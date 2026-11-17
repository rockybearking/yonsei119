package com.yonsei119.dto;

import java.util.List;
/*
 * [자바 문법] package, import : 네이버 자동차 길찾기(Directions 5 / 15) 응답 데이터를 담는 DTO 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)] List (이름 변경 불가)
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
/*
 * [자바 문법] public record, int, double, long
 * [자바/스프링/라이브러리 내장 도구(타입)] String, List<List<Double>> (좌표 [경도, 위도] 쌍의 배열) (이름 변경 불가)
 * [내가 지은 이름]
 * - 대문자 타입명: DirectionsResponseDto, RouteSectionDto, RouteOptionSummaryDto
 * - 소문자 필드명: apiType, apiLabel, option, optionLabel, code(0이면 성공), message, distanceMeters, distanceKm,
 *   durationMs, durationMinutes, durationText("약 11분"), tollFare(통행료), taxiFare(택시비), fuelPrice(유류비),
 *   path(폴리라인 좌표열), sections(혼잡도 구간), guidePrompts(회전 안내), alternatives(4대 탐색 옵션 비교 카드)
 * [핵심 원리 & 데이터 구조 예시]
 *   네이버 원본의 깊숙한 중첩 JSON(route.trafast[0].summary...)을 프론트엔드가 바로 그릴 수 있는 1차원 구조로 정제한 도시락임:
 *   {
 *     "apiType": "directions5", "option": "trafast", "durationText": "약 11분", "distanceKm": 6.7,
 *     "path": [ [127.9012, 37.3190], [127.9456, 37.3191] ],  // 주의: GeoJSON 표준 [경도(lng), 위도(lat)] 순서
 *     "sections": [ { "pointIndex": 0, "pointCount": 2, "name": "서원대로", "congestion": 2, "speed": 28 } ],
 *     "alternatives": [ { "option": "trafast", ... }, { "option": "traavoidtoll", ... } ]
 *   }
 */

    public record RouteSectionDto(
            int pointIndex,
            int pointCount,
            int distance,
            String name,
            int congestion,
            int speed
    ) {
    /*
     * [자바 문법] public record, int
     * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
     * [내가 지은 이름] RouteSectionDto(대문자 타입명) / pointIndex(시작 좌표 인덱스), pointCount(좌표 개수), distance(구간 미터),
     *   name(도로명), congestion(혼잡도 코드: 1=원활 초록, 2=서행 주황, 3=정체 빨강), speed(평균 시속 km/h)
     */
    }

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
    /*
     * [자바 문법] public record, int, double, long
     * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
     * [내가 지은 이름] RouteOptionSummaryDto(대문자 타입명) / option("trafast" 등), optionLabel("실시간 빠른길" 등) 외 요약 수치들
     * [역할] 병원 상세 시트에서 4가지 주행 옵션(빠른길·최적·편한길·무료우선)의 시간과 요금을 한눈에 비교하는 버튼 카드를 그릴 때 사용됨.
     */
    }
}
