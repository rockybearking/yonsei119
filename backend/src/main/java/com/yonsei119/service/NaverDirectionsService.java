package com.yonsei119.service;

import com.yonsei119.config.Yonsei119Properties;
import com.yonsei119.dto.DirectionsResponseDto;
import com.yonsei119.dto.HospitalDto;
import com.yonsei119.dto.HospitalEtaRankDto;
import com.yonsei119.util.BoundedTtlCache;
import com.yonsei119.util.GeoUtils;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
/*
 * [패키지 및 임포트]
 * - com.yonsei119.service : 응급실 추천·경로 탐색·혼잡도·지오코딩 서비스 패키지 선언임.
 * - package, import : 소속 패키지와 HTTP·비동기·JSON·스프링·DTO·유틸 타입 사용을 선언함.
 *
 * [자바/라이브러리 내장 타입 (이름 변경 불가)]
 * - Logger, LoggerFactory (org.slf4j) : SLF4J 로깅 인터페이스와 로거 팩토리 클래스임.
 * - JsonNode (tools.jackson.databind) : Jackson 3의 읽기 전용 JSON 트리 노드 타입임.
 * - JsonMapper (tools.jackson.databind.json) : Jackson 3 JSON 파서·직렬화기 클래스임.
 * - ObjectNode (tools.jackson.databind.node) : 속성 추가·수정이 가능한 JSON 객체 노드임.
 * - URI, URLEncoder (java.net) : URI 생성 및 UTF-8 쿼리 인코딩 클래스임.
 * - HttpClient, HttpRequest, HttpResponse (java.net.http) : Java 11+ 표준 HTTP 통신 타입임.
 * - StandardCharsets (java.nio.charset), Duration (java.time) : 문자셋 상수 및 시간 간격 타입임.
 * - ArrayList, Comparator, LinkedHashSet, List, Locale, Map, Set (java.util) : 컬렉션·정렬·로케일 타입임.
 * - CompletableFuture (java.util.concurrent) : 비동기 작업 조합·병렬 실행 클래스임.
 * - ExecutorService, Executors (java.util.concurrent) : 스레드풀 인터페이스와 생성 팩토리임.
 * - AtomicInteger (java.util.concurrent.atomic) : 스레드 안전하게 정수를 증가시키는 숫자 객체임.
 *
 * [프로젝트 내부 참조 타입]
 * - Yonsei119Properties (com.yonsei119.config) : application.yml 설정 바인딩 레코드임.
 * - DirectionsResponseDto, HospitalDto, HospitalEtaRankDto : 경로·병원·ETA 순위 응답 DTO임.
 * - BoundedTtlCache, GeoUtils (com.yonsei119.util) : TTL 제한 캐시 및 좌표·거리 유틸리티임.
 */

@Service
public class NaverDirectionsService {
/*
 * [스프링 내장 어노테이션]
 * - @Service 정의 (출처: org.springframework.stereotype.Service, 이름 변경 불가)
 *   · 역할 : 핵심 비즈니스 로직을 담당하는 서비스 계층 클래스를 스프링 싱글톤 빈으로 자동 생성·등록하는 어노테이션임.
 * - @Service 현재 코드 적용
 *   · 적용 대상 : NaverDirectionsService 클래스 — 네이버 Directions 5/15 경로 탐색과 병원 ETA 순위 서비스 빈임.
 *   · 작동 원리 : @Component를 메타 어노테이션으로 포함하며, 컴포넌트 스캔 시 싱글톤 빈 1개를 등록하고 생성자 DI를 연결함.
 *   · 실행 시점 : 스프링 애플리케이션 부팅 및 ApplicationContext 초기화 단계에서 빈 생성과 의존성 주입이 완료됨.
 *   · 비교 : 범용 빈 @Component, 웹 API @RestController, 데이터 저장소 @Repository와 계층 역할만 구분함.
 *
 * [자바 문법]
 * - public class : 외부 패키지에서도 접근 가능한 공개 클래스 선언부임.
 *
 * [클래스명]
 * - NaverDirectionsService : 네이버 Directions 5/15 경로 탐색과 응급실 ETA 추천 순위를 담당함.
 *
 * [호출 경로 및 협력 구조]
 * - EmergencyApiController.getDirections() (GET /api/directions) -> getDrivingRoute(...)
 * - EmergencyApiController.rankDirections() (GET /api/directions/rank) -> rankHospitalsByDrivingTime(...)
 * - 생성자 주입 빈: Yonsei119Properties(설정), RouteCongestionAnalyzer(혼잡도), HospitalRecommendationScorer(추천 점수)
 * - 내부 캐시: BoundedTtlCache로 60초 TTL routeCache(경로) 및 etaCache(요약 ETA) 관리
 *
 * [동작 흐름]
 * - 단건 경로 탐색: 좌표 검증 -> routeCache 조회 -> 2배치 병렬 호출 -> route 병합 -> 전 옵션 캐싱 -> 반환
 * - 주변 병원 순위: 종별·병상·증상 필터 -> 최대 8곳 선별 -> 병렬 ETA 조회 -> 점수 산출 -> 정렬·순위 반환
 */

    private static final Logger log = LoggerFactory.getLogger(NaverDirectionsService.class);
    private static final long ROUTE_CACHE_TTL_SECONDS = 60L;
    private static final int MAX_ROUTE_CACHE_ENTRIES = 256;
    private static final int MAX_ETA_CACHE_ENTRIES = 512;
    private static final int MAX_WAYPOINTS_LENGTH = 256;
    /*
     * [자바 문법]
     * - private static final : 클래스 내부에서만 공유되며 실행 중 변경되지 않는 정적 상수임.
     *
     * [상수명]
     * - log : SLF4J 로깅용 정적 로거 상수임.
     * - ROUTE_CACHE_TTL_SECONDS : 경로·ETA 캐시 보관 수명(60초) 상수임.
     * - MAX_ROUTE_CACHE_ENTRIES : routeCache 최대 보관 건수(256건) 상수임.
     * - MAX_ETA_CACHE_ENTRIES : etaCache 최대 보관 건수(512건) 상수임.
     * - MAX_WAYPOINTS_LENGTH : 경유지 파라미터 최대 허용 길이(256자) 상수임.
     *
     * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
     * - LoggerFactory.getLogger(클래스.class) : 지정한 클래스 이름 기준의 Logger를 생성함.
     */

    public static final Map<String, String> OPTION_LABELS = Map.of(
            "trafast", "실시간 빠른길",
            "traoptimal", "실시간 최적",
            "tracomfort", "실시간 편한길",
            "traavoidtoll", "무료 우선",
            "traavoidcaronly", "자동차전용 회피"
    );
    private static final List<String> ALL_FOUR_OPTIONS = List.of(
            "trafast", "traoptimal", "tracomfort", "traavoidtoll"
    );
    /*
     * [자바 문법]
     * - public static final, private static final, 제네릭 타입(Map<String, String>, List<String>)
     *
     * [상수명]
     * - OPTION_LABELS : 네이버 Directions 5대 옵션 코드와 한국어 라벨을 연결한 불변 맵 상수임.
     * - ALL_FOUR_OPTIONS : 기본 경로 조회 시 한꺼번에 조회·캐싱하는 4대 주행 옵션 목록 상수임.
     *
     * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
     * - Map.of(...), List.of(...) : 수정 불가(Immutable) 맵과 리스트를 생성함.
     */

    private final Yonsei119Properties properties;
    private final RouteCongestionAnalyzer congestionAnalyzer;
    private final HospitalRecommendationScorer recommendationScorer;
    private final HttpClient httpClient;
    private final JsonMapper jsonMapper;
    private final ExecutorService httpBatchExecutor;
    private final ExecutorService etaRankExecutor;
    private final BoundedTtlCache<String, DirectionsResponseDto> routeCache =
            new BoundedTtlCache<>(MAX_ROUTE_CACHE_ENTRIES, ROUTE_CACHE_TTL_SECONDS);
    private final BoundedTtlCache<String, EtaSummary> etaCache =
            new BoundedTtlCache<>(MAX_ETA_CACHE_ENTRIES, ROUTE_CACHE_TTL_SECONDS);
    /*
     * [자바 문법]
     * - private final, new, 제네릭 타입, 다이아몬드 연산자(<>)
     *
     * [필드명 (멤버 변수)]
     * - properties : application.yml의 네이버 API 인증키 및 Directions URL 설정 객체임.
     * - congestionAnalyzer : 구간별 주행 속도·혼잡도 세분화 분석을 담당하는 빈 필드임.
     * - recommendationScorer : 병원 병상·공지 평가와 증상 필터링을 담당하는 빈 필드임.
     * - httpClient : 네이버 Directions HTTP GET 요청을 실행하는 재사용 클라이언트 필드임.
     * - jsonMapper : Jackson 3 JSON 파싱·병합용 매퍼 필드임.
     * - httpBatchExecutor : 단건 경로 탐색의 2개 배치를 병렬 호출하는 6스레드 풀 필드임.
     * - etaRankExecutor : 주변 병원 ETA 순위 계산용 최대 8건 병렬 호출 8스레드 풀 필드임.
     * - routeCache : 전체 경로 응답 DTO를 최대 256건·60초간 보관하는 캐시 필드임.
     * - etaCache : 병원 순위 계산용 경량 ETA 요약을 최대 512건·60초간 보관하는 캐시 필드임.
     */

    public NaverDirectionsService(
            Yonsei119Properties properties,
            RouteCongestionAnalyzer congestionAnalyzer,
            HospitalRecommendationScorer recommendationScorer
    ) {
    /*
     * [자바 문법]
     * - public NaverDirectionsService(...) : 스프링 컨테이너가 3개 빈을 생성자 주입하는 생성자임.
     * - this.필드명 : 매개변수를 멤버 필드에 대입함.
     *
     * [생성자 및 매개변수명]
     * - 생성자명: NaverDirectionsService
     * - 매개변수명: properties, congestionAnalyzer, recommendationScorer
     */
        this.properties = properties;
        this.congestionAnalyzer = congestionAnalyzer;
        this.recommendationScorer = recommendationScorer;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.jsonMapper = JsonMapper.builder().build();

        AtomicInteger batchSeq = new AtomicInteger(1);
        this.httpBatchExecutor = Executors.newFixedThreadPool(6, runnable -> {
            Thread thread = new Thread(runnable, "yonsei119-naver-batch-" + batchSeq.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        });

        AtomicInteger etaSeq = new AtomicInteger(1);
        this.etaRankExecutor = Executors.newFixedThreadPool(8, runnable -> {
            Thread thread = new Thread(runnable, "yonsei119-naver-eta-" + etaSeq.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        });
        /*
         * [자바 문법]
         * - new, 람다 표현식(runnable -> { ... }) : ThreadFactory를 람다로 구현해 스레드 설정함.
         *
         * [지역 변수명]
         * - batchSeq (배치 스레드 순번기), etaSeq (ETA 스레드 순번기), runnable, thread
         *
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build() : 10초 타임아웃 HTTP 클라이언트 생성.
         * - JsonMapper.builder().build() : Jackson 3 JsonMapper 인스턴스를 생성함.
         * - new AtomicInteger(1), .getAndIncrement() : 스레드 안전하게 1부터 번호를 증가시킴.
         * - Executors.newFixedThreadPool(int, ThreadFactory) : 고정 크기 스레드풀을 생성함.
         * - new Thread(Runnable, String), .setDaemon(true) : 이름 있는 데몬 스레드를 생성함.
         *
         * [동작 흐름]
         * - ForkJoinPool.commonPool 고갈을 막기 위해 용도별 전용 고정 스레드풀 2개 분리 생성
         *   ├── httpBatchExecutor: 6스레드 데몬 풀("yonsei119-naver-batch-1..N")
         *   └── etaRankExecutor: 8스레드 데몬 풀("yonsei119-naver-eta-1..N")
         */
    }

    @PreDestroy
    public void shutdown() {
    /*
     * [자바/스프링 내장 어노테이션]
     * - @PreDestroy 정의 (출처: jakarta.annotation.PreDestroy, 이름 변경 불가)
     *   · 역할 : 스프링 컨테이너가 종료되면서 빈을 소멸시키기 직전에 자원 정리용 메서드를 1회 자동 실행해 주는 생명주기 어노테이션임.
     * - @PreDestroy 현재 코드 적용
     *   · 적용 대상 : NaverDirectionsService.shutdown() 메서드 — 2개 전용 스레드풀 자원을 해제하는 종료 정리 메서드임.
     *   · 작동 원리 : CommonAnnotationBeanPostProcessor가 @PreDestroy 대상인 NaverDirectionsService.shutdown() 메서드를 자동 실행함.
     *   · 실행 시점 : 서버 종료나 Spring ApplicationContext가 닫히며 싱글톤 빈이 제거되기 직전에 1회만 호출됨.
     *   · 비교 : 빈 생성 직후 초기화 콜백 @PostConstruct, 인터페이스 구현 방식 DisposableBean.destroy()와 역할·구현 방식이 다름.
     *
     * [자바 문법]
     * - public void : 반환값이 없는 종료 정리 메서드 선언임.
     *
     * [메서드명]
     * - shutdown
     */
        httpBatchExecutor.shutdownNow();
        etaRankExecutor.shutdownNow();
        /*
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - ExecutorService.shutdownNow() : 대기·실행 중인 작업에 인터럽트를 걸어 스레드를 해제함.
         *
         * [동작 흐름]
         * - 빈 종료 콜백 호출 -> httpBatchExecutor.shutdownNow() -> etaRankExecutor.shutdownNow() 자원 해제
         */
    }

    private boolean isMissingNaverApiCredentials() {
    /*
     * [자바 문법]
     * - private boolean : 클래스 내부 전용 인증키 누락 여부 검사 메서드임.
     *
     * [메서드명]
     * - isMissingNaverApiCredentials
     */
        return properties.naver() == null
                || properties.naver().clientId() == null || properties.naver().clientId().isBlank()
                || properties.naver().clientSecret() == null || properties.naver().clientSecret().isBlank();
        /*
         * [자바 문법]
         * - 논리합(||), null 비교(==), return
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .isBlank() (String) : 빈 문자열이거나 공백 문자로만 이루어졌는지 검사함.
         *
         * [동작 흐름]
         * - properties.naver() null 확인 -> clientId·clientSecret null 또는 공백 확인 -> 하나라도 비면 true 반환
         */
    }

    public DirectionsResponseDto getDrivingRoute(
            double startLat,
            double startLng,
            double goalLat,
            double goalLng,
            String apiType,
            String option,
            String waypoints
    ) {
    /*
     * [자바 문법]
     * - public, 기본형 double
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [프로젝트 내부 참조 타입]
     * - DirectionsResponseDto (반환 DTO 레코드)
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: getDrivingRoute
     * - startLat/startLng (출발 위경도), goalLat/goalLng (도착 위경도)
     * - apiType ("directions5"|"directions15"), option (주행 옵션), waypoints (경유지 문자열)
     *
     * [호출 경로]
     * - EmergencyApiController.getDirections() -> GET /api/directions 에서 호출됨.
     */
        String normalizedApi = normalizeApiType(apiType);
        String normalizedOption = normalizeOption(option);
        String apiLabel = "directions15".equals(normalizedApi) ? "Directions 15" : "Directions 5";
        String optionLabel = OPTION_LABELS.getOrDefault(normalizedOption, "실시간 빠른길");

        if (GeoUtils.isInvalidWorldCoordinate(startLat, startLng) || GeoUtils.isInvalidWorldCoordinate(goalLat, goalLng)) {
            return createErrorResponse(normalizedApi, apiLabel, normalizedOption, optionLabel, -400, "유효하지 않은 출발지 또는 목적지 좌표입니다.");
        }

        String safeWaypoints = sanitizeWaypoints(waypoints);
        String cacheKey = buildRouteCacheKey(normalizedApi, normalizedOption, startLat, startLng, goalLat, goalLng, safeWaypoints);

        DirectionsResponseDto cached = routeCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        if (isMissingNaverApiCredentials()) {
            return createErrorResponse(
                    normalizedApi, apiLabel, normalizedOption, optionLabel,
                    -1, "네이버 지도 API 인증키(NAVER_MAP_CLIENT_SECRET)가 설정되지 않았습니다."
            );
        }

        String baseEndpoint = "directions15".equals(normalizedApi)
                ? properties.naver().directions15Url()
                : properties.naver().directions5Url();

        Set<String> allRequestedOptions = new LinkedHashSet<>(ALL_FOUR_OPTIONS);
        allRequestedOptions.add(normalizedOption);

        String batch1Options = "trafast:traoptimal:tracomfort";
        String batch2Options = "traavoidcaronly".equals(normalizedOption)
                ? "traavoidtoll:traavoidcaronly"
                : "traavoidtoll";

        String startParam = String.format(Locale.US, "%.6f,%.6f", startLng, startLat);
        String goalParam = String.format(Locale.US, "%.6f,%.6f", goalLng, goalLat);
        /*
         * [좌표 순서 및 배치 옵션 구성 원리]
         * - 네이버 Directions API의 start/goal은 (위도, 경도)가 아닌 "경도(lng),위도(lat)" 순으로 전달함.
         * - 1회 호출당 option은 최대 3개까지 허용되므로 batch1(3개)과 batch2(1~2개)로 나누어 동시 요청함.
         * - baseEndpoint는 application.yml의 yonsei119.naver.directions5-url 또는 directions15-url 값임.
         */

        try {
            CompletableFuture<HttpResponse<String>> future1 = CompletableFuture.supplyAsync(
                    () -> sendDirectionsHttpRequest(baseEndpoint, startParam, goalParam, batch1Options, safeWaypoints),
                    httpBatchExecutor
            );
            CompletableFuture<HttpResponse<String>> future2 = CompletableFuture.supplyAsync(
                    () -> sendDirectionsHttpRequest(baseEndpoint, startParam, goalParam, batch2Options, safeWaypoints),
                    httpBatchExecutor
            );

            HttpResponse<String> response1 = future1.join();
            HttpResponse<String> response2 = future2.join();

            HttpResponse<String> primaryResponse = (response1 != null && response1.statusCode() >= 200 && response1.statusCode() < 300)
                    ? response1
                    : response2;

            if (primaryResponse == null) {
                return createErrorResponse(normalizedApi, apiLabel, normalizedOption, optionLabel, -1, "경로 탐색 요청 중 네트워크 오류가 발생했습니다.");
            }
            if (primaryResponse.statusCode() < 200 || primaryResponse.statusCode() >= 300) {
                log.warn("네이버 {} HTTP 오류: status={}", apiLabel, primaryResponse.statusCode());
                return createErrorResponse(
                        normalizedApi, apiLabel, normalizedOption, optionLabel,
                        primaryResponse.statusCode(), "네이버 경로 탐색 서버 응답 오류 (HTTP " + primaryResponse.statusCode() + ")"
                );
            }

            String mergedBody = mergeDirectionsJsonBodies(
                    response1 != null && response1.statusCode() >= 200 && response1.statusCode() < 300 ? response1.body() : null,
                    response2 != null && response2.statusCode() >= 200 && response2.statusCode() < 300 ? response2.body() : null
            );

            for (String optKey : allRequestedOptions) {
                String label = OPTION_LABELS.getOrDefault(optKey, "실시간 빠른길");
                DirectionsResponseDto optDto = parseDirectionsJson(mergedBody, normalizedApi, apiLabel, optKey, label);
                if (optDto.code() == 0 && !optDto.path().isEmpty()) {
                    routeCache.put(
                            buildRouteCacheKey(normalizedApi, optKey, startLat, startLng, goalLat, goalLng, safeWaypoints),
                            optDto
                    );
                    if (safeWaypoints.isEmpty() && "directions5".equals(normalizedApi)) {
                        etaCache.put(
                                buildEtaCacheKey(optKey, startLat, startLng, goalLat, goalLng),
                                new EtaSummary(optDto.distanceKm(), optDto.durationMinutes(), optDto.durationText(), optDto.tollFare(), optDto.taxiFare())
                        );
                    }
                }
            }

            DirectionsResponseDto primaryCached = routeCache.get(cacheKey);
            if (primaryCached != null) {
                return primaryCached;
            }
            return parseDirectionsJson(mergedBody, normalizedApi, apiLabel, normalizedOption, optionLabel);
        } catch (Exception ex) {
            log.error("네이버 {} 호출 중 예외 발생: {}", apiLabel, ex.getMessage(), ex);
            return createErrorResponse(normalizedApi, apiLabel, normalizedOption, optionLabel, -1, "경로 탐색 요청 중 오류가 발생했습니다.");
        }
        /*
         * [자바 문법]
         * - if, 향상된 for(:), try { ... } catch (Exception ex), 삼항 연산자(? :), 람다(() -> ...)
         *
         * [지역 변수명]
         * - normalizedApi, normalizedOption, apiLabel, optionLabel, safeWaypoints, cacheKey, cached, baseEndpoint
         * - allRequestedOptions, batch1Options, batch2Options, startParam, goalParam, future1, future2
         * - response1, response2, primaryResponse, mergedBody, optKey, label, optDto, primaryCached, ex
         *
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - new LinkedHashSet<>(Collection), .add(...) (Set) : 삽입 순서를 유지해 중복 없는 집합을 만듦.
         * - Map.getOrDefault(Object key, V defaultVal) (Map) : 키가 없으면 기본값을 반환함.
         * - String.format(Locale.US, "%.6f,%.6f", ...) : 소수점 6자리 미국식 점(.) 표기로 포맷함.
         * - CompletableFuture.supplyAsync(Supplier, Executor) : 지정 스레드풀에서 비동기 작업을 실행함.
         * - .join() (CompletableFuture) : 비동기 작업이 끝날 때까지 기다려 결과를 꺼냄.
         * - .statusCode(), .body() (HttpResponse), .isEmpty() (List, String)
         * - log.warn(...), log.error(...) (Logger)
         *
         * [동작 흐름]
         * - 1단계: API·옵션 정규화 -> 좌표 범위 검증 -> 경유지 정제(sanitizeWaypoints)
         * - 2단계: routeCache 적중 시 즉시 반환 -> 미적중 시 인증키 확인 후 2배치 병렬 HTTP 호출
         * - 3단계: 2xx 응답 2개 병합(mergeDirectionsJsonBodies) -> 전 옵션 파싱 -> routeCache·etaCache 적재
         * - 4단계: 요청 cacheKey DTO 우선 반환(실패 시 createErrorResponse로 안전 응답 반환)
         */
    }

    private static String sanitizeWaypoints(String rawWaypoints) {
    /*
     * [자바 문법]
     * - private static
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: sanitizeWaypoints
     * - rawWaypoints : 사용자 요청으로 전달된 경유지 문자열임.
     */
        if (rawWaypoints == null || rawWaypoints.isBlank()) {
            return "";
        }
        String trimmed = rawWaypoints.trim();
        if (trimmed.length() > MAX_WAYPOINTS_LENGTH) {
            trimmed = trimmed.substring(0, MAX_WAYPOINTS_LENGTH);
        }
        if (!trimmed.matches("^[0-9.,:|\\-]+$")) {
            return "";
        }
        return trimmed;
        /*
         * [자바 문법]
         * - if, 논리 부정 연산자, return
         *
         * [지역 변수명]
         * - trimmed
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .isBlank(), .trim(), .length() (String) : 공백 확인, 앞뒤 제거, 길이를 조회함.
         * - .substring(int beginIndex, int endIndex), .matches(String regex) (String)
         *
         * [동작 흐름]
         * - null·공백 -> "" 반환 -> 256자 초과분 절단
         * - └── ^[0-9.,:|\-]+$ 정규식 통과 시만 반환(허용 외 문자 제거로 URL 인젝션 차단)
         */
    }

    private HttpResponse<String> sendDirectionsHttpRequest(
            String baseEndpoint,
            String startParam,
            String goalParam,
            String optionParam,
            String safeWaypoints
    ) {
    /*
     * [자바 문법]
     * - private
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - HttpResponse<String>, String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: sendDirectionsHttpRequest
     * - baseEndpoint (Directions 5/15 URL), startParam ("경도,위도"), goalParam ("경도,위도")
     * - optionParam (콜론 구분 옵션 문자열), safeWaypoints (정제된 경유지 문자열)
     */
        try {
            StringBuilder urlBuilder = new StringBuilder(baseEndpoint)
                    .append("?start=").append(URLEncoder.encode(startParam, StandardCharsets.UTF_8))
                    .append("&goal=").append(URLEncoder.encode(goalParam, StandardCharsets.UTF_8))
                    .append("&option=").append(URLEncoder.encode(optionParam, StandardCharsets.UTF_8));

            if (!safeWaypoints.isEmpty()) {
                urlBuilder.append("&waypoints=").append(URLEncoder.encode(safeWaypoints, StandardCharsets.UTF_8));
            }

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(urlBuilder.toString()))
                    .timeout(Duration.ofSeconds(10))
                    .header("X-NCP-APIGW-API-KEY-ID", properties.naver().clientId())
                    .header("X-NCP-APIGW-API-KEY", properties.naver().clientSecret())
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            /*
             * [외부 API URL 조립 3단계 분해 및 인증 헤더]
             * - 1단계 기본 URL 출처(application.yml):
             *   baseEndpoint는 properties.naver().directions5Url() 또는 directions15Url()에서 전달됨.
             *   원본 설정 키는 application.yml의 yonsei119.naver.directions5-url과 directions15-url임.
             * - 2단계 쿼리 파라미터(? / &) 및 URL 인코딩:
             *   StringBuilder로 ?start=..., &goal=..., &option=..., 선택적 &waypoints=...를 연결함.
             *   모든 값에 URLEncoder.encode(..., UTF_8)를 적용해 ','->'%2C', ':'->'%3A', '|'->'%7C' 변환함.
             *   완성된 urlBuilder.toString() 문자열을 URI.create(...)로 변환해 .uri(...)에 전달함.
             * - 3단계 인증 헤더(.header(...)):
             *   X-NCP-APIGW-API-KEY-ID : properties.naver().clientId() (yonsei119.naver.client-id)
             *   X-NCP-APIGW-API-KEY    : properties.naver().clientSecret() (yonsei119.naver.client-secret)
             *   Accept                 : "application/json"
             *
             * [최종 URL 시각 구조도]
             *   https://maps.apigw.ntruss.com/map-direction/v1/driving   <-- 1단계: application.yml directions5-url (또는 directions15-url)
             *     ?start=127.901229%2C37.319040                         <-- 2단계: 출발 경도,위도 UTF-8 인코딩
             *     &goal=127.945610%2C37.319120                          <-- 2단계: 도착 경도,위도 UTF-8 인코딩
             *     &option=trafast%3Atraoptimal%3Atracomfort             <-- 2단계: 콜론 구분 최대 3개 옵션 UTF-8 인코딩
             *     &waypoints=127.920000%2C37.320000 (선택)             <-- 2단계(선택): safeWaypoints 존재 시 추가
             *   HTTP Headers:
             *     X-NCP-APIGW-API-KEY-ID = <properties.naver().clientId()>
             *     X-NCP-APIGW-API-KEY    = <properties.naver().clientSecret()>
             *     Accept                 = application/json
             */

            return httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            log.warn("네이버 Directions 배치 호출 실패 (option={}): {}", optionParam, ex.getMessage());
            return null;
        }
        /*
         * [자바 문법]
         * - try { ... } catch (Exception ex), if, new, return null
         *
         * [지역 변수명]
         * - urlBuilder, request, ex
         *
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - new StringBuilder(String), .append(...), .toString() (StringBuilder)
         * - URLEncoder.encode(String, Charset), URI.create(String)
         * - HttpRequest.newBuilder().uri(...).timeout(Duration.ofSeconds(10)).header(...).GET().build()
         * - httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
         * - log.warn(...) (Logger)
         *
         * [동작 흐름]
         * - URL 조립·NCP 헤더 설정 -> httpClient.send 동기 GET 전송 -> HttpResponse 반환
         * - └── 네트워크·타임아웃 예외 발생 -> 경고 로그 기록 후 null 반환
         */
    }

    private String mergeDirectionsJsonBodies(String body1, String body2) {
    /*
     * [자바 문법]
     * - private
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: mergeDirectionsJsonBodies
     * - body1 (배치1 JSON 응답 문자열), body2 (배치2 JSON 응답 문자열)
     */
        if (body1 == null || body1.isBlank()) {
            return body2 != null ? body2 : "{}";
        }
        if (body2 == null || body2.isBlank()) {
            return body1;
        }
        try {
            JsonNode root1 = jsonMapper.readTree(body1);
            JsonNode root2 = jsonMapper.readTree(body2);
            if (root1.path("route") instanceof ObjectNode routeObj1
                    && root2.path("route") instanceof ObjectNode routeObj2) {
                for (String fieldName : routeObj2.propertyNames()) {
                    routeObj1.set(fieldName, routeObj2.get(fieldName));
                }
                return jsonMapper.writeValueAsString(root1);
            }
        } catch (Exception ex) {
            log.debug("Directions 응답 병합 생략: {}", ex.getMessage());
        }
        return body1;
        /*
         * [자바 문법]
         * - instanceof 패턴 매칭(`root1.path("route") instanceof ObjectNode routeObj1`) :
         *   타입 검사와 동시에 형변환된 지역 변수(routeObj1)를 바로 선언하는 Java 16+ 문법임.
         * - if, 삼항 연산자(? :), 논리곱(&&), 논리합(||), 향상된 for(:), try { ... } catch
         *
         * [지역 변수명]
         * - root1, root2, routeObj1, routeObj2, fieldName, ex
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .isBlank() (String) : 빈 문자열이나 공백만 있는지 확인함.
         * - jsonMapper.readTree(String), jsonMapper.writeValueAsString(Object) : JSON 트리 읽기·직렬화함.
         * - .path("키") (JsonNode) : 키가 없어도 MissingNode를 반환해 NullPointerException을 막음.
         * - .get("키") (JsonNode/ObjectNode 비교) : 키가 없으면 null을 반환하므로 확인 후 사용해야 함.
         * - .propertyNames() (ObjectNode) : JSON 객체가 가진 모든 키 이름 컬렉션을 반환함.
         * - .set(String key, JsonNode value) (ObjectNode) : 대상 JSON 객체에 속성을 추가·덮어씀.
         * - log.debug(...) (Logger)
         *
         * [동작 흐름]
         * - 한쪽 배치 응답 비어 있음 -> 유효한 다른 쪽 응답(없으면 "{}") 반환
         * - 두 응답 모두 route ObjectNode 보유 -> body2의 route 필드를 body1에 병합 -> 단일 JSON 반환
         */
    }

    public DirectionsResponseDto parseDirectionsJson(
            String jsonBody,
            String apiType,
            String apiLabel,
            String option,
            String optionLabel
    ) {
    /*
     * [자바 문법]
     * - public
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [프로젝트 내부 참조 타입]
     * - DirectionsResponseDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: parseDirectionsJson
     * - jsonBody (단일 또는 병합된 Directions JSON), apiType, apiLabel
     * - option (요청 주행 옵션 코드), optionLabel (한국어 옵션명)
     */
        try {
            JsonNode root = jsonMapper.readTree(jsonBody);
            int code = root.path("code").asInt(-1);
            String message = root.path("message").asString("");

            if (code != 0) {
                return createErrorResponse(apiType, apiLabel, option, optionLabel, code, message);
            }

            JsonNode routeNode = root.path("route");
            List<DirectionsResponseDto.RouteOptionSummaryDto> alternatives = new ArrayList<>();
            List<String> optionOrder = List.of("trafast", "traoptimal", "tracomfort", "traavoidtoll", "traavoidcaronly");
            for (String optKey : optionOrder) {
                JsonNode arr = routeNode.path(optKey);
                if (arr.isArray() && !arr.isEmpty()) {
                    JsonNode sum = arr.get(0).path("summary");
                    int distM = sum.path("distance").asInt(0);
                    double distKm = Math.round((distM / 100.0)) / 10.0;
                    long durMs = sum.path("duration").asLong(0L);
                    int durMin = Math.max(1, (int) Math.round(durMs / 60000.0));
                    alternatives.add(new DirectionsResponseDto.RouteOptionSummaryDto(
                            optKey, OPTION_LABELS.getOrDefault(optKey, optKey),
                            distM, distKm, durMs, durMin, formatDurationKorean(durMs),
                            sum.path("tollFare").asInt(0), sum.path("taxiFare").asInt(0), sum.path("fuelPrice").asInt(0)
                    ));
                }
            }

            JsonNode optionArray = routeNode.path(option);
            if (!optionArray.isArray() || optionArray.isEmpty()) {
                for (String fieldName : routeNode.propertyNames()) {
                    JsonNode candidate = routeNode.path(fieldName);
                    if (candidate.isArray() && !candidate.isEmpty()) {
                        optionArray = candidate;
                        break;
                    }
                }
            }

            if (!optionArray.isArray() || optionArray.isEmpty()) {
                return createErrorResponse(apiType, apiLabel, option, optionLabel, code, "탐색된 도로 경로 데이터가 없습니다.");
            }

            JsonNode firstRoute = optionArray.get(0);
            JsonNode summary = firstRoute.path("summary");
            int distanceMeters = summary.path("distance").asInt(0);
            double distanceKm = Math.round((distanceMeters / 100.0)) / 10.0;
            long durationMs = summary.path("duration").asLong(0L);
            int durationMinutes = Math.max(1, (int) Math.round(durationMs / 60000.0));

            JsonNode pathNode = firstRoute.path("path");
            List<List<Double>> path = new ArrayList<>();
            if (pathNode.isArray()) {
                for (JsonNode coord : pathNode) {
                    if (coord.isArray() && coord.size() >= 2) {
                        path.add(List.of(coord.get(0).asDouble(), coord.get(1).asDouble()));
                    }
                }
            }

            List<DirectionsResponseDto.RouteSectionDto> sections = congestionAnalyzer.buildDetailedSections(
                    firstRoute.path("section"), firstRoute.path("guide")
            );

            List<String> guidePrompts = new ArrayList<>();
            JsonNode guideNode = firstRoute.path("guide");
            if (guideNode.isArray()) {
                for (JsonNode step : guideNode) {
                    String instructions = step.path("instructions").asString("").trim();
                    if (!instructions.isEmpty()) {
                        guidePrompts.add(instructions);
                    }
                }
            }

            return new DirectionsResponseDto(
                    apiType, apiLabel, option, optionLabel, code, message,
                    distanceMeters, distanceKm, durationMs, durationMinutes,
                    formatDurationKorean(durationMs), summary.path("departureTime").asString(""),
                    summary.path("tollFare").asInt(0), summary.path("taxiFare").asInt(0), summary.path("fuelPrice").asInt(0),
                    List.copyOf(path), List.copyOf(sections), List.copyOf(guidePrompts), List.copyOf(alternatives)
            );
        } catch (Exception ex) {
            log.warn("네이버 Directions JSON 파싱 오류: {}", ex.getMessage());
            return createErrorResponse(apiType, apiLabel, option, optionLabel, -2, "경로 응답 JSON 파싱에 실패했습니다.");
        }
        /*
         * [자바 문법]
         * - try { ... } catch (Exception ex), if, 향상된 for(:), break, (int) 형변환, 제네릭, new, return
         *
         * [지역 변수명]
         * - root, code, message, routeNode, alternatives, optionOrder, optKey, arr, sum, distM, distKm, durMs, durMin
         * - optionArray, fieldName, candidate, firstRoute, summary, distanceMeters, distanceKm, durationMs, durationMinutes
         * - pathNode, path, coord, sections, guidePrompts, guideNode, step, instructions, ex
         *
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - jsonMapper.readTree(String) (JsonMapper)
         * - .path("키") (JsonNode) : 누락 시 MissingNode를 반환해 null 예외 없이 안전하게 탐색함.
         * - .get(int index) (JsonNode) : JSON 배열에서 지정 인덱스의 요소를 추출함.
         * - .get("키") (JsonNode 비교) : 객체 키가 없을 때 null을 반환함(.path와 차이).
         * - .isArray(), .isEmpty(), .size(), .propertyNames() (JsonNode)
         * - .asInt(기본값), .asLong(기본값), .asDouble(), .asString(기본값) (JsonNode)
         * - List.of(...), List.copyOf(...), new ArrayList<>(), .add(...) (List)
         * - Math.round(double), Math.max(int, int) (Math), .trim(), .isEmpty() (String)
         *
         * [동작 흐름]
         * - 1단계: 최상위 code != 0 -> 오류 응답 DTO 즉시 반환
         * - 2단계: routeNode의 5개 옵션 순회 -> 대안 경로 요약(alternatives) 목록 조립
         * - 3단계: 요청 option 배열 추출(없으면 첫 유효 배열 폴백) -> summary·path 좌표열([경도, 위도]) 파싱
         * - 4단계: section·guide는 congestionAnalyzer에 위임 -> guidePrompts와 함께 불변 DTO 조립 후 반환
         */
    }

    public List<HospitalEtaRankDto> rankHospitalsByDrivingTime(
            List<HospitalDto> allHospitals,
            double startLat,
            double startLng,
            double radiusKm,
            int limit,
            boolean includeRegional,
            boolean includeTertiary,
            boolean includeMedical,
            boolean includeOther,
            boolean onlyAvailableBeds,
            String symptomPreset,
            String rankMode,
            String option
    ) {
    /*
     * [자바 문법]
     * - public, 기본형 double·int·boolean, 제네릭 타입(List<HospitalDto>, List<HospitalEtaRankDto>)
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - List, String
     *
     * [프로젝트 내부 참조 타입]
     * - HospitalEtaRankDto, HospitalDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: rankHospitalsByDrivingTime
     * - allHospitals (전체 병원 목록), startLat/startLng (출발 위경도), radiusKm (반경 km), limit (최대 건수)
     * - includeRegional/includeTertiary/includeMedical/includeOther (병원 종별 필터 4종)
     * - onlyAvailableBeds (가용병상 보유 필터), symptomPreset (증상 프리셋), rankMode, option
     *
     * [호출 경로]
     * - EmergencyApiController.rankDirections() -> GET /api/directions/rank 에서 호출됨.
     */
        if (allHospitals == null || allHospitals.isEmpty() || GeoUtils.isInvalidWorldCoordinate(startLat, startLng)) {
            return List.of();
        }

        int safeLimit = Math.max(1, Math.min(limit, 8));
        double safeRadius = radiusKm > 0 ? GeoUtils.clamp(radiusKm, 1.0, 200.0) : 0.0;
        String normalizedOption = normalizeOption(option);
        boolean useOptimalScore = !"fastest".equalsIgnoreCase(rankMode != null ? rankMode.trim() : "");

        List<HospitalDto> matchingPool = allHospitals.stream()
                .filter(h -> matchesGroupFilter(h, includeRegional, includeTertiary, includeMedical, includeOther))
                .filter(h -> {
                    if (!onlyAvailableBeds) {
                        return true;
                    }
                    Integer beds = HospitalRecommendationScorer.parseBedCount(
                            h.beds() != null ? h.beds().get("hvec") : null
                    );
                    return beds != null && beds > 0;
                })
                .filter(h -> recommendationScorer.matchesSymptomPreset(h, symptomPreset))
                .toList();

        if (matchingPool.isEmpty()) {
            return List.of();
        }

        List<HospitalDto> candidates = matchingPool.stream()
                .filter(h -> safeRadius <= 0 || GeoUtils.haversineKm(startLat, startLng, h.lat(), h.lng()) <= safeRadius)
                .sorted(Comparator.comparingDouble(h -> candidatePreScore(h, startLat, startLng, useOptimalScore)))
                .limit(Math.min(safeLimit + 3, 8))
                .toList();

        if (candidates.isEmpty() && symptomPreset != null && !symptomPreset.isBlank() && !"all".equalsIgnoreCase(symptomPreset)) {
            candidates = matchingPool.stream()
                    .sorted(Comparator.comparingDouble(h -> candidatePreScore(h, startLat, startLng, useOptimalScore)))
                    .limit(safeLimit)
                    .toList();
        }

        if (candidates.isEmpty()) {
            return List.of();
        }

        List<CompletableFuture<HospitalEtaRankDto>> futures = candidates.stream()
                .map(hospital -> CompletableFuture.supplyAsync(() -> {
                    double straightKm = Math.round(GeoUtils.haversineKm(startLat, startLng, hospital.lat(), hospital.lng()) * 10.0) / 10.0;
                    EtaSummary eta = getDrivingEtaSummary(startLat, startLng, hospital.lat(), hospital.lng(), normalizedOption);

                    String erBeds = hospital.beds() != null ? hospital.beds().getOrDefault("hvec", "") : "";
                    String typeGroup = hospital.regional()
                            ? "regional"
                            : (hospital.type() != null ? hospital.type().group() : "other");
                    String typeLabel = hospital.regional()
                            ? "권역응급의료센터"
                            : (hospital.type() != null ? hospital.type().label() : "응급의료기관");

                    int durMin = (eta != null && eta.durationMinutes() > 0)
                            ? eta.durationMinutes()
                            : Math.max(2, (int) Math.round(straightKm * 1.8));
                    double drvKm = (eta != null && eta.durationMinutes() > 0) ? eta.distanceKm() : straightKm;
                    String durText = (eta != null && eta.durationMinutes() > 0)
                            ? eta.durationText()
                            : "약 " + durMin + "분(추정)";
                    int toll = eta != null ? eta.tollFare() : 0;
                    int taxi = eta != null ? eta.taxiFare() : 0;

                    HospitalRecommendationScorer.Evaluation eval =
                            recommendationScorer.evaluate(hospital, durMin, symptomPreset);

                    return new HospitalEtaRankDto(
                            0, hospital.id(), hospital.name(), typeGroup, typeLabel, hospital.regional(), erBeds,
                            straightKm, drvKm, durMin, durText, toll, taxi, hospital.lat(), hospital.lng(),
                            eval.availabilityStatus(), eval.hasBlockingNotice(), eval.recommendationScore(), eval.recommendationReason()
                    );
                }, etaRankExecutor))
                .toList();

        Comparator<HospitalEtaRankDto> rankComparator = useOptimalScore
                ? Comparator.comparingDouble(HospitalEtaRankDto::recommendationScore)
                        .thenComparingInt(HospitalEtaRankDto::durationMinutes)
                        .thenComparingDouble(HospitalEtaRankDto::drivingDistanceKm)
                : Comparator.comparingInt(HospitalEtaRankDto::durationMinutes)
                        .thenComparingDouble(HospitalEtaRankDto::recommendationScore)
                        .thenComparingDouble(HospitalEtaRankDto::drivingDistanceKm);

        List<HospitalEtaRankDto> sorted = futures.stream()
                .map(CompletableFuture::join)
                .sorted(rankComparator)
                .limit(safeLimit)
                .toList();

        AtomicInteger rankCounter = new AtomicInteger(1);
        return sorted.stream()
                .map(item -> new HospitalEtaRankDto(
                        rankCounter.getAndIncrement(),
                        item.id(), item.name(), item.typeGroup(), item.typeLabel(), item.regional(), item.erBeds(),
                        item.straightDistanceKm(), item.drivingDistanceKm(), item.durationMinutes(), item.durationText(),
                        item.tollFare(), item.taxiFare(), item.lat(), item.lng(),
                        item.availabilityStatus(), item.hasBlockingNotice(), item.recommendationScore(), item.recommendationReason()
                ))
                .toList();
        /*
         * [자바 문법]
         * - Stream 파이프라인, 람다 표현식, 메서드 참조(::), 삼항 연산자(? :), if, 제네릭, new, return
         *
         * [지역 변수명]
         * - safeLimit, safeRadius, normalizedOption, useOptimalScore, matchingPool, beds, candidates
         * - futures, hospital, straightKm, eta, erBeds, typeGroup, typeLabel, durMin, drvKm, durText, toll, taxi, eval
         * - rankComparator, sorted, rankCounter, item
         *
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - .stream(), .filter(...), .sorted(...), .limit(...), .map(...), .toList() (Stream)
         * - Comparator.comparingDouble(...), .thenComparingInt(...), .thenComparingDouble(...) : 다중 정렬 조건을 연결함.
         * - CompletableFuture.supplyAsync(Supplier, Executor), CompletableFuture::join : 병렬 작업 실행 및 결과 수집.
         * - new AtomicInteger(1), .getAndIncrement() : 스레드 안전하게 1부터 순위를 증가시킴.
         * - List.of(), Math.max(...), Math.min(...), Math.round(...)
         * - .equalsIgnoreCase(...), .isBlank(), .isEmpty(), .trim() (String), .get(...), .getOrDefault(...) (Map)
         *
         * [동작 흐름]
         * - 1단계(조건 필터): 종별 4종 + 가용병상(> 0) + 증상 프리셋 통과 병원(matchingPool) 추출
         * - 2단계(1차 후보): 반경 내 병원을 candidatePreScore 순으로 최대 min(safeLimit+3, 8)곳 선별
         *   └── 증상 필터 적용 시 반경 내 0건이면 반경 해제 후 전국에서 safeLimit곳 대체 선별
         * - 3단계(병렬 ETA·점수): etaRankExecutor로 getDrivingEtaSummary 호출(실패 시 직선거리*1.8분 추정)
         *   └── recommendationScorer.evaluate로 수용 점수 산출
         * - 4단계(정렬·순위): "optimal"(점수->시간->거리) 또는 "fastest"(시간->점수->거리) 정렬 -> 1~N위 반환
         */
    }

    private double candidatePreScore(HospitalDto h, double startLat, double startLng, boolean useOptimalScore) {
    /*
     * [자바 문법]
     * - private double, 기본형 boolean
     *
     * [프로젝트 내부 참조 타입]
     * - HospitalDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: candidatePreScore
     * - h (후보 병원 DTO), startLat/startLng (출발 위경도), useOptimalScore (수용 최적 모드 여부)
     */
        double distKm = GeoUtils.haversineKm(startLat, startLng, h.lat(), h.lng());
        if (!useOptimalScore) {
            return distKm;
        }
        int estMinutes = Math.max(1, (int) Math.round(distKm * 1.6));
        return recommendationScorer.evaluate(h, estMinutes, null).recommendationScore();
        /*
         * [자바 문법]
         * - double, int, if, 논리 부정 연산자, (int) 형변환, return
         *
         * [지역 변수명]
         * - distKm (직선거리 km), estMinutes (추정 주행 시간 분)
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - Math.max(int, int), Math.round(double) (Math)
         *
         * [동작 흐름]
         * - useOptimalScore == false (최단시간) -> 직선거리(distKm)만 즉시 반환
         * - useOptimalScore == true (수용최적) -> distKm * 1.6 추정 분에 병상·공지 가중치 반영 점수 반환
         */
    }

    private static boolean matchesGroupFilter(
            HospitalDto h,
            boolean includeRegional,
            boolean includeTertiary,
            boolean includeMedical,
            boolean includeOther
    ) {
    /*
     * [자바 문법]
     * - private static boolean
     *
     * [프로젝트 내부 참조 타입]
     * - HospitalDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: matchesGroupFilter
     * - 매개변수명: h, includeRegional, includeTertiary, includeMedical, includeOther
     */
        String group = h.type() != null ? h.type().group() : "other";
        boolean groupAllowed = ("tertiary".equals(group) && includeTertiary)
                || ("medical".equals(group) && includeMedical)
                || ("other".equals(group) && includeOther);
        return groupAllowed || (h.regional() && includeRegional);
        /*
         * [자바 문법]
         * - 삼항 연산자(? :), 논리곱(&&), 논리합(||), return
         *
         * [지역 변수명]
         * - group, groupAllowed
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .equals(Object) (String)
         *
         * [동작 흐름]
         * - tertiary·medical·other 종별 일치 || (h.regional() && includeRegional) 검사
         * - └── 둘 중 하나라도 참이면 true 반환(권역센터이면서 상급종합인 병원 누락 방지)
         */
    }

    private EtaSummary getDrivingEtaSummary(
            double startLat,
            double startLng,
            double goalLat,
            double goalLng,
            String normalizedOption
    ) {
    /*
     * [자바 문법]
     * - private, 기본형 double
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [프로젝트 내부 참조 타입]
     * - EtaSummary (NaverDirectionsService 내부에 정의된 private 중첩 레코드)
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: getDrivingEtaSummary
     * - 매개변수명: startLat, startLng, goalLat, goalLng, normalizedOption
     */
        String fullRouteKey = buildRouteCacheKey("directions5", normalizedOption, startLat, startLng, goalLat, goalLng, "");
        DirectionsResponseDto cachedRoute = routeCache.get(fullRouteKey);
        if (cachedRoute != null && cachedRoute.code() == 0 && cachedRoute.durationMinutes() > 0) {
            return new EtaSummary(
                    cachedRoute.distanceKm(), cachedRoute.durationMinutes(),
                    cachedRoute.durationText(), cachedRoute.tollFare(), cachedRoute.taxiFare()
            );
        }

        String etaKey = buildEtaCacheKey(normalizedOption, startLat, startLng, goalLat, goalLng);
        EtaSummary cachedEta = etaCache.get(etaKey);
        if (cachedEta != null) {
            return cachedEta;
        }

        if (isMissingNaverApiCredentials()) {
            return null;
        }

        String startParam = String.format(Locale.US, "%.6f,%.6f", startLng, startLat);
        String goalParam = String.format(Locale.US, "%.6f,%.6f", goalLng, goalLat);
        HttpResponse<String> response = sendDirectionsHttpRequest(
                properties.naver().directions5Url(), startParam, goalParam, normalizedOption, ""
        );
        if (response == null || response.statusCode() < 200 || response.statusCode() >= 300) {
            return null;
        }

        try {
            JsonNode root = jsonMapper.readTree(response.body());
            if (root.path("code").asInt(-1) != 0) {
                return null;
            }
            JsonNode optionArray = root.path("route").path(normalizedOption);
            if (!optionArray.isArray() || optionArray.isEmpty()) {
                return null;
            }
            JsonNode summary = optionArray.get(0).path("summary");
            int distanceMeters = summary.path("distance").asInt(0);
            double distanceKm = Math.round(distanceMeters / 100.0) / 10.0;
            long durationMs = summary.path("duration").asLong(0L);
            if (durationMs <= 0L) {
                return null;
            }
            int durationMinutes = Math.max(1, (int) Math.round(durationMs / 60000.0));
            EtaSummary parsed = new EtaSummary(
                    distanceKm, durationMinutes, formatDurationKorean(durationMs),
                    summary.path("tollFare").asInt(0), summary.path("taxiFare").asInt(0)
            );
            etaCache.put(etaKey, parsed);
            return parsed;
        } catch (Exception ex) {
            log.debug("ETA 요약 JSON 파싱 생략: {}", ex.getMessage());
            return null;
        }
        /*
         * [자바 문법]
         * - if, try { ... } catch (Exception ex), (int) 형변환, new, return null
         *
         * [지역 변수명]
         * - fullRouteKey, cachedRoute, etaKey, cachedEta, startParam, goalParam, response
         * - root, optionArray, summary, distanceMeters, distanceKm, durationMs, durationMinutes, parsed, ex
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - String.format(Locale.US, ...), .statusCode(), .body() (HttpResponse)
         * - jsonMapper.readTree(String), .path(String), .get(int), .isArray(), .isEmpty() (JsonNode)
         * - .asInt(int), .asLong(long) (JsonNode)
         * - Math.round(double), Math.max(int, int) (Math), log.debug(...) (Logger)
         *
         * [동작 흐름]
         * - 1단계: routeCache에 전체 경로 존재 -> 재호출 없이 요약 필드만 추출해 반환
         * - 2단계: etaCache 적중 -> 즉시 반환 | 미적중 -> Directions 5 단일 옵션 1회 HTTP 호출
         * - 3단계: path·section·guide 생략 -> summary만 파싱해 etaCache 저장 후 반환
         */
    }

    public static String formatDurationKorean(long durationMs) {
    /*
     * [자바 문법]
     * - public static, 기본형 long
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: formatDurationKorean
     * - durationMs : 밀리초(ms) 단위 주행 소요 시간임.
     */
        if (durationMs <= 0) {
            return "약 1분 미만";
        }
        int totalSeconds = (int) Math.round(durationMs / 1000.0);
        if (totalSeconds < 60) {
            return "약 " + Math.max(1, totalSeconds) + "초";
        }
        int totalMinutes = totalSeconds / 60;
        int seconds = totalSeconds % 60;
        int hours = totalMinutes / 60;
        int minutes = totalMinutes % 60;
        if (hours <= 0) {
            return seconds == 0 ? "약 " + minutes + "분" : String.format("약 %d분 %d초", minutes, seconds);
        }
        return minutes == 0 ? "약 " + hours + "시간" : String.format("약 %d시간 %d분", hours, minutes);
        /*
         * [자바 문법]
         * - int, 나눗셈(/), 나머지(%), 삼항 연산자(? :), if, (int) 형변환, return
         *
         * [지역 변수명]
         * - totalSeconds, totalMinutes, seconds, hours, minutes
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - Math.round(double), Math.max(int, int) (Math), String.format(String, Object...) (String)
         *
         * [동작 흐름]
         * - 0 이하 -> "약 1분 미만" | 60초 미만 -> "약 N초"
         * - 1시간 미만 -> "약 M분" 또는 "약 M분 S초" | 1시간 이상 -> "약 H시간" 또는 "약 H시간 M분"
         */
    }

    private static String buildRouteCacheKey(
            String apiType, String option, double startLat, double startLng, double goalLat, double goalLng, String waypoints
    ) {
    /*
     * [자바 문법]
     * - private static, 기본형 double
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: buildRouteCacheKey
     * - 매개변수명: apiType, option, startLat, startLng, goalLat, goalLng, waypoints
     */
        return String.format(Locale.US, "%s|%s|%.5f,%.5f|%.5f,%.5f|%s",
                apiType, option, startLat, startLng, goalLat, goalLng, waypoints);
        /*
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - String.format(Locale.US, ...) : OS 로케일 무관하게 소수점(.)을 고정해 포맷 문자열을 생성함.
         *
         * [동작 흐름]
         * - 위경도를 소수점 5자리(약 1.1m)로 반올림 -> "api|option|출발|도착|경유지" 형식 routeCache 키 생성
         */
    }

    private static String buildEtaCacheKey(
            String option, double startLat, double startLng, double goalLat, double goalLng
    ) {
    /*
     * [자바 문법]
     * - private static, 기본형 double
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: buildEtaCacheKey
     * - 매개변수명: option, startLat, startLng, goalLat, goalLng
     */
        return String.format(Locale.US, "eta|%s|%.5f,%.5f|%.5f,%.5f", option, startLat, startLng, goalLat, goalLng);
        /*
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - String.format(Locale.US, ...) : 미국식 소수점(.) 고정 포맷 문자열을 생성함.
         *
         * [동작 흐름]
         * - 위경도를 소수점 5자리로 고정 -> "eta|option|출발|도착" 형식 etaCache 키 생성
         */
    }

    private static String normalizeApiType(String apiType) {
    /*
     * [자바 문법]
     * - private static
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: normalizeApiType
     * - apiType : 클라이언트가 전달한 Directions API 버전 문자열임.
     */
        if (apiType != null && apiType.trim().equalsIgnoreCase("directions15")) {
            return "directions15";
        }
        return "directions5";
        /*
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .trim(), .equalsIgnoreCase(String) (String) : 공백 제거 및 대소문자 무시 비교를 수행함.
         *
         * [동작 흐름]
         * - null 아님 && trim 후 "directions15" 일치 -> "directions15" 반환
         * - └── 그 외 모든 입력 -> 안전한 기본값 "directions5" 반환
         */
    }

    private static String normalizeOption(String option) {
    /*
     * [자바 문법]
     * - private static
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: normalizeOption
     * - option : 클라이언트가 전달한 주행 옵션 코드 문자열임.
     */
        if (option == null || option.isBlank()) {
            return "trafast";
        }
        String lower = option.trim().toLowerCase(Locale.ROOT);
        return OPTION_LABELS.containsKey(lower) ? lower : "trafast";
        /*
         * [자바 문법]
         * - if, 삼항 연산자(? :), return
         *
         * [지역 변수명]
         * - lower
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .isBlank(), .trim(), .toLowerCase(Locale.ROOT) (String), Map.containsKey(Object) (Map)
         *
         * [동작 흐름]
         * - null·공백 -> 기본값 "trafast" 즉시 반환
         * - 소문자 변환 -> OPTION_LABELS에 있는 5대 공식 키면 일치한 옵션 코드, 없으면 "trafast" 반환
         */
    }

    private static DirectionsResponseDto createErrorResponse(
            String apiType, String apiLabel, String option, String optionLabel, int code, String message
    ) {
    /*
     * [자바 문법]
     * - private static, 기본형 int
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [프로젝트 내부 참조 타입]
     * - DirectionsResponseDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: createErrorResponse
     * - 매개변수명: apiType, apiLabel, option, optionLabel, code, message
     */
        return new DirectionsResponseDto(
                apiType, apiLabel, option, optionLabel, code, message,
                0, 0.0, 0L, 0, "-", "", 0, 0, 0,
                List.of(), List.of(), List.of(), List.of()
        );
        /*
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - List.of() : 요소가 없는 수정 불가 빈 리스트를 생성함.
         *
         * [동작 흐름]
         * - 거리·시간·요금은 0 및 "-"로 채움 -> List.of() 4개로 null 없는 안전 오류 DTO 반환
         */
    }

    private record EtaSummary(
            double distanceKm,
            int durationMinutes,
            String durationText,
            int tollFare,
            int taxiFare
    ) {
    /*
     * [자바 문법]
     * - private record : Java 16+ 불변 데이터 전용 중첩 레코드 선언임(생성자·접근자 자동 생성).
     *
     * [중첩 레코드명 및 컴포넌트명]
     * - 레코드명: EtaSummary
     * - distanceKm (실도로 거리 km), durationMinutes (소요 분), durationText (한국어 시간)
     * - tollFare (통행료 원), taxiFare (예상 택시요금 원)
     */
    }
}
