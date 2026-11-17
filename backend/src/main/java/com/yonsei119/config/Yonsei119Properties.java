package com.yonsei119.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
/*
 * [자바 문법] package, import : 환경설정 전용 패키지(com.yonsei119.config)를 선언하고 프로퍼티 바인딩 어노테이션을 가져옴.
 * [스프링/라이브러리 내장 어노테이션] @ConfigurationProperties (출처: org.springframework.boot.context.properties) :
 *   application.yml의 계층형 설정값들을 자바 객체 필드에 통째로 자동 매핑해 줌 (형제 어노테이션: 단일 값만 하나씩 뽑아 쓰는 @Value("${...}")).
 */

@ConfigurationProperties(prefix = "yonsei119")
public record Yonsei119Properties(
        Nemc nemc,
        Naver naver,
        DefaultOrigin defaultOrigin,
        Cors cors
) {
/*
 * [스프링/라이브러리 내장 어노테이션] @ConfigurationProperties(prefix = "yonsei119") : application.yml에서 'yonsei119:' 아래에 적힌 모든 설정을 이 상자로 연결함.
 * [자바 문법] public record : 한 번 값이 채워지면 절대 중간에 바뀌지 않는(불변, Immutable) 데이터 전용 설계도를 만드는 Java 16+ 핵심 예약어임 (getter, equals, toString 자동 생성 / 형제 문법: class, interface, enum).
 * [내가 지은 이름]
 * - 대문자 타입명: Yonsei119Properties, Nemc, Naver, DefaultOrigin, Cors (설계도 이름)
 * - 소문자 변수(상자)명: nemc, naver, defaultOrigin, cors (실제 설정값이 담기는 칸 이름 — YAML의 키 이름과 매칭)
 * [핵심 원리 & 데이터 변환 예시]
 *   [application.yml]                        [Yonsei119Properties record 객체]
 *   yonsei119:
 *     nemc:
 *       cache-ttl-seconds: 180        ───>   properties.nemc().cacheTtlSeconds() == 180L
 *       cold-cache-ttl-seconds: 21600 ───>   properties.nemc().coldCacheTtlSeconds() == 21600L
 *     naver:
 *       client-id: "xfbxloc8km"       ───>   properties.naver().clientId() == "xfbxloc8km"
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
     * [자바 문법] public record, long(큰 정수 기본형), boolean(참/거짓 기본형)
     * [자바/스프링/라이브러리 내장 도구(타입)] String : 자바 표준 문자열 타입임 (이름 변경 불가).
     * [내가 지은 이름] Nemc(대문자 타입명) / baseUrl, serviceKey, cacheTtlSeconds, coldCacheTtlSeconds, requestTimeoutMs, autoRefreshEnabled, refreshIntervalMs(소문자 필드명)
     * [핵심 원리] 국립중앙의료원(NEMC) OpenAPI 주소, 인증키, Hot 캐시 수명(기본 180초=3분), Cold 마스터 캐시 수명(기본 21600초=6시간)을 안전하게 보관하는 금고임.
     */
        public long effectiveColdCacheTtlSeconds() {
        /*
         * [자바 문법] public long : 외부에서 호출 가능하며 초 단위 큰 정수(long)를 돌려주는 메서드 선언부임.
         * [내가 지은 이름] effectiveColdCacheTtlSeconds : 테스트 환경 등에서 cold-cache-ttl-seconds가 생략되어 0으로 들어왔을 때도 안전한 기본값(6시간)을 보장하는 보조 함수임.
         */
            return coldCacheTtlSeconds > 0L ? coldCacheTtlSeconds : 21_600L;
            /*
             * [자바 문법] return, 삼항 연산자(조건 ? 참일때값 : 거짓일때값), 숫자 가독성 밑줄 표기(21_600L == 21600L)
             * [핵심 원리] 설정값이 0 이하이면 자동으로 21,600초(6시간)를 반환하여 Cold 캐시가 즉시 만료되는 현상을 방지함.
             */
        }
    }

    public record Naver(
            String clientId,
            String darkStyleId,
            String clientSecret,
            String directions5Url,
            String directions15Url
    ) {
    /*
     * [자바 문법] public record
     * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
     * [내가 지은 이름] Naver(대문자 타입명) / clientId, darkStyleId, clientSecret, directions5Url, directions15Url(소문자 필드명)
     * [핵심 원리 & 보안 분리 비유]
     * - 식당 간판 번호(clientId, darkStyleId)는 손님(브라우저 /api/config)에게 알려주지만,
     * - 금고 비밀번호(clientSecret)는 주방(NaverDirectionsService, NaverGeocodingService) 안에서만 꺼내 쓰고 손님에게는 절대 보여주지 않음.
     */
    }

    public record DefaultOrigin(
            double lat,
            double lng,
            String label
    ) {
    /*
     * [자바 문법] public record, double(소수점 실수 기본형 — 위도·경도처럼 정밀한 소수점 계산에 사용 / 형제 타입: float, int, long)
     * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
     * [내가 지은 이름] DefaultOrigin(대문자 타입명) / lat(위도), lng(경도), label(장소 이름)
     * [핵심 원리] GPS 신호가 없는 데스크톱 PC 환경이나 위치 초기화 시 지도의 초기 중심점이 되는 기본 좌표(서울시청)를 담는 도시락 칸임.
     */
    }

    public record Cors(
            String allowedOriginPatterns
    ) {
    /*
     * [자바 문법] public record
     * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
     * [내가 지은 이름] Cors(대문자 타입명) / allowedOriginPatterns(콤마로 구분된 허용 출처 패턴 문자열)
     * [핵심 원리] WebConfig에서 브라우저 교차 출처(CORS) 허용 범위를 코드 수정 없이 환경변수로 제어하기 위한 설정 칸임.
     */
    }
}
