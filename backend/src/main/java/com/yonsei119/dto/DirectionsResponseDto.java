package com.yonsei119.dto;

import java.util.List;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 네이버 자동차 길찾기 결과(경로 좌표열, 주요 도로 요약 구간, 요금, 4대 대안 옵션)를
 *          담아 프론트엔드로 전달하는 내비게이션 응답 그릇 (DTO)
 * - 실행 시점 : `NaverDirectionsService.parseDirectionsJson()` 실행 시 생성되어 60초간 캐싱됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [directions-eta.js]         [ApiController]           [DirectionsService]       [DirectionsResponseDto]
 *             |                         |                           |                           |
 *             |-- 1. GET /directions -->|-- 2. getDrivingRoute() -->|                           |  실시간 자동차 경로 요청
 *             |                         |                           |-- 3. new ResponseDto() -->|  좌표열 · 요금 · 대안 포장
 *             |<-- 4. 200 JSON ---------|<-- code 0 or -304 --------|<-- dto -------------------|  경로 수신 후 CTT 색상 매칭
 *             v                         v                           v                           v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record              : 바깥 DTO 및 중첩 DTO 2종의 생성자 · Getter 자동생성 키워드
 *   ㄴ String              : 옵션명 · 시간 문자열 · 안내 문구를 담는 표준 내장 클래스
 *   ㄴ int / long / double : 거리(m) · 시간(ms) · 요금(원) · 거리(km) 기본형 키워드
 *   ㄴ List / Double       : `[경도, 위도]` 좌표 목록을 담는 표준 내장 컬렉션·래퍼 타입
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson               : 응답 시 전체 중첩 `record` 트리를 JSON으로 자동 직렬화
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ NaverDirectionsService.java  : `parseDirectionsJson()`, `createErrorResponse()`
 *   ㄴ RouteCongestionAnalyzer.java : `buildDetailedSections()` (`RouteSectionDto` 생성)
 *   ㄴ EmergencyApiController.java  : `getDirections()`
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/directions-eta.js : `loadDirectionsForHospital()`, `drawRouteOnMap()`
 * - IntelliJ 추적 단축키
 *   ㄴ 호출 계층 보기 : `DirectionsResponseDto` 위에서 `Ctrl + Alt + H`
 *   ㄴ 프론트엔드 검색 : `Ctrl + Shift + F`로 `/api/directions` 또는 `alternatives` 검색
 *
 * [5. 실행 방법 및 JSON 예시]
 * - 호출 예시 :
 *   `curl "http://localhost:8080/api/directions?startLat=37.5666&startLng=126.9784&goalLat=37.5599&goalLng=127.0448"`
 * - JSON 출력 예시 :
 *   {
 *     "apiType": "directions5",
 *     "option": "trafast",
 *     "code": 0,
 *     "distanceKm": 7.4,
 *     "durationText": "약 27분",
 *     "path": [[126.9780, 37.5665], [127.0448, 37.5599]]
 *   }
 */
public record DirectionsResponseDto(
        String apiType,
        String apiLabel,
        String option,
        String optionLabel,
        int code,
        String message,
        int distanceMeters,
        double distanceKm,
        long durationMs,
        int durationMinutes,
        String durationText,
        String departureTime,
        int tollFare,
        int taxiFare,
        int fuelPrice,
        List<List<Double>> path,
        List<RouteSectionDto> sections,
        List<String> guidePrompts,
        List<RouteOptionSummaryDto> alternatives
) {

    /** 네이버 API 주요 도로 구간 요약 1건을 담는 중첩 레코드 (`congestion`: 0~3) */
    public record RouteSectionDto(
            int pointIndex,
            int pointCount,
            int distance,
            String name,
            int congestion,
            int speed
    ) {
    }

    /** 빠른길·최적·편한길·무료우선 등 주행 옵션별 소요시간·거리·요금 비교용 중첩 레코드 */
    public record RouteOptionSummaryDto(
            String option,
            String optionLabel,
            int distanceMeters,
            double distanceKm,
            long durationMs,
            int durationMinutes,
            String durationText,
            int tollFare,
            int taxiFare,
            int fuelPrice
    ) {
    }
}
