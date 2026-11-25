package com.yonsei119.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : `application.yml`과 OS 환경변수(`.env` 포함)의 `yonsei119.*` 설정을
 *          안전하게 보관하는 불변 설정 금고 (식당 레시피·연락처 보관함 역할)
 * - 실행 시점 : 서버 시작 시 `@ConfigurationPropertiesScan`이 자동으로 읽어
 *              싱글톤 빈 1개를 생성한 뒤 필요한 빈들에 주입함
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [.env / OS Env]         [application.yml]      [Yonsei119Properties]       [Service / Filter]
 *           |                        |                        |                          |
 *           |-- 1. ${ENV:default} -->|                        |                          |  환경변수 값 치환
 *           |                        |-- 2. bind prefix ----->|                          |  yonsei119.* 자동 매핑
 *           |                        |                        |-- 3. compact ctor        |  누락 설정 기본값 보정
 *           |                        |                        |<-- 4. nemc() / naver() --|  불변 설정 레코드 조회
 *           |                        |                        |-- 5. config values ----->|  타입 안전 설정값 반환
 *           v                        v                        v                          v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record           : 불변 데이터 클래스 선언 키워드 (생성자 · Getter 자동생성)
 *   ㄴ String           : URL · 인증키 문자열을 담는 표준 내장 클래스
 *   ㄴ int / long       : 횟수 · 시간(초, ms)을 담는 정수 기본형 키워드
 *   ㄴ double / boolean : 위경도 실수 · 활성화 여부를 담는 기본형 키워드
 *   ㄴ regionMatches()  : 대소문자 구분 없이 접두어(`YOUR_`)를 비교하는 String 메서드
 * - Spring 프레임워크
 *   ㄴ @ConfigurationProperties : YAML 하이픈 키를 자바 카멜 필드에 자동 매핑하는 어노테이션
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ EmergencyApiController.java : `getConfig()` 공개 설정 응답 조립
 *   ㄴ NmcOpenApiClient.java       : 공공데이터 URL · 서비스키 · 타임아웃 참조
 *   ㄴ EmergencyDataService.java   : 60초 실시간 캐시 TTL · 자동 갱신 여부 참조
 *   ㄴ NaverDirectionsService.java : 네이버 Directions 5/15 URL 및 인증키 참조
 *   ㄴ NaverGeocodingService.java  : 네이버 지오코딩 인증키 참조
 *   ㄴ WebConfig.java              : CORS 허용 도메인 패턴 참조
 *   ㄴ ApiRateLimitFilter.java     : 분당 요청 허용량(`RateLimit`) 참조
 * - IntelliJ 추적 단축키
 *   ㄴ 호출 계층 보기 : 각 중첩 record나 메서드 위에서 `Ctrl + Alt + H`
 *   ㄴ 설정 원본 검색 : `Ctrl + Shift + F`로 `yonsei119:` 검색
 */
@ConfigurationProperties(prefix = "yonsei119")
public record Yonsei119Properties(
        Nemc nemc,
        Naver naver,
        DefaultOrigin defaultOrigin,
        Cors cors,
        RateLimit rateLimit
) {
    // [컴팩트 생성자] 테스트 등에서 rate-limit 블록이 생략되어도 기본값(분당 60회)을 보장함
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
        /** 0 이하가 입력되어도 마스터 캐시 최소 6시간(21,600초) 수명을 보장함 */
        public long effectiveColdCacheTtlSeconds() {
            return coldCacheTtlSeconds > 0L ? coldCacheTtlSeconds : 21_600L;
        }

        /** 빈 문자열이나 예시 값(`YOUR_...`)이 아닌 실제 인증키가 있는지 판별함 */
        public boolean hasServiceKey() {
            return hasConfiguredValue(serviceKey);
        }
    }

    /** 설정값이 비어 있거나 `YOUR_` 플레이스홀더인지 검사하는 공통 정적 메서드 */
    public static boolean hasConfiguredValue(String value) {
        if (value == null) {
            return false;
        }
        String trimmed = value.trim();
        return !trimmed.isEmpty() && !trimmed.regionMatches(true, 0, "YOUR_", 0, 5);
    }

    /** 네이버 지도 SDK 및 서버 전용 길찾기·지오코딩 인증 설정 레코드 (`clientSecret` 외부 비공개) */
    public record Naver(
            String clientId,
            String darkStyleId,
            String clientSecret,
            String directions5Url,
            String directions15Url
    ) {
        /** 서버 간 REST 호출용 Client ID와 Secret이 모두 유효한지 판별함 */
        public boolean hasApiCredentials() {
            return hasConfiguredValue(clientId) && hasConfiguredValue(clientSecret);
        }
    }

    /** GPS 미사용 또는 초기화 시 기준이 되는 기본 출발 좌표(서울시청) 레코드 */
    public record DefaultOrigin(
            double lat,
            double lng,
            String label
    ) {
    }

    /** `/api/**` 교차 출처 리소스 공유(CORS) 허용 도메인 패턴 레코드 */
    public record Cors(
            String allowedOriginPatterns
    ) {
    }

    /** 유료 네이버 대리 API 보호용 IP별 토큰 버킷 요청률 제한 설정 레코드 */
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
