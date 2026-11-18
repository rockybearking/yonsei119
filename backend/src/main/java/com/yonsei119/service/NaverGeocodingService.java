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
 * [패키지 및 임포트]
 * - com.yonsei119.service : 비즈니스 로직 및 외부 API 연동 클래스들을 묶은 패키지 선언임.
 * - package, import : 소속 패키지와 HTTP·JSON·스트림·스프링·DTO·유틸 타입 사용을 선언함.
 *
 * [자바/라이브러리 내장 타입 (이름 변경 불가)]
 * - Logger, LoggerFactory (org.slf4j) : SLF4J 로그 출력 인터페이스와 로거 생성 팩토리임.
 * - JsonNode, JsonMapper (tools.jackson.databind) : Spring Boot 4 내장 Jackson 3 JSON 도구임.
 * - URI, URLEncoder (java.net) : URI 생성 및 UTF-8 쿼리 파라미터 인코딩 도구임.
 * - HttpClient, HttpRequest, HttpResponse (java.net.http) : Java 11+ 표준 HTTP 통신 타입임.
 * - StandardCharsets (java.nio.charset) : UTF_8 등 표준 문자셋 상수 모음 클래스임.
 * - Duration (java.time) : 초·밀리초 단위 시간 간격을 표현하는 불변 클래스임.
 * - ArrayList, List, Locale, Stream (java.util) : 동적 리스트, 로케일, 함수형 스트림 타입임.
 *
 * [프로젝트 내부 참조 타입]
 * - Yonsei119Properties (com.yonsei119.config) : application.yml 설정 바인딩 레코드임.
 * - GeocodeResponseDto, HospitalDto, ReverseGeocodeResponseDto (com.yonsei119.dto) : 도메인 DTO임.
 * - BoundedTtlCache, GeoUtils (com.yonsei119.util) : TTL 제한 캐시 및 좌표 검증 유틸리티임.
 */

@Service
public class NaverGeocodingService {
/*
 * [스프링 내장 어노테이션]
 * - @Service 정의 (출처: org.springframework.stereotype.Service, 이름 변경 불가)
 *   · 역할 : 핵심 비즈니스 로직을 담당하는 서비스 계층 클래스를 스프링 싱글톤 빈으로 자동 생성·등록하는 어노테이션임.
 * - @Service 현재 코드 적용
 *   · 적용 대상 : NaverGeocodingService 클래스 — 역지오코딩과 3단계 지오코딩 변환을 담당하는 서비스 빈임.
 *   · 작동 원리 : @Component를 메타 어노테이션으로 포함하며, 컴포넌트 스캔 시 싱글톤 빈 1개를 등록하고 생성자 DI를 연결함.
 *   · 실행 시점 : 스프링 애플리케이션 부팅 및 ApplicationContext 초기화 단계에서 빈 생성과 의존성 주입이 완료됨.
 *   · 비교 : 범용 빈 @Component, 웹 API @RestController, 데이터 저장소 @Repository와 계층 역할만 구분함.
 *
 * [자바 문법]
 * - public class : 다른 패키지에서도 접근 가능한 공개 클래스 선언부임.
 *
 * [클래스명]
 * - NaverGeocodingService : 위경도->주소(역지오코딩)와 검색어->좌표(3단계 지오코딩) 변환 서비스임.
 *
 * [호출 경로 및 협력 구조]
 * - EmergencyApiController (GET /api/reverse-geocode, GET /api/geocode)에서 직접 호출함.
 * - 생성자에서 Yonsei119Properties 빈을 주입받아 네이버 API 인증키를 참조함.
 *
 * [동작 흐름]
 * - 역지오코딩: 좌표 검증 -> 소수점 4자리 캐시 -> 네이버 API 호출 -> 실패 시 좌표 텍스트 폴백
 * - 지오코딩: 검색어 정제 -> 정규화 캐시 -> 1단계 네이버 -> 2단계 병원 목록 -> 3단계 Nominatim
 */

    private static final Logger log = LoggerFactory.getLogger(NaverGeocodingService.class);
    private static final long GEOCODE_CACHE_TTL_SECONDS = 600L;
    private static final int MAX_CACHE_ENTRIES = 512;
    private static final int MAX_QUERY_LENGTH = 120;
    private static final long NOMINATIM_MIN_INTERVAL_MS = 1_050L;
    private static final String REVERSE_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
    private static final String GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
    /*
     * [자바 문법]
     * - private static final : 클래스 내부에서만 공유되며 재할당이 불가능한 정적 상수 선언임.
     * - 1_050L : 자릿수 가독성을 높인 Java 7+ 밑줄 표기 long 리터럴(실제 값 1050)임.
     *
     * [상수명]
     * - log : SLF4J 로그 출력용 정적 로거 상수임.
     * - GEOCODE_CACHE_TTL_SECONDS : 지오코딩·역지오코딩 캐시 수명(600초 = 10분) 상수임.
     * - MAX_CACHE_ENTRIES : reverseGeocodeCache와 geocodeCache의 최대 보관 건수(512건) 상수임.
     * - MAX_QUERY_LENGTH : 과도한 검색어 입력을 자르는 최대 글자 수 상수(120자)임.
     * - NOMINATIM_MIN_INTERVAL_MS : Nominatim 초당 1회 제한을 지키기 위한 최소 간격(1,050ms) 상수임.
     * - REVERSE_GEOCODE_URL, GEOCODE_URL : 네이버 클라우드 역지오코딩·지오코딩 v2 URL 상수임.
     *
     * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
     * - LoggerFactory.getLogger(클래스.class) : 지정한 클래스 이름 기준의 Logger를 생성함.
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
     * [자바 문법]
     * - private final : 초기화 이후 다른 객체 참조로 바꿀 수 없는 멤버 필드 선언임.
     * - private long : 요청 시각마다 값이 갱신되므로 final을 붙이지 않은 64비트 정수 필드임.
     * - new, 제네릭 타입, 다이아몬드 연산자(<>)
     *
     * [필드명 (멤버 변수)]
     * - properties : application.yml의 네이버 API 인증키(clientId, clientSecret) 설정 객체임.
     * - httpClient : 네이버 및 Nominatim HTTP GET 통신용 재사용 클라이언트 필드임.
     * - jsonMapper : Jackson 3 기반 JSON 응답 파싱기 필드임.
     * - reverseGeocodeCache : 좌표 키 -> 역지오코딩 결과 캐시(최대 512건, 600초 TTL)임.
     * - geocodeCache : 정규화 검색어 키 -> 지오코딩 결과 캐시(최대 512건, 600초 TTL)임.
     * - nominatimLock : synchronized 블록에서 Nominatim 호출을 1건씩 직렬화하는 잠금 기준 객체임.
     * - lastNominatimRequestAtMs : 직전 Nominatim 요청 시각(UTC 밀리초)을 기록하는 필드임.
     */

    public NaverGeocodingService(Yonsei119Properties properties) {
    /*
     * [자바 문법]
     * - public NaverGeocodingService(...) : 스프링 컨테이너가 설정 빈을 생성자 주입하는 생성자임.
     * - this.필드명 : 매개변수와 필드 이름이 같을 때 인스턴스 필드를 구분하는 키워드임.
     *
     * [생성자 및 매개변수명]
     * - 생성자명: NaverGeocodingService
     * - properties : application.yml 설정이 바인딩된 Yonsei119Properties 객체임.
     */
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(8))
                .build();
        this.jsonMapper = JsonMapper.builder().build();
        /*
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - HttpClient.newBuilder() : HTTP 클라이언트 빌더 객체를 생성함.
         * - .connectTimeout(Duration.ofSeconds(8)) : TCP 연결 제한 시간을 8초로 설정함.
         * - .build() : 설정된 옵션으로 불변 HttpClient 인스턴스를 생성함.
         * - JsonMapper.builder().build() : Jackson 3 JsonMapper 인스턴스를 생성함.
         *
         * [동작 흐름]
         * - properties 저장 -> 8초 연결 타임아웃 HttpClient 생성 -> JsonMapper 초기화
         */
    }

    private boolean hasNaverApiCredentials() {
    /*
     * [자바 문법]
     * - private boolean : 클래스 내부 전용 인증키 유무 검사 메서드임.
     *
     * [메서드명]
     * - hasNaverApiCredentials : 네이버 API clientId·clientSecret 설정 여부를 검사함.
     */
        return properties.naver() != null
                && properties.naver().clientId() != null && !properties.naver().clientId().isBlank()
                && properties.naver().clientSecret() != null && !properties.naver().clientSecret().isBlank();
        /*
         * [자바 문법]
         * - 논리곱(&&), 논리 부정 연산자, null 비교(!=), return
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .isBlank() (String) : 빈 문자열이거나 공백 문자로만 이루어졌는지 판별함.
         *
         * [동작 흐름]
         * - properties.naver() 확인 -> clientId·clientSecret 공백 아님 확인 -> 모두 참이면 true 반환
         * - └── 시크릿 미설정 환경에서 불필요한 외부 인증 실패 호출을 미리 방지함.
         */
    }

    public ReverseGeocodeResponseDto reverseGeocode(double lat, double lng) {
    /*
     * [자바 문법]
     * - public, 기본형 double
     *
     * [프로젝트 내부 참조 타입]
     * - ReverseGeocodeResponseDto (반환 DTO 레코드)
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: reverseGeocode
     * - lat (위도), lng (경도)
     *
     * [호출 경로]
     * - EmergencyApiController (GET /api/reverse-geocode) -> reverseGeocode(lat, lng) 직접 호출
     */
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
        /*
         * [지역 변수명]
         * - cacheKey : 소수점 4자리(약 11m 격자) 캐시 키임.
         * - cached : 캐시 조회 결과, fallbackCoord : 인증키·호출 실패 시 좌표 문자열임.
         * - coordsParam : 네이버 API용 "경도,위도" 문자열, url : 최종 요청 URL임.
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - String.format(Locale.US, ...) : OS 로케일 무관하게 소수점을 점(.)으로 고정 포맷함.
         * - URLEncoder.encode(String, Charset) : UTF-8 기준 퍼센트 인코딩(',' -> '%2C')을 적용함.
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
            /*
             * [외부 API URL 조립 3단계 분해 및 인증 헤더]
             * - 1단계 기본 URL 및 설정 출처:
             *   기본 URL은 NaverGeocodingService 클래스 상수 REVERSE_GEOCODE_URL로 고정됨.
             *   인증키(clientId, clientSecret)는 application.yml의 yonsei119.naver.* 설정에서 주입됨.
             * - 2단계 쿼리 파라미터(? / &) 및 URL 인코딩:
             *   ?coords= 뒤에 "경도(lng),위도(lat)" 순의 coordsParam을 UTF-8 URL 인코딩해 연결함.
             *   &output=json으로 응답 형식을 지정하고, &orders=roadaddr,addr,admcode로 우선순위를 지정함.
             *   완성된 url 문자열을 URI.create(url)로 변환해 .uri(...)에 전달함.
             * - 3단계 인증 헤더(.header(...)):
             *   X-NCP-APIGW-API-KEY-ID : properties.naver().clientId()
             *   X-NCP-APIGW-API-KEY    : properties.naver().clientSecret()
             *   Accept                 : "application/json"
             *
             * [최종 URL 시각 구조도]
             *   https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc   <-- 1단계: REVERSE_GEOCODE_URL 상수
             *     ?coords=127.901229%2C37.319040                         <-- 2단계: 경도,위도 순서 UTF-8 인코딩
             *     &output=json                                           <-- 2단계: JSON 응답 형식 지정
             *     &orders=roadaddr,addr,admcode                          <-- 2단계: 도로명 -> 지번 -> 행정동 순
             *   HTTP Headers:
             *     X-NCP-APIGW-API-KEY-ID = <yonsei119.naver.client-id>
             *     X-NCP-APIGW-API-KEY    = <yonsei119.naver.client-secret>
             *     Accept                 = application/json
             */

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
         * [자바 문법]
         * - try { ... } catch (Exception ex), if, 비교 연산자(>=, <, ==), new, return
         *
         * [지역 변수명]
         * - request, response, parsed, ex, fallbackCoord
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - URI.create(String) : 문자열로부터 URI 인스턴스를 생성함.
         * - HttpRequest.newBuilder().uri(...).timeout(...).header(...).GET().build() : GET 요청을 생성함.
         * - httpClient.send(HttpRequest, BodyHandler) : 동기 HTTP 요청을 보내고 응답을 받음.
         * - HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8) : 본문을 UTF-8 문자열로 읽음.
         * - .statusCode(), .body() (HttpResponse) : HTTP 상태 코드와 본문 문자열을 반환함.
         * - log.warn(String, Object) (Logger) : 경고 레벨 로그를 남김.
         *
         * [동작 흐름]
         * - 1단계: 세계 좌표 범위(-90~90, -180~180) 검증 실패 -> code=-1 오류 DTO 즉시 반환
         * - 2단계: 소수점 4자리 cacheKey가 reverseGeocodeCache 적중 -> 캐시 DTO 즉시 반환
         * - 3단계: API 인증키 미설정 -> 위경도 텍스트 폴백 DTO 반환
         * - 4단계: HTTP 2xx 응답 -> parseReverseGeocodeJson 파싱 -> code == 0이면 캐시 저장 후 반환(실패 시 폴백)
         */
    }

    public ReverseGeocodeResponseDto parseReverseGeocodeJson(String jsonBody, double lat, double lng) {
    /*
     * [자바 문법]
     * - public, 기본형 double
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [프로젝트 내부 참조 타입]
     * - ReverseGeocodeResponseDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: parseReverseGeocodeJson
     * - jsonBody : 네이버 Reverse Geocoding API JSON 응답 원문임.
     * - lat (위도), lng (경도)
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
         * [자바 문법]
         * - try { ... } catch (Exception ex), 향상된 for(:), if / else if
         * - 람다 표현식(s -> !s.isEmpty()), 삼항 연산자(? :)
         *
         * [지역 변수명]
         * - root, code, message, results, coordLabel, shortAddr, roadAddr, jibunAddr, item, name
         * - region, a1, a1Short, a2, a3, a4, regionPrefix, land, roadName, num1, num2, bldg, numPart, fullAddr, ex
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - jsonMapper.readTree(String) (JsonMapper) : JSON 문자열을 트리로 읽음.
         * - .path("키") (JsonNode) : 키가 없어도 MissingNode를 반환해 NullPointerException을 막음.
         * - .get("키") (JsonNode 비교) : 키가 없을 때 null을 반환하므로 연쇄 호출 시 예외 위험이 있음.
         * - .asInt(기본값), .asString(기본값), .isArray(), .isEmpty() (JsonNode)
         * - Stream.of(...).filter(...).toList() : 빈 문자열을 걸러 주소 조각 리스트를 만듦.
         * - String.join(" ", Iterable) : 비어 있지 않은 주소 조각들을 공백 1칸으로 이어 붙임.
         * - .trim(), .isEmpty(), .equals(Object) (String), ex.getMessage() (Throwable)
         *
         * [동작 흐름]
         * - 1단계: status.code != 0 또는 results 비어 있음 -> 좌표 문자열 폴백 DTO 즉시 반환
         * - 2단계: results 순회 -> area1~4로 shortAddr 조립
         *   ├── name == "roadaddr" -> 도로명 주소(roadAddr) 조립
         *   └── name == "addr" -> 지번 주소(jibunAddr) 조립
         * - 3단계: roadAddr -> jibunAddr -> shortAddr 순으로 fullAddr 선택 -> DTO 반환(예외 시 code=-2)
         */
    }

    public GeocodeResponseDto geocode(String query, List<HospitalDto> hospitals) {
    /*
     * [자바 문법]
     * - public, 제네릭 타입 List<HospitalDto>
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String, List
     *
     * [프로젝트 내부 참조 타입]
     * - GeocodeResponseDto, HospitalDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: geocode
     * - query : 사용자가 입력한 주소·지명·병원명 검색어임.
     * - hospitals : 메모리 내 병원 목록 캐시임.
     *
     * [호출 경로]
     * - EmergencyApiController (GET /api/geocode) -> geocode(query, snapshot.hospitals()) 직접 호출
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
                /*
                 * [외부 API URL 조립 3단계 분해 및 인증 헤더 (1단계 네이버 Geocoding)]
                 * - 1단계 기본 URL 및 설정 출처:
                 *   기본 URL은 NaverGeocodingService 클래스 상수 GEOCODE_URL을 사용함.
                 *   인증키는 application.yml의 yonsei119.naver.* 설정이 바인딩된 객체에서 읽음.
                 * - 2단계 쿼리 파라미터(?) 및 URL 인코딩:
                 *   ?query= 뒤에 정제된 safeQuery를 UTF-8 URL 인코딩해 붙인 뒤 URI.create(url)로 변환함.
                 * - 3단계 인증 헤더(.header(...)):
                 *   X-NCP-APIGW-API-KEY-ID : properties.naver().clientId()
                 *   X-NCP-APIGW-API-KEY    : properties.naver().clientSecret()
                 *   Accept                 : "application/json"
                 *
                 * [최종 URL 시각 구조도 (1단계 네이버 Geocoding)]
                 *   https://maps.apigw.ntruss.com/map-geocode/v2/geocode   <-- 1단계: GEOCODE_URL 상수
                 *     ?query=%EC%97%B0%EC%84%B8%EB%8C%80%EA%B8%B8%201      <-- 2단계: 검색어 UTF-8 인코딩
                 *   HTTP Headers:
                 *     X-NCP-APIGW-API-KEY-ID = <yonsei119.naver.client-id>
                 *     X-NCP-APIGW-API-KEY    = <yonsei119.naver.client-secret>
                 *     Accept                 = application/json
                 */

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
         * [자바 문법]
         * - if, 향상된 for(:), break(반복 즉시 종료), try { ... } catch (Exception ex), 삼항 연산자(? :)
         *
         * [지역 변수명]
         * - safeQuery, cacheKey, cached, results, url, request, response, ex
         * - compactQuery, h, name, addr, nomRes, arr, item, lat, lng, displayName, responseDto
         *
         * [프로젝트 내부 생성자]
         * - new GeocodeResponseDto(...), new GeocodeResponseDto.GeocodeItemDto(...) : 지오코딩 응답·후보 DTO 생성자임.
         *
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - new ArrayList<>(), List.of(), List.copyOf(Collection) : 가변·불변 리스트를 생성함.
         * - .trim(), .isEmpty(), .length(), .substring(int, int) (String)
         * - .replaceAll("\\s+", ...), .toLowerCase(Locale.ROOT), .contains(...) (String)
         * - .size(), .add(...), .addAll(...) (List), .statusCode(), .body() (HttpResponse)
         * - jsonMapper.readTree(...), .isArray(), .path(...), .asDouble(0.0), .asString(...) (JsonNode)
         * - log.warn(...), log.debug(...) (Logger)
         *
         * [동작 흐름]
         * - 사전: 공백 제거·120자 제한(safeQuery) -> 정규화 cacheKey로 geocodeCache 조회(적중 시 즉시 반환)
         * - 1단계(네이버 API): 인증키 존재 시 NCP Geocoding 호출 -> parseGeocodeJson으로 후보 추가
         * - 2단계(병원 목록): 결과 5건 미만이면 공백 제거 후 병원명·주소 부분 일치 보충(최대 6건)
         * - 3단계(Nominatim): 1·2단계 결과가 비었을 때만 국내(countrycodes=kr) 랜드마크 좌표 조회
         * - 마무리: 결과 있음 -> code=0으로 geocodeCache 저장 후 반환 | 결과 없음 -> code=404 반환
         */
    }

    private HttpResponse<String> sendRateLimitedNominatimRequest(String safeQuery) throws Exception {
    /*
     * [자바 문법]
     * - private, throws Exception : Thread.sleep·HTTP I/O 예외를 호출자(geocode)로 넘김.
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - HttpResponse<String>, String, Exception
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: sendRateLimitedNominatimRequest
     * - safeQuery : 공백 정리와 길이 제한을 마친 검색어 문자열임.
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
            /*
             * [외부 API URL 조립 3단계 분해 및 요청 헤더 (3단계 OpenStreetMap Nominatim)]
             * - 1단계 기본 URL 출처:
             *   application.yml이 아닌 Nominatim 공개 검색 URL 리터럴 문자열을 직접 사용함.
             * - 2단계 쿼리 파라미터(? / &) 및 URL 인코딩:
             *   ?format=json&limit=4&countrycodes=kr&accept-language=ko로 한국어·국내 4건 제한을 둠.
             *   &q= 뒤에 URLEncoder.encode(safeQuery, StandardCharsets.UTF_8)를 이어 URI.create(...)로 변환함.
             * - 3단계 요청 헤더(.header(...)):
             *   User-Agent : "Yonsei119-Emergency-Service/2.1" (정책상 앱 식별 필수, NCP 키 미전송)
             *   Accept     : "application/json"
             *
             * [최종 URL 시각 구조도 (3단계 OpenStreetMap Nominatim)]
             *   https://nominatim.openstreetmap.org/search         <-- 1단계: Nominatim 공개 검색 URL
             *     ?format=json                                     <-- 2단계: JSON 응답 형식
             *     &limit=4                                         <-- 2단계: 최대 4건 제한
             *     &countrycodes=kr                                 <-- 2단계: 대한민국 국가 코드 필터
             *     &accept-language=ko                              <-- 2단계: 한국어 지명 우선
             *     &q=%EC%9B%90%EC%A3%BC%EC%8B%9C%EC%B2%AD          <-- 2단계: 검색어 UTF-8 URL 인코딩
             *   HTTP Headers:
             *     User-Agent = Yonsei119-Emergency-Service/2.1
             *     Accept     = application/json
             */

            return httpClient.send(nomReq, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        }
        /*
         * [자바 문법]
         * - synchronized (nominatimLock) { ... } : 동시 요청 스레드를 잠금 객체로 한 줄씩 직렬화함.
         * - long, if, return
         *
         * [지역 변수명]
         * - now, waitMs, nomUrl, nomReq
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - System.currentTimeMillis() (java.lang.System) : 현재 UTC Epoch 밀리초 시각을 반환함.
         * - Thread.sleep(long millis) (java.lang.Thread) : 지정 밀리초만큼 현재 스레드를 일시 정지함.
         * - URLEncoder.encode(...), URI.create(...), HttpRequest.newBuilder()...build(), httpClient.send(...)
         *
         * [동작 흐름]
         * - synchronized(nominatimLock) 진입 -> (직전 시각 + 1,050ms - 현재 시각) 계산
         *   ├── waitMs > 0 -> Thread.sleep(waitMs)로 초당 1회 제한 대기
         *   └── lastNominatimRequestAtMs 갱신 -> Nominatim HTTP GET 전송 및 응답 반환
         */
    }

    public List<GeocodeResponseDto.GeocodeItemDto> parseGeocodeJson(String jsonBody) {
    /*
     * [자바 문법]
     * - public, 제네릭 타입 List<GeocodeResponseDto.GeocodeItemDto>
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - List, String
     *
     * [프로젝트 내부 참조 타입]
     * - GeocodeResponseDto.GeocodeItemDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: parseGeocodeJson
     * - jsonBody : 네이버 Geocoding v2 JSON 응답 문자열임.
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
         * [자바 문법]
         * - try { ... } catch (Exception ex), if, 향상된 for(:), 삼항 연산자(? :), 논리 부정, new, return
         *
         * [지역 변수명]
         * - list, root, addresses, item, road, jibun, lng, lat, title, ex
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - jsonMapper.readTree(String), .path(String), .isArray(), .asString(String) (JsonNode)
         * - Double.parseDouble(String) (java.lang.Double) : 문자열 좌표를 기본형 실수(double)로 변환함.
         * - .trim(), .isEmpty() (String), .add(...) (List), log.warn(...) (Logger)
         *
         * [좌표 필드 매핑 주의]
         * - 네이버 Geocoding 응답에서 "x"는 경도(lng), "y"는 위도(lat)이므로 순서를 맞춰 파싱함.
         *
         * [동작 흐름]
         * - jsonBody 트리 파싱 -> addresses 배열 순회 -> "x"(경도)·"y"(위도) 실수 변환
         * - └── GeoUtils.isValidKoreaCoordinate(lat, lng) 통과 시만 GeocodeItemDto 추가 -> list 반환
         */
    }
}
