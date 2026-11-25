package com.yonsei119.util;

/*
 * [역할 및 실행 시점]
 * - 역할: 위도·경도 유효성 검사, 두 좌표 사이의 지구 곡면 거리(Haversine km) 계산, 숫자 범위 보정을 수행하는 지리 수학 도구함
 * - 실행 시점: 상태 필드가 없는 순수 `static` 유틸리티 클래스로, 각 서비스에서 필요할 때 객체 생성 없이 즉시 호출됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 주요 메서드별 사용 흐름:
 *   ├── isInvalidWorldCoordinate() ──> NaverDirectionsService, NaverGeocodingService (잘못된 좌표로 외부 API를 부르는 실수 차단)
 *   ├── isValidKoreaCoordinate()   ──> EmergencyDataService, NaverGeocodingService ((0.0, 0.0) 등 대한민국 밖 오류 좌표 제거)
 *   ├── haversineKm()              ──> NaverDirectionsService (출발지~병원 직선거리 km 계산)
 *   └── clamp()                    ──> NaverDirectionsService (탐색 반경 1~200km 안전 범위 보정)
 *
 * [내장 구분]
 * - Java 표준 내장(`java.lang` 자동 포함): `Double.isFinite()`, `Math.toRadians()`, `Math.sin()`, `Math.cos()`, `Math.atan2()`, `Math.clamp()`
 *
 * [사용처 및 IDE 추적 가이드]
 * - 프론트엔드 대칭 함수: frontend/js/utils.js의 `distanceKm()`과 동일한 지구 반지름(6371km) 하버사인 공식을 사용함
 * - Java 호출 추적: 각 메서드명 위에서 `Ctrl + Alt + H`
 */
public final class GeoUtils {

    public static final double KOREA_MIN_LAT = 32.0;
    public static final double KOREA_MAX_LAT = 39.5;
    public static final double KOREA_MIN_LNG = 124.0;
    public static final double KOREA_MAX_LNG = 132.0;
    private static final double EARTH_RADIUS_KM = 6371.0;

    // 인스턴스 생성을 막기 위한 비공개 생성자
    private GeoUtils() {
    }

    /** NaN·무한대이거나 지구 위경도 범위(위도 -90~90, 경도 -180~180)를 벗어난 비정상 좌표이면 `true`를 반환함 */
    public static boolean isInvalidWorldCoordinate(double lat, double lng) {
        return !Double.isFinite(lat)
                || !Double.isFinite(lng)
                || lat < -90.0 || lat > 90.0
                || lng < -180.0 || lng > 180.0;
    }

    /** 한반도 및 부속 도서(제주·울릉도·백령도 포함: 위도 32.0~39.5, 경도 124.0~132.0) 안의 정상 좌표인지 확인함 */
    public static boolean isValidKoreaCoordinate(double lat, double lng) {
        return Double.isFinite(lat)
                && Double.isFinite(lng)
                && lat >= KOREA_MIN_LAT && lat <= KOREA_MAX_LAT
                && lng >= KOREA_MIN_LNG && lng <= KOREA_MAX_LNG;
    }

    /** 둥근 지구 표면을 따라 두 위경도 지점 사이의 최단 직선거리(km)를 하버사인 공식으로 계산함 */
    public static double haversineKm(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2.0) * Math.sin(dLng / 2.0);
        return EARTH_RADIUS_KM * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
    }

    /** 숫자가 `[min, max]` 범위를 벗어나거나 NaN일 때 경계값 안으로 안전하게 잘라 반환함 */
    public static double clamp(double value, double min, double max) {
        if (!Double.isFinite(value)) {
            return min;
        }
        return Math.clamp(value, min, max);
    }
}
