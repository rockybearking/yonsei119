package com.yonsei119.util;
/*
 * [자바 문법] package : 지리 좌표 검증 및 구면 거리(Haversine) 계산 전용 유틸리티 패키지(com.yonsei119.util) 선언임.
 * (외부 라이브러리 없이 자바 기본 내장 Math 도구만 사용하므로 별도 import가 필요 없음.)
 */

public final class GeoUtils {
/*
 * [자바 문법] public final class : 상태(멤버 변수) 없이 순수 수학·지리 공식 함수만 모아 둔 유틸리티 클래스임.
 * [내가 지은 이름] GeoUtils : EmergencyDataService, EmergencyApiController, NaverDirectionsService, NaverGeocodingService가 함께 쓰는 지리 연산 도구함임.
 */

    public static final double KOREA_MIN_LAT = 32.0;
    public static final double KOREA_MAX_LAT = 39.5;
    public static final double KOREA_MIN_LNG = 124.0;
    public static final double KOREA_MAX_LNG = 132.0;
    private static final double EARTH_RADIUS_KM = 6371.0;
    /*
     * [자바 문법] public/private static final double : 프로그램 전체에서 공유(static)되며 절대 변하지 않는(final) 실수 상수임.
     * [내가 지은 이름] KOREA_MIN_LAT ~ KOREA_MAX_LNG (한반도 및 제주·독도·이어도 인근 유효 위경도 경계), EARTH_RADIUS_KM (지구 평균 반지름 6,371km)
     * [핵심 원리] 공공데이터 XML에서 간혹 내려오는 (0.0, 0.0) 같은 오류 좌표나 비정상 요청 파라미터를 걸러내는 기준선임.
     */

    private GeoUtils() {
    /*
     * [자바 문법] private 생성자 : new GeoUtils()로 불필요한 빈 객체를 만들지 못하도록 막는 유틸리티 클래스 표준 관례임.
     */
    }

    public static boolean isValidWorldCoordinate(double lat, double lng) {
    /*
     * [자바 문법] public static boolean : 지구상 유효한 위도(-90~90)·경도(-180~180)인지 검사해 참/거짓을 반환함.
     * [내가 지은 이름] isValidWorldCoordinate(함수명), lat(위도), lng(경도)
     */
        return Double.isFinite(lat)
                && Double.isFinite(lng)
                && lat >= -90.0 && lat <= 90.0
                && lng >= -180.0 && lng <= 180.0;
        /*
         * [스프링/자바 내장 함수] Double.isFinite(...) : NaN(숫자 아님)이나 Infinity(무한대) 공격 입력을 차단하는 자바 표준 함수임 (이름 변경 불가).
         */
    }

    public static boolean isValidKoreaCoordinate(double lat, double lng) {
    /*
     * [자바 문법] public static boolean : 대한민국 서비스 권역 내 유효 좌표인지 판별함.
     * [내가 지은 이름] isValidKoreaCoordinate(함수명), lat, lng
     */
        return Double.isFinite(lat)
                && Double.isFinite(lng)
                && lat >= KOREA_MIN_LAT && lat <= KOREA_MAX_LAT
                && lng >= KOREA_MIN_LNG && lng <= KOREA_MAX_LNG;
        /*
         * [핵심 원리] 위도 32.0~39.5, 경도 124.0~132.0 범위 안에 들어올 때만 true를 반환하여 지도 카메라가 아프리카 기니만(0, 0)으로 튀는 사고를 원천 차단함.
         */
    }

    public static double haversineKm(double lat1, double lng1, double lat2, double lng2) {
    /*
     * [자바 문법] public static double : 출발점(lat1, lng1)과 도착점(lat2, lng2) 사이의 지구 곡면 최단 직선거리(km)를 계산함.
     * [내가 지은 이름] haversineKm(하버사인 공식 함수명), lat1, lng1, lat2, lng2
     */
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2.0) * Math.sin(dLng / 2.0);
        return EARTH_RADIUS_KM * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
        /*
         * [스프링/자바 내장 함수] Math.toRadians(각도->라디안), Math.sin, Math.cos, Math.sqrt(제곱근), Math.atan2(역탄젠트) (모두 java.lang.Math 내장 함수로 이름 변경 불가)
         * [계산 결과 예시]
         *   연세대 미래캠퍼스(37.3190, 127.9012) ──> 원주세브란스기독병원(37.3191, 127.9456)
         *   └──> 반환값: 약 3.93 (단위: km)
         */
    }

    public static double clamp(double value, double min, double max) {
    /*
     * [자바 문법] public static double : 입력 숫자가 허용 범위[min, max]를 벗어나지 않도록 안전하게 가두는(Clamp) 함수임.
     * [내가 지은 이름] clamp, value, min, max
     */
        if (!Double.isFinite(value)) {
            return min;
        }
        return Math.max(min, Math.min(max, value));
        /*
         * [스프링/자바 내장 함수] Math.max, Math.min (이름 변경 불가)
         * [예시] clamp(500.0, 1.0, 200.0) -> 200.0 반환 (과도한 반경 탐색 요청으로부터 서버 보호)
         */
    }
}
