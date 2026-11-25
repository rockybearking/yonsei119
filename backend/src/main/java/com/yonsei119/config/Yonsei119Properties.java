package com.yonsei119.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/*
 * [역할 및 실행 시점]
 * - 역할: `application.yml`과 OS 환경변수의 `yonsei119.*` 설정값들을 타입 안전하게 담아 두는 불변 설정 금고 (식당 레시피·연락처 보관함 역할)
 * - 실행 시점: 서버 부팅 시 `@ConfigurationPropertiesScan`이 자동으로 읽어 싱글톤 빈 1개를 생성한 뒤 필요한 클래스에 주입함
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   OS 환경변수 / .env ──> application.yml (`yonsei119.*`) ──> Yonsei119Properties 생성자 바인딩
 *   ├── .nemc()          ──> NmcOpenApiClient, EmergencyDataService (공공데이터 키·URL·60초 캐시 수명 참조)
 *   ├── .naver()         ──> EmergencyApiController(/api/config), NaverDirectionsService, NaverGeocodingService
 *   ├── .defaultOrigin() ──> EmergencyApiController(/api/config) (서울시청 기본 출발지 전달)
 *   ├── .cors()          ──> WebConfig.addCorsMappings() (교차 출처 허용 도메인 적용)
 *   └── .rateLimit()     ──> ApiRateLimitFilter (유료 API IP당 분당 호출 제한 적용)
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 모든 필드가 `private final` 불변으로 고정되며, 생성자·Getter(`.nemc()`, `.naver()` 등)·`equals`/`hashCode`/`toString`이 컴파일 시 자동 생성됨
 * - Spring 프레임워크: `@ConfigurationProperties(prefix = "yonsei119")`가 YAML의 하이픈 표기(`cache-ttl-seconds`)를 카멜 표기(`cacheTtlSeconds`)로 자동 매핑함
 *
 * [사용처 및 IDE 추적 가이드]
 * - 호출 추적: 각 중첩 record나 조회 메서드 위에서 `Ctrl + Alt + H`로 어디서 읽히는지 즉시 확인 가능
 * - 설정 원본 찾기: `Ctrl + Shift + F`로 `yonsei119:` 또는 `NEMC_CACHE_TTL_SECONDS` 검색
 */
@ConfigurationProperties(prefix = "yonsei119")
public record Yonsei119Properties(
        Nemc nemc,
        Naver naver,
        DefaultOrigin defaultOrigin,
        Cors cors,
        RateLimit rateLimit
) {
    // [컴팩트 생성자] YAML에 rate-limit 블록이 생략된 테스트 환경에서도 null 없이 기본값(분당 60회)을 보장함
    public Yonsei119Properties {
        if (rateLimit == null) {
            rateLimit = new RateLimit(true, 60, 60);
        }
    }

    /** 국립중앙의료원(NEMC) 응급의료 OpenAPI 접속 주소·인증키·캐시 수명 설정 레코드 */
    public record Nemc(
            String baseUrl,
            String serviceKey,
            long cacheTtlSeconds,
            long coldCacheTtlSeconds,
            long requestTimeoutMs,
            boolean autoRefreshEnabled,
            long refreshIntervalMs
    ) {
        /** 설정 누락으로 0 이하가 들어와도 마스터 캐시가 즉시 만료되지 않도록 최소 6시간(21,600초) 기본값을 보장함 */
        public long effectiveColdCacheTtlSeconds() {
            return coldCacheTtlSeconds > 0L ? coldCacheTtlSeconds : 21_600L;
        }

        /** 빈 문자열이나 예시 플레이스홀더(`YOUR_...`)가 아닌 실제 서비스키가 입력되었는지 확인함 */
        public boolean hasServiceKey() {
            return hasConfiguredValue(serviceKey);
        }
    }

    /** 설정 문자열이 비어 있거나 `YOUR_` 예시 값인지 검사하는 공통 정적 헬퍼 */
    public static boolean hasConfiguredValue(String value) {
        if (value == null) {
            return false;
        }
        String trimmed = value.trim();
        return !trimmed.isEmpty() && !trimmed.regionMatches(true, 0, "YOUR_", 0, 5);
    }

    /** 네이버 클라우드 지도 SDK 및 서버 전용 Directions·Geocoding API 설정 레코드 (`clientSecret`은 서버 내부 전용) */
    public record Naver(
            String clientId,
            String darkStyleId,
            String clientSecret,
            String directions5Url,
            String directions15Url
    ) {
        /** 서버 간 REST API 호출에 필요한 Client ID와 Secret이 모두 유효하게 설정되었는지 확인함 */
        public boolean hasApiCredentials() {
            return hasConfiguredValue(clientId) && hasConfiguredValue(clientSecret);
        }
    }

    /** GPS 미사용 또는 출발지 초기화 시 사용할 기본 출발 기준점(서울시청) 레코드 */
    public record DefaultOrigin(
            double lat,
            double lng,
            String label
    ) {
    }

    /** `/api/**` 경로의 교차 출처 리소스 공유(CORS) 허용 패턴 레코드 */
    public record Cors(
            String allowedOriginPatterns
    ) {
    }

    /** 유료 외부 API 남용 방지를 위한 IP별 토큰 버킷 요청률 제한 설정 레코드 */
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
