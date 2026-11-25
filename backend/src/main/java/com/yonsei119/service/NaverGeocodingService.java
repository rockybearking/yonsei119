package com.yonsei119.service;

import com.yonsei119.config.Yonsei119Properties;
import com.yonsei119.dto.GeocodeResponseDto;
import com.yonsei119.dto.HospitalDto;
import com.yonsei119.dto.ReverseGeocodeResponseDto;
import com.yonsei119.util.BoundedTtlCache;
import com.yonsei119.util.GeoUtils;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.locks.ReentrantLock;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 위경도를 한국어 주소로 바꾸고(역지오코딩), 검색어를 위경도로 찾아 주는
 *          3단계 하이브리드 주소 안내원 서비스
 * - 실행 시점 : 서버 시작 시 `@Service` 싱글톤 빈으로 생성되며,
 *              `/api/reverse-geocode` 또는 `/api/geocode` 호출 시 실행됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [ApiController]            [NaverGeocodingService]          [Naver / Nominatim API]
 *              |                              |                                |
 *              |-- 1. geocode(query, list) -->|                                |  주소 · 지명 좌표 검색 요청
 *              |                              |-- 2. [Step 1] Naver Geocode -->|  도로명 · 지번 정확 주소 조회
 *              |                              |<-- 3. address matches ---------|  1차 좌표 후보 수신
 *         +----+------------------------------+--------------------------------+-------------+
 *         | [opt : results < 5 items]                                                        |  결과 부족 시 단계별 보충
 *         |    |                              |-- 4a. [Step 2] hospital list   |             |  전국 응급실 이름 · 주소 매칭
 *         |    |                              |-- 4b. [Step 3] Nominatim ----->|             |  0건 시 역 · 시청 랜드마크 검색
 *         +----+------------------------------+--------------------------------+-------------+
 *              |<-- 5. GeocodeResponseDto ----|                                |  10분 캐싱 후 후보 목록 반환
 *              v                              v                                v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ HttpClient / HttpRequest : 외부 지오코딩 API 호출용 표준 내장 HTTP 클라이언트
 *   ㄴ URLEncoder               : 한글 검색어 UTF-8 URL 인코딩 표준 내장 클래스
 *   ㄴ ReentrantLock            : Nominatim 초당 1회 호출 간격을 지키는 잠금 클래스
 *   ㄴ Pattern                  : 연속 공백 정규화용 정규식 표준 내장 클래스
 *   ㄴ Stream / List            : 후보 주소 필터링 및 목록 조립용 표준 내장 타입
 * - Spring 프레임워크
 *   ㄴ @Service                : 비즈니스 서비스 빈 등록 어노테이션
 * - 프로젝트 내부 타입
 *   ㄴ BoundedTtlCache : 주소·좌표 변환 결과 10분(600초) LRU 캐시
 *   ㄴ GeoUtils        : 대한민국 유효 위경도 범위 검증 유틸리티
 * - 외부 라이브러리
 *   ㄴ Jackson (`JsonMapper`, `JsonNode`)         : 응답 JSON 파싱 라이브러리
 *   ㄴ SLF4J (`Logger`) / Jakarta (`@PreDestroy`) : 로그 및 클라이언트 정리
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ EmergencyApiController.java : `reverseGeocode()`, `geocode()`
 *   ㄴ Yonsei119BackendTests.java  : Test 7 역지오코딩 · 지오코딩 JSON 파싱 검증
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/search-controls.js : `updateOriginAddress()`, `geocodeAndMoveOrigin()`
 */
@Service
public class NaverGeocodingService {

    private static final Logger log = LoggerFactory.getLogger(NaverGeocodingService.class);
    private static final long GEOCODE_CACHE_TTL_SECONDS = 600L;
    private static final int MAX_CACHE_ENTRIES = 512;
    private static final int MAX_QUERY_LENGTH = 120;
    private static final long NOMINATIM_MIN_INTERVAL_MS = 1_050L;
    private static final String REVERSE_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
    private static final String GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
    private static final Pattern WHITESPACE_PATTERN = Pattern.compile("\\s+");

    private final Yonsei119Properties properties;
    private final HttpClient httpClient;
    private final JsonMapper jsonMapper;
    private final BoundedTtlCache<String, ReverseGeocodeResponseDto> reverseGeocodeCache =
            new BoundedTtlCache<>(MAX_CACHE_ENTRIES, GEOCODE_CACHE_TTL_SECONDS);
    private final BoundedTtlCache<String, GeocodeResponseDto> geocodeCache =
            new BoundedTtlCache<>(MAX_CACHE_ENTRIES, GEOCODE_CACHE_TTL_SECONDS);
    private final ReentrantLock nominatimLock = new ReentrantLock();
    private long lastNominatimRequestAtMs = 0L;

    public NaverGeocodingService(Yonsei119Properties properties, JsonMapper jsonMapper) {
        this.properties = properties;
        this.jsonMapper = jsonMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(8))
                .build();
    }

    @PreDestroy
    public void shutdown() {
        httpClient.close();
    }

    private boolean hasNaverApiCredentials() {
        return properties.naver() != null && properties.naver().hasApiCredentials();
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 위도·경도 좌표를 한국어 주소(`강원 원주시 흥업면` 등)로 변환하며, 실패 시 좌표 텍스트로 안전하게 폴백함
     * - 주의: 네이버 역지오코딩 `coords` 파라미터 역시 `"경도(lng),위도(lat)"` 순서를 요구함
     * - 사용처: EmergencyApiController.reverseGeocode() (GET /api/reverse-geocode)
     */
    public ReverseGeocodeResponseDto reverseGeocode(double lat, double lng) {
        if (GeoUtils.isInvalidWorldCoordinate(lat, lng)) {
            return new ReverseGeocodeResponseDto(-1, "유효하지 않은 좌표 범위입니다.", 0.0, 0.0, "좌표 범위 오류", "좌표 범위 오류", "", "");
        }

        String cacheKey = String.format(Locale.US, "%.4f,%.4f", lat, lng);
        ReverseGeocodeResponseDto cached = reverseGeocodeCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        if (!hasNaverApiCredentials()) {
            String fallbackCoord = String.format(Locale.US, "위도 %.4f, 경도 %.4f", lat, lng);
            return new ReverseGeocodeResponseDto(-1, "API 인증키 미설정", lat, lng, fallbackCoord, fallbackCoord, "", "");
        }

        String coordsParam = String.format(Locale.US, "%.6f,%.6f", lng, lat);
        String url = REVERSE_GEOCODE_URL
                + "?coords=" + URLEncoder.encode(coordsParam, StandardCharsets.UTF_8)
                + "&output=json&orders=roadaddr,addr,admcode";

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(8))
                    .header("X-NCP-APIGW-API-KEY-ID", properties.naver().clientId())
                    .header("X-NCP-APIGW-API-KEY", properties.naver().clientSecret())
                    .header("Accept", "application/json")
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );

            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                ReverseGeocodeResponseDto parsed = parseReverseGeocodeJson(response.body(), lat, lng);
                if (parsed.code() == 0) {
                    reverseGeocodeCache.put(cacheKey, parsed);
                }
                return parsed;
            }
        } catch (Exception ex) {
            log.warn("네이버 Reverse Geocoding 호출 오류: {}", ex.getMessage());
        }

        String fallbackCoord = String.format(Locale.US, "위도 %.4f, 경도 %.4f", lat, lng);
        return new ReverseGeocodeResponseDto(-1, "주소 변환 실패", lat, lng, fallbackCoord, fallbackCoord, "", "");
    }

    /** 네이버 역지오코딩 JSON 응답에서 도로명(`roadaddr`), 지번(`addr`), 행정구역 요약 주소를 추출함 */
    public ReverseGeocodeResponseDto parseReverseGeocodeJson(String jsonBody, double lat, double lng) {
        try {
            JsonNode root = jsonMapper.readTree(jsonBody);
            int code = root.path("status").path("code").asInt(-1);
            String message = root.path("status").path("message").asString("");

            JsonNode results = root.path("results");
            if (code != 0 || !results.isArray() || results.isEmpty()) {
                String coordLabel = String.format(Locale.US, "위도 %.4f, 경도 %.4f", lat, lng);
                return new ReverseGeocodeResponseDto(code, message, lat, lng, coordLabel, coordLabel, "", "");
            }

            String shortAddr = "";
            String roadAddr = "";
            String jibunAddr = "";

            for (JsonNode item : results) {
                String name = item.path("name").asString("");
                JsonNode region = item.path("region");
                String a1 = region.path("area1").path("name").asString("").trim();
                String a1Short = region.path("area1").path("alias").asString(a1).trim();
                String a2 = region.path("area2").path("name").asString("").trim();
                String a3 = region.path("area3").path("name").asString("").trim();
                String a4 = region.path("area4").path("name").asString("").trim();

                String regionPrefix = String.join(" ", Stream.of(a1, a2, a3, a4)
                        .filter(s -> !s.isEmpty()).toList());
                if (shortAddr.isEmpty() && !regionPrefix.isEmpty()) {
                    shortAddr = String.join(" ", Stream.of(a1Short.isEmpty() ? a1 : a1Short, a2, a3)
                            .filter(s -> !s.isEmpty()).toList());
                }

                JsonNode land = item.path("land");
                if ("roadaddr".equals(name)) {
                    String roadName = land.path("name").asString("").trim();
                    String num1 = land.path("number1").asString("").trim();
                    String num2 = land.path("number2").asString("").trim();
                    String bldg = land.path("addition0").path("value").asString("").trim();
                    String numPart = num2.isEmpty() ? num1 : (num1 + "-" + num2);
                    roadAddr = String.join(" ", Stream.of(a1, a2, roadName, numPart, bldg)
                            .filter(s -> !s.isEmpty()).toList());
                } else if ("addr".equals(name)) {
                    String num1 = land.path("number1").asString("").trim();
                    String num2 = land.path("number2").asString("").trim();
                    String numPart = num2.isEmpty() ? num1 : (num1 + "-" + num2);
                    jibunAddr = String.join(" ", Stream.of(regionPrefix, numPart)
                            .filter(s -> !s.isEmpty()).toList());
                }
            }

            String fullAddr = !roadAddr.isEmpty() ? roadAddr : (!jibunAddr.isEmpty() ? jibunAddr : shortAddr);
            if (shortAddr.isEmpty()) {
                shortAddr = fullAddr;
            }
            return new ReverseGeocodeResponseDto(0, "ok", lat, lng, shortAddr, fullAddr, roadAddr, jibunAddr);
        } catch (Exception ex) {
            String coordLabel = String.format(Locale.US, "위도 %.4f, 경도 %.4f", lat, lng);
            return new ReverseGeocodeResponseDto(-2, ex.getMessage(), lat, lng, coordLabel, coordLabel, "", "");
        }
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 주소·지명·병원명 검색어를 3단계(네이버 API -> 메모리 내 병원 목록 -> Nominatim)로 찾아 위경도 목록을 반환함
     * - 사용처: EmergencyApiController.geocode() (GET /api/geocode)
     */
    public GeocodeResponseDto geocode(String query, List<HospitalDto> hospitals) {
        String safeQuery = query != null ? query.trim() : "";
        if (safeQuery.isEmpty()) {
            return new GeocodeResponseDto(-1, "", List.of());
        }
        if (safeQuery.length() > MAX_QUERY_LENGTH) {
            safeQuery = safeQuery.substring(0, MAX_QUERY_LENGTH);
        }

        String cacheKey = WHITESPACE_PATTERN.matcher(safeQuery).replaceAll(" ").toLowerCase(Locale.ROOT);
        GeocodeResponseDto cached = geocodeCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        List<GeocodeResponseDto.GeocodeItemDto> results = new ArrayList<>();

        // [1단계] 네이버 클라우드 Geocoding v2 API 조회
        if (hasNaverApiCredentials()) {
            try {
                String url = GEOCODE_URL + "?query=" + URLEncoder.encode(safeQuery, StandardCharsets.UTF_8);
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(Duration.ofSeconds(8))
                        .header("X-NCP-APIGW-API-KEY-ID", properties.naver().clientId())
                        .header("X-NCP-APIGW-API-KEY", properties.naver().clientSecret())
                        .header("Accept", "application/json")
                        .GET()
                        .build();

                HttpResponse<String> response = httpClient.send(
                        request,
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
                );

                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    results.addAll(parseGeocodeJson(response.body()));
                }
            } catch (Exception ex) {
                log.warn("네이버 Geocoding 호출 오류: {}", ex.getMessage());
            }
        }

        // [2단계] 캐시된 전국 응급실 병원명·주소에서 부분 일치 보충
        if (hospitals != null && results.size() < 5) {
            String compactQuery = WHITESPACE_PATTERN.matcher(safeQuery).replaceAll("").toLowerCase(Locale.ROOT);
            for (HospitalDto h : hospitals) {
                String name = h.name() != null ? h.name() : "";
                String addr = h.address() != null ? h.address() : "";
                if (WHITESPACE_PATTERN.matcher(name).replaceAll("").toLowerCase(Locale.ROOT).contains(compactQuery)
                        || WHITESPACE_PATTERN.matcher(addr).replaceAll("").toLowerCase(Locale.ROOT).contains(compactQuery)) {
                    results.add(new GeocodeResponseDto.GeocodeItemDto(name, addr, addr, h.lat(), h.lng()));
                    if (results.size() >= 6) {
                        break;
                    }
                }
            }
        }

        // [3단계] 1·2단계 결과가 비었을 때만 OpenStreetMap Nominatim으로 국내 랜드마크(역·시청 등) 조회
        if (results.isEmpty()) {
            try {
                HttpResponse<String> nomRes = sendRateLimitedNominatimRequest(safeQuery);
                if (nomRes != null && nomRes.statusCode() == 200) {
                    JsonNode arr = jsonMapper.readTree(nomRes.body());
                    if (arr.isArray()) {
                        for (JsonNode item : arr) {
                            double lat = item.path("lat").asDouble(0.0);
                            double lng = item.path("lon").asDouble(0.0);
                            String displayName = item.path("display_name").asString("").trim();
                            String name = item.path("name").asString(safeQuery).trim();
                            if (GeoUtils.isValidKoreaCoordinate(lat, lng)) {
                                results.add(new GeocodeResponseDto.GeocodeItemDto(
                                        name.isEmpty() ? safeQuery : name,
                                        displayName,
                                        displayName,
                                        lat,
                                        lng
                                ));
                            }
                        }
                    }
                }
            } catch (Exception ex) {
                log.debug("보조 지오코딩 조회 생략: {}", ex.getMessage());
            }
        }

        GeocodeResponseDto responseDto = new GeocodeResponseDto(
                results.isEmpty() ? 404 : 0,
                safeQuery,
                List.copyOf(results)
        );
        if (!results.isEmpty()) {
            geocodeCache.put(cacheKey, responseDto);
        }
        return responseDto;
    }

    /** Nominatim 공개 정책(초당 최대 1회)을 지키도록 ReentrantLock으로 요청 간 최소 1,050ms 간격을 강제함 */
    private HttpResponse<String> sendRateLimitedNominatimRequest(String safeQuery) throws Exception {
        nominatimLock.lock();
        try {
            long now = System.currentTimeMillis();
            long waitMs = (lastNominatimRequestAtMs + NOMINATIM_MIN_INTERVAL_MS) - now;
            if (waitMs > 0L) {
                Thread.sleep(waitMs);
            }
            lastNominatimRequestAtMs = System.currentTimeMillis();

            String nomUrl = "https://nominatim.openstreetmap.org/search?format=json&limit=4&countrycodes=kr&accept-language=ko&q="
                    + URLEncoder.encode(safeQuery, StandardCharsets.UTF_8);
            HttpRequest nomReq = HttpRequest.newBuilder()
                    .uri(URI.create(nomUrl))
                    .timeout(Duration.ofSeconds(6))
                    .header("User-Agent", "Yonsei119-Emergency-Service/3.0")
                    .header("Accept", "application/json")
                    .GET()
                    .build();

            return httpClient.send(nomReq, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } finally {
            nominatimLock.unlock();
        }
    }

    /** 네이버 Geocoding JSON의 `addresses` 배열을 파싱함 (`x`=경도 lng, `y`=위도 lat 매핑 주의) */
    public List<GeocodeResponseDto.GeocodeItemDto> parseGeocodeJson(String jsonBody) {
        List<GeocodeResponseDto.GeocodeItemDto> list = new ArrayList<>();
        try {
            JsonNode root = jsonMapper.readTree(jsonBody);
            JsonNode addresses = root.path("addresses");
            if (addresses.isArray()) {
                for (JsonNode item : addresses) {
                    String road = item.path("roadAddress").asString("").trim();
                    String jibun = item.path("jibunAddress").asString("").trim();
                    double lng = Double.parseDouble(item.path("x").asString("0"));
                    double lat = Double.parseDouble(item.path("y").asString("0"));
                    if (GeoUtils.isValidKoreaCoordinate(lat, lng)) {
                        String title = !road.isEmpty() ? road : jibun;
                        list.add(new GeocodeResponseDto.GeocodeItemDto(title, road, jibun, lat, lng));
                    }
                }
            }
        } catch (Exception ex) {
            log.warn("Geocoding JSON 파싱 오류: {}", ex.getMessage());
        }
        return list;
    }
}
