package com.yonsei119.util;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 위경도 유효성 검사, 지구 곡면 직선거리(Haversine km) 계산, 숫자 범위 보정을
 *          담당하는 순수 지리 수학 도구함 클래스
 * - 실행 시점 : 상태가 없는 `static` 유틸리티로, 각 서비스에서 객체 생성 없이 즉시 호출됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [Emergency / Naver Service]             [GeoUtils (static)]
 *                 |                                   |
 *                 |-- 1a. isValidKoreaCoordinate() -->|  (0.0, 0.0) 등 한반도 밖 차단
 *                 |<-- boolean -----------------------|  유효 한국 좌표 여부 반환
 *                 |-- 1b. haversineKm(p1, p2) ------->|  두 지점 구면 직선거리 계산
 *                 |<-- distanceKm (double) -----------|  km 단위 실수 거리 반환
 *                 v                                   v
 *
 * [3. 사용된 요소 구분 (표준 내장)]
 * - Java 표준 내장
 *   ㄴ final class / private 생성자 : 상속 및 불필요한 객체 생성을 막는 표준 유틸 문법
 *   ㄴ double / boolean                          : 좌표 실수 및 판정 논리 기본형 키워드
 *   ㄴ Double.isFinite()                         : `NaN` · 무한대(`Infinity`)가 아닌 정상 실수 확인 메서드
 *   ㄴ Math.toRadians / sin / cos / atan2 / sqrt : 구면 삼각법 거리 계산 표준 수학 메서드
 *   ㄴ Math.clamp()                              : 최소~최대 경계 안으로 값을 자르는 Java 21+ 표준 메서드
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ EmergencyDataService.java   : `mergeDatasetsIntoSnapshot()` 한국 좌표 검증
 *   ㄴ NaverDirectionsService.java : `getDrivingRoute()`, `rankHospitalsByDrivingTime()`
 *   ㄴ NaverGeocodingService.java  : `reverseGeocode()`, `parseGeocodeJson()`
 * - 프론트엔드 대칭 함수
 *   ㄴ frontend/js/utils.js        : `distanceKm()` (동일한 반지름 6,371km 공식 사용)
 * - IntelliJ 추적 단축키
 *   ㄴ 호출 계층 보기 : 메서드명 위에서 `Ctrl + Alt + H`
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
