package com.yonsei119.service;

import com.yonsei119.config.Yonsei119Properties;
import com.yonsei119.dto.EmergencySnapshotDto;
import com.yonsei119.dto.HospitalDto;
import com.yonsei119.dto.HospitalTypeDto;
import com.yonsei119.util.GeoUtils;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
/*
 * [자바 문법] package, import : 7대 공공데이터를 HPID 기준으로 교차 병합하고 Hot/Cold 이원화 캐시 및 경량/상세 조회를 총괄하는 핵심 서비스 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - Instant, ZonedDateTime, ZoneId, DateTimeFormatter : UTC 기준 절대 시각 및 한국 표준시(KST) 포맷팅용 Java 8+ 표준 시간 도구임 (이름 변경 불가).
 * - AtomicBoolean, ExecutorService, CompletableFuture : 중복 백그라운드 실행을 막고 비동기 캐시 워밍을 수행하는 동시성 도구임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @Service (출처: org.springframework.stereotype) : 핵심 비즈니스 로직을 수행하는 주방장 빈(Bean)임을 선언함 (형제: @RestController, @Repository, @Component).
 * - @EventListener (출처: org.springframework.context.event) : 서버 부팅 완료 이벤트(ApplicationReadyEvent)를 감지해 사전 로딩을 시작함.
 * - @Scheduled (출처: org.springframework.scheduling.annotation) : 정해진 주기(기본 3분)마다 백그라운드 갱신을 자동 실행함.
 */

@Service
public class EmergencyDataService {
/*
 * [스프링/라이브러리 내장 어노테이션] @Service
 * [자바 문법] public class
 * [내가 지은 이름] EmergencyDataService : 전국 응급의료기관 데이터 교차 병합(Cross-Merge) 및 Stale-While-Revalidate + Hot/Cold 캐시 관리 서비스임.
 * [핵심 원리 & 식당 주방 비유]
 * 1) 사전 조리(Pre-warming): 식당 문을 열자마자(ApplicationReadyEvent) 미리 전국 530여 개 병원 데이터를 준비해 첫 손님도 0.01초 만에 응답받게 함.
 * 2) Hot / Cold 이원화 조리: 잘 안 바뀌는 병원 주소·기본정보(Cold 4종)는 6시간마다 갱신하고, 실시간 병상·공지·중증질환(Hot 3종)만 3분마다 재빠르게 갈아끼움.
 * 3) 요약 메뉴판 vs 상세 원산지표 분리: 목록 조회(?compact=true)는 가벼운 요약본을 즉시 내주고, 개별 상세 조회(/api/hospitals/{hpid})는 원본 태그 전체를 제공함.
 */

    private static final Logger log = LoggerFactory.getLogger(EmergencyDataService.class);
    private static final ZoneId KST_ZONE = ZoneId.of("Asia/Seoul");
    private static final long MIN_FORCE_REFRESH_COOLDOWN_SECONDS = 15L;
    /*
     * [자바 문법] private static final
     * [내가 지은 이름] KST_ZONE(한국 표준시 시간대), MIN_FORCE_REFRESH_COOLDOWN_SECONDS(새로고침 버튼 연타 공격 방어용 15초 쿨다운)
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
            "hvgc", "hvs38", "hv4", "hv41", "hvs25", "hv40", "hvs24",
            "hvoc", "hvs22", "hv42", "hvs26", "hv43", "hvs36",
            "hvventiayn", "hvs30", "hvventisoayn", "hvs31", "hvincuayn", "hvs32",
            "hvcrrtayn", "hvs33", "hvecmoayn", "hvs34", "hvhypoayn", "hvs35",
            "hvoxyayn", "hvs37", "hvctayn", "hvs27", "hvmriayn", "hvs28",
            "hvangioayn", "hvs29", "hvamyn", "hvidate", "dutytel3"
    );
    /*
     * [스프링/자바 내장 함수] Set.of(...) : 중복 없는 불변 집합 생성 (이름 변경 불가)
     * [내가 지은 이름] ESSENTIAL_UI_BED_KEYS (지도 신호등·증상 필터·응급실/입원실/장비 매트릭스에 실제 표시되는 핵심 코드 집합)
     */

    private final NmcOpenApiClient openApiClient;
    private final HospitalClassifier classifier;
    private final Yonsei119Properties properties;
    private final Object cacheLock = new Object();
    private final AtomicBoolean backgroundRefreshInProgress = new AtomicBoolean(false);
    private final ExecutorService backgroundRefreshExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "yonsei119-cache-warmer");
        thread.setDaemon(true);
        return thread;
    });
    /*
     * [자바 문법] private final
     * [내가 지은 이름] openApiClient(공공데이터 수집기), classifier(종별 분류기), properties(설정 상자),
     *   cacheLock(동시 갱신 방지 자물쇠), backgroundRefreshInProgress(백그라운드 중복 방지 스위치), backgroundRefreshExecutor(전용 워커 스레드)
     */

    private volatile EmergencySnapshotDto cachedSnapshot;
    private volatile EmergencySnapshotDto cachedCompactSnapshot;
    private volatile Map<String, HospitalDto> cachedHospitalById = Map.of();
    private volatile Map<String, List<Map<String, String>>> cachedColdDatasets = Map.of();
    private volatile Instant cachedAt = Instant.EPOCH;
    private volatile Instant coldCachedAt = Instant.EPOCH;
    /*
     * [자바 문법] private volatile : 멀티스레드 환경에서 백그라운드 워커가 새 스냅샷으로 교체하는 즉시 모든 웹 요청 스레드가 옛날 CPU 캐시 대신 최신 참조를 읽도록 강제하는 키워드임.
     * [내가 지은 이름]
     * - cachedSnapshot        : 전체 원본 태그가 포함된 마스터 스냅샷
     * - cachedCompactSnapshot : 모바일 초기 로딩용 경량 스냅샷 (미리 만들어 두어 요청마다 재조립 비용 0)
     * - cachedHospitalById    : GET /api/hospitals/{hpid} 조회 시 O(1) 즉시 반환용 해시 인덱스
     * - cachedColdDatasets    : 6시간 주기로 재사용할 Cold 4종(list, basic, traumaList, traumaBasic) 원본 캐시
     */

    public EmergencyDataService(
            NmcOpenApiClient openApiClient,
            HospitalClassifier classifier,
            Yonsei119Properties properties
    ) {
    /*
     * [자바 문법] public EmergencyDataService(...) : 스프링 의존성 주입(DI) 생성자임.
     */
        this.openApiClient = openApiClient;
        this.classifier = classifier;
        this.properties = properties;
        /*
         * [핵심 실행 코드] 스프링이 조립해 준 싱글톤 부품 3개를 내 필드에 연결함.
         */
    }

    @EventListener(ApplicationReadyEvent.class)
    public void warmUpCacheOnStartup() {
    /*
     * [스프링/라이브러리 내장 어노테이션] @EventListener(ApplicationReadyEvent.class) : 8080 포트가 열리자마자 자동 호출됨.
     * [내가 지은 이름] warmUpCacheOnStartup
     */
        if (!properties.nemc().autoRefreshEnabled()) {
            log.info("NEMC 자동 캐시 사전 로딩(Pre-warming) 비활성화 상태입니다 (auto-refresh-enabled=false).");
            return;
        }
        log.info("서버 기동 완료 — 백그라운드에서 전국 응급의료기관 초기 캐시 사전 로딩(Pre-warming)을 시작합니다.");
        triggerAsyncBackgroundRefresh("서버 시작 직후 사전 로딩(Pre-warming)");
        /*
         * [핵심 원리] 서버 부팅 자체를 가로막지 않고 별도 데몬 스레드에서 Cold+Hot 7개 API를 미리 채워 둠.
         */
    }

    @Scheduled(
            initialDelayString = "${yonsei119.nemc.refresh-interval-ms:180000}",
            fixedDelayString = "${yonsei119.nemc.refresh-interval-ms:180000}"
    )
    public void scheduledBackgroundRefresh() {
    /*
     * [스프링/라이브러리 내장 어노테이션] @Scheduled(initialDelayString=..., fixedDelayString=...) :
     *   이전 갱신이 끝난 시점으로부터 지정 시간(기본 180,000ms = 3분)마다 반복 실행함 (형제 옵션: fixedRateString, cron).
     * [내가 지은 이름] scheduledBackgroundRefresh
     */
        if (!properties.nemc().autoRefreshEnabled()) {
            return;
        }
        triggerAsyncBackgroundRefresh("주기적 스케줄러(@Scheduled) Hot/Cold 자동 갱신");
        /*
         * [핵심 원리] 3분마다 실행되지만, 내부에서 Cold 캐시(6시간)가 유효하면 Hot 실시간 3종 API만 빠르게 갱신함.
         */
    }

    public void triggerAsyncBackgroundRefresh(String reason) {
    /*
     * [자바 문법] public void : 이미 백그라운드 갱신이 돌고 있으면 중복 실행을 건너뛰고, 비어 있을 때만 워커 스레드에 작업을 맡김.
     * [내가 지은 이름] triggerAsyncBackgroundRefresh, reason(로그 출력용 갱신 사유)
     */
        if (!backgroundRefreshInProgress.compareAndSet(false, true)) {
            return;
        }
        CompletableFuture.runAsync(() -> {
            try {
                refreshCacheSynchronously(reason, false, null);
            } finally {
                backgroundRefreshInProgress.set(false);
            }
        }, backgroundRefreshExecutor);
        /*
         * [스프링/자바 내장 함수] backgroundRefreshInProgress.compareAndSet(false, true) : 원자적(Atomic)으로 false일 때만 true로 바꾸며 동시 중복 실행을 100% 차단함.
         */
    }

    public EmergencySnapshotDto getSnapshot(boolean forceRefresh) {
    /*
     * [자바 문법] public : 기존 호출부 및 단위 테스트 호환용 기본 스냅샷 조회 메서드임 (원본 전체 포함).
     * [내가 지은 이름] getSnapshot, forceRefresh
     */
        return getSnapshot(forceRefresh, false);
        /*
         * [핵심 원리] compact=false로 위임하여 모든 필드가 담긴 전체 스냅샷을 반환함.
         */
    }

    public EmergencySnapshotDto getSnapshot(boolean forceRefresh, boolean compact) {
    /*
     * [자바 문법] public : 강제 새로고침 여부(forceRefresh)와 경량 요약 모드 여부(compact)를 받아 스냅샷을 반환하는 대표 메서드임.
     * [내가 지은 이름] getSnapshot(오버로딩 함수명), forceRefresh, compact
     */
        long hotTtlSeconds = Math.max(5L, properties.nemc().cacheTtlSeconds());
        Instant now = Instant.now();

        EmergencySnapshotDto currentFull = this.cachedSnapshot;
        if (!forceRefresh && currentFull != null) {
            if (now.isAfter(this.cachedAt.plusSeconds(hotTtlSeconds))) {
                triggerAsyncBackgroundRefresh("Hot TTL 경과에 따른 비동기 Stale-While-Revalidate 갱신");
            }
            EmergencySnapshotDto target = compact && this.cachedCompactSnapshot != null
                    ? this.cachedCompactSnapshot
                    : currentFull;
            return asCachedSnapshot(target);
        }

        if (forceRefresh && currentFull != null
                && now.isBefore(this.cachedAt.plusSeconds(MIN_FORCE_REFRESH_COOLDOWN_SECONDS))) {
            EmergencySnapshotDto target = compact && this.cachedCompactSnapshot != null
                    ? this.cachedCompactSnapshot
                    : currentFull;
            return asCachedSnapshot(target);
        }

        EmergencySnapshotDto refreshed = refreshCacheSynchronously(
                forceRefresh ? "사용자 수동 새로고침 요청" : "최초 콜드 스타트 동기 수집",
                forceRefresh,
                now
        );
        if (compact && this.cachedCompactSnapshot != null) {
            return refreshed.cached() ? asCachedSnapshot(this.cachedCompactSnapshot) : this.cachedCompactSnapshot;
        }
        return refreshed;
        /*
         * [핵심 원리 — Stale-While-Revalidate 패턴]
         * - 3분(hotTtlSeconds)이 지났더라도 손님(브라우저)을 수 초 동안 빈 화면으로 기다리게 하지 않고,
         *   일단 메모리에 있는 직전 스냅샷을 0.01초 만에 내어준 뒤 주방 뒤편(triggerAsyncBackgroundRefresh)에서 조용히 새 데이터를 받아 갈아끼움.
         */
    }

    public HospitalDto getHospitalById(String hpid) {
    /*
     * [자바 문법] public : 기관 고유코드(HPID, 예: "A2200001")로 특정 병원의 전체 원본 상세 정보(HospitalDto)를 1ms 이내에 찾아 반환함.
     * [내가 지은 이름] getHospitalById(함수명), hpid(조회할 병원 코드)
     */
        if (hpid == null || hpid.isBlank()) {
            return null;
        }
        String normalizedId = hpid.trim();
        if (this.cachedSnapshot == null) {
            getSnapshot(false, false);
        }
        return this.cachedHospitalById.get(normalizedId);
        /*
         * [스프링/자바 내장 함수] Map.get(...) : 530개 리스트를 처음부터 뒤지지 않고 해시 인덱스로 단 한 번에(O(1)) 꺼냄.
         */
    }

    private EmergencySnapshotDto refreshCacheSynchronously(
            String reason,
            boolean respectForceCooldown,
            Instant requestEnteredAt
    ) {
    /*
     * [자바 문법] private : synchronized 잠금 블록 안에서 중복 외부 호출 없이 안전하게 신규 스냅샷을 조립해 교체함.
     * [내가 지은 이름] refreshCacheSynchronously, reason, respectForceCooldown, requestEnteredAt
     */
        synchronized (cacheLock) {
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
                boolean forceAll = respectForceCooldown;
                EmergencySnapshotDto fresh = buildFreshSnapshot(forceAll);
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
        }
        /*
         * [자바 문법] synchronized (cacheLock) { ... } : 동시에 100명의 사용자가 접속해도 단 1개의 스레드만 공공데이터 API를 호출하고 나머지 99명은 완성된 캐시를 즉시 공유받음.
         */
    }

    private void storeSnapshotIndexes(EmergencySnapshotDto fullSnapshot) {
    /*
     * [자바 문법] private void : 마스터 스냅샷이 완성될 때 경량 목록 스냅샷(cachedCompactSnapshot)과 HPID 조회 인덱스(cachedHospitalById)를 한 번에 미리 구축함.
     * [내가 지은 이름] storeSnapshotIndexes, fullSnapshot
     */
        if (fullSnapshot == null) {
            this.cachedSnapshot = null;
            this.cachedCompactSnapshot = null;
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

        this.cachedSnapshot = fullSnapshot;
        this.cachedHospitalById = Map.copyOf(byId);
        this.cachedCompactSnapshot = new EmergencySnapshotDto(
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
        /*
         * [핵심 성능 원리] 갱신 시점(3분에 1번)에 미리 경량본과 해시맵을 만들어 두므로, 초당 수백 번 들어오는 사용자 조회 요청에서는 CPU 연산과 객체 할당이 거의 0에 수렴함.
         */
    }

    public void setCachedSnapshotForTest(EmergencySnapshotDto snapshot) {
    /*
     * [자바 문법] public void : JUnit 통합 테스트에서 장애 폴백 시나리오를 재현하기 위해 초기 캐시를 주입하는 테스트 전용 메서드임.
     * [내가 지은 이름] setCachedSnapshotForTest, snapshot
     */
        synchronized (cacheLock) {
            storeSnapshotIndexes(snapshot);
            this.cachedAt = snapshot != null ? Instant.now() : Instant.EPOCH;
            if (snapshot == null) {
                this.cachedColdDatasets = Map.of();
                this.coldCachedAt = Instant.EPOCH;
            }
        }
        /*
         * [핵심 원리] 테스트 종료 후 null을 넘기면 Cold 캐시까지 깨끗하게 초기화되어 다른 테스트에 영향을 주지 않음.
         */
    }

    @PreDestroy
    public void shutdown() {
    /*
     * [스프링/라이브러리 내장 어노테이션] @PreDestroy
     * [내가 지은 이름] shutdown
     */
        backgroundRefreshExecutor.shutdownNow();
        /*
         * [스프링/자바 내장 함수] backgroundRefreshExecutor.shutdownNow() (이름 변경 불가)
         */
    }

    public EmergencySnapshotDto buildFreshSnapshot() {
    /*
     * [자바 문법] public : 전체 강제 수집(Cold+Hot) 기본 오버로드 메서드임.
     * [내가 지은 이름] buildFreshSnapshot
     */
        return buildFreshSnapshot(true);
        /*
         * [핵심 원리] 명시적으로 전체 빌드를 요청한 경우 Cold/Hot 모두 최신 수집함.
         */
    }

    public EmergencySnapshotDto buildFreshSnapshot(boolean forceColdRefresh) {
    /*
     * [자바 문법] public : Cold 마스터 데이터(6시간 캐시)가 아직 유효하면 재사용하고, Hot 실시간 3종만 새로 수집해 병합하는 이원화 빌더임.
     * [내가 지은 이름] buildFreshSnapshot, forceColdRefresh
     */
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
        /*
         * [Hot / Cold 수집 분기 흐름도]
         *   hasValidColdCache == true (평상시 3분 주기 갱신)
         *   ├── Cold 4종(list, basic, traumaList, traumaBasic) : 메모리 캐시 즉시 재사용 (API 호출 0회)
         *   └── Hot  3종(beds, messages, severe)               : 공공데이터포털 실시간 호출 (API 호출 3회)
         */
    }

    public EmergencySnapshotDto mergeDatasetsIntoSnapshot(Map<String, List<Map<String, String>>> rawDatasets) {
    /*
     * [자바 문법] public : 7개 데이터셋을 기관코드(hpid) 단일 열쇠로 교차 병합(Cross-Merge)하여 최종 스냅샷 DTO를 완성함.
     * [내가 지은 이름] mergeDatasetsIntoSnapshot(함수명), rawDatasets(7종 원시 맵 데이터)
     */
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
        /*
         * [7종 데이터 교차 병합(Cross-Merge) 구조 예시]
         *   list("A2200001") + basic("A2200001") + beds("A2200001") + messages("A2200001") + severe("A2200001") + trauma("A2200001")
         *   └──> HospitalDto(id="A2200001", name="연세대학교원주세브란스기독병원", regional=true, erBeds="-2", ...)
         *   (좌표가 0.0, 0.0 등 대한민국 영역 밖인 오류 데이터는 GeoUtils.isValidKoreaCoordinate에서 자동 제외됨)
         */
    }

    private static Map<String, Map<String, String>> groupSingleById(List<Map<String, String>> items) {
    /*
     * [자바 문법] private static : 1:1 데이터 리스트를 hpid -> Map 해시 사전으로 인덱싱하여 O(N^2) 중첩 탐색을 O(1)로 줄임.
     * [내가 지은 이름] groupSingleById, items
     */
        Map<String, Map<String, String>> map = new LinkedHashMap<>();
        for (Map<String, String> item : items) {
            String rawId = item.get("hpid");
            if (rawId == null || rawId.isBlank()) {
                continue;
            }
            map.put(rawId.trim(), item);
        }
        return map;
        /*
         * [스프링/자바 내장 함수] item.get("hpid"), rawId.trim(), map.put(...) (이름 변경 불가)
         */
    }

    private static Map<String, List<Map<String, String>>> groupMultiById(List<Map<String, String>> items) {
    /*
     * [자바 문법] private static : 한 병원이 여러 건의 공지를 올리는 1:N 메시지 데이터를 hpid -> List<Map>으로 묶음.
     * [내가 지은 이름] groupMultiById, items
     */
        Map<String, List<Map<String, String>>> map = new LinkedHashMap<>();
        for (Map<String, String> item : items) {
            String rawId = item.get("hpid");
            if (rawId == null || rawId.isBlank()) {
                continue;
            }
            map.computeIfAbsent(rawId.trim(), k -> new ArrayList<>()).add(Map.copyOf(item));
        }
        return map;
        /*
         * [스프링/자바 내장 함수] map.computeIfAbsent(키, 생성람다) : 해당 병원 키가 처음 등장하면 빈 ArrayList를 자동 생성해 넣고 이어서 추가함 (이름 변경 불가).
         */
    }

    private static double parseCoordinate(String text) {
    /*
     * [자바 문법] private static double : 문자열 좌표를 실수(double)로 안전하게 파싱하고, 실패 시 Double.NaN을 반환함.
     * [내가 지은 이름] parseCoordinate, text
     */
        if (text == null || text.isBlank()) {
            return Double.NaN;
        }
        try {
            return Double.parseDouble(text.trim());
        } catch (NumberFormatException ex) {
            return Double.NaN;
        }
        /*
         * [스프링/자바 내장 함수] Double.parseDouble(...), Double.NaN (형제 함수: Integer.parseInt, Long.parseLong)
         */
    }

    private static String firstNonBlank(String... candidates) {
    /*
     * [자바 문법] private static, 가변 인자(String... candidates : 개수 제한 없이 여러 후보 문자열을 나열해 전달 가능)
     * [내가 지은 이름] firstNonBlank, candidates
     */
        if (candidates == null) {
            return "";
        }
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.trim();
            }
        }
        return "";
        /*
         * [핵심 원리] 여러 XML 소스 후보 값 중 비어 있지 않은 첫 번째 유효 텍스트를 찾아 반환함.
         */
    }

    private static String displayValue(String value) {
    /*
     * [자바 문법] private static : 값이 비어 있으면 "미정보", 있으면 공백 제거 문자열을 반환함.
     * [내가 지은 이름] displayValue, value
     */
        if (value == null || value.isBlank()) {
            return "미정보";
        }
        return value.trim();
        /*
         * [스프링/자바 내장 함수] value.isBlank(), value.trim() (이름 변경 불가)
         */
    }

    private static EmergencySnapshotDto asCachedSnapshot(EmergencySnapshotDto snapshot) {
    /*
     * [자바 문법] private static : 기존 불변 스냅샷에서 cached 플래그만 true로 바꾼 새 DTO를 반환함.
     * [내가 지은 이름] asCachedSnapshot, snapshot
     */
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
        /*
         * [핵심 원리] 불변 리스트(hospitals) 참조 자체는 그대로 재사용하므로 메모리 복사 비용 없이 1마이크로초 만에 생성됨.
         */
    }
}
