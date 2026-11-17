package com.yonsei119.service;

import com.yonsei119.config.Yonsei119Properties;
import com.yonsei119.dto.DirectionsResponseDto;
import com.yonsei119.dto.GeocodeResponseDto;
import com.yonsei119.dto.HospitalDto;
import com.yonsei119.dto.HospitalEtaRankDto;
import com.yonsei119.dto.ReverseGeocodeResponseDto;
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
 * [자바 문법] package, import : 네이버 클라우드 Directions 5/15 자동차 경로 탐색 및 다차원 수용 최적 추천 순위 산출 서비스 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - HttpClient, HttpRequest, HttpResponse, URI, URLEncoder : 표준 HTTP 통신 및 쿼리 인코딩 내장 도구임 (이름 변경 불가).
 * - JsonMapper, JsonNode, ObjectNode : Jackson JSON 파싱 및 2배치 다중 옵션 응답 병합 도구임 (이름 변경 불가).
 * - CompletableFuture, ExecutorService, Comparator, AtomicInteger : 병렬 경로 계산 및 순위 정렬 도구임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @Service (출처: org.springframework.stereotype), @PreDestroy (출처: jakarta.annotation)
 */

@Service
public class NaverDirectionsService {
/*
 * [스프링/라이브러리 내장 어노테이션] @Service
 * [자바 문법] public class
 * [내가 지은 이름] NaverDirectionsService : 자동차 실도로 길찾기(Directions 5/15)와 주변 응급실 수용 최적/최단시간 병렬 추천을 총괄하는 서비스임.
 * [병렬 모듈화 구조]
 * - 혼잡도 정밀 분해 -> RouteCongestionAnalyzer 로 분리 위임
 * - 병상·공지·증상 수용성 평가 -> HospitalRecommendationScorer 로 분리 위임
 * - 주소/좌표 지오코딩 -> NaverGeocodingService 로 분리 위임
 * - LRU+TTL 캐시 자료구조 -> BoundedTtlCache 로 분리 위임
 */

    private static final Logger log = LoggerFactory.getLogger(NaverDirectionsService.class);
    private static final long ROUTE_CACHE_TTL_SECONDS = 60L;
    private static final int MAX_ROUTE_CACHE_ENTRIES = 256;
    private static final int MAX_ETA_CACHE_ENTRIES = 512;
    private static final int MAX_WAYPOINTS_LENGTH = 256;
    /*
     * [자바 문법] private static final
     * [내가 지은 이름] ROUTE_CACHE_TTL_SECONDS(실시간 교통 반영 60초 캐시), MAX_ROUTE_CACHE_ENTRIES(256건), MAX_ETA_CACHE_ENTRIES(512건), MAX_WAYPOINTS_LENGTH(경유지 파라미터 길이 보안 상한)
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
     * [스프링/자바 내장 함수] Map.of(...), List.of(...) (이름 변경 불가)
     * [내가 지은 이름] OPTION_LABELS(네이버 탐색 코드 -> 한글 명칭 사전), ALL_FOUR_OPTIONS(한 번에 비교할 4대 핵심 탐색 옵션)
     */

    private final Yonsei119Properties properties;
    private final RouteCongestionAnalyzer congestionAnalyzer;
    private final HospitalRecommendationScorer recommendationScorer;
    private final NaverGeocodingService geocodingService;
    private final HttpClient httpClient;
    private final JsonMapper jsonMapper;
    private final ExecutorService httpBatchExecutor;
    private final ExecutorService etaRankExecutor;
    private final BoundedTtlCache<String, DirectionsResponseDto> routeCache =
            new BoundedTtlCache<>(MAX_ROUTE_CACHE_ENTRIES, ROUTE_CACHE_TTL_SECONDS);
    private final BoundedTtlCache<String, EtaSummary> etaCache =
            new BoundedTtlCache<>(MAX_ETA_CACHE_ENTRIES, ROUTE_CACHE_TTL_SECONDS);
    /*
     * [자바 문법] private final
     * [내가 지은 이름] properties, congestionAnalyzer(혼잡도 분석기), recommendationScorer(수용성 점수 계산기),
     *   geocodingService(지오코딩 서비스), httpBatchExecutor(다중 옵션 병렬 스레드풀), etaRankExecutor(후보 병원 병렬 ETA 스레드풀), routeCache, etaCache
     */

    public NaverDirectionsService(
            Yonsei119Properties properties,
            RouteCongestionAnalyzer congestionAnalyzer,
            HospitalRecommendationScorer recommendationScorer,
            NaverGeocodingService geocodingService
    ) {
    /*
     * [자바 문법] public NaverDirectionsService(...) : 독립 분리된 3개의 협력 서비스와 설정 객체를 주입받는 생성자임.
     */
        this.properties = properties;
        this.congestionAnalyzer = congestionAnalyzer;
        this.recommendationScorer = recommendationScorer;
        this.geocodingService = geocodingService;
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
         * [핵심 원리] 공통 스레드풀(ForkJoinPool.commonPool) 고갈을 막기 위해 길찾기 배치용(6개)과 주변 병원 ETA 병렬 비교용(8개) 전용 I/O 스레드풀을 독립 운영함.
         */
    }

    @PreDestroy
    public void shutdown() {
    /*
     * [스프링/라이브러리 내장 어노테이션] @PreDestroy
     * [내가 지은 이름] shutdown
     */
        httpBatchExecutor.shutdownNow();
        etaRankExecutor.shutdownNow();
        /*
         * [스프링/자바 내장 함수] .shutdownNow() (서버 종료 시 스레드 즉시 정리, 이름 변경 불가)
         */
    }

    private boolean hasNaverApiCredentials() {
    /*
     * [자바 문법] private boolean : NCP 인증키(clientId, clientSecret) 존재 여부를 확인함.
     * [내가 지은 이름] hasNaverApiCredentials
     */
        return properties.naver() != null
                && properties.naver().clientId() != null && !properties.naver().clientId().isBlank()
                && properties.naver().clientSecret() != null && !properties.naver().clientSecret().isBlank();
        /*
         * [핵심 원리] 브라우저에 절대 노출하면 안 되는 clientSecret이 백엔드 서버 환경변수에 잘 등록되었는지 검사함.
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
     * [자바 문법] public, double : 출발지~목적지 병원 간 자동차 주행 경로와 4대 옵션 대안을 병렬 조회해 반환함.
     * [내가 지은 이름] DirectionsResponseDto(반환 DTO), getDrivingRoute(함수명), startLat, startLng, goalLat, goalLng, apiType, option, waypoints
     */
        String normalizedApi = normalizeApiType(apiType);
        String normalizedOption = normalizeOption(option);
        String apiLabel = "directions15".equals(normalizedApi) ? "Directions 15" : "Directions 5";
        String optionLabel = OPTION_LABELS.getOrDefault(normalizedOption, "실시간 빠른길");

        if (!GeoUtils.isValidWorldCoordinate(startLat, startLng) || !GeoUtils.isValidWorldCoordinate(goalLat, goalLng)) {
            return createErrorResponse(normalizedApi, apiLabel, normalizedOption, optionLabel, -400, "유효하지 않은 출발지 또는 목적지 좌표입니다.");
        }

        String safeWaypoints = sanitizeWaypoints(waypoints);
        String cacheKey = buildRouteCacheKey(normalizedApi, normalizedOption, startLat, startLng, goalLat, goalLng, safeWaypoints);

        DirectionsResponseDto cached = routeCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        if (!hasNaverApiCredentials()) {
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
         * [좌표 순서 절대 주의]
         * - 일반적인 (위도, 경도)와 달리 네이버 Directions API의 start/goal 파라미터는 반드시 "경도(lng),위도(lat)" 순서임.
         *   예시: start=127.901229,37.319040&goal=127.945610,37.319120&option=trafast:traoptimal:tracomfort
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
         * [핵심 원리] 네이버 API는 1번 호출에 최대 3개 옵션까지만 허용하므로, [3개 옵션 배치1 + 1개 옵션 배치2]를 동시에 날려 합친 뒤
         * 4가지 주행 옵션 전체를 routeCache에 미리 저장해 두어 사용자가 다른 옵션 카드를 누를 때 0.001초 만에 전환되게 함.
         */
    }

    private static String sanitizeWaypoints(String rawWaypoints) {
    /*
     * [자바 문법] private static : 경유지 문자열에서 허용된 좌표·구분자(숫자, 소수점, 콤마, 콜론, 파이프, 마이너스)만 남기고 길이를 제한하는 보안 정제 함수임.
     * [내가 지은 이름] sanitizeWaypoints, rawWaypoints
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
         * [보안 원리] 임의의 악성 쿼리 문자열이 외부 API URL에 주입되거나 캐시 키 메모리를 오염시키는 것을 차단함.
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
     * [자바 문법] private : 네이버 클라우드 API 게이트웨이 인증 헤더(X-NCP-APIGW-API-KEY-ID / KEY)를 실어 실제 HTTP GET 요청을 전송함.
     * [내가 지은 이름] sendDirectionsHttpRequest, baseEndpoint, startParam, goalParam, optionParam, safeWaypoints
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

            return httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            log.warn("네이버 Directions 배치 호출 실패 (option={}): {}", optionParam, ex.getMessage());
            return null;
        }
        /*
         * [최종 조립된 URL 예시]
         *   https://maps.apigw.ntruss.com/map-direction/v1/driving?start=127.901229%2C37.319040&goal=127.945610%2C37.319120&option=trafast%3Atraoptimal%3Atracomfort
         */
    }

    private String mergeDirectionsJsonBodies(String body1, String body2) {
    /*
     * [자바 문법] private : 배치1(빠른길·최적·편한길)과 배치2(무료우선) JSON의 route 객체를 하나로 합침.
     * [내가 지은 이름] mergeDirectionsJsonBodies, body1, body2
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
         * [자바 16+ 패턴 매칭 문법] `root1.path("route") instanceof ObjectNode routeObj1` :
         *   타입 검사와 형변환(Casting) 변수 선언을 한 줄에 안전하게 처리함.
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
     * [자바 문법] public : 네이버 Directions JSON 본문을 파싱하여 프론트엔드 렌더링용 DirectionsResponseDto로 조립함.
     * [내가 지은 이름] parseDirectionsJson, jsonBody, apiType, apiLabel, option, optionLabel
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
         * [핵심 원리] 혼잡 구간 분석은 독립된 RouteCongestionAnalyzer에 맡기고, 여기서는 경로·요금·대안 경로 요약 조립에만 집중함.
         */
    }

    public List<HospitalEtaRankDto> rankHospitalsByDrivingTime(
            List<HospitalDto> allHospitals,
            double startLat,
            double startLng,
            double radiusKm,
            int limit,
            boolean includeOther,
            String option
    ) {
    /*
     * [자바 문법] public : 기존 시그니처 호환용 오버로드 메서드임 (권역·상급·의료원 기본 포함, 수용최적 추천 모드 적용).
     * [내가 지은 이름] rankHospitalsByDrivingTime
     */
        return rankHospitalsByDrivingTime(
                allHospitals, startLat, startLng, radiusKm, limit,
                true, true, true, includeOther, false, "all", "optimal", option
        );
        /*
         * [핵심 원리] 상세 필터 버전으로 위임하여 기존 호출 코드와의 하위 호환성을 100% 유지함.
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
     * [자바 문법] public : 4종 병원 필터 + 증상 프리셋 + 가용병상 전용 필터 + 추천 모드(optimal 수용최적 / fastest 최단시간)를 모두 반영한 핵심 추천 엔진임.
     * [내가 지은 이름] rankHospitalsByDrivingTime(오버로드 함수명), includeRegional~includeOther(4대 종별 체크박스),
     *   onlyAvailableBeds(가용병상만 보기), symptomPreset(증상 프리셋), rankMode("optimal"|"fastest"), option(주행 옵션)
     */
        if (allHospitals == null || allHospitals.isEmpty() || !GeoUtils.isValidWorldCoordinate(startLat, startLng)) {
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
         * [병렬 추천 파이프라인 요약]
         *   전체 530개 병원 ──> 종별(4종) + 증상 프리셋 + 가용병상 필터 ──> 상위 8개 후보 선정
         *   ──> etaRankExecutor로 네이버 Directions 5 단일 요약 병렬 호출
         *   ──> HospitalRecommendationScorer로 [실도로 ETA + 포화/차단 페널티] 점수 산출 ──> 1~5위 반환
         */
    }

    private double candidatePreScore(HospitalDto h, double startLat, double startLng, boolean useOptimalScore) {
    /*
     * [자바 문법] private double : 외부 API 호출 전 1차 후보 8곳을 고를 때도 만실·초과수용 병원에만 후보 슬롯이 독점되지 않도록 직선거리 추정 분 + 간단 페널티로 선별함.
     * [내가 지은 이름] candidatePreScore, h, startLat, startLng, useOptimalScore
     */
        double distKm = GeoUtils.haversineKm(startLat, startLng, h.lat(), h.lng());
        if (!useOptimalScore) {
            return distKm;
        }
        int estMinutes = Math.max(1, (int) Math.round(distKm * 1.6));
        return recommendationScorer.evaluate(h, estMinutes, null).recommendationScore();
        /*
         * [핵심 원리] 도심에서 가까운 병원 8곳이 모두 초과수용일 때 조금 더 떨어져 있지만 병상이 여유로운 병원이 1차 후보군에 진입할 수 있게 해줌.
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
     * [자바 문법] private static boolean : 프론트엔드 4개 종별 체크박스 상태와 정확히 동일한 규칙으로 후보 병원을 필터링함.
     * [내가 지은 이름] matchesGroupFilter
     */
        String group = h.type() != null ? h.type().group() : "other";
        boolean groupAllowed = ("tertiary".equals(group) && includeTertiary)
                || ("medical".equals(group) && includeMedical)
                || ("other".equals(group) && includeOther);
        return groupAllowed || (h.regional() && includeRegional);
        /*
         * [핵심 원리] 권역응급의료센터이면서 상급종합병원인 기관은 둘 중 하나만 체크되어 있어도 정상 포함됨.
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
     * [자바 문법] private : ETA 랭킹 전용 경량 조회 함수로, 캐시 히트 시 즉시 반환하고 미스 시에도 단일 옵션 1회만 호출해 API 비용을 50% 절약함.
     * [내가 지은 이름] getDrivingEtaSummary
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

        if (!hasNaverApiCredentials()) {
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
         * [핵심 성능 원리] 폴리라인 좌표 수천 개를 파싱하지 않고 summary(거리·시간·요금)만 가볍게 추출해 etaCache에 보관함.
         */
    }

    public ReverseGeocodeResponseDto reverseGeocode(double lat, double lng) {
    /*
     * [자바 문법] public : 독립 분리된 NaverGeocodingService로 역지오코딩을 위임함.
     * [내가 지은 이름] reverseGeocode, lat, lng
     */
        return geocodingService.reverseGeocode(lat, lng);
        /*
         * [핵심 원리] 기존 호출부 및 단위 테스트 호환성을 유지하면서 실제 구현은 NaverGeocodingService가 병렬 전담함.
         */
    }

    public ReverseGeocodeResponseDto parseReverseGeocodeJson(String jsonBody, double lat, double lng) {
    /*
     * [자바 문법] public : NaverGeocodingService의 역지오코딩 JSON 파서로 위임함.
     */
        return geocodingService.parseReverseGeocodeJson(jsonBody, lat, lng);
        /*
         * [핵심 원리] 역할 분리 후에도 기존 테스트 코드와 100% 호환됨.
         */
    }

    public GeocodeResponseDto geocode(String query, List<HospitalDto> hospitals) {
    /*
     * [자바 문법] public : 독립 분리된 NaverGeocodingService로 3단계 하이브리드 지오코딩을 위임함.
     */
        return geocodingService.geocode(query, hospitals);
        /*
         * [핵심 원리] 주소·장소 검색 책임을 NaverGeocodingService로 깔끔히 위임함.
         */
    }

    public List<GeocodeResponseDto.GeocodeItemDto> parseGeocodeJson(String jsonBody) {
    /*
     * [자바 문법] public : NaverGeocodingService의 지오코딩 JSON 파서로 위임함.
     */
        return geocodingService.parseGeocodeJson(jsonBody);
        /*
         * [핵심 원리] 지오코딩 파싱 로직 중복 없이 단일 구현체를 공유함.
         */
    }

    public static String formatDurationKorean(long durationMs) {
    /*
     * [자바 문법] public static : 밀리초(ms) 주행 시간을 "약 11분 3초", "약 1시간 5분" 같은 자연스러운 한국어로 포맷함.
     * [내가 지은 이름] formatDurationKorean, durationMs
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
         * [변환 예시] 960000ms (16분) -> "약 16분" | 663000ms (11분 3초) -> "약 11분 3초"
         */
    }

    private static String buildRouteCacheKey(
            String apiType, String option, double startLat, double startLng, double goalLat, double goalLng, String waypoints
    ) {
    /*
     * [자바 문법] private static : 경로 캐시 조회용 고유 문자열 키를 생성함.
     */
        return String.format(Locale.US, "%s|%s|%.5f,%.5f|%.5f,%.5f|%s",
                apiType, option, startLat, startLng, goalLat, goalLng, waypoints);
        /*
         * [생성 키 예시] "directions5|trafast|37.31904,127.90123|37.31912,127.94561|"
         */
    }

    private static String buildEtaCacheKey(
            String option, double startLat, double startLng, double goalLat, double goalLng
    ) {
    /*
     * [자바 문법] private static : ETA 요약 캐시 조회용 고유 문자열 키를 생성함.
     */
        return String.format(Locale.US, "eta|%s|%.5f,%.5f|%.5f,%.5f", option, startLat, startLng, goalLat, goalLng);
        /*
         * [생성 키 예시] "eta|trafast|37.31904,127.90123|37.31912,127.94561"
         */
    }

    private static String normalizeApiType(String apiType) {
    /*
     * [자바 문법] private static : 허용된 API 종류("directions5" 또는 "directions15")만 통과시키는 화이트리스트 정규화 함수임.
     */
        if (apiType != null && apiType.trim().equalsIgnoreCase("directions15")) {
            return "directions15";
        }
        return "directions5";
        /*
         * [보안 원리] 임의의 문자열이 들어와도 안전하게 기본값 "directions5"로 귀결됨.
         */
    }

    private static String normalizeOption(String option) {
    /*
     * [자바 문법] private static : 허용된 5종 탐색 옵션 코드만 통과시키는 화이트리스트 정규화 함수임.
     */
        if (option == null || option.isBlank()) {
            return "trafast";
        }
        String lower = option.trim().toLowerCase(Locale.ROOT);
        return OPTION_LABELS.containsKey(lower) ? lower : "trafast";
        /*
         * [보안 원리] OPTION_LABELS 사전에 등록된 공식 옵션이 아니면 즉시 "trafast"(실시간 빠른길)로 대체함.
         */
    }

    private static DirectionsResponseDto createErrorResponse(
            String apiType, String apiLabel, String option, String optionLabel, int code, String message
    ) {
    /*
     * [자바 문법] private static : 오류 상황에서도 프론트엔드가 Null 에러 없이 안내 문구를 띄울 수 있도록 빈 배열이 채워진 표준 응답 DTO를 생성함.
     */
        return new DirectionsResponseDto(
                apiType, apiLabel, option, optionLabel, code, message,
                0, 0.0, 0L, 0, "-", "", 0, 0, 0,
                List.of(), List.of(), List.of(), List.of()
        );
        /*
         * [핵심 원리] null 대신 빈 불변 리스트(List.of())를 담아 보내 프론트엔드 JS의 Array.isArray 검사 안정성을 보장함.
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
     * [자바 문법] private record : ETA 캐시에 보관할 핵심 요약 5개 필드 묶음임.
     */
    }
}
