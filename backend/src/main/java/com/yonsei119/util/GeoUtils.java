package com.yonsei119.util;
/*
 * [자바 문법]
 * - package : 좌표 검증, 거리 계산, 숫자 범위 제한 기능을 제공하는 패키지(com.yonsei119.util) 선언문임.
 *   · 참고 : java.lang 패키지의 Double·Math만 쓰므로 import 문이 필요 없음.
 *
 * [패키지명]
 * - com.yonsei119.util : 서비스 계층 여러 곳에서 함께 쓰는 공통 유틸리티 패키지명임.
 */

public final class GeoUtils {
/*
 * [자바 문법]
 * - public final class : 외부에서 정적 메서드를 부를 수 있되 상속(extends)을 금지해 유틸리티 형태를 지키는 선언임.
 *
 * [클래스명]
 * - GeoUtils : EmergencyDataService, NaverDirectionsService, NaverGeocodingService가 공통으로 쓰는 지리 계산 클래스명임.
 */

    public static final double KOREA_MIN_LAT = 32.0;
    public static final double KOREA_MAX_LAT = 39.5;
    public static final double KOREA_MIN_LNG = 124.0;
    public static final double KOREA_MAX_LNG = 132.0;
    private static final double EARTH_RADIUS_KM = 6371.0;
    /*
     * [자바 문법]
     * - public / private : 외부 공개용(KOREA_*)과 내부 계산용(EARTH_RADIUS_KM)으로 접근 범위를 나눔.
     * - static final double : 객체 없이 공유되며 실행 중 값이 절대 바뀌지 않는 실수 상수 선언임.
     *
     * [상수명]
     * - KOREA_MIN_LAT (32.0), KOREA_MAX_LAT (39.5) : 대한민국·제주·도서를 감싸는 유효 위도 범위 상수임.
     * - KOREA_MIN_LNG (124.0), KOREA_MAX_LNG (132.0) : 대한민국·도서를 감싸는 유효 경도 범위 상수임.
     * - EARTH_RADIUS_KM (6371.0) : 하버사인 거리 계산에 쓰는 지구 평균 반지름(km) 상수임.
     */

    private GeoUtils() {
    /*
     * [자바 문법]
     * - private GeoUtils() : 모든 메서드가 static이므로 밖에서 불필요하게 new GeoUtils()로 만들지 못하게 막음.
     *
     * [생성자 및 매개변수명]
     * - 생성자명 : GeoUtils (매개변수 없음, 외부 호출 불가).
     */
    }

    public static boolean isInvalidWorldCoordinate(double lat, double lng) {
    /*
     * [자바 문법]
     * - public static boolean : 객체 생성 없이 GeoUtils.isInvalidWorldCoordinate(lat, lng)로 부르는 정적 메서드 선언임.
     * - double : 위도·경도 실수 매개변수 기본형임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : isInvalidWorldCoordinate.
     * - 매개변수명 : lat(검사할 위도), lng(검사할 경도).
     */
        return !Double.isFinite(lat)
                || !Double.isFinite(lng)
                || lat < -90.0 || lat > 90.0
                || lng < -180.0 || lng > 180.0;
        /*
         * [자바 문법]
         * - return : 판별한 true/false 결과를 바로 돌려줌.
         * - 논리 부정(!Double.isFinite), || (단락 논리합) : 앞 조건이 true면 뒤 조건은 보지 않고 곧장 true를 반환함.
         * - <, > : 미만·초과 비교 연산자이며 -90.0, -180.0은 음수 실수 리터럴임.
         *
         * [자바 표준 내장 타입 및 메서드 (이름 변경 불가)]
         * - Double (출처: java.lang 패키지) : double 기본형을 감싸는 표준 래퍼 클래스임.
         * - Double.isFinite(double d) (출처: java.lang 패키지) : 값이 NaN이나 무한대(Infinity)가 아닌 정상 실수인지 검사함.
         *
         * [동작 흐름]
         * - 호출 출처 : NaverDirectionsService(경로·순위)와 NaverGeocodingService(역지오코딩)가 좌표 검증 시 호출함.
         * - 흐름 :
         *   ├── lat·lng가 NaN·Infinity거나 위도 [-90, 90]·경도 [-180, 180] 밖 ──> true 반환 (오류 응답 분기)
         *   └── 정상 실수이고 지구 좌표 범위 안 ──> false 반환 (정상 진행)
         * - 전달 대상 : 호출 서비스가 true를 받으면 -400 등 오류 응답을 내려 잘못된 외부 API 호출을 막음.
         */
    }

    public static boolean isValidKoreaCoordinate(double lat, double lng) {
    /*
     * [자바 문법]
     * - public static boolean, double : 대한민국 서비스 범위 안의 정상 좌표인지 판별하는 정적 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : isValidKoreaCoordinate.
     * - 매개변수명 : lat(위도), lng(경도).
     */
        return Double.isFinite(lat)
                && Double.isFinite(lng)
                && lat >= KOREA_MIN_LAT && lat <= KOREA_MAX_LAT
                && lng >= KOREA_MIN_LNG && lng <= KOREA_MAX_LNG;
        /*
         * [자바 문법]
         * - return, &&, >=, <= : 유한 실수 검사와 대한민국 경계 상수 비교 연산 조합임.
         *
         * [자바 표준 내장 메서드 (이름 변경 불가)]
         * - Double.isFinite(double d) (출처: java.lang 패키지).
         *
         * [동작 흐름]
         * - 호출 출처 :
         *   ├── EmergencyDataService.mergeDatasetsIntoSnapshot() ──> 공공데이터 병원 좌표 검사
         *   └── NaverGeocodingService.geocode(), parseGeocodeJson() ──> 지오코딩 검색 결과 좌표 검사
         * - 흐름 : lat·lng가 정상 실수이며 위도 [32.0, 39.5], 경도 [124.0, 132.0] 구간 안인지 확인함.
         * - 반환값 : 범위 안이면 true(유효 좌표 채택), (0.0, 0.0) 등 범위 밖이면 false(목록에서 제외).
         */
    }

    public static double haversineKm(double lat1, double lng1, double lat2, double lng2) {
    /*
     * [자바 문법]
     * - public static double : 두 지점의 위경도를 받아 km 단위 직선거리를 돌려주는 정적 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : haversineKm.
     * - 매개변수명 : lat1·lng1(출발 지점 위경도), lat2·lng2(도착 지점 위경도).
     */
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2.0) * Math.sin(dLng / 2.0);
        return EARTH_RADIUS_KM * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
        /*
         * [자바 문법]
         * - double : 중간 계산 변수와 반환값 실수형 선언임.
         * - -, +, *, / : 뺄셈·덧셈·곱셈·나눗셈 사칙연산자임.
         * - return : 계산한 km 직선거리를 호출한 쪽에 돌려줌.
         *
         * [자바 표준 내장 타입 및 메서드 (이름 변경 불가)]
         * - Math (출처: java.lang 패키지) : 표준 수학 함수를 모아 둔 정적 유틸리티 클래스임.
         * - Math.toRadians(double angdeg) : 도(Degree) 단위 위경도 각도를 라디안(Radian)으로 변환함.
         * - Math.sin(double a), Math.cos(double a) : 라디안 각도의 사인·코사인 값을 계산함.
         * - Math.sqrt(double a) : 양수의 제곱근을 계산함.
         * - Math.atan2(double y, double x) : 두 성분으로부터 중심각(라디안)을 안정적으로 구하는 역탄젠트 함수임.
         *
         * [지역 변수명]
         * - dLat : 두 지점 위도 차이의 라디안 값.
         * - dLng : 두 지점 경도 차이의 라디안 값.
         * - a : 하버사인 공식의 중간 계산값 (sin^2(dLat/2) + cos(lat1)*cos(lat2)*sin^2(dLng/2)).
         *
         * [동작 흐름]
         * - 호출 출처 : NaverDirectionsService.rankHospitalsByDrivingTime()·candidatePreScore()가 반경 필터링 시 호출함.
         * - 흐름 : 위경도 차이 라디안 변환 ──> 구면 중심각(2 * atan2) 계산 ──> EARTH_RADIUS_KM(6371.0) 곱셈.
         * - 반환값 : 둥근 지구 표면을 따라 잰 최단 직선거리 km를 반환함 (예: 원주캠퍼스~원주세브란스 약 3.93km).
         */
    }

    public static double clamp(double value, double min, double max) {
    /*
     * [자바 문법]
     * - public static double : 입력 숫자가 [min, max] 범위 밖이면 경계값으로 맞춰 돌려주는 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : clamp.
     * - 매개변수명 : value(보정할 숫자), min(허용 최솟값), max(허용 최댓값).
     */
        if (!Double.isFinite(value)) {
            return min;
        }
        return Math.max(min, Math.min(max, value));
        /*
         * [자바 문법]
         * - if, 논리 부정(!Double.isFinite(value)), return : 비정상 숫자가 들어오면 최솟값 min을 바로 돌려줌.
         *
         * [자바 표준 내장 메서드 (이름 변경 불가)]
         * - Double.isFinite(double d) (출처: java.lang 패키지) : value가 NaN이나 무한대인지 먼저 확인함.
         * - Math.min(double a, double b) (출처: java.lang 패키지) : 둘 중 작은 값을 골라 상한 max를 넘지 않게 자름.
         * - Math.max(double a, double b) (출처: java.lang 패키지) : 둘 중 큰 값을 골라 하한 min 아래로 내려가지 않게 올림.
         *
         * [동작 흐름]
         * - 호출 출처 : NaverDirectionsService.rankHospitalsByDrivingTime()이 반경 radiusKm를 [1.0, 200.0]으로 제한할 때 호출함.
         * - 흐름 :
         *   ├── !Double.isFinite(value) ──> 안전하게 min 반환
         *   └── 정상 실수 ──> Math.min(max, value) 상한 제한 ──> Math.max(min, ...) 하한 제한 ──> 보정값 반환
         * - 반환값 : [min, max] 구간 안으로 맞춘 double 값(예: clamp(500.0, 1.0, 200.0) -> 200.0)을 반환함.
         */
    }
}
