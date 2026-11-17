package com.yonsei119.service;

import com.yonsei119.config.Yonsei119Properties;
import com.yonsei119.dto.GeocodeResponseDto;
import com.yonsei119.dto.HospitalDto;
import com.yonsei119.dto.ReverseGeocodeResponseDto;
import com.yonsei119.util.BoundedTtlCache;
import com.yonsei119.util.GeoUtils;
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
import java.util.stream.Stream;
/*
 * [자바 문법] package, import : 좌표 <-> 한국어 주소 양방향 변환(Reverse Geocoding & 3단계 하이브리드 Geocoding)을 전담하는 독립 서비스 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)] HttpClient, HttpRequest, HttpResponse, JsonMapper, JsonNode, URI, URLEncoder, Stream (이름 변경 불가)
 * [스프링/라이브러리 내장 어노테이션] @Service (출처: org.springframework.stereotype) : 길찾기 서비스와 병렬로 분리된 주소·좌표 변환 전담 비즈니스 서비스임.
 */

@Service
public class NaverGeocodingService {
/*
 * [스프링/라이브러리 내장 어노테이션] @Service
 * [자바 문법] public class
 * [내가 지은 이름] NaverGeocodingService : 네이버 Reverse Geocoding / Geocoding + 병원 주소록 + OpenStreetMap Nominatim 3단계 하이브리드 지오코딩 서비스임.
 * [핵심 원리 & 비유]
 * - '위치 번역 통역사' 역할임.
 * - 손님이 지도 위 한 점을 찍으면 "강원 원주시 흥업면" 같은 한글 주소로 번역(reverseGeocode)해 주고,
 * - 반대로 검색창에 "원주시청"이나 "연세대길 1"을 입력하면 위도·경도 숫자로 번역(geocode)해 줌.
 */

    private static final Logger log = LoggerFactory.getLogger(NaverGeocodingService.class);
    private static final long GEOCODE_CACHE_TTL_SECONDS = 600L;
    private static final int MAX_CACHE_ENTRIES = 512;
    private static final int MAX_QUERY_LENGTH = 120;
    private static final long NOMINATIM_MIN_INTERVAL_MS = 1_050L;
    private static final String REVERSE_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
    private static final String GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
    /*
     * [자바 문법] private static final
     * [내가 지은 이름] GEOCODE_CACHE_TTL_SECONDS(주소 캐시 10분 유지), MAX_QUERY_LENGTH(과도한 장문 검색 공격 차단용 120자 상한),
     *   NOMINATIM_MIN_INTERVAL_MS(보조 Nominatim 초당 1회 정책 준수 간격), REVERSE_GEOCODE_URL, GEOCODE_URL
     */

    private final Yonsei119Properties properties;
    private final HttpClient httpClient;
    private final JsonMapper jsonMapper;
    private final BoundedTtlCache<String, ReverseGeocodeResponseDto> reverseGeocodeCache =
            new BoundedTtlCache<>(MAX_CACHE_ENTRIES, GEOCODE_CACHE_TTL_SECONDS);
    private final BoundedTtlCache<String, GeocodeResponseDto> geocodeCache =
            new BoundedTtlCache<>(MAX_CACHE_ENTRIES, GEOCODE_CACHE_TTL_SECONDS);
    private final Object nominatimLock = new Object();
    private long lastNominatimRequestAtMs = 0L;
    /*
     * [자바 문법] private final, private long
     * [내가 지은 이름] BoundedTtlCache(온장고 캐시 타입) / reverseGeocodeCache, geocodeCache, nominatimLock, lastNominatimRequestAtMs
     */

    public NaverGeocodingService(Yonsei119Properties properties) {
    /*
     * [자바 문법] public NaverGeocodingService(...) : 스프링 의존성 주입 생성자임.
     * [내가 지은 이름] properties
     */
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(8))
                .build();
        this.jsonMapper = JsonMapper.builder().build();
        /*
         * [스프링/자바 내장 함수] HttpClient.newBuilder().connectTimeout(...).build(), JsonMapper.builder().build() (이름 변경 불가)
         */
    }

    private boolean hasNaverApiCredentials() {
    /*
     * [자바 문법] private boolean : NCP Client ID와 Secret이 모두 설정되어 있는지 확인함.
     * [내가 지은 이름] hasNaverApiCredentials
     */
        return properties.naver() != null
                && properties.naver().clientId() != null && !properties.naver().clientId().isBlank()
                && properties.naver().clientSecret() != null && !properties.naver().clientSecret().isBlank();
        /*
         * [핵심 원리] 로컬에 아직 비밀키를 안 넣은 개발 환경에서도 에러 대신 좌표 문자열 폴백을 우아하게 내려주기 위한 안전 점검임.
         */
    }

    public ReverseGeocodeResponseDto reverseGeocode(double lat, double lng) {
    /*
     * [자바 문법] public, double : 위도(lat)·경도(lng)를 받아 한국어 도로명·지번 주소를 반환함.
     * [내가 지은 이름] ReverseGeocodeResponseDto(반환 DTO), reverseGeocode(함수명), lat, lng
     */
        if (!GeoUtils.isValidWorldCoordinate(lat, lng)) {
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
        /*
         * [최종 조립된 네이버 Reverse Geocoding URL 예시 (주의: coords는 경도,위도 순서)]
         *   https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=127.901229%2C37.319040&output=json&orders=roadaddr,addr,admcode
         */

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
        /*
         * [성능 최적화 원리] 좌표를 소수점 넷째 자리(약 11m 격자)로 반올림한 cacheKey를 사용하여 인근 지점 재클릭 시 외부 API 호출 없이 0ms 응답함.
         */
    }

    public ReverseGeocodeResponseDto parseReverseGeocodeJson(String jsonBody, double lat, double lng) {
    /*
     * [자바 문법] public : 네이버 Reverse Geocoding 원본 JSON 문자열을 평탄화된 ReverseGeocodeResponseDto로 파싱함.
     * [내가 지은 이름] parseReverseGeocodeJson, jsonBody, lat, lng
     */
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
        /*
         * [스프링/자바 내장 함수] jsonMapper.readTree(...), String.join(" ", ...), Stream.of(...).filter(...).toList() (이름 변경 불가)
         */
    }

    public GeocodeResponseDto geocode(String query, List<HospitalDto> hospitals) {
    /*
     * [자바 문법] public : 검색어(query)를 [1단계 NCP Geocoding -> 2단계 전국 병원 주소록 -> 3단계 Nominatim 랜드마크] 순으로 하이브리드 변환함.
     * [내가 지은 이름] GeocodeResponseDto(반환 DTO), geocode(함수명), query(검색어), hospitals(전국 병원 캐시 목록)
     */
        String safeQuery = query != null ? query.trim() : "";
        if (safeQuery.isEmpty()) {
            return new GeocodeResponseDto(-1, "", List.of());
        }
        if (safeQuery.length() > MAX_QUERY_LENGTH) {
            safeQuery = safeQuery.substring(0, MAX_QUERY_LENGTH);
        }

        String cacheKey = safeQuery.replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        GeocodeResponseDto cached = geocodeCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        List<GeocodeResponseDto.GeocodeItemDto> results = new ArrayList<>();

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

        if (hospitals != null && results.size() < 5) {
            String compactQuery = safeQuery.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
            for (HospitalDto h : hospitals) {
                String name = h.name() != null ? h.name() : "";
                String addr = h.address() != null ? h.address() : "";
                if (name.replaceAll("\\s+", "").toLowerCase(Locale.ROOT).contains(compactQuery)
                        || addr.replaceAll("\\s+", "").toLowerCase(Locale.ROOT).contains(compactQuery)) {
                    results.add(new GeocodeResponseDto.GeocodeItemDto(name, addr, addr, h.lat(), h.lng()));
                    if (results.size() >= 6) {
                        break;
                    }
                }
            }
        }

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
        /*
         * [3단계 하이브리드 지오코딩 동작 예시]
         *   검색어: "원주시청" (도로명이 아닌 장소명이라 네이버 도로명 Geocoding만으로는 빈 배열이 올 수 있음)
         *   ├── 1단계: 네이버 Geocoding API 호출
         *   ├── 2단계: 전국 530개 병원 이름/주소 내장 메모리 검색
         *   └── 3단계: OpenStreetMap Nominatim 한국 영역 검색 -> (37.3422, 127.9202) 좌표 획득 성공
         */
    }

    private HttpResponse<String> sendRateLimitedNominatimRequest(String safeQuery) throws Exception {
    /*
     * [자바 문법] private ... throws Exception : OpenStreetMap 공식 정책(초당 최대 1회 호출)을 엄격히 지키는 동기화 요청 함수임.
     * [내가 지은 이름] sendRateLimitedNominatimRequest, safeQuery
     */
        synchronized (nominatimLock) {
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
                    .header("User-Agent", "Yonsei119-Emergency-Service/2.1")
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            return httpClient.send(nomReq, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        }
        /*
         * [최종 조립 URL 예시]
         *   https://nominatim.openstreetmap.org/search?format=json&limit=4&countrycodes=kr&accept-language=ko&q=%EC%9B%90%EC%A3%BC%EC%8B%9C%EC%B2%AD
         */
    }

    public List<GeocodeResponseDto.GeocodeItemDto> parseGeocodeJson(String jsonBody) {
    /*
     * [자바 문법] public : 네이버 Geocoding JSON 응답에서 한반도 유효 좌표 후보만 추출함.
     * [내가 지은 이름] parseGeocodeJson, jsonBody
     */
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
        /*
         * [주의 포인트] 네이버 응답에서 "x"는 경도(lng), "y"는 위도(lat)이므로 순서를 뒤집히지 않게 정확히 매핑했음.
         */
    }
}
