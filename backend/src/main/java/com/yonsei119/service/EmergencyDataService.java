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
 * [자바 문법]
 * - package : EmergencyDataService 클래스가 속한 패키지 경로를 선언함.
 * - import : 다른 패키지의 DTO·유틸리티·설정 클래스와 자바·스프링 도구를 불러옴.
 *
 * [패키지명]
 * - com.yonsei119.service : 데이터 병합, 캐싱, 종별 분류 등 백엔드 서비스 계층 패키지임.
 *
 * [자바/스프링/라이브러리 내장 타입]
 * - Logger, LoggerFactory (org.slf4j) : 실행 로그와 오류 메시지를 출력하는 표준 로거임.
 * - Instant, ZoneId, ZonedDateTime, DateTimeFormatter (java.time) : UTC 시각 비교와 KST 포맷팅 타입임.
 * - List, Map, Set, ArrayList, LinkedHashMap, LinkedHashSet : 순서·중복 제어 컬렉션 타입임.
 * - CompletableFuture, ExecutorService, Executors, AtomicBoolean : 비동기 실행과 동시성 제어 타입임.
 *
 * [프로젝트 내부 타입]
 * - Yonsei119Properties (com.yonsei119.config) : application.yml 설정을 읽는 불변 레코드임.
 * - EmergencySnapshotDto, HospitalDto, HospitalTypeDto (com.yonsei119.dto) : 응답용 DTO 레코드들임.
 * - GeoUtils (com.yonsei119.util) : 대한민국 위경도 유효 범위를 검증하는 유틸리티 클래스임.
 */

@Service
public class EmergencyDataService {
/*
 * [스프링 내장 어노테이션]
 * - @Service 정의 (출처: org.springframework.stereotype.Service, 이름 변경 불가)
 *   · 역할 : 핵심 비즈니스 로직을 담당하는 서비스 계층 클래스를 스프링 싱글톤 빈으로 자동 생성·등록하는 어노테이션임.
 * - @Service 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 EmergencyDataService 클래스
 *   · 작동 원리 : 컴포넌트 스캔으로 부팅 시 EmergencyDataService 싱글톤 빈을 만들고 생성자 의존성을 자동 주입함.
 *   · 실행 시점 : 스프링 애플리케이션 컨텍스트 초기화(부팅) 시점임.
 *   · 비교 : @Component(범용), @Repository(DB), @RestController(API)와 같은 빈 등록 계열임.
 *
 * [자바 문법]
 * - public class : 컨트롤러·테스트 등 외부 패키지에서도 호출 가능한 공개 클래스를 선언함.
 *
 * [클래스명]
 * - EmergencyDataService : 7대 공공데이터 병합, Hot/Cold 캐시, 경량/상세 인덱스 조회를 총괄하는 서비스임.
 *
 * [동작 흐름]
 * - 1) 서버 준비(@EventListener) -> warmUpCacheOnStartup() -> 비동기 초기 캐시 적재
 * - 2) 주기 스케줄(@Scheduled) ──> scheduledBackgroundRefresh() ──> 3분마다 Hot/Cold 갱신
 * - 3) buildFreshSnapshot() -> NmcOpenApiClient 수집 -> mergeDatasetsIntoSnapshot() -> storeSnapshotIndexes()
 * - 4) 컨트롤러 요청 -> getSnapshot() / getHospitalById()로 캐싱 스냅샷 즉시 반환
 */

    private static final Logger log = LoggerFactory.getLogger(EmergencyDataService.class);
    private static final ZoneId KST_ZONE = ZoneId.of("Asia/Seoul");
    private static final long MIN_FORCE_REFRESH_COOLDOWN_SECONDS = 15L;
    /*
     * [자바 문법]
     * - private static final : 클래스 내부에서만 공유하는 변경 불가 정적 상수 선언임.
     * - long / 클래스.class : 64비트 정수 기본형(L 접미사)과 클래스 메타정보 리터럴 문법임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Logger, LoggerFactory (org.slf4j), ZoneId (java.time).
     *
     * [자바/스프링 내장 메서드]
     * - LoggerFactory.getLogger(클래스.class) : 전달한 클래스 이름의 SLF4J 로거를 생성함.
     * - ZoneId.of("Asia/Seoul") : 한국 시간대(UTC+09:00) ZoneId 객체를 생성함.
     *
     * [상수명]
     * - log : 캐시 갱신 소요 시간과 오류를 기록하는 로거 상수임.
     * - KST_ZONE : 스냅샷의 updatedAt 시각을 한국 시간으로 바꿀 때 쓰는 타임존 상수임.
     * - MIN_FORCE_REFRESH_COOLDOWN_SECONDS (15L) : 강제 새로고침 연타를 막는 최소 15초 재수집 제한 상수임.
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
     * [자바 문법]
     * - private static final : 클래스 로딩 시 1회만 만들어지는 불변 상수 집합 선언임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Set<String> : 중복 요소를 허용하지 않는 문자열 집합 인터페이스임.
     *
     * [자바/스프링 내장 메서드]
     * - Set.of(...) : 수정·null 삽입이 금지된 불변 Set을 만드는 Java 9+ 정적 팩토리임.
     *   - 주의 : 같은 원소를 중복해서 넘기면 IllegalArgumentException이 발생함.
     *
     * [상수명]
     * - ESSENTIAL_UI_BED_KEYS : ?compact=true 응답 시 지도·증상필터·병상표에 필요한 키만 고르는 집합임.
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
     * [자바 문법]
     * - private final : 생성 시 1회 초기화 후 다른 참조로 바꿀 수 없는 멤버 필드임.
     * - 람다식 runnable -> { ... } : ThreadFactory 인터페이스의 스레드 생성 메서드를 구현함.
     *
     * [프로젝트 내부 타입]
     * - NmcOpenApiClient, HospitalClassifier, Yonsei119Properties : 생성자로 주입받는 프로젝트 타입들임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Object (java.lang) : synchronized 블록의 잠금(모니터 락) 기준으로 쓰는 최상위 객체임.
     * - AtomicBoolean (java.util.concurrent.atomic) : 락 없이 동시성 안전하게 boolean을 바꾸는 클래스임.
     * - ExecutorService, Executors, Thread : 비동기 작업을 순서대로 실행하는 스레드 풀과 스레드 클래스임.
     *
     * [자바/스프링 내장 생성자·메서드]
     * - new Object() : synchronized (락객체) 전용 모니터 락 객체를 생성함.
     * - new AtomicBoolean(false) : 초기값 false를 가진 원자적 불리언 객체를 만듦.
     * - Executors.newSingleThreadExecutor(팩토리) : 1개 워커 스레드로 작업을 FIFO 순차 실행하는 풀을 만듦.
     * - new Thread(작업, 이름) : 로그·프로파일러 구분이 쉽도록 스레드 이름을 지정해 생성함.
     * - Thread.setDaemon(true) : 데몬 스레드로 지정해 서버 종료 시 작업 스레드가 프로세스 종료를 붙잡지 않게 설정함.
     *
     * [필드명 (멤버 변수)]
     * - openApiClient : NEMC 7대 OpenAPI 수집 클라이언트 필드임.
     * - classifier : 상급종합·권역응급·의료원·기타 종별 판별기 필드임.
     * - properties : Hot/Cold 캐시 TTL과 자동 갱신 설정을 읽는 레코드 필드임.
     * - cacheLock : synchronized 동기화 블록으로 동시 캐시 갱신을 직렬화하는 락 객체임.
     * - backgroundRefreshInProgress : 백그라운드 갱신이 이미 돌고 있는지 확인해 중복 제출을 막는 플래그임.
     * - backgroundRefreshExecutor : 서버 기동 워밍과 주기적 갱신을 실행하는 단일 데몬 스레드 풀임.
     *
     * [지역 변수명]
     * - thread : 람다 스레드 팩토리 안에서 생성·설정한 데몬 스레드 변수임.
     */

    private volatile EmergencySnapshotDto cachedSnapshot;
    private volatile EmergencySnapshotDto cachedCompactSnapshot;
    private volatile Map<String, HospitalDto> cachedHospitalById = Map.of();
    private volatile Map<String, List<Map<String, String>>> cachedColdDatasets = Map.of();
    private volatile Instant cachedAt = Instant.EPOCH;
    private volatile Instant coldCachedAt = Instant.EPOCH;
    /*
     * [자바 문법]
     * - private volatile : 스레드가 새 참조를 쓰면 다른 스레드도 즉시 메인 메모리에서 최신 값을 읽게 함.
     *
     * [프로젝트 내부 타입]
     * - EmergencySnapshotDto, HospitalDto (com.yonsei119.dto) : 프로젝트 스냅샷·병원 DTO 레코드 타입임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map, List, String, Instant : 자바 표준 컬렉션, 문자열, UTC 절대 시각 타입임.
     *
     * [자바/스프링 내장 생성자·메서드]
     * - Map.of() : 비어 있는 불변 맵을 초기값으로 넣어 NullPointerException을 방지함.
     * - Instant.EPOCH : 유닉스 기준 시각(1970-01-01T00:00:00Z)으로, 최초 캐시 만료 초기값으로 씀.
     *
     * [필드명 (멤버 변수)]
     * - cachedSnapshot : 모든 원본 태그가 들어 있는 최신 마스터 스냅샷 필드임.
     * - cachedCompactSnapshot : ?compact=true 목록 조회 시 가공 없이 바로 반환할 경량 스냅샷 필드임.
     * - cachedHospitalById : 기관코드(hpid)로 HospitalDto를 O(1) 속도로 찾는 불변 해시맵 필드임.
     * - cachedColdDatasets : 6시간마다 재사용할 Cold 4종 원시 데이터셋 보관 필드임.
     * - cachedAt : 마지막 스냅샷 갱신 UTC 시각(Instant) 필드임.
     * - coldCachedAt : 마지막 Cold 4종 캐시 갱신 UTC 시각(Instant) 필드임.
     */

    public EmergencyDataService(
            NmcOpenApiClient openApiClient,
            HospitalClassifier classifier,
            Yonsei119Properties properties
    ) {
    /*
     * [자바 문법]
     * - public 생성자 : 스프링 컨테이너가 필요한 빈을 매개변수로 넣어 자동 호출하는 생성자임.
     *
     * [프로젝트 내부 타입]
     * - NmcOpenApiClient, HospitalClassifier, Yonsei119Properties : 생성자 주입으로 받는 내부 타입들임.
     *
     * [생성자 및 매개변수명]
     * - EmergencyDataService : API 클라이언트·분류기·설정을 연결하는 서비스 생성자임.
     * - openApiClient / classifier / properties : 스프링 DI로 주입받는 외부 호출·분류·설정 객체임.
     */
        this.openApiClient = openApiClient;
        this.classifier = classifier;
        this.properties = properties;
        /*
         * [자바 문법]
         * - this. : 매개변수명과 이름이 같은 인스턴스 필드를 구별해 값을 대입하는 참조 키워드임.
         */
    }

    @EventListener(ApplicationReadyEvent.class)
    public void warmUpCacheOnStartup() {
    /*
     * [스프링 내장 어노테이션]
     * - @EventListener 정의 (출처: org.springframework.context.event.EventListener, 이름 변경 불가)
     *   · 역할 : 스프링 내부에서 특정 이벤트 발생을 감지하다가, 지정한 이벤트가 발생하면 연결된 메서드를 자동 실행해 주는 어노테이션임.
     * - @EventListener(ApplicationReadyEvent.class) 현재 코드 적용
     *   · 조건 인자 : ApplicationReadyEvent.class (메서드가 아니라 부팅 완료 이벤트 클래스 타입임)
     *   · 적용 대상 : 바로 위 선언된 warmUpCacheOnStartup() 메서드
     *   · 작동 원리 : 서버 부팅 완료 이벤트(ApplicationReadyEvent) 발행 시 스프링이 warmUpCacheOnStartup() 메서드를 자동 호출함.
     *   · 실행 시점 : 웹 서버 포트 개방과 모든 빈 초기화가 끝나고 요청 처리 준비가 끝난 직후 1회 실행됨.
     *   · 비교 : @PostConstruct는 웹 포트 개방 전에 실행되며, @EventListener(ApplicationReadyEvent.class) 방식은 부팅을 막지 않고 비동기 시작에 적합함.
     *
     * [자바 문법]
     * - public void / .class : 반환값이 없는 공개 메서드 선언과 구독 이벤트 클래스 리터럴임.
     *
     * [메서드명 및 매개변수명]
     * - warmUpCacheOnStartup : 서버 기동 직후 백그라운드에서 초기 응급실 캐시를 미리 채우는 메서드임.
     */
        if (!properties.nemc().autoRefreshEnabled()) {
            log.info("NEMC 자동 캐시 사전 로딩(Pre-warming) 비활성화 상태입니다 (auto-refresh-enabled=false).");
            return;
        }
        log.info("서버 기동 완료 — 백그라운드에서 전국 응급의료기관 초기 캐시 사전 로딩(Pre-warming)을 시작합니다.");
        triggerAsyncBackgroundRefresh("서버 시작 직후 사전 로딩(Pre-warming)");
        /*
         * [자바 문법]
         * - if / 논리 부정(!enabled) / return : 자동 갱신이 꺼져 있으면 로그만 남기고 조기 종료함.
         *
         * [프로젝트 내부 접근자]
         * - properties.nemc().autoRefreshEnabled() : application.yml의 auto-refresh-enabled 값(true/false)을 읽는 record 조회 메서드임 (nemc = 국립중앙의료원).
         *
         * [자바/스프링 내장 메서드]
         * - Logger.info(메시지) : 사전 로딩 비활성 여부와 시작 알림을 정보 로그로 출력함.
         *
         * [동작 흐름]
         * - autoRefreshEnabled == false -> 로그 출력 후 즉시 종료
         * - autoRefreshEnabled == true -> triggerAsyncBackgroundRefresh() 호출 ──> 데몬 스레드에서 초기 수집
         */
    }

    @Scheduled(
            initialDelayString = "${yonsei119.nemc.refresh-interval-ms:180000}",
            fixedDelayString = "${yonsei119.nemc.refresh-interval-ms:180000}"
    )
    public void scheduledBackgroundRefresh() {
    /*
     * [스프링 내장 어노테이션]
     * - @Scheduled 정의 (출처: org.springframework.scheduling.annotation.Scheduled, 이름 변경 불가)
     *   · 역할 : 지정한 시간 간격(fixedDelay, fixedRate)이나 시각(cron)마다 백그라운드에서 연결된 메서드를 반복 자동 실행해 주는 어노테이션임.
     * - @Scheduled 현재 코드 적용
     *   · 조건 인자 : initialDelayString, fixedDelayString = "${yonsei119.nemc.refresh-interval-ms:180000}" (기본 180,000ms = 3분)
     *   · 적용 대상 : 바로 위 선언된 scheduledBackgroundRefresh() 메서드
     *   · 작동 원리 : @EnableScheduling 활성화 시 설정 파일(${...})에서 읽은 주기(ms)마다 scheduledBackgroundRefresh() 메서드를 자동 실행함.
     *   · 실행 시점 : 기동 후 initialDelay 경과 시 첫 실행되며, 이전 실행 종료 후 fixedDelay 간격으로 반복됨.
     *   · 비교 : fixedDelay(종료 기준 대기, 중첩 방지) vs fixedRate(시작 기준 고정) vs cron(시각 지정).
     *
     * [자바 문법]
     * - public void : 반환값이 없는 스케줄러 진입 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - scheduledBackgroundRefresh : 설정된 주기마다 백그라운드 캐시 갱신을 호출하는 메서드임.
     */
        if (!properties.nemc().autoRefreshEnabled()) {
            return;
        }
        triggerAsyncBackgroundRefresh("주기적 스케줄러(@Scheduled) Hot/Cold 자동 갱신");
        /*
         * [자바 문법]
         * - if / 논리 부정(!enabled) / return : 자동 갱신이 비활성이면 스케줄 실행을 건너뜀.
         *
         * [프로젝트 내부 접근자]
         * - properties.nemc().autoRefreshEnabled() : application.yml의 auto-refresh-enabled 설정(true/false)을 읽는 record 접근자임.
         *
         * [동작 흐름]
         * - 주기(기본 3분) 도래 -> triggerAsyncBackgroundRefresh() ──> buildFreshSnapshot(false)
         *   └── Cold 캐시(6시간) 유효 시 Hot 3종만 재수집, 만료 시 7종 전체 재수집
         */
    }

    public void triggerAsyncBackgroundRefresh(String reason) {
    /*
     * [자바 문법]
     * - public void : 반환값 없이 백그라운드 비동기 갱신을 예약하는 공개 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [메서드명 및 매개변수명]
     * - triggerAsyncBackgroundRefresh : 중복 실행을 막으며 스레드 풀에 캐시 갱신 작업을 제출함.
     * - reason : 로그에 기록할 갱신 호출 사유 문자열 매개변수임.
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
         * [자바 문법]
         * - if / !acquired / 람다 / try ... finally : 선점 실패 시 종료하고, 끝나면 플래그를 복구함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - CompletableFuture, AtomicBoolean.
         *
         * [자바/스프링 내장 메서드]
         * - AtomicBoolean.compareAndSet(false, true) : 현재 값이 false일 때만 true로 바꿔 중복 실행을 차단함.
         * - CompletableFuture.runAsync(작업, 스레드풀) : 반환값 없는 비동기 작업을 전용 스레드 풀에 맡김.
         * - AtomicBoolean.set(false) : finally에서 플래그를 false로 되돌려 다음 갱신이 막히지 않게 함.
         *
         * [동작 흐름]
         * - CAS(false -> true) 선점 성공 -> backgroundRefreshExecutor에 작업 등록
         * - 워커 스레드 실행 ──> refreshCacheSynchronously(reason, false, null) ──> finally에서 플래그 false 복구
         */
    }

    public EmergencySnapshotDto getSnapshot(boolean forceRefresh, boolean compact) {
    /*
     * [자바 문법]
     * - public / boolean : 강제 새로고침과 경량 요약 여부를 인자로 받는 공개 조회 메서드임.
     *
     * [프로젝트 내부 타입]
     * - EmergencySnapshotDto : com.yonsei119.dto 패키지에 직접 정의한 스냅샷 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - getSnapshot : 강제 새로고침과 경량 모드에 따라 캐시 또는 동기 수집 스냅샷을 반환함.
     * - forceRefresh / compact : 새로고침 요청 여부와 경량 요약본(cachedCompactSnapshot) 반환 여부임.
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
         * [자바 문법]
         * - if / !forceRefresh / && / != null / ?: / return : 강제 갱신과 캐시 상태로 3개 경로 분기.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Math, Instant.
         *
         * [자바/스프링 내장 메서드]
         * - Math.max(5L, 값) : 설정값이 5초 미만이어도 최소 5초 TTL 하한을 보장함.
         * - Instant.now() : 현재 UTC 절대 시각을 생성함.
         * - Instant.isAfter(만료시각) / plusSeconds(초) : 캐시 생성 시각 + TTL이 지났는지 판별함.
         * - Instant.isBefore(쿨다운시각) : 마지막 갱신 후 15초 쿨다운 안인지 판별함.
         *
         * [프로젝트 내부 타입 및 접근자]
         * - EmergencySnapshotDto : com.yonsei119.dto 패키지에 직접 정의한 스냅샷 DTO 레코드임.
         * - properties.nemc().cacheTtlSeconds() : Hot 캐시 TTL(기본 180초)을 읽는 record 접근자임.
         * - refreshed.cached() : 스냅샷이 캐시 사본인지(true/false) 읽는 EmergencySnapshotDto 접근자임.
         *
         * [지역 변수명]
         * - hotTtlSeconds / now : 5초 하한이 적용된 Hot TTL(초)과 요청 진입 시각임.
         * - currentFull / target / refreshed : 전체 스냅샷, compact 선택 대상, 동기 수집 결과 변수임.
         *
         * [동작 흐름]
         * - 1) 일반 조회(!forceRefresh & 캐시 있음) -> TTL 경과 시 비동기 갱신 예약 + 직전 캐시 즉시 반환
         * - 2) 쿨다운 보호(forceRefresh & 15초 이내) -> 중복 API 호출 없이 직전 캐시 즉시 반환
         * - 3) 콜드 스타트 또는 쿨다운 경과 ──> refreshCacheSynchronously() 실행 ──> compact 여부에 맞춰 반환
         */
    }

    public HospitalDto getHospitalById(String hpid) {
    /*
     * [자바 문법]
     * - public : 컨트롤러 등에서 기관 ID 단건 조회 시 호출 가능한 공개 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [프로젝트 내부 타입]
     * - HospitalDto : com.yonsei119.dto 패키지에 직접 정의한 단일 병원 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - getHospitalById : 기관 고유코드(hpid)로 전체 원본 필드가 담긴 병원 상세 DTO를 조회함.
     * - hpid : 경로 변수 등에서 전달받은 기관 고유코드 문자열(예: "A2200001")임.
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
         * [자바 문법]
         * - if / == null / || / this. / return : 빈 ID는 null 반환하고, 캐시가 없으면 먼저 채움.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - String, Map.
         *
         * [자바/스프링 내장 메서드]
         * - String.isBlank() / trim() : 빈 문자열 여부를 검사하고 앞뒤 공백을 제거해 정규화함.
         * - Map.get(키) : 해시맵에서 키에 해당하는 값을 O(1) 시간 복잡도로 즉시 찾음.
         *
         * [프로젝트 내부 타입]
         * - HospitalDto : 맵의 값(Value)으로 보관된 프로젝트 단일 병원 DTO 레코드임.
         *
         * [지역 변수명]
         * - normalizedId : 앞뒤 공백을 제거한 정규화 기관코드 문자열임.
         *
         * [동작 흐름]
         * - cachedSnapshot == null -> getSnapshot(false, false) 호출로 인덱스 구축
         * - cachedHospitalById.get(normalizedId) -> normalizedId에 일치하는 병원 상세 HospitalDto 즉시 반환
         */
    }

    private EmergencySnapshotDto refreshCacheSynchronously(
            String reason,
            boolean respectForceCooldown,
            Instant requestEnteredAt
    ) {
    /*
     * [자바 문법]
     * - private / boolean : 동기화 락 내부 캐시 갱신 전용 비공개 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String, Instant.
     *
     * [프로젝트 내부 타입]
     * - EmergencySnapshotDto : com.yonsei119.dto 패키지에 직접 정의한 스냅샷 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - refreshCacheSynchronously : 락 안에서 중복 수집을 막으며 최신 스냅샷을 조립·교체함.
     * - reason / respectForceCooldown / requestEnteredAt : 로그 사유, 쿨다운 적용 여부, 요청 진입 시각임.
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
        }
        /*
         * [자바 문법]
         * - synchronized (모니터객체) { ... } : 락을 잡은 스레드 1개만 블록에 들어가고 나머지는 대기하게 함.
         * - try { ... } catch (Exception ex) { ... } / throw ex : 예외 시 직전 캐시로 폴백하거나 전파함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Instant, System, Exception.
         *
         * [자바/스프링 내장 메서드]
         * - Instant.isAfter(시각) : 대기 중 다른 스레드가 이미 더 최신으로 갱신했는지 확인함(더블 체크).
         * - Instant.now() / isBefore(...) / plusSeconds(...) : 락 내부 쿨다운 재검사와 갱신 시각 기록에 씀.
         * - System.currentTimeMillis() : 수집부터 병합까지 걸린 시간(ms)을 측정하는 기준 시각을 읽음.
         * - Logger.info(...) / warn(...) / error(...) : 갱신 결과·빈 응답 폴백·예외를 로그로 남김.
         * - List.isEmpty() : 수집된 병원 목록이 비어 있는지 확인함.
         *
         * [프로젝트 내부 타입 및 접근자]
         * - EmergencySnapshotDto : 수집·병합 결과를 담는 프로젝트 스냅샷 DTO 레코드임.
         * - fresh.hospitals() / fresh.totalCount() : EmergencySnapshotDto record가 자동 생성한 접근자임.
         *
         * [지역 변수명]
         * - current / currentCachedAt : 락 진입 직후 읽은 기존 스냅샷과 갱신 시각임.
         * - startMs / elapsedMs / fresh / ex : 소요 시간, 새 스냅샷, 예외 객체임.
         *
         * [동작 흐름]
         * - 1) synchronized (cacheLock) 진입 -> 선행 스레드가 이미 갱신했거나 쿨다운 내면 기존 캐시 반환
         * - 2) buildFreshSnapshot(respectForceCooldown) -> NmcOpenApiClient 수집 -> mergeDatasetsIntoSnapshot()로 fresh 생성
         * - 3) !fresh.hospitals().isEmpty() 또는 current == null -> storeSnapshotIndexes(fresh) & cachedAt 갱신
         * - 4) 빈 목록 또는 예외 발생 ──> 직전 스냅샷이 있으면 asCachedSnapshot(current) 반환(무중단 폴백)
         *
         * [매개변수 전달 원리]
         * - 스코프 차이 : fresh(갱신 메서드 지역변수)와 snapshot(테스트 메서드 매개변수)은 타 메서드에서 직접 못 읽음.
         * - 참조 전달 : 호출 시 타입(EmergencySnapshotDto)과 1번째 인자 순서만 맞으면 같은 객체 참조가 대입됨.
         * - 호출 흐름 : refreshCacheSynchronously(fresh) / setCachedSnapshotForTest(snapshot) -> storeSnapshotIndexes(fullSnapshot)
         */
    }

    private void storeSnapshotIndexes(EmergencySnapshotDto fullSnapshot) {
    /*
     * [자바 문법]
     * - private void : 반환값 없이 캐시 인덱스 필드들을 한꺼번에 갱신하는 비공개 메서드임.
     *
     * [프로젝트 내부 타입]
     * - EmergencySnapshotDto : com.yonsei119.dto 패키지에 직접 정의한 스냅샷 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - storeSnapshotIndexes : 마스터 스냅샷 저장 시 해시 인덱스와 경량 목록 스냅샷을 함께 만듦.
     * - fullSnapshot : 전체 원본 필드가 담긴 스냅샷 객체(또는 테스트 초기화용 null)임.
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
         * [자바 문법]
         * - if (fullSnapshot == null) / return : null 입력 시 모든 캐시 참조를 비우고 즉시 종료함.
         * - 향상된 for / new / <> : 병원 목록을 순회하며 해시맵과 경량 목록을 동시에 만듦.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map, LinkedHashMap, List, ArrayList.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - Map.of() : null 초기화 시 해시맵 필드를 빈 불변 맵으로 설정함.
         * - new LinkedHashMap<>(크기) / new ArrayList<>(크기) : 예상 크기만큼 초기 용량을 잡아 생성함.
         * - Map.put(키, 값) / List.add(항목) : 해시맵과 경량 리스트에 각 병원 데이터를 채움.
         * - Map.copyOf(원본) / List.copyOf(원본) : 외부 변경을 막은 불변 맵과 불변 리스트를 생성함.
         * - List.size() / String.isBlank() : 병원 목록 크기를 얻고 기관 ID 공백 여부를 확인함.
         *
         * [프로젝트 내부 타입·생성자·메서드]
         * - HospitalDto, EmergencySnapshotDto (com.yonsei119.dto) : 병원·스냅샷 프로젝트 DTO 레코드임.
         * - fullSnapshot.hospitals() / hospital.id() : record가 자동 생성한 병원 목록·ID 접근자임.
         * - hospital.toCompactSummary(키집합) : 목록 표시에 꼭 필요한 태그만 남긴 경량 HospitalDto를 반환함.
         * - new EmergencySnapshotDto(...) : 통계는 유지하고 목록만 경량화한 cachedCompactSnapshot을 생성함.
         *
         * [지역 변수명]
         * - byId : 기관코드(hpid) -> 원본 HospitalDto 해시 인덱스를 조립하는 맵임.
         * - compactList / hospital : 경량화된 HospitalDto 목록과 순회 중인 병원 객체임.
         *
         * [성능 및 동시성 원리]
         * - 스냅샷 교체 시점(3분마다 1회)에 해시맵·경량 목록을 1회만 미리 만들고 volatile 참조를 바꿈.
         * - 덕분에 사용자 조회 요청마다 목록 필터링·재복사 없이 즉시 응답이 가능함.
         */
    }

    public void setCachedSnapshotForTest(EmergencySnapshotDto snapshot) {
    /*
     * [자바 문법]
     * - public void : 반환값 없이 테스트용 캐시 상태를 설정하는 공개 메서드임.
     *
     * [프로젝트 내부 타입]
     * - EmergencySnapshotDto : com.yonsei119.dto 패키지에 직접 정의한 스냅샷 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - setCachedSnapshotForTest : 통합 테스트에서 초기 캐시를 넣거나 테스트 후 비우는 메서드임.
     * - snapshot : 테스트에서 주입할 스냅샷 객체(캐시를 완전히 비우려면 null 전달)임.
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
         * [자바 문법]
         * - synchronized (락객체) / ?: / if : 락 안에서 캐시를 일관되게 주입하거나 null로 초기화함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Instant, Map.
         *
         * [자바/스프링 내장 메서드]
         * - Instant.now() / Instant.EPOCH : 주입 시 현재 시각으로, null 초기화 시 1970-01-01로 맞춤.
         * - Map.of() : null 초기화 시 Cold 원시 캐시 맵도 빈 불변 맵으로 비움.
         *
         * [동작 흐름]
         * - synchronized (cacheLock) -> storeSnapshotIndexes(snapshot) 호출 ──> fullSnapshot = snapshot 참조 전달
         *   └── 마스터·경량·해시맵 인덱스와 cachedAt(null이면 coldCachedAt까지) 동시 교체
         */
    }

    @PreDestroy
    public void shutdown() {
    /*
     * [자바/스프링 내장 어노테이션]
     * - @PreDestroy 정의 (출처: jakarta.annotation.PreDestroy, 이름 변경 불가)
     *   · 역할 : 스프링 컨테이너가 종료되면서 빈을 소멸시키기 직전에 자원 정리용 메서드를 1회 자동 실행해 주는 생명주기 어노테이션임.
     * - @PreDestroy 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyDataService.shutdown() 메서드
     *   · 작동 원리 : 스프링 컨테이너가 종료되면서 EmergencyDataService 빈을 내리기 직전에 shutdown() 메서드를 자동 호출함.
     *   · 실행 시점 : 서버 정상 종료(SIGTERM) 또는 테스트 컨텍스트 종료 시점임.
     *   · 비교 : 빈 초기화 직후 실행되는 @PostConstruct와 대칭되는 종료 콜백임.
     *
     * [자바 문법]
     * - public void : 반환값이 없는 공개 정리 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - shutdown : 매개변수 없이 백그라운드 캐시 워머 스레드 풀을 닫는 메서드임.
     */
        backgroundRefreshExecutor.shutdownNow();
        /*
         * [자바/스프링 내장 메서드]
         * - ExecutorService.shutdownNow() : 대기 작업을 취소하고 워커 스레드에 인터럽트를 걸어 즉시 종료함.
         *   - 비교 : 진행 중인 작업 완료까지 기다리고 싶을 때는 shutdown()을 씀.
         */
    }

    public EmergencySnapshotDto buildFreshSnapshot(boolean forceColdRefresh) {
    /*
     * [자바 문법]
     * - public / boolean : Cold 캐시 강제 갱신 여부를 받는 공개 스냅샷 빌드 메서드임.
     *
     * [프로젝트 내부 타입]
     * - EmergencySnapshotDto : com.yonsei119.dto 패키지에 직접 정의한 스냅샷 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - buildFreshSnapshot : Cold 캐시 수명에 따라 Hot 3종 또는 7종 전체를 수집한 뒤 병합함.
     * - forceColdRefresh : true면 7종 전체를 강제 재수집하고, false면 Cold 유효 시 Hot 3종만 수집함.
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
         * [자바 문법]
         * - if ... else / && / !forceColdRefresh / 향상된 for : Cold 캐시 유효 여부로 수집 범위를 분기함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Instant, Map, LinkedHashMap, List.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - Instant.now() / isBefore(...) / plusSeconds(...) : 현재 시각으로 Cold 캐시 6시간 수명을 검사함.
         * - Map.isEmpty() / List.isEmpty() / Map.getOrDefault(키, 기본값) : 캐시와 list가 비었는지 확인함.
         * - new LinkedHashMap<>() / Map.putAll(...) / Map.put(...) : 수집 데이터셋을 순서대로 결합·추출함.
         * - Map.copyOf(원본) : 추출한 Cold 4종 맵을 수정 불가 불변 Map으로 복사해 저장함.
         *
         * [프로젝트 내부 타입·상수·메서드]
         * - NmcOpenApiClient : NEMC 7대 OpenAPI 수집을 담당하는 프로젝트 컴포넌트임.
         * - properties.nemc().effectiveColdCacheTtlSeconds() : Cold TTL(기본 6시간)을 읽는 설정 메서드임.
         * - NmcOpenApiClient.COLD_ENDPOINTS.keySet() : Cold 4종 키("list", "basic", "traumaList", "traumaBasic")임.
         *
         * [지역 변수명]
         * - now / coldTtlSeconds / hasValidColdCache : 기준 시각, Cold 수명(초), Cold 캐시 유효 여부임.
         * - combinedRaw / allFetched / nextCold / coldKey : 병합 입력 맵, 전체 수집 결과, Cold 저장 맵과 키임.
         *
         * [동작 흐름]
         * - 1) hasValidColdCache 계산 (!forceColdRefresh & 캐시 존재 & 6시간 이내)
         * - 2) 분기 수집
         *   ├── 유효(true, 평상시 3분 주기) -> cachedColdDatasets + openApiClient.fetchHotDatasets()(3종)
         *   └── 만료/강제(false) -> openApiClient.fetchAllDatasets()(7종) ──> list 비지 않으면 Cold 4종 갱신
         * - 3) combinedRaw ──> mergeDatasetsIntoSnapshot(combinedRaw)로 최종 스냅샷 생성·반환
         */
    }

    public EmergencySnapshotDto mergeDatasetsIntoSnapshot(Map<String, List<Map<String, String>>> rawDatasets) {
    /*
     * [자바 문법]
     * - public : 7대 원시 데이터셋 맵을 받아 병합 스냅샷 DTO를 만드는 공개 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, List<Map<String, String>>>.
     *
     * [프로젝트 내부 타입]
     * - EmergencySnapshotDto : com.yonsei119.dto 패키지에 직접 정의한 반환 스냅샷 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - mergeDatasetsIntoSnapshot : 7종 OpenAPI 원시 데이터를 기관코드(hpid) 기준으로 교차 병합함.
     * - rawDatasets : 7개 데이터셋 키별 파싱 행 리스트가 담긴 입력 맵 매개변수임.
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
        /*
         * [자바 문법]
         * - if / && / !previousById / new / <> : 고유 ID 합집합을 만들고, 비었으면 직전 캐시에서 복원함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - List, Map, Set, LinkedHashSet (입력 순서를 유지하면서 중복 ID를 제거하는 집합 구현체).
         *
         * [자바/스프링 내장 생성자·메서드]
         * - Map.getOrDefault(키, List.of()) : 키가 없어도 null 대신 빈 불변 리스트를 돌려줌.
         * - new LinkedHashSet<>(집합) : 원본 컬렉션의 순서를 유지하며 중복 없는 집합을 생성함.
         * - Set.addAll(추가집합) : 다른 집합의 모든 원소를 합집합으로 추가함.
         *
         * [프로젝트 내부 타입]
         * - HospitalDto : 직전 스냅샷 캐시 맵(previousById)의 값으로 저장된 병원 DTO 레코드임.
         *
         * [지역 변수명]
         * - listItems ~ traumaBasicItems : 7대 OpenAPI에서 받은 원시 기관 목록 7종임.
         * - listById ~ traumaBasicById : 기관코드(hpid)로 바로 찾기 위해 인덱싱한 맵 7종임.
         * - previousById / uniqueIds : 직전 스냅샷의 병원 맵과 최종 병합 대상 고유 hpid 집합임.
         */

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
        /*
         * [자바 문법]
         * - 향상된 for / if ... else if ... else / continue : 각 병원을 교차 병합하고 좌표 오류 시 건너뜀.
         * - ?: / && / || / ++ : 결측 필드를 대체하고 종별 누적 변수를 1씩 증가시킴.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - List, ArrayList, Map, LinkedHashMap, Map.Entry, Double.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new ArrayList<>(크기) : 고유 기관 수만큼 초기 용량을 잡아 리스트를 생성함.
         * - Map.get(키) / Map.getOrDefault(키, 기본값) / Map.of() / List.of() : 맵 조회와 결측 대체에 씀.
         * - new LinkedHashMap<>(기존맵) / Map.entrySet() / put(...) : basic 빈 항목만 list로 보완함.
         * - Double.isFinite(실수) : NaN이나 무한대가 아닌 유한 실수인지 검사함.
         * - String.equals(...) / Map.copyOf(...) / List.copyOf(...) / List.add(...) : 비교·불변 복사·추가.
         *
         * [프로젝트 내부 타입·생성자·메서드]
         * - GeoUtils (com.yonsei119.util), HospitalDto, HospitalTypeDto (com.yonsei119.dto) : 유틸·DTO 타입임.
         * - GeoUtils.isValidKoreaCoordinate(lat, lng) : 한국 위경도(32.0~39.5, 124.0~132.0) 밖 좌표를 거름.
         * - classifier.isRegional(...) / classifier.classify(..., name) : 권역응급 여부와 종별을 판별함.
         * - new HospitalDto(...) : 14개 교차 병합 필드로 병원 DTO 레코드를 생성함.
         *
         * [지역 변수명]
         * - hospitals / tertiaryCount ~ otherCount : 최종 병원 목록과 종별·외상센터별 기관 수 누적 변수임.
         * - id, prev, listFields, basicFields, mergedBasic, traumaFields, beds, severe, messages : 기관 데이터 조각임.
         * - lat, lng, name, address, tel, erTel, regional, type, hasTrauma : 정제된 병원 속성과 분류 결과임.
         *
         * [동작 흐름]
         * - 1) 기관별 hpid 기준 ──> list·basic·trauma·beds·messages·severe 7종 조각 조합
         * - 2) 일부 API 일시 장애 시 ──> prev(직전 정상 DTO)에서 병상·중증·공지·좌표·종별 보존
         * - 3) GeoUtils 한국 좌표 검증 통과 ──> new HospitalDto(...) 생성 후 hospitals에 적재
         */

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
         * [자바 문법]
         * - new / <> / || / && / !empty / return : 통계·출처 맵과 갱신 시각을 묶어 스냅샷을 반환함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map<String, Integer>, Map<String, Boolean>, LinkedHashMap, ZonedDateTime, DateTimeFormatter.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new LinkedHashMap<>() / Map.put(...) / List.size() / isEmpty() : 7종별 건수와 확보 여부를 기록함.
         * - Map.containsKey("messages") : messages 키가 원시 데이터 맵에 들어 있는지 검사함.
         * - ZonedDateTime.now(시간대) : 지정한 타임존(KST) 기준의 현재 날짜·시각을 생성함.
         * - ZonedDateTime.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME) : +09:00 오프셋 포함 ISO 문자열로 변환함.
         * - Map.copyOf(...) / List.copyOf(...) : 응답 안의 맵과 리스트를 모두 불변으로 고정함.
         *
         * [프로젝트 내부 타입 및 생성자]
         * - EmergencySnapshotDto (com.yonsei119.dto) : 최종 스냅샷 응답을 담는 프로젝트 DTO 레코드임.
         * - new EmergencySnapshotDto(...) : cached=false인 신규 마스터 스냅샷 레코드를 생성해 반환함.
         *
         * [지역 변수명]
         * - endpointCounts / sources : 7종 API별 원본 수신 건수 맵과 데이터 확보 여부 맵임.
         * - updatedAt : KST 오프셋(+09:00)이 포함된 ISO-8601 갱신 시각 문자열임.
         *
         * [데이터 변환 예시]
         * - 7종 조각("A2200001") -> HospitalDto(name="연세대학교원주세브란스기독병원", ...) -> EmergencySnapshotDto
         */
    }

    private static Map<String, Map<String, String>> groupSingleById(List<Map<String, String>> items) {
    /*
     * [자바 문법]
     * - private static : 인스턴스 상태 없이 순수 인덱싱 변환만 수행하는 비공개 정적 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, Map<String, String>>, List<Map<String, String>>.
     *
     * [메서드명 및 매개변수명]
     * - groupSingleById : 병원당 1건인 리스트를 hpid -> 태그 맵 사전으로 인덱싱함.
     * - items : 파싱된 단일 엔드포인트 기관 목록 매개변수임.
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
         * [자바 문법]
         * - 향상된 for / if / continue / return : hpid가 비어 있는 행은 건너뛰고 맵에 인덱싱함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map, LinkedHashMap, String.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new LinkedHashMap<>() : 원래 XML 수신 순서를 유지하는 해시맵을 생성함.
         * - Map.get(키) / Map.put(키, 값) : 맵에서 키를 꺼내 O(1) 조회용 새 맵에 등록함.
         * - String.isBlank() / trim() : 빈 ID를 거르고 앞뒤 공백을 제거함.
         *
         * [지역 변수명]
         * - map / item / rawId : hpid 1:1 색인 맵, 순회 중인 기관 맵, 원본 hpid 문자열임.
         */
    }

    private static Map<String, List<Map<String, String>>> groupMultiById(List<Map<String, String>> items) {
    /*
     * [자바 문법]
     * - private static : 인스턴스 상태 없이 1:N 그룹화만 수행하는 비공개 정적 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, List<Map<String, String>>>, List<Map<String, String>>.
     *
     * [메서드명 및 매개변수명]
     * - groupMultiById : 한 병원이 여러 공지를 갖는 1:N 데이터를 hpid -> List<Map>으로 묶음.
     * - items : 응급실 메시지 API에서 수신한 전체 공지 목록 매개변수임.
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
         * [자바 문법]
         * - 향상된 for / continue / 람다 k -> new ArrayList<>() : 기관별 공지 리스트를 만들어 누적함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map, LinkedHashMap, List, ArrayList, String.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new LinkedHashMap<>() : 기관별 공지 리스트를 묶을 맵을 생성함.
         * - Map.get(키) / String.isBlank() / trim() : 맵에서 문자열 ID를 꺼내 검증하고 공백을 지움.
         * - Map.computeIfAbsent(키, 생성람다) : 키가 없을 때만 새 ArrayList를 만들어 넣고 반환함.
         * - List.add(Map.copyOf(원본)) : 기관별 공지 리스트에 수정 불가 공지 사본을 추가함.
         *
         * [지역 변수명]
         * - map / item / rawId / k : 1:N 공지 맵, 공지 1건, 원본 hpid, 람다에 전달되는 키 변수임.
         */
    }

    private static double parseCoordinate(String text) {
    /*
     * [자바 문법]
     * - private static double : 64비트 실수 기본형(double)을 반환하는 비공개 정적 좌표 파싱 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [메서드명 및 매개변수명]
     * - parseCoordinate : 문자열 위도·경도를 double 실수로 안전하게 변환하는 메서드임.
     * - text : XML의 wgs84lat, wgs84lon 등 문자열 좌표값 매개변수임.
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
         * [자바 문법]
         * - if / try ... catch (NumberFormatException ex) / return : 실패 시 예외 대신 Double.NaN 반환.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Double (java.lang 래퍼 클래스), NumberFormatException.
         *
         * [자바/스프링 내장 메서드]
         * - String.isBlank() / trim() : 빈 문자열 여부를 검사하고 앞뒤 공백을 제거함.
         * - Double.parseDouble(문자열) : 문자열을 double 실수로 바꿈 (정수는 Integer.parseInt).
         * - Double.NaN : 숫자가 아님(Not-a-Number) 상수로, 뒤이은 isFinite() 검사에서 걸러짐.
         *
         * [지역 변수명]
         * - ex : 숫자가 아닌 문자열이 들어왔을 때 잡은 NumberFormatException 객체임.
         */
    }

    private static String firstNonBlank(String... candidates) {
    /*
     * [자바 문법]
     * - private static / 가변 인자 String... : 문자열 여러 개를 인자로 나열하면 배열로 받아 처리함.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [메서드명 및 매개변수명]
     * - firstNonBlank : 여러 후보 문자열 중 null·공백이 아닌 첫 번째 유효 문자열을 반환함.
     * - candidates : 우선순위 순서대로 나열된 후보 문자열 가변 인자 배열임.
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
         * [자바 문법]
         * - if / 향상된 for / != null / && / return : 첫 유효 후보를 만나면 즉시 반환함.
         *
         * [자바/스프링 내장 메서드]
         * - String.isBlank() / trim() : 공백 여부를 확인하고 유효한 첫 값의 앞뒤 공백을 제거함.
         *
         * [지역 변수명]
         * - candidate : 가변 인자 배열에서 순서대로 검사하는 후보 문자열 변수임.
         *
         * [동작 흐름]
         * - list -> basic -> trauma -> beds -> prev 순 검사 ──> 첫 유효 값 반환 (없으면 "" 반환)
         */
    }

    private static String displayValue(String value) {
    /*
     * [자바 문법]
     * - private static : 화면 표시 문자열 정규화용 비공개 정적 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [메서드명 및 매개변수명]
     * - displayValue : 화면 표시용 기관명·주소·전화번호가 비어 있으면 "미정보"를 반환함.
     * - value : 검증할 표시용 문자열 매개변수임.
     */
        if (value == null || value.isBlank()) {
            return "미정보";
        }
        return value.trim();
        /*
         * [자바 문법]
         * - if / == null / || / return : 비어 있으면 기본 문구를 돌려주고, 값이 있으면 공백만 다듬음.
         *
         * [자바/스프링 내장 메서드]
         * - String.isBlank() / trim() : null·공백이면 "미정보"를, 유효하면 앞뒤 공백만 지워 반환함.
         */
    }

    private static EmergencySnapshotDto asCachedSnapshot(EmergencySnapshotDto snapshot) {
    /*
     * [자바 문법]
     * - private static : 캐시 플래그 전환 사본을 만드는 비공개 정적 메서드임.
     *
     * [프로젝트 내부 타입]
     * - EmergencySnapshotDto : com.yonsei119.dto 패키지에 직접 정의한 스냅샷 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - asCachedSnapshot : 기존 불변 스냅샷에서 cached 플래그만 true로 바꾼 사본을 반환함.
     * - snapshot : cached 값을 true로 표시할 기준 스냅샷 객체 매개변수임.
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
         * [자바 문법]
         * - return / new / true : 두 번째 필드(cached)만 true로 바꾼 새 레코드 인스턴스를 반환함.
         *
         * [프로젝트 내부 타입 및 생성자·접근자]
         * - EmergencySnapshotDto (com.yonsei119.dto) : 반환 타입인 프로젝트 스냅샷 DTO 레코드임.
         * - new EmergencySnapshotDto(...) : 11개 필드 중 cached만 true로 바꾼 새 스냅샷 레코드를 생성함.
         * - snapshot.updatedAt() ~ snapshot.hospitals() : record 문법이 자동 생성한 조회 접근자들임.
         *
         * [성능 및 동시성 원리]
         * - 내부 hospitals 리스트와 불변 맵들의 메모리 참조는 그대로 재사용하고 겉 레코드만 새로 만듦.
         * - 따라서 큰 리스트를 매번 복사하는 비용 없이 즉시 캐시 응답을 만들 수 있음.
         */
    }
}
