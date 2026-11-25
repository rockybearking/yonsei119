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
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 네이버 Directions 5 / 15 자동차 길찾기 API를 호출하고, 울릉도 등 해상 페리
 *          항로를 차단하며, 반경(기본 50km) 내 추천 응급실 순위를 산출하는 내비게이션 서비스
 * - 실행 시점 : 서버 시작 시 `@Service` 싱글톤 빈으로 생성되며,
 *              `/api/directions` 또는 `/api/directions/rank` 요청 시 동작함
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [ApiController]             [NaverDirectionsService]                  [Naver Directions API]
 *              |                                |                                        |
 *              |-- 1. getDrivingRoute(...) ---->|                                        |  출발지~병원 경로 탐색 요청
 *         +----+--------------------------------+----------------------------------------+------------+
 *         | [par : 2 parallel HTTP batches]                                                           |  4대 주행 옵션 동시 조회
 *         |    |                                |-- 2a. trafast:traoptimal:tracomfort -->|            |  1차 배치 병렬 요청
 *         |    |                                |-- 2b. traavoidtoll ------------------->|            |  2차 배치 병렬 요청
 *         +----+--------------------------------+----------------------------------------+------------+
 *              |                                |<-- 3. route JSON ----------------------|  경로 좌표 · 안내 응답 수신
 *         +----+--------------------------------+----------------------------------------+------------+
 *         | [alt : containsFerryCrossing (type 48/49)]                                                |  울릉도 등 해상 페리 감지
 *         |    |<-- 4a. code = -304 (blocked) --|                                        |            |  도서 페리 자동차 경로 차단
 *         +----+--------------------------------+----------------------------------------+------------+
 *         | [else : land / bridge road]                                                               |  정상 육로 · 연륙교 경로
 *         |    |<-- 4b. DirectionsResponseDto --|                                        |            |  60초 캐싱 후 경로 응답 반환
 *         +----+--------------------------------+----------------------------------------+------------+
 *              v                                v                                        v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record                   : 내부 `EtaSummary`, `RankedCandidate` 선언 키워드 (자동생성)
 *   ㄴ HttpClient / HttpRequest : 네이버 REST API 비동기 호출 표준 내장 클래스
 *   ㄴ CompletableFuture        : 배치 경로 조회 및 병렬 ETA 계산용 비동기 클래스
 *   ㄴ Executors                : Java 27 가상 스레드 실행기 생성 팩토리 클래스
 *   ㄴ Semaphore                : 동시 외부 API 호출 개수를 제어하는 동기화 클래스
 *   ㄴ Comparator               : 수용최적 점수 및 최단시간 오름차순 정렬 인터페이스
 *   ㄴ Map / List / Set         : 옵션 라벨 · 경로 좌표 · 후보 병원 표준 컬렉션
 * - Spring 프레임워크
 *   ㄴ @Service                : 비즈니스 서비스 빈 등록 어노테이션
 * - 프로젝트 내부 타입
 *   ㄴ RouteCongestionAnalyzer      : 공식 `section` 구간 요약 추출기
 *   ㄴ HospitalRecommendationScorer : 병상 여유 · 차단 공지 기반 추천 점수 산출기
 *   ㄴ BoundedTtlCache              : 경로(256개) 및 ETA(512개) 60초 LRU 캐시
 *   ㄴ GeoUtils                     : 좌표 범위 검사 및 직선거리 계산 유틸리티
 * - 외부 라이브러리
 *   ㄴ Jackson (`JsonMapper`, `JsonNode`, `ObjectNode`) : JSON 병합 및 트리 파싱
 *   ㄴ SLF4J (`Logger`) / Jakarta (`@PreDestroy`)       : 로깅 및 스레드 풀 종료
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ EmergencyApiController.java : `getDirections()`, `rankDirections()`
 *   ㄴ Yonsei119BackendTests.java  : Test 5 · 7 · 9(페리 차단) · 12(추천 순위)
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/directions-eta.js : `loadDirectionsForHospital()`, `refreshActiveRoute()`,
 *                                      `loadEtaRanking()`
 * - IntelliJ 추적 단축키
 *   ㄴ 호출 계층 보기 : 메서드명 위에서 `Ctrl + Alt + H`
 *   ㄴ 페리 차단 검색 : `Ctrl + Shift + F`로 `FERRY_ROUTE_UNSUPPORTED_CODE` 검색
 */
@Service
public class NaverDirectionsService {

    private static final Logger log = LoggerFactory.getLogger(NaverDirectionsService.class);
    private static final long ROUTE_CACHE_TTL_SECONDS = 60L;
    private static final int MAX_ROUTE_CACHE_ENTRIES = 256;
    private static final int MAX_ETA_CACHE_ENTRIES = 512;
    private static final int MAX_WAYPOINTS_LENGTH = 256;
    private static final int MAX_BATCH_CONCURRENCY = 6;
    private static final int MAX_ETA_CONCURRENCY = 8;
    // 네이버 Directions API에서 해상 페리 항로 진입(48)·출구(49)를 뜻하는 공식 guide type 코드
    private static final int GUIDE_TYPE_FERRY_ENTER = 48;
    private static final int GUIDE_TYPE_FERRY_EXIT = 49;
    public static final int FERRY_ROUTE_UNSUPPORTED_CODE = -304;
    private static final String FERRY_ROUTE_UNSUPPORTED_MESSAGE =
            "해상 페리 항로가 포함된 도서 지역(울릉도·백령도·제주 등)은 자동차 경로 안내를 제공하지 않습니다.";
    private static final Pattern WAYPOINT_PATTERN = Pattern.compile("^[0-9.,:|\\-]+$");
    private static final EtaSummary FERRY_BLOCKED_ETA = new EtaSummary(0.0, -1, "-", 0, 0, true);

    /** 네이버 Directions 5대 주행 옵션 코드와 한글 표시명 매핑 */
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

    private final Yonsei119Properties properties;
    private final RouteCongestionAnalyzer congestionAnalyzer;
    private final HospitalRecommendationScorer recommendationScorer;
    private final HttpClient httpClient;
    private final JsonMapper jsonMapper;
    private final ExecutorService httpBatchExecutor;
    private final ExecutorService etaRankExecutor;
    private final Semaphore batchConcurrencyLimiter = new Semaphore(MAX_BATCH_CONCURRENCY);
    private final Semaphore etaConcurrencyLimiter = new Semaphore(MAX_ETA_CONCURRENCY);
    private final BoundedTtlCache<String, DirectionsResponseDto> routeCache =
            new BoundedTtlCache<>(MAX_ROUTE_CACHE_ENTRIES, ROUTE_CACHE_TTL_SECONDS);
    private final BoundedTtlCache<String, EtaSummary> etaCache =
            new BoundedTtlCache<>(MAX_ETA_CACHE_ENTRIES, ROUTE_CACHE_TTL_SECONDS);

    public NaverDirectionsService(
            Yonsei119Properties properties,
            RouteCongestionAnalyzer congestionAnalyzer,
            HospitalRecommendationScorer recommendationScorer,
            JsonMapper jsonMapper
    ) {
        this.properties = properties;
        this.congestionAnalyzer = congestionAnalyzer;
        this.recommendationScorer = recommendationScorer;
        this.jsonMapper = jsonMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();

        this.httpBatchExecutor = Executors.newThreadPerTaskExecutor(
                Thread.ofVirtual().name("yonsei119-naver-batch-", 1).factory()
        );
        this.etaRankExecutor = Executors.newThreadPerTaskExecutor(
                Thread.ofVirtual().name("yonsei119-naver-eta-", 1).factory()
        );
    }

    @PreDestroy
    public void shutdown() {
        httpBatchExecutor.shutdownNow();
        etaRankExecutor.shutdownNow();
        httpClient.close();
    }

    private static <T> T runWithPermit(Semaphore semaphore, Supplier<T> task) {
        boolean acquired = false;
        try {
            semaphore.acquire();
            acquired = true;
            return task.get();
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new CompletionException(ie);
        } finally {
            if (acquired) {
                semaphore.release();
            }
        }
    }

    private boolean isMissingNaverApiCredentials() {
        return properties.naver() == null || !properties.naver().hasApiCredentials();
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 출발지~병원 자동차 경로를 조회하고 4대 주행 옵션(빠른길·최적·편한길·무료우선)을 한 번에 비교·캐싱함
     * - 주의: 네이버 Directions API는 위경도 순서가 아닌 `"경도(lng),위도(lat)"` 순서를 요구하므로 startParam/goalParam에서 순서를 맞춤
     * - 사용처: EmergencyApiController.getDirections() (GET /api/directions)
     */
    public DirectionsResponseDto getDrivingRoute(
            double startLat,
            double startLng,
            double goalLat,
            double goalLng,
            String apiType,
            String option,
            String waypoints
    ) {
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

        // 네이버 API는 1회 호출당 최대 3개 옵션만 허용하므로 2개 배치로 나누어 동시에 요청함
        String batch1Options = "trafast:traoptimal:tracomfort";
        String batch2Options = "traavoidcaronly".equals(normalizedOption)
                ? "traavoidtoll:traavoidcaronly"
                : "traavoidtoll";

        String startParam = String.format(Locale.US, "%.6f,%.6f", startLng, startLat);
        String goalParam = String.format(Locale.US, "%.6f,%.6f", goalLng, goalLat);

        try {
            CompletableFuture<HttpResponse<String>> future1 = CompletableFuture.supplyAsync(
                    () -> runWithPermit(batchConcurrencyLimiter, () ->
                            sendDirectionsHttpRequest(baseEndpoint, startParam, goalParam, batch1Options, safeWaypoints)),
                    httpBatchExecutor
            );
            CompletableFuture<HttpResponse<String>> future2 = CompletableFuture.supplyAsync(
                    () -> runWithPermit(batchConcurrencyLimiter, () ->
                            sendDirectionsHttpRequest(baseEndpoint, startParam, goalParam, batch2Options, safeWaypoints)),
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
                                new EtaSummary(optDto.distanceKm(), optDto.durationMinutes(), optDto.durationText(),
                                        optDto.tollFare(), optDto.taxiFare(), false)
                        );
                    }
                } else if (optDto.code() == FERRY_ROUTE_UNSUPPORTED_CODE) {
                    routeCache.put(
                            buildRouteCacheKey(normalizedApi, optKey, startLat, startLng, goalLat, goalLng, safeWaypoints),
                            optDto
                    );
                    if (safeWaypoints.isEmpty() && "directions5".equals(normalizedApi)) {
                        etaCache.put(buildEtaCacheKey(optKey, startLat, startLng, goalLat, goalLng), FERRY_BLOCKED_ETA);
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
    }

    private static String sanitizeWaypoints(String rawWaypoints) {
        if (rawWaypoints == null || rawWaypoints.isBlank()) {
            return "";
        }
        String trimmed = rawWaypoints.trim();
        if (trimmed.length() > MAX_WAYPOINTS_LENGTH) {
            trimmed = trimmed.substring(0, MAX_WAYPOINTS_LENGTH);
        }
        if (!WAYPOINT_PATTERN.matcher(trimmed).matches()) {
            return "";
        }
        return trimmed;
    }

    private HttpResponse<String> sendDirectionsHttpRequest(
            String baseEndpoint,
            String startParam,
            String goalParam,
            String optionParam,
            String safeWaypoints
    ) {
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

            return httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            log.warn("네이버 Directions 배치 호출 실패 (option={}): {}", optionParam, ex.getMessage());
            return null;
        }
    }

    /** 2개 배치로 나누어 받은 네이버 Directions JSON의 `route` 객체를 하나의 트리로 병합함 */
    private String mergeDirectionsJsonBodies(String body1, String body2) {
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
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 경로 내 `guide` 배열을 검사해 해상 페리(여객선) 탑승 구간이 포함되어 있는지 감지함
     * - 실제 네이버맵 일치 원리:
     *   · 네이버 Directions REST API는 육지에서 울릉군보건의료원 등을 조회할 때 묵호항 등 여객선 터미널을 거쳐
     *     `type: 48("페리항로 진입")`, `type: 49("페리항로 출구")`가 포함된 경로를 `code: 0`으로 반환함.
     *   · 반면 실제 네이버 지도 웹/앱 자동차 길찾기는 도서 페리 횡단 경로를 제공하지 않으므로 동일하게 차단함!
     *   · 단, 섬 내부 육로 이동(예: 제주시 내 -> 제주대병원, 울릉읍 내 -> 울릉군보건의료원)은 페리 구간이 없으므로 정상 안내됨.
     */
    public static boolean containsFerryCrossing(JsonNode guideNode) {
        if (guideNode == null || !guideNode.isArray()) {
            return false;
        }
        for (JsonNode step : guideNode) {
            int type = step.path("type").asInt(0);
            if (type == GUIDE_TYPE_FERRY_ENTER || type == GUIDE_TYPE_FERRY_EXIT) {
                return true;
            }
            String instructions = step.path("instructions").asString("");
            if (instructions.contains("페리") || instructions.contains("여객선") || instructions.contains("항로 진입") || instructions.contains("항로 출구")) {
                return true;
            }
        }
        return false;
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 네이버 Directions JSON 문자열을 파싱해 좌표열, 공식 혼잡도 구간, 대안 경로 요약을 담은 `DirectionsResponseDto`로 조립함
     * - 흐름:
     *   JSON 트리 파싱 -> 최상위 code == 0 확인
     *   -> 5대 옵션 순회하며 페리 미포함 육로만 alternatives에 적재
     *   -> 요청 옵션 경로가 페리 항로를 포함하면 다른 육로 옵션 탐색 후, 모두 페리면 code=-304 오류 DTO 즉시 반환
     *   -> path([경도, 위도]), congestionAnalyzer.buildDetailedSections(), guidePrompts 조립 후 반환
     * - 사용처: getDrivingRoute(), Yonsei119BackendTests(Test 5, 7, 9)
     */
    public DirectionsResponseDto parseDirectionsJson(
            String jsonBody,
            String apiType,
            String apiLabel,
            String option,
            String optionLabel
    ) {
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
            boolean anyFerryDetected = false;

            for (String optKey : optionOrder) {
                JsonNode arr = routeNode.path(optKey);
                if (arr.isArray() && !arr.isEmpty()) {
                    JsonNode candidateRoute = arr.get(0);
                    if (containsFerryCrossing(candidateRoute.path("guide"))) {
                        anyFerryDetected = true;
                        continue;
                    }
                    JsonNode sum = candidateRoute.path("summary");
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

            JsonNode selectedRoute = null;
            JsonNode requestedArray = routeNode.path(option);
            if (requestedArray.isArray() && !requestedArray.isEmpty()) {
                JsonNode candidate = requestedArray.get(0);
                if (containsFerryCrossing(candidate.path("guide"))) {
                    anyFerryDetected = true;
                } else {
                    selectedRoute = candidate;
                }
            }

            if (selectedRoute == null) {
                for (String fieldName : routeNode.propertyNames()) {
                    JsonNode candidateArr = routeNode.path(fieldName);
                    if (candidateArr.isArray() && !candidateArr.isEmpty()) {
                        JsonNode candidate = candidateArr.get(0);
                        if (containsFerryCrossing(candidate.path("guide"))) {
                            anyFerryDetected = true;
                            continue;
                        }
                        selectedRoute = candidate;
                        break;
                    }
                }
            }

            if (selectedRoute == null) {
                if (anyFerryDetected) {
                    return createErrorResponse(
                            apiType, apiLabel, option, optionLabel,
                            FERRY_ROUTE_UNSUPPORTED_CODE, FERRY_ROUTE_UNSUPPORTED_MESSAGE
                    );
                }
                return createErrorResponse(apiType, apiLabel, option, optionLabel, code, "탐색된 도로 경로 데이터가 없습니다.");
            }

            JsonNode summary = selectedRoute.path("summary");
            int distanceMeters = summary.path("distance").asInt(0);
            double distanceKm = Math.round((distanceMeters / 100.0)) / 10.0;
            long durationMs = summary.path("duration").asLong(0L);
            int durationMinutes = Math.max(1, (int) Math.round(durationMs / 60000.0));

            JsonNode pathNode = selectedRoute.path("path");
            List<List<Double>> path = new ArrayList<>();
            if (pathNode.isArray()) {
                for (JsonNode coord : pathNode) {
                    if (coord.isArray() && coord.size() >= 2) {
                        path.add(List.of(coord.get(0).asDouble(), coord.get(1).asDouble()));
                    }
                }
            }

            List<DirectionsResponseDto.RouteSectionDto> sections = congestionAnalyzer.buildDetailedSections(
                    selectedRoute.path("section"), selectedRoute.path("guide")
            );

            List<String> guidePrompts = new ArrayList<>();
            JsonNode guideNode = selectedRoute.path("guide");
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
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 출발 기준 반경(기본 50km) 내 병원들의 실도로 도착 시간과 수용 가능성을 병렬 평가해 추천 순위를 산출함
     * - 흐름:
     *   1) 종별·가용병상·증상 필터 통과 병원 추출(matchingPool)
     *   2) 반경 내 후보를 1차 사전 점수(candidatePreScore) 순으로 최대 8곳 압축
     *   3) 가상 스레드 병렬로 getDrivingEtaSummary() 호출 (페리 도서 병원은 null 필터링으로 자동 제외!)
     *   4) HospitalRecommendationScorer.evaluate() 점수 계산 후 1~N위 부여해 반환
     * - 사용처: EmergencyApiController.rankDirections() (GET /api/directions/rank)
     */
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
        if (allHospitals == null || allHospitals.isEmpty() || GeoUtils.isInvalidWorldCoordinate(startLat, startLng)) {
            return List.of();
        }

        int safeLimit = Math.clamp(limit, 1, 8);
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
                .map(hospital -> CompletableFuture.supplyAsync(() -> runWithPermit(etaConcurrencyLimiter, () -> {
                    double straightKm = Math.round(GeoUtils.haversineKm(startLat, startLng, hospital.lat(), hospital.lng()) * 10.0) / 10.0;
                    EtaSummary eta = getDrivingEtaSummary(startLat, startLng, hospital.lat(), hospital.lng(), normalizedOption);
                    if (eta != null && eta.ferryBlocked()) {
                        return null;
                    }

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
                }), etaRankExecutor))
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
                .filter(Objects::nonNull)
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
    }

    private double candidatePreScore(HospitalDto h, double startLat, double startLng, boolean useOptimalScore) {
        double distKm = GeoUtils.haversineKm(startLat, startLng, h.lat(), h.lng());
        if (!useOptimalScore) {
            return distKm;
        }
        int estMinutes = Math.max(1, (int) Math.round(distKm * 1.6));
        return recommendationScorer.evaluate(h, estMinutes, null).recommendationScore();
    }

    private static boolean matchesGroupFilter(
            HospitalDto h,
            boolean includeRegional,
            boolean includeTertiary,
            boolean includeMedical,
            boolean includeOther
    ) {
        String group = h.type() != null ? h.type().group() : "other";
        boolean groupAllowed = ("tertiary".equals(group) && includeTertiary)
                || ("medical".equals(group) && includeMedical)
                || ("other".equals(group) && includeOther);
        return groupAllowed || (h.regional() && includeRegional);
    }

    /** ETA 순위 계산을 위해 단일 옵션(Directions 5) 요약만 가볍게 조회하며, 페리 항로 감지 시 차단 마커를 캐싱함 */
    private EtaSummary getDrivingEtaSummary(
            double startLat,
            double startLng,
            double goalLat,
            double goalLng,
            String normalizedOption
    ) {
        String fullRouteKey = buildRouteCacheKey("directions5", normalizedOption, startLat, startLng, goalLat, goalLng, "");
        DirectionsResponseDto cachedRoute = routeCache.get(fullRouteKey);
        if (cachedRoute != null) {
            if (cachedRoute.code() == FERRY_ROUTE_UNSUPPORTED_CODE) {
                return FERRY_BLOCKED_ETA;
            }
            if (cachedRoute.code() == 0 && cachedRoute.durationMinutes() > 0) {
                return new EtaSummary(
                        cachedRoute.distanceKm(), cachedRoute.durationMinutes(),
                        cachedRoute.durationText(), cachedRoute.tollFare(), cachedRoute.taxiFare(), false
                );
            }
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
            JsonNode firstRoute = optionArray.get(0);
            if (containsFerryCrossing(firstRoute.path("guide"))) {
                etaCache.put(etaKey, FERRY_BLOCKED_ETA);
                return FERRY_BLOCKED_ETA;
            }
            JsonNode summary = firstRoute.path("summary");
            int distanceMeters = summary.path("distance").asInt(0);
            double distanceKm = Math.round(distanceMeters / 100.0) / 10.0;
            long durationMs = summary.path("duration").asLong(0L);
            if (durationMs <= 0L) {
                return null;
            }
            int durationMinutes = Math.max(1, (int) Math.round(durationMs / 60000.0));
            EtaSummary parsed = new EtaSummary(
                    distanceKm, durationMinutes, formatDurationKorean(durationMs),
                    summary.path("tollFare").asInt(0), summary.path("taxiFare").asInt(0), false
            );
            etaCache.put(etaKey, parsed);
            return parsed;
        } catch (Exception ex) {
            log.debug("ETA 요약 JSON 파싱 생략: {}", ex.getMessage());
            return null;
        }
    }

    /** 밀리초(ms) 주행 시간을 "약 11분 20초" 또는 "약 1시간 15분" 형태의 한국어 문구로 변환함 */
    public static String formatDurationKorean(long durationMs) {
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
    }

    private static String buildRouteCacheKey(
            String apiType, String option, double startLat, double startLng, double goalLat, double goalLng, String waypoints
    ) {
        return String.format(Locale.US, "%s|%s|%.5f,%.5f|%.5f,%.5f|%s",
                apiType, option, startLat, startLng, goalLat, goalLng, waypoints);
    }

    private static String buildEtaCacheKey(
            String option, double startLat, double startLng, double goalLat, double goalLng
    ) {
        return String.format(Locale.US, "eta|%s|%.5f,%.5f|%.5f,%.5f", option, startLat, startLng, goalLat, goalLng);
    }

    private static String normalizeApiType(String apiType) {
        if (apiType != null && apiType.trim().equalsIgnoreCase("directions15")) {
            return "directions15";
        }
        return "directions5";
    }

    private static String normalizeOption(String option) {
        if (option == null || option.isBlank()) {
            return "trafast";
        }
        String lower = option.trim().toLowerCase(Locale.ROOT);
        return OPTION_LABELS.containsKey(lower) ? lower : "trafast";
    }

    private static DirectionsResponseDto createErrorResponse(
            String apiType, String apiLabel, String option, String optionLabel, int code, String message
    ) {
        return new DirectionsResponseDto(
                apiType, apiLabel, option, optionLabel, code, message,
                0, 0.0, 0L, 0, "-", "", 0, 0, 0,
                List.of(), List.of(), List.of(), List.of()
        );
    }

    private record EtaSummary(
            double distanceKm,
            int durationMinutes,
            String durationText,
            int tollFare,
            int taxiFare,
            boolean ferryBlocked
    ) {
    }
}
