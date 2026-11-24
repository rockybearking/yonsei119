package com.yonsei119.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
/*
 * [자바 문법]
 * - package : 환경설정, 웹 MVC 설정, 보안 필터를 모아 두는 패키지(com.yonsei119.config) 선언문임.
 * - import : 스프링 부트 설정 바인딩 타입을 Yonsei119Properties.java로 불러오는 선언문임.
 *
 * [패키지명]
 * - com.yonsei119.config : 설정 모델, MVC 설정, 보안 필터가 위치하는 패키지명임.
 */

@ConfigurationProperties(prefix = "yonsei119")
public record Yonsei119Properties(
        Nemc nemc,
        Naver naver,
        DefaultOrigin defaultOrigin,
        Cors cors,
        RateLimit rateLimit
) {
    public Yonsei119Properties {
        if (rateLimit == null) {
            rateLimit = new RateLimit(true, 60, 60);
        }
    }
/*
 * [스프링 내장 어노테이션]
 * - @ConfigurationProperties 정의 (출처: org.springframework.boot.context.properties.ConfigurationProperties, 이름 변경 불가)
 *   · 역할 : application.yml이나 환경변수의 외부 설정값들을 지정한 접두사(prefix) 기준으로 객체·레코드 필드에 자동 바인딩하는 어노테이션임.
 * - @ConfigurationProperties(prefix = "yonsei119") 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 Yonsei119Properties record
 *   · 작동 원리 : application.yml과 환경변수의 yonsei119.* 하이픈 표기를 카멜 표기로 변환해 생성자에 일괄 바인딩함.
 *   · 비교 : 단일 설정값을 주입하는 @Value("${...}"), 빈 정의 클래스를 표시하는 @Configuration이 있음.
 *
 * [자바 문법]
 * - public : 다른 패키지(controller, service 등)에서도 Yonsei119Properties record를 주입받아 읽도록 공개함.
 * - record : Java 16+ 불변 데이터 전용 타입 예약어임 (형제 문법: class, interface, enum).
 *   · 자동 생성 : private final 필드, 전체 생성자, 필드명과 같은 조회 메서드(nemc() 등), equals·hashCode·toString이 자동 생성됨.
 *
 * [레코드명 및 필드명]
 * - 레코드명 : Yonsei119Properties (루트 설정), Nemc·Naver·DefaultOrigin·Cors (내부 중첩 record 타입명).
 * - 필드명 :
 *   · nemc : NEMC 공공데이터 설정 (nemc = 국립중앙의료원).
 *   · naver : 네이버 클라우드 API 설정.
 *   · defaultOrigin : 기본 출발 좌표 설정.
 *   · cors : CORS 허용 출처 설정.
 *
 * [동작 흐름]
 * - 호출 출처 : 서버 부팅 시 스프링 부트 설정 바인더가 application.yml과 환경변수를 읽어 생성자를 호출함.
 * - 흐름 :
 *   ├── yonsei119.nemc.* ──> Nemc 생성 후 nemc 필드에 연결
 *   ├── yonsei119.naver.* ──> Naver 생성 후 naver 필드에 연결
 *   ├── yonsei119.default-origin.* ──> DefaultOrigin 생성 후 defaultOrigin 필드에 연결
 *   └── yonsei119.cors.* ──> Cors 생성 후 cors 필드에 연결
 * - 전달 대상 : 생성된 단일 Yonsei119Properties 빈이 WebConfig, EmergencyApiController 및 각 서비스 빈으로 주입됨.
 */

    public record Nemc(
            String baseUrl,
            String serviceKey,
            long cacheTtlSeconds,
            long coldCacheTtlSeconds,
            long requestTimeoutMs,
            boolean autoRefreshEnabled,
            long refreshIntervalMs
    ) {
    /*
     * [자바 문법]
     * - public record : 외부에서 접근 가능한 중첩 불변 record 선언임 (중첩 record는 자동으로 static 특성을 가짐).
     * - long : 64비트 정수 기본형임 (밀리초·초처럼 큰 숫자에 사용하며, 형제 타입은 int·short·byte임).
     * - boolean : true 또는 false 논리값을 저장하는 기본형임.
     *
     * [자바 표준 내장 타입 (이름 변경 불가)]
     * - String (출처: java.lang 패키지) : 문자열을 표현하는 자바 표준 불변 클래스임.
     *
     * [레코드명 및 필드명]
     * - 레코드명 : Nemc (국립중앙의료원 응급의료 OpenAPI 연동 설정 record).
     * - 필드명 :
     *   · baseUrl : yonsei119.nemc.base-url (NEMC OpenAPI 기본 URL).
     *   · serviceKey : yonsei119.nemc.service-key (공공데이터포털 인증키).
     *   · cacheTtlSeconds : yonsei119.nemc.cache-ttl-seconds (실시간 Hot 데이터 3종 캐시 유지 시간, 기본 180초).
     *   · coldCacheTtlSeconds : yonsei119.nemc.cold-cache-ttl-seconds (마스터 Cold 데이터 4종 캐시 유지 시간, 기본 21600초).
     *   · requestTimeoutMs : yonsei119.nemc.request-timeout-ms (외부 API 요청 제한 시간 밀리초).
     *   · autoRefreshEnabled : yonsei119.nemc.auto-refresh-enabled (기동 사전 캐싱 및 주기적 갱신 사용 여부).
     *   · refreshIntervalMs : yonsei119.nemc.refresh-interval-ms (스케줄러 자동 갱신 주기 밀리초).
     *
     * [동작 흐름]
     * - 호출 출처 : Yonsei119Properties 생성 시 application.yml의 yonsei119.nemc.* 값이 주입됨.
     * - 흐름 : 생성 후 불변 상태로 보관 ──> baseUrl(), cacheTtlSeconds() 등 조회 메서드로 읽기 전용 제공.
     * - 전달 대상 :
     *   ├── NmcOpenApiClient ──> baseUrl, serviceKey, requestTimeoutMs 사용
     *   └── EmergencyDataService ──> cacheTtlSeconds, autoRefreshEnabled, effectiveColdCacheTtlSeconds() 사용
     */
        public long effectiveColdCacheTtlSeconds() {
        /*
         * [자바 문법]
         * - public : 다른 패키지(service 등)에서 호출할 수 있도록 공개함.
         * - long : 64비트 정수 기본형 반환 타입임.
         *
         * [메서드명 및 매개변수명]
         * - 메서드명 : effectiveColdCacheTtlSeconds (매개변수 없음).
         * - 역할 : 설정 누락으로 coldCacheTtlSeconds가 0 이하일 때도 Cold 캐시가 즉시 만료되지 않게 기본 6시간(21,600초)을 돌려줌.
         */
            return coldCacheTtlSeconds > 0L ? coldCacheTtlSeconds : 21_600L;
            /*
             * [자바 문법]
             * - return : 계산한 결과를 호출한 쪽에 돌려주고 메서드를 끝내는 예약어임.
             * - > : 왼쪽 값이 오른쪽 값보다 큰지 비교하는 연산자임.
             * - 0L, 21_600L : long 타입 숫자 리터럴이며, 밑줄(_)은 큰 숫자 가독성을 위한 구분 기호임 (값은 21600L과 같음).
             * - ? : : '조건 ? 참일때값 : 거짓일때값' 형태로 분기하는 삼항 연산자임.
             *
             * [동작 흐름]
             * - 호출 출처 : EmergencyDataService.buildFreshSnapshot()이 Cold 캐시 유효 시간을 계산할 때 호출함.
             * - 흐름 :
             *   ├── coldCacheTtlSeconds > 0L ──> 설정된 coldCacheTtlSeconds 그대로 반환
             *   └── coldCacheTtlSeconds <= 0L ──> 안전 기본값 21_600L(6시간) 반환
             * - 전달 대상 : EmergencyDataService의 coldTtlSeconds 변수 ──> coldCachedAt 만료 비교에 쓰임.
             */
        }

        public boolean hasServiceKey() {
            return hasConfiguredValue(serviceKey);
        }
    }

    public static boolean hasConfiguredValue(String value) {
        if (value == null) {
            return false;
        }
        String trimmed = value.trim();
        return !trimmed.isEmpty() && !trimmed.regionMatches(true, 0, "YOUR_", 0, 5);
    }

    public record Naver(
            String clientId,
            String darkStyleId,
            String clientSecret,
            String directions5Url,
            String directions15Url
    ) {
        public boolean hasApiCredentials() {
            return hasConfiguredValue(clientId) && hasConfiguredValue(clientSecret);
        }
    /*
     * [자바 문법]
     * - public record : 중첩 불변 record 선언임.
     *
     * [자바 표준 내장 타입 (이름 변경 불가)]
     * - String (출처: java.lang 패키지).
     *
     * [레코드명 및 필드명]
     * - 레코드명 : Naver (네이버 클라우드 플랫폼 지도·경로·지오코딩 API 설정 record).
     * - 필드명 :
     *   · clientId : yonsei119.naver.client-id (공개 지도 SDK 및 NCP 게이트웨이 Client ID).
     *   · darkStyleId : yonsei119.naver.dark-style-id (네이버 다크 모드 지도 스타일 UUID).
     *   · clientSecret : yonsei119.naver.client-secret (서버 HTTP 요청 헤더 전용 비밀키, 브라우저 미노출).
     *   · directions5Url : yonsei119.naver.directions5-url (네이버 Directions 5 API 호출 URL).
     *   · directions15Url : yonsei119.naver.directions15-url (네이버 Directions 15 API 호출 URL).
     *
     * [동작 흐름]
     * - 호출 출처 : application.yml의 yonsei119.naver.* 속성 및 환경변수로 생성됨.
     * - 흐름 : 공개 키와 비밀키를 함께 보관 ──> 사용처에 따라 공개/비공개 필드를 분리 조회함.
     * - 전달 대상 :
     *   ├── EmergencyApiController.getConfig() ──> clientId, darkStyleId만 FrontendConfigDto로 복사해 브라우저에 전달
     *   └── NaverDirectionsService, NaverGeocodingService ──> clientSecret을 서버 API 요청 헤더에만 포함
     */
    }

    public record DefaultOrigin(
            double lat,
            double lng,
            String label
    ) {
    /*
     * [자바 문법]
     * - public record : 중첩 불변 record 선언임.
     * - double : 64비트 소수점 실수 기본형임 (위도·경도 좌표 저장에 사용하며, 형제 타입은 float·int·long임).
     *
     * [자바 표준 내장 타입 (이름 변경 불가)]
     * - String (출처: java.lang 패키지).
     *
     * [레코드명 및 필드명]
     * - 레코드명 : DefaultOrigin (GPS 미사용 시나 위치 초기화 시 쓰는 기본 출발지 record).
     * - 필드명 :
     *   · lat : yonsei119.default-origin.lat (기본 위도, application.yml 기준 37.5666805).
     *   · lng : yonsei119.default-origin.lng (기본 경도, application.yml 기준 126.9784147).
     *   · label : yonsei119.default-origin.label (기본 위치명, application.yml 기준 "서울시청").
     *
     * [동작 흐름]
     * - 호출 출처 : 부팅 시 application.yml의 yonsei119.default-origin.* 항목으로부터 생성됨.
     * - 흐름 : 위도·경도·라벨 보관 ──> EmergencyApiController.getConfig()가 FrontendConfigDto로 변환해 응답.
     * - 전달 대상 : 프론트엔드 search-controls.js의 syncFrontendConfig()가 기본 출발 좌표로 반영함.
     */
    }

    public record Cors(
            String allowedOriginPatterns
    ) {
    /*
     * [자바 문법]
     * - public record : 중첩 불변 record 선언임.
     *
     * [자바 표준 내장 타입 (이름 변경 불가)]
     * - String (출처: java.lang 패키지).
     *
     * [레코드명 및 필드명]
     * - 레코드명 : Cors (교차 출처 리소스 공유 CORS 정책 설정 record).
     * - 필드명 :
     *   · allowedOriginPatterns : yonsei119.cors.allowed-origin-patterns (콤마 구분 허용 출처 패턴, 기본값 "*").
     *
     * [동작 흐름]
     * - 호출 출처 : 부팅 시 application.yml의 yonsei119.cors.allowed-origin-patterns 속성으로 생성됨.
     * - 흐름 : YONSEI119_CORS_ORIGINS 또는 "*" 보관 ──> WebConfig.addCorsMappings()가 콤마로 분리.
     * - 전달 대상 : /api/** 경로의 CORS 허용 규칙으로 등록됨.
     */
    }

    public record RateLimit(
            boolean enabled,
            int capacity,
            int refillPerMinute
    ) {
        public int effectiveCapacity() {
            return capacity > 0 ? capacity : 60;
        }

        public int effectiveRefillPerMinute() {
            return refillPerMinute > 0 ? refillPerMinute : 60;
        }
    }
}
