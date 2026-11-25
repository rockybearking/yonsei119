package com.yonsei119.service;

import com.yonsei119.config.Yonsei119Properties;
import com.yonsei119.dto.EmergencySnapshotDto;
import com.yonsei119.dto.HospitalDto;
import com.yonsei119.dto.HospitalTypeDto;
import com.yonsei119.util.GeoUtils;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 7대 공공데이터를 기관코드(`hpid`) 기준으로 하나로 병합하고,
 *          메모리 캐시 · 경량 목록 · SHA-256 ETag를 관리하는 메인 주방장 서비스
 * - 실행 시점 :
 *   ㄴ 서버 시작 시 `@Service` 싱글톤 빈으로 생성됨
 *   ㄴ 부팅 직후 `warmUpCacheOnStartup()`이 초기 데이터를 사전 적재함
 *   ㄴ 이후 60초마다 `scheduledBackgroundRefresh()`가 실시간 병상·공지를 자동 갱신함
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [Scheduler / Controller]        [EmergencyDataService]            [NmcOpenApiClient]      [HospitalClassifier]
 *                |                              |                               |                        |
 *                |-- 1. warmUp / 60s refresh -->|                               |                        |  초기 적재 또는 주기적 갱신
 *                |                              |-- 2. fetchAll / fetchHot() -->|                        |  공공데이터 병렬 수집 요청
 *                |                              |<-- 3. raw 7 datasets ---------|                        |  파싱된 원시 맵 목록 반환
 *                |                              |-- 4. classify(hospital) ------|----------------------->|  47개 상급종합 · 권역 판정
 *                |                              |<-- 5. HospitalTypeDto --------|------------------------|  종별 등급 반환
 *                |                              |-- 6. storeSnapshotIndexes()   |                        |  원본 · 경량본 · ETag 생성
 *                |<-- 7. 0ms cached bytes ------|                               |                        |  /api/hospitals 즉시 응답
 *                v                              v                               v                        v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record           : 내부 `SerializedPayload`, `SerializedSnapshot` 선언 키워드
 *   ㄴ volatile         : 멀티스레드 최신 캐시 참조 가시성을 보장하는 문법 키워드
 *   ㄴ ReentrantLock    : 동시 캐시 갱신 중복을 막는 표준 내장 잠금 클래스
 *   ㄴ AtomicBoolean    : 백그라운드 갱신 실행 중 여부를 원자적으로 제어하는 클래스
 *   ㄴ Executors        : 가상 스레드 실행기를 생성하는 표준 내장 팩토리 클래스
 *   ㄴ MessageDigest    : SHA-256 해시로 ETag를 계산하는 표준 내장 암호화 클래스
 *   ㄴ HexFormat        : 바이트 다이제스트를 16진수 문자열로 바꾸는 표준 내장 클래스
 *   ㄴ ZonedDateTime    : 한국 표준시(`Asia/Seoul`) 갱신 시각 생성 클래스
 *   ㄴ Map / List / Set : 병원 색인 · 목록 · 필수 병상 키 집합 표준 인터페이스
 * - Spring 프레임워크
 *   ㄴ @Service       : 비즈니스 서비스 빈 등록 어노테이션
 *   ㄴ @EventListener : `ApplicationReadyEvent` 기동 완료 시점 감지 어노테이션
 *   ㄴ @Scheduled     : 60초 간격 주기적 자동 실행 어노테이션
 * - 외부 라이브러리
 *   ㄴ Jackson (`JsonMapper`)       : 스냅샷 DTO를 UTF-8 JSON 바이트로 직렬화
 *   ㄴ Micrometer (`MeterRegistry`) : 캐시된 병원 수 · 적중률 지표 기록
 *   ㄴ SLF4J (`Logger`)             : 캐시 적재 소요시간 및 장애 로그 기록
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 호출처
 *   ㄴ EmergencyApiController.java : `health()`, `getHospitalsHttp()`, `getHospitalDetail()`,
 *                                    `rankDirections()`, `geocode()`
 *   ㄴ Yonsei119BackendTests.java  : Test 4 · 10 · 14 · 17 스냅샷 병합 및 ETag 검증
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/search-controls.js : `fetchData()` (`GET /api/hospitals?compact=true`)
 *   ㄴ frontend/js/hospital-sheet.js  : `hydrateHospitalDetailIfNeeded()`
 * - IntelliJ 추적 단축키
 *   ㄴ Java 호출 계층 보기 : 메서드명 위에서 `Ctrl + Alt + H`
 *   ㄴ 병상 코드 사용처 검색 : `Ctrl + Shift + F`로 `ESSENTIAL_UI_BED_KEYS` 또는 `hvec` 검색
 */
@Service
public class EmergencyDataService {

    private static final Logger log = LoggerFactory.getLogger(EmergencyDataService.class);
    private static final ZoneId KST_ZONE = ZoneId.of("Asia/Seoul");
    private static final long MIN_FORCE_REFRESH_COOLDOWN_SECONDS = 15L;
    // 외부 공공데이터포털 장애 시에도 Render 배포가 무한 대기하지 않도록 최대 30초 워밍업 안전 상한을 둠
    private static final long MAX_WARMUP_WAIT_SECONDS = 30L;

    /**
     * 초기 로딩(?compact=true) 시 병원 상세 시트(응급실·입원병상·장비·당직의 연락처)에서 즉시 사용하는 필수 태그 화이트리스트.
     * (개발자 모드의 전체 원시 필드는 /api/hospitals/{hpid} 단건 API에서 100% 무손실 제공함)
     */
    private static final Set<String> ESSENTIAL_UI_BED_KEYS = Set.of(
            "hvec", "hvs01", "hv28", "hvs02", "hv60", "hvs60", "hv61", "hvs61",
            "hv30", "hvs04", "hv29", "hvs03", "hv14", "hvs47", "hv13", "hvs46",
            "hv16", "hvs49", "hv15", "hvs48", "hv27", "hvs59",
            "hvicc", "hvs17", "hv35", "hvs18", "hv32", "hvs09", "hvncc", "hvs08",
            "hv2", "hvs06", "hv34", "hvs15", "hvcc", "hvs11", "hv8", "hvs13",
            "hv3", "hvs07", "hv6", "hvs12", "hvccc", "hvs16",
            "hv36", "hvs19", "hv19", "hvs52", "hv21", "hvs53", "hv31", "hvs05",
            "hv17", "hvs50", "hv18", "hvs51", "hv37", "hvs20", "hv33", "hvs10",
            "hv9", "hvs14", "hv38", "hvs21", "hv39", "hvs23",
            "hv22", "hvs54", "hv23", "hvs55", "hv24", "hvs56", "hv25", "hvs57", "hv26", "hvs58",
            "hvgc", "hvs38", "hv4", "hv5", "hv7", "hv41", "hvs25", "hv40", "hvs24",
            "hvoc", "hvs22", "hv42", "hvs26", "hv43", "hvs36",
            "hvventiayn", "hvs30", "hvventisoayn", "hv10", "hvs31", "hvincuayn", "hv11", "hvs32",
            "hvcrrtayn", "hvs33", "hvecmoayn", "hvs34", "hvhypoayn", "hvs35",
            "hvoxyayn", "hvs37", "hvctayn", "hvs27", "hvmriayn", "hvs28",
            "hvangioayn", "hvs29", "hvamyn", "hv1", "hv12", "hvdnm", "hvidate", "dutytel3"
    );

    private final NmcOpenApiClient openApiClient;
    private final HospitalClassifier classifier;
    private final Yonsei119Properties properties;
    private final JsonMapper jsonMapper;
    private final MeterRegistry meterRegistry;
    private final Instant startupInstant = Instant.now();
    private final ReentrantLock cacheLock = new ReentrantLock();
    private final AtomicBoolean backgroundRefreshInProgress = new AtomicBoolean(false);
    private final ExecutorService backgroundRefreshExecutor =
            Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("yonsei119-cache-warmer-", 0).factory());

    private volatile boolean initialWarmupCompleted;
    private volatile EmergencySnapshotDto cachedSnapshot;
    private volatile EmergencySnapshotDto cachedCompactSnapshot;
    private volatile byte[] cachedFullJsonBytes;
    private volatile byte[] cachedCompactJsonBytes;
    private volatile String cachedFullEtag;
    private volatile String cachedCompactEtag;
    private volatile Map<String, HospitalDto> cachedHospitalById = Map.of();
    private volatile Map<String, List<Map<String, String>>> cachedColdDatasets = Map.of();
    private volatile Instant cachedAt = Instant.EPOCH;
    private volatile Instant coldCachedAt = Instant.EPOCH;

    public EmergencyDataService(
            NmcOpenApiClient openApiClient,
            HospitalClassifier classifier,
            Yonsei119Properties properties
    ) {
        this(openApiClient, classifier, properties, null, null);
    }

    @Autowired
    public EmergencyDataService(
            NmcOpenApiClient openApiClient,
            HospitalClassifier classifier,
            Yonsei119Properties properties,
            ObjectProvider<JsonMapper> jsonMapperProvider,
            ObjectProvider<MeterRegistry> meterRegistryProvider
    ) {
        this.openApiClient = openApiClient;
        this.classifier = classifier;
        this.properties = properties;
        JsonMapper resolvedMapper = jsonMapperProvider != null ? jsonMapperProvider.getIfAvailable() : null;
        this.jsonMapper = resolvedMapper != null ? resolvedMapper : JsonMapper.builder().build();
        this.meterRegistry = meterRegistryProvider != null ? meterRegistryProvider.getIfAvailable() : null;

        // 자동 워밍업 대상(인증키 존재 + auto-refresh=true)일 때만 초기 캐시 적재 완료 전까지 false로 시작함
        boolean willWarmUpOnStartup = properties.nemc() != null
                && properties.nemc().autoRefreshEnabled()
                && properties.nemc().hasServiceKey();
        this.initialWarmupCompleted = !willWarmUpOnStartup;

        if (this.meterRegistry != null) {
            Gauge.builder("yonsei119.hospitals.cached.count", this,
                            service -> service.cachedSnapshot != null ? service.cachedSnapshot.totalCount() : 0)
                    .description("Currently cached emergency hospitals count")
                    .register(this.meterRegistry);
        }
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: Render 무료 플랜 콜드스타트 시 초기 병원 데이터가 메모리에 준비되었는지 판별함
     * - 흐름:
     *   GET /api/health -> isReadyForTraffic()
     *   ㄴ 초기 캐시 완료(initialWarmupCompleted) 또는 스냅샷 존재: true 반환 (HTTP 200 -> Render가 트래픽 연결)
     *   ㄴ 인증키 미설정·자동갱신 비활성·30초 안전 상한 경과: true 반환 (배포 무한 대기 방지)
     *   ㄴ 초기 7종 공공데이터 적재 진행 중: false 반환 (HTTP 503 -> Render 자체 로딩 화면 유지!)
     * - 사용처: EmergencyApiController.health()
     */
    public boolean isReadyForTraffic() {
        if (this.initialWarmupCompleted || this.cachedSnapshot != null) {
            return true;
        }
        if (properties.nemc() == null || !properties.nemc().autoRefreshEnabled() || !properties.nemc().hasServiceKey()) {
            return true;
        }
        return Instant.now().isAfter(this.startupInstant.plusSeconds(MAX_WARMUP_WAIT_SECONDS));
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 내장 Tomcat 포트 개방 직후 백그라운드에서 전국 응급의료기관 초기 캐시를 적재함
     * - 실행 시점: ApplicationReadyEvent 발생 시 스프링이 자동으로 1회 호출함
     */
    @EventListener(ApplicationReadyEvent.class)
    public void warmUpCacheOnStartup() {
        if (properties.nemc() == null || !properties.nemc().autoRefreshEnabled() || !properties.nemc().hasServiceKey()) {
            this.initialWarmupCompleted = true;
            log.info("NEMC 자동 캐시 사전 로딩(Pre-warming) 생략 상태입니다 (인증키 미설정 또는 auto-refresh-enabled=false).");
            return;
        }
        log.info("서버 기동 완료 — 백그라운드에서 전국 응급의료기관 초기 캐시 사전 로딩(Pre-warming)을 시작합니다.");
        triggerAsyncBackgroundRefresh("서버 시작 직후 사전 로딩(Pre-warming)");
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 60초(기본값)마다 실시간 병상·응급메시지·중증질환(Hot 3종) 캐시를 자동 동기화함
     * - 실행 시점: @EnableScheduling에 의해 설정된 refresh-interval-ms 간격으로 자동 반복 실행됨
     */
    @Scheduled(
            initialDelayString = "${yonsei119.nemc.refresh-interval-ms:60000}",
            fixedDelayString = "${yonsei119.nemc.refresh-interval-ms:60000}"
    )
    public void scheduledBackgroundRefresh() {
        if (properties.nemc() == null || !properties.nemc().autoRefreshEnabled()) {
            return;
        }
        triggerAsyncBackgroundRefresh("주기적 스케줄러(@Scheduled) 실시간 Hot/Cold 자동 갱신");
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 중복 갱신이 겹치지 않도록 AtomicBoolean으로 한 번에 1개 가상 스레드만 백그라운드 갱신을 실행함
     * - 사용처: warmUpCacheOnStartup(), scheduledBackgroundRefresh(), getSnapshot()의 Stale-While-Revalidate 분기
     */
    public void triggerAsyncBackgroundRefresh(String reason) {
        if (!backgroundRefreshInProgress.compareAndSet(false, true)) {
            return;
        }
        CompletableFuture.runAsync(() -> {
            try {
                refreshCacheSynchronously(reason, false, null);
            } finally {
                this.initialWarmupCompleted = true;
                backgroundRefreshInProgress.set(false);
            }
        }, backgroundRefreshExecutor);
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 전체(compact=false) 또는 경량(compact=true) 병원 스냅샷 DTO를 조회함
     * - 흐름:
     *   호출 진입 -> 캐시 존재 확인
     *   ㄴ 일반 조회 & 캐시 있음: TTL(60초) 경과 시 백그라운드 갱신만 예약하고 직전 캐시를 즉시 반환(0ms 지연)
     *   ㄴ 강제 새로고침 & 15초 쿨다운 이내: 외부 API 보호를 위해 직전 캐시 즉시 반환
     *   ㄴ 최초 콜드스타트 또는 쿨다운 경과 강제 새로고침: refreshCacheSynchronously() 동기 수집 후 반환
     * - 사용처: getSerializedSnapshot(), EmergencyApiController(getHospitals, rankDirections, geocode)
     */
    public EmergencySnapshotDto getSnapshot(boolean forceRefresh, boolean compact) {
        long hotTtlSeconds = Math.max(5L, properties.nemc().cacheTtlSeconds());
        Instant now = Instant.now();

        EmergencySnapshotDto currentFull = this.cachedSnapshot;
        if (!forceRefresh && currentFull != null) {
            if (now.isAfter(this.cachedAt.plusSeconds(hotTtlSeconds))) {
                triggerAsyncBackgroundRefresh("Hot TTL 경과에 따른 비동기 Stale-While-Revalidate 갱신");
            }
            recordSnapshotMetric("hit", compact);
            EmergencySnapshotDto target = compact && this.cachedCompactSnapshot != null
                    ? this.cachedCompactSnapshot
                    : currentFull;
            return asCachedSnapshot(target);
        }

        if (forceRefresh && currentFull != null
                && now.isBefore(this.cachedAt.plusSeconds(MIN_FORCE_REFRESH_COOLDOWN_SECONDS))) {
            recordSnapshotMetric("hit", compact);
            EmergencySnapshotDto target = compact && this.cachedCompactSnapshot != null
                    ? this.cachedCompactSnapshot
                    : currentFull;
            return asCachedSnapshot(target);
        }

        recordSnapshotMetric("miss", compact);
        EmergencySnapshotDto refreshed = refreshCacheSynchronously(
                forceRefresh ? "사용자 수동 새로고침 요청" : "최초 콜드 스타트 동기 수집",
                forceRefresh,
                now
        );
        if (compact && this.cachedCompactSnapshot != null) {
            return refreshed.cached() ? asCachedSnapshot(this.cachedCompactSnapshot) : this.cachedCompactSnapshot;
        }
        return refreshed;
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 기관코드(hpid)로 60여 개 모든 원시 태그가 보존된 병원 상세 DTO를 O(1) 해시맵에서 즉시 꺼냄
     * - 사용처: EmergencyApiController.getHospitalDetail() (GET /api/hospitals/{hpid})
     */
    public HospitalDto getHospitalById(String hpid) {
        if (hpid == null || hpid.isBlank()) {
            return null;
        }
        String normalizedId = hpid.trim();
        if (this.cachedSnapshot == null) {
            getSnapshot(false, false);
        }
        return this.cachedHospitalById.get(normalizedId);
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: ReentrantLock 안에서 단 하나의 스레드만 실제 OpenAPI 수집·병합·인덱스 교체를 수행하게 직렬화함
     * - 흐름:
     *   cacheLock.lock() -> 대기 중 다른 스레드가 이미 갱신했는지 재확인(Double-Check)
     *   -> buildFreshSnapshot() -> storeSnapshotIndexes() -> finally { initialWarmupCompleted = true; unlock(); }
     */
    private EmergencySnapshotDto refreshCacheSynchronously(
            String reason,
            boolean respectForceCooldown,
            Instant requestEnteredAt
    ) {
        cacheLock.lock();
        try {
            EmergencySnapshotDto current = this.cachedSnapshot;
            Instant currentCachedAt = this.cachedAt;
            if (current != null) {
                if (requestEnteredAt != null && currentCachedAt.isAfter(requestEnteredAt)) {
                    return asCachedSnapshot(current);
                }
                if (respectForceCooldown
                        && Instant.now().isBefore(currentCachedAt.plusSeconds(MIN_FORCE_REFRESH_COOLDOWN_SECONDS))) {
                    return asCachedSnapshot(current);
                }
            }

            long startMs = System.currentTimeMillis();
            try {
                EmergencySnapshotDto fresh = buildFreshSnapshot(respectForceCooldown);
                long elapsedMs = System.currentTimeMillis() - startMs;
                if (!fresh.hospitals().isEmpty() || current == null) {
                    storeSnapshotIndexes(fresh);
                    this.cachedAt = Instant.now();
                    log.info("응급의료기관 캐시 갱신 완료 [사유: {}] — 총 {}개 기관 ({}ms 소요)",
                            reason, fresh.totalCount(), elapsedMs);
                    return fresh;
                }
                log.warn("신규 수집된 병원 목록이 비어 있어 직전 정상 캐시 스냅샷을 유지합니다 [사유: {}]", reason);
                return asCachedSnapshot(current);
            } catch (Exception ex) {
                log.error("응급의료 데이터 스냅샷 갱신 중 오류 발생 [사유: {}]: {}", reason, ex.getMessage(), ex);
                if (current != null) {
                    return asCachedSnapshot(current);
                }
                throw ex;
            }
        } finally {
            this.initialWarmupCompleted = true;
            cacheLock.unlock();
        }
    }

    /*
     * [역할 및 성능 최적화 원리]
     * - 역할: 스냅샷이 갱신될 때 단 1회만 ① hpid 해시맵, ② 경량 목록 스냅샷, ③ JSON 직렬화 바이트와 ETag를 미리 만들어 둠
     * - 효과: 수백 명의 사용자가 동시에 `/api/hospitals?compact=true`를 호출해도 매번 JSON 변환을 반복하지 않고 바이트 배열을 즉시 전송함
     */
    private void storeSnapshotIndexes(EmergencySnapshotDto fullSnapshot) {
        if (fullSnapshot == null) {
            this.cachedSnapshot = null;
            this.cachedCompactSnapshot = null;
            this.cachedFullJsonBytes = null;
            this.cachedCompactJsonBytes = null;
            this.cachedFullEtag = null;
            this.cachedCompactEtag = null;
            this.cachedHospitalById = Map.of();
            return;
        }

        Map<String, HospitalDto> byId = new LinkedHashMap<>(fullSnapshot.hospitals().size());
        List<HospitalDto> compactList = new ArrayList<>(fullSnapshot.hospitals().size());
        for (HospitalDto hospital : fullSnapshot.hospitals()) {
            if (hospital.id() != null && !hospital.id().isBlank()) {
                byId.put(hospital.id(), hospital);
            }
            compactList.add(hospital.toCompactSummary(ESSENTIAL_UI_BED_KEYS));
        }

        EmergencySnapshotDto compactSnapshot = new EmergencySnapshotDto(
                fullSnapshot.updatedAt(),
                fullSnapshot.cached(),
                fullSnapshot.totalCount(),
                fullSnapshot.tertiaryCount(),
                fullSnapshot.regionalCount(),
                fullSnapshot.medicalCount(),
                fullSnapshot.traumaCount(),
                fullSnapshot.otherCount(),
                fullSnapshot.sources(),
                fullSnapshot.endpointCounts(),
                List.copyOf(compactList)
        );

        SerializedPayload fullPayload = serializeAndComputeEtag(asCachedSnapshot(fullSnapshot));
        SerializedPayload compactPayload = serializeAndComputeEtag(asCachedSnapshot(compactSnapshot));

        this.cachedSnapshot = fullSnapshot;
        this.cachedHospitalById = Map.copyOf(byId);
        this.cachedCompactSnapshot = compactSnapshot;
        this.cachedFullJsonBytes = fullPayload.bytes();
        this.cachedFullEtag = fullPayload.etag();
        this.cachedCompactJsonBytes = compactPayload.bytes();
        this.cachedCompactEtag = compactPayload.etag();
    }

    /*
     * [역할 및 사용처]
     * - 역할: 통합 테스트에서 외부 API 호출 없이 메모리 스냅샷을 직접 주입하거나 초기화함
     * - 사용처: Yonsei119BackendTests
     */
    public void setCachedSnapshotForTest(EmergencySnapshotDto snapshot) {
        cacheLock.lock();
        try {
            storeSnapshotIndexes(snapshot);
            this.cachedAt = snapshot != null ? Instant.now() : Instant.EPOCH;
            if (snapshot == null) {
                this.cachedColdDatasets = Map.of();
                this.coldCachedAt = Instant.EPOCH;
            } else {
                this.initialWarmupCompleted = true;
            }
        } finally {
            cacheLock.unlock();
        }
    }

    /** 통합 테스트에서 콜드스타트 워밍업 상태(503 ↔ 200 전환)를 검증할 때 사용하는 테스트 보조 메서드 */
    public void setInitialWarmupCompletedForTest(boolean completed) {
        this.initialWarmupCompleted = completed;
    }

    @PreDestroy
    public void shutdown() {
        backgroundRefreshExecutor.shutdownNow();
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 마스터 데이터(Cold 4종, 6시간 수명) 캐시가 유효하면 실시간 데이터(Hot 3종)만 수집해 합치고, 만료 시 7종 전체를 새로 수집함
     * - 흐름:
     *   hasValidColdCache 판별
     *   ㄴ true  -> cachedColdDatasets(4종) + openApiClient.fetchHotDatasets()(3종) 결합
     *   ㄴ false -> openApiClient.fetchAllDatasets()(7종) 수집 및 Cold 캐시 갱신
     *   -> mergeDatasetsIntoSnapshot(combinedRaw) 호출
     */
    public EmergencySnapshotDto buildFreshSnapshot(boolean forceColdRefresh) {
        Instant now = Instant.now();
        long coldTtlSeconds = properties.nemc().effectiveColdCacheTtlSeconds();
        boolean hasValidColdCache = !forceColdRefresh
                && !this.cachedColdDatasets.isEmpty()
                && !this.cachedColdDatasets.getOrDefault("list", List.of()).isEmpty()
                && now.isBefore(this.coldCachedAt.plusSeconds(coldTtlSeconds));

        Map<String, List<Map<String, String>>> combinedRaw = new LinkedHashMap<>();
        if (hasValidColdCache) {
            combinedRaw.putAll(this.cachedColdDatasets);
            combinedRaw.putAll(openApiClient.fetchHotDatasets());
        } else {
            Map<String, List<Map<String, String>>> allFetched = openApiClient.fetchAllDatasets();
            combinedRaw.putAll(allFetched);
            if (!allFetched.getOrDefault("list", List.of()).isEmpty()) {
                Map<String, List<Map<String, String>>> nextCold = new LinkedHashMap<>();
                for (String coldKey : NmcOpenApiClient.COLD_ENDPOINTS.keySet()) {
                    nextCold.put(coldKey, allFetched.getOrDefault(coldKey, List.of()));
                }
                this.cachedColdDatasets = Map.copyOf(nextCold);
                this.coldCachedAt = now;
            }
        }
        return mergeDatasetsIntoSnapshot(combinedRaw);
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 7종 OpenAPI에서 따로 내려온 조각 데이터를 병원 고유코드(hpid) 기준으로 하나의 HospitalDto로 교차 조립함
     * - 흐름:
     *   7종 원시 리스트 -> hpid 기준 해시맵 색인(1:1 및 공지 1:N)
     *   -> 각 병원별 루프:
     *       ㄴ 1) 기본정보(basic + list 결측 보완) 및 외상센터(trauma) 병합
     *       ㄴ 2) 실시간 병상(beds)·응급메시지(messages)·중증질환(severe) 결합 (일시 장애 시 직전 스냅샷 값 복원)
     *       ㄴ 3) 위경도 파싱 및 대한민국 유효 좌표 범위(GeoUtils.isValidKoreaCoordinate) 필터링
     *       ㄴ 4) HospitalClassifier로 권역응급·상급종합·의료원·기타 종별 판별 및 통계 집계
     *   -> 불변 EmergencySnapshotDto 생성·반환
     * - 사용처: buildFreshSnapshot(), Yonsei119BackendTests(Test 4, Test 10)
     */
    public EmergencySnapshotDto mergeDatasetsIntoSnapshot(Map<String, List<Map<String, String>>> rawDatasets) {
        List<Map<String, String>> listItems = rawDatasets.getOrDefault("list", List.of());
        List<Map<String, String>> basicItems = rawDatasets.getOrDefault("basic", List.of());
        List<Map<String, String>> bedItems = rawDatasets.getOrDefault("beds", List.of());
        List<Map<String, String>> messageItems = rawDatasets.getOrDefault("messages", List.of());
        List<Map<String, String>> severeItems = rawDatasets.getOrDefault("severe", List.of());
        List<Map<String, String>> traumaListItems = rawDatasets.getOrDefault("traumaList", List.of());
        List<Map<String, String>> traumaBasicItems = rawDatasets.getOrDefault("traumaBasic", List.of());

        Map<String, Map<String, String>> listById = groupSingleById(listItems);
        Map<String, Map<String, String>> basicById = groupSingleById(basicItems);
        Map<String, Map<String, String>> bedsById = groupSingleById(bedItems);
        Map<String, List<Map<String, String>>> messagesById = groupMultiById(messageItems);
        Map<String, Map<String, String>> severeById = groupSingleById(severeItems);
        Map<String, Map<String, String>> traumaListById = groupSingleById(traumaListItems);
        Map<String, Map<String, String>> traumaBasicById = groupSingleById(traumaBasicItems);

        Map<String, HospitalDto> previousById = this.cachedHospitalById;
        Set<String> uniqueIds = new LinkedHashSet<>(listById.keySet());
        uniqueIds.addAll(traumaListById.keySet());
        if (uniqueIds.isEmpty() && !previousById.isEmpty()) {
            uniqueIds.addAll(previousById.keySet());
        }

        List<HospitalDto> hospitals = new ArrayList<>(uniqueIds.size());
        int tertiaryCount = 0;
        int regionalCount = 0;
        int medicalCount = 0;
        int traumaCount = 0;
        int otherCount = 0;

        for (String id : uniqueIds) {
            HospitalDto prev = previousById.get(id);
            Map<String, String> listFields = listById.getOrDefault(id, traumaListById.getOrDefault(id, Map.of()));
            Map<String, String> basicFields = basicById.getOrDefault(id, Map.of());
            if (basicFields.isEmpty() && prev != null && prev.basic() != null) {
                basicFields = prev.basic();
            }

            Map<String, String> mergedBasic = new LinkedHashMap<>(basicFields);
            for (Map.Entry<String, String> entry : listFields.entrySet()) {
                String existing = mergedBasic.get(entry.getKey());
                if (existing == null || existing.isBlank()) {
                    mergedBasic.put(entry.getKey(), entry.getValue());
                }
            }

            Map<String, String> traumaFields = traumaBasicById.getOrDefault(
                    id,
                    traumaListById.getOrDefault(id, null)
            );
            if (traumaFields == null && traumaListItems.isEmpty() && traumaBasicItems.isEmpty()
                    && prev != null && prev.trauma() != null) {
                traumaFields = prev.trauma();
            }

            Map<String, String> beds = bedsById.get(id);
            if (beds == null && bedItems.isEmpty() && prev != null && prev.beds() != null) {
                beds = prev.beds();
            }

            Map<String, String> severe = severeById.get(id);
            if (severe == null && severeItems.isEmpty() && prev != null && prev.severe() != null) {
                severe = prev.severe();
            }

            List<Map<String, String>> messages = messagesById.getOrDefault(id, List.of());
            if (messages.isEmpty() && messageItems.isEmpty() && prev != null
                    && prev.messages() != null && !prev.messages().isEmpty()) {
                messages = prev.messages();
            }

            double lat = parseCoordinate(
                    firstNonBlank(
                            listFields.get("wgs84lat"),
                            basicFields.get("wgs84lat"),
                            traumaFields != null ? traumaFields.get("wgs84lat") : null,
                            listFields.get("latitude")
                    )
            );
            if (!Double.isFinite(lat) && prev != null) {
                lat = prev.lat();
            }

            double lng = parseCoordinate(
                    firstNonBlank(
                            listFields.get("wgs84lon"),
                            basicFields.get("wgs84lon"),
                            traumaFields != null ? traumaFields.get("wgs84lon") : null,
                            listFields.get("longitude")
                    )
            );
            if (!Double.isFinite(lng) && prev != null) {
                lng = prev.lng();
            }

            // (0.0, 0.0) 등 대한민국 영역 밖 오류 좌표는 지도 마커 왜곡을 막기 위해 제외
            if (!GeoUtils.isValidKoreaCoordinate(lat, lng)) {
                continue;
            }

            String name = displayValue(firstNonBlank(
                    listFields.get("dutyname"),
                    basicFields.get("dutyname"),
                    prev != null ? prev.name() : null
            ));
            String address = displayValue(firstNonBlank(
                    listFields.get("dutyaddr"),
                    basicFields.get("dutyaddr"),
                    prev != null ? prev.address() : null
            ));
            String tel = displayValue(firstNonBlank(
                    listFields.get("dutytel1"),
                    basicFields.get("dutytel1"),
                    prev != null ? prev.tel() : null
            ));
            String erTel = displayValue(firstNonBlank(
                    listFields.get("dutytel3"),
                    basicFields.get("dutytel3"),
                    beds != null ? beds.get("dutytel3") : null,
                    prev != null ? prev.erTel() : null
            ));

            Map<String, String> classificationFields = new LinkedHashMap<>(mergedBasic);
            String resolvedDutyName = firstNonBlank(listFields.get("dutyname"), basicFields.get("dutyname"));
            if (!resolvedDutyName.isEmpty()) {
                classificationFields.put("dutyname", resolvedDutyName);
            }
            String resolvedDutyAddr = firstNonBlank(listFields.get("dutyaddr"), basicFields.get("dutyaddr"));
            if (!resolvedDutyAddr.isEmpty()) {
                classificationFields.put("dutyaddr", resolvedDutyAddr);
            }

            boolean upstreamIdentityMissing = listItems.isEmpty() && basicItems.isEmpty() && traumaListItems.isEmpty();
            boolean regional = (upstreamIdentityMissing && prev != null)
                    ? (prev.regional() || classifier.isRegional(classificationFields))
                    : classifier.isRegional(classificationFields);
            HospitalTypeDto type = (upstreamIdentityMissing && prev != null && prev.type() != null)
                    ? prev.type()
                    : classifier.classify(classificationFields, name);
            boolean hasTrauma = traumaFields != null && !traumaFields.isEmpty();

            if (regional) {
                regionalCount++;
            }
            if ("tertiary".equals(type.group())) {
                tertiaryCount++;
            } else if ("medical".equals(type.group())) {
                medicalCount++;
            } else {
                otherCount++;
            }
            if (hasTrauma) {
                traumaCount++;
            }

            hospitals.add(new HospitalDto(
                    id,
                    name,
                    address,
                    tel,
                    erTel,
                    lat,
                    lng,
                    regional,
                    type,
                    Map.copyOf(mergedBasic),
                    hasTrauma ? Map.copyOf(traumaFields) : null,
                    beds != null ? Map.copyOf(beds) : null,
                    List.copyOf(messages),
                    severe != null ? Map.copyOf(severe) : null
            ));
        }

        Map<String, Integer> endpointCounts = new LinkedHashMap<>();
        endpointCounts.put("list", listItems.size());
        endpointCounts.put("basic", basicItems.size());
        endpointCounts.put("beds", bedItems.size());
        endpointCounts.put("messages", messageItems.size());
        endpointCounts.put("severe", severeItems.size());
        endpointCounts.put("traumaList", traumaListItems.size());
        endpointCounts.put("traumaBasic", traumaBasicItems.size());

        Map<String, Boolean> sources = new LinkedHashMap<>();
        sources.put("list", !listItems.isEmpty() || !previousById.isEmpty());
        sources.put("basic", !basicItems.isEmpty() || !previousById.isEmpty());
        sources.put("beds", !bedItems.isEmpty());
        sources.put("messages", rawDatasets.containsKey("messages") && (!messageItems.isEmpty() || !bedItems.isEmpty()));
        sources.put("severe", !severeItems.isEmpty());
        sources.put("traumaList", !traumaListItems.isEmpty());
        sources.put("traumaBasic", !traumaBasicItems.isEmpty());

        String updatedAt = ZonedDateTime.now(KST_ZONE)
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);

        return new EmergencySnapshotDto(
                updatedAt,
                false,
                hospitals.size(),
                tertiaryCount,
                regionalCount,
                medicalCount,
                traumaCount,
                otherCount,
                Map.copyOf(sources),
                Map.copyOf(endpointCounts),
                List.copyOf(hospitals)
        );
    }

    /** 병원당 1건인 API 응답 리스트를 `hpid -> 필드 맵`으로 색인함 */
    private static Map<String, Map<String, String>> groupSingleById(List<Map<String, String>> items) {
        Map<String, Map<String, String>> map = new LinkedHashMap<>();
        for (Map<String, String> item : items) {
            String rawId = item.get("hpid");
            if (rawId == null || rawId.isBlank()) {
                continue;
            }
            map.put(rawId.trim(), item);
        }
        return map;
    }

    /** 병원 1곳이 여러 개의 응급메시지를 가지는 1:N API 응답을 `hpid -> 공지 리스트`로 묶음 */
    private static Map<String, List<Map<String, String>>> groupMultiById(List<Map<String, String>> items) {
        Map<String, List<Map<String, String>>> map = new LinkedHashMap<>();
        for (Map<String, String> item : items) {
            String rawId = item.get("hpid");
            if (rawId == null || rawId.isBlank()) {
                continue;
            }
            map.computeIfAbsent(rawId.trim(), _ -> new ArrayList<>()).add(Map.copyOf(item));
        }
        return map;
    }

    private static double parseCoordinate(String text) {
        if (text == null || text.isBlank()) {
            return Double.NaN;
        }
        try {
            return Double.parseDouble(text.trim());
        } catch (NumberFormatException ex) {
            return Double.NaN;
        }
    }

    private static String firstNonBlank(String... candidates) {
        if (candidates == null) {
            return "";
        }
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.trim();
            }
        }
        return "";
    }

    private static String displayValue(String value) {
        if (value == null || value.isBlank()) {
            return "미정보";
        }
        return value.trim();
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 컨트롤러의 `/api/hospitals` 요청에 대해 미리 직렬화된 UTF-8 JSON 바이트와 ETag를 함께 반환함
     * - 사용처: EmergencyApiController.getHospitalsHttp()
     */
    public SerializedSnapshot getSerializedSnapshot(boolean forceRefresh, boolean compact) {
        EmergencySnapshotDto dto = getSnapshot(forceRefresh, compact);
        byte[] bytes = compact ? this.cachedCompactJsonBytes : this.cachedFullJsonBytes;
        String etag = compact ? this.cachedCompactEtag : this.cachedFullEtag;
        if (bytes == null || etag == null) {
            SerializedPayload fallback = serializeAndComputeEtag(dto);
            bytes = fallback.bytes();
            etag = fallback.etag();
        }
        return new SerializedSnapshot(dto, bytes, etag);
    }

    public void recordNotModifiedHit(boolean compact) {
        recordSnapshotMetric("not_modified", compact);
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 브라우저가 보낸 `If-None-Match` 헤더와 서버의 현재 ETag가 일치하는지 비교함 (`W/` 접두사 및 `-gzip` 접미사 정규화 지원)
     * - 사용처: EmergencyApiController.getHospitalsHttp() (일치 시 본문 없이 HTTP 304 반환)
     */
    public static boolean matchesEtag(String ifNoneMatchHeader, String currentEtag) {
        if (ifNoneMatchHeader == null || ifNoneMatchHeader.isBlank() || currentEtag == null || currentEtag.isBlank()) {
            return false;
        }
        String normalizedCurrent = normalizeEtagToken(currentEtag);
        for (String candidate : ifNoneMatchHeader.split(",")) {
            String trimmed = candidate.trim();
            if ("*".equals(trimmed) || normalizedCurrent.equals(normalizeEtagToken(trimmed))) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeEtagToken(String raw) {
        String s = raw.trim();
        if (s.startsWith("W/") || s.startsWith("w/")) {
            s = s.substring(2).trim();
        }
        if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2) {
            s = s.substring(1, s.length() - 1);
        }
        if (s.endsWith("-gzip")) {
            s = s.substring(0, s.length() - 5);
        }
        return s;
    }

    private void recordSnapshotMetric(String result, boolean compact) {
        if (meterRegistry != null) {
            meterRegistry.counter("yonsei119.cache.snapshot.requests",
                            "result", result,
                            "compact", String.valueOf(compact))
                    .increment();
        }
    }

    private SerializedPayload serializeAndComputeEtag(EmergencySnapshotDto dto) {
        try {
            byte[] jsonBytes = jsonMapper.writeValueAsBytes(dto);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(jsonBytes);
            String shortHex = HexFormat.of().formatHex(digest, 0, 10);
            String etag = "W/\"" + shortHex + "-" + Long.toHexString(jsonBytes.length) + "\"";
            return new SerializedPayload(jsonBytes, etag);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        } catch (Exception ex) {
            log.warn("스냅샷 사전 직렬화 실패, 빈 폴백 사용: {}", ex.getMessage());
            byte[] fallback = "{}".getBytes(StandardCharsets.UTF_8);
            return new SerializedPayload(fallback, "W/\"0\"");
        }
    }

    private record SerializedPayload(byte[] bytes, String etag) {
    }

    /** 컨트롤러가 HTTP 200 바이트 응답 또는 304 Not Modified 판정에 사용하는 직렬화 패키지 레코드 */
    public record SerializedSnapshot(EmergencySnapshotDto dto, byte[] jsonBytes, String etag) {
    }

    private static EmergencySnapshotDto asCachedSnapshot(EmergencySnapshotDto snapshot) {
        return new EmergencySnapshotDto(
                snapshot.updatedAt(),
                true,
                snapshot.totalCount(),
                snapshot.tertiaryCount(),
                snapshot.regionalCount(),
                snapshot.medicalCount(),
                snapshot.traumaCount(),
                snapshot.otherCount(),
                snapshot.sources(),
                snapshot.endpointCounts(),
                snapshot.hospitals()
        );
    }
}
