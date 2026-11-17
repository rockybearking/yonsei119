package com.yonsei119.dto;
/*
 * [자바 문법] package : 주변 응급실 실도로 주행시간(ETA) + 병상 수용 가능성 종합 추천 순위 DTO 패키지 선언임.
 */

public record HospitalEtaRankDto(
        int rank,
        String id,
        String name,
        String typeGroup,
        String typeLabel,
        boolean regional,
        String erBeds,
        double straightDistanceKm,
        double drivingDistanceKm,
        int durationMinutes,
        String durationText,
        int tollFare,
        int taxiFare,
        double lat,
        double lng,
        String availabilityStatus,
        boolean hasBlockingNotice,
        double recommendationScore,
        String recommendationReason
) {
/*
 * [자바 문법] public record, int, double, boolean
 * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
 * [내가 지은 이름]
 * - 대문자 타입명: HospitalEtaRankDto
 * - 소문자 필드명:
 *   · 기본 경로·병원 정보: rank(추천 순위 1~N), id(HPID), name(병원명), typeGroup, typeLabel, regional, erBeds(원본 병상 문자열),
 *     straightDistanceKm(직선거리), drivingDistanceKm(실도로 거리), durationMinutes(순수 주행 분), durationText, tollFare, taxiFare, lat, lng
 *   · 응급실 핑퐁 방지 고도화 정보:
 *     - availabilityStatus : 병상 신호등 상태 ("여유" | "혼잡" | "만실" | "초과수용" | "미보고")
 *     - hasBlockingNotice  : 실시간 수용/진료 차단 공지 존재 여부 (true/false)
 *     - recommendationScore: 주행 시간(분)에 포화·차단 페널티를 합산한 종합 추천 점수 (낮을수록 최우선 추천)
 *     - recommendationReason: 보호자·구급대원이 즉시 판단할 수 있는 추천 근거 요약 문구
 * [변환 JSON 예시]
 *   {
 *     "rank": 1, "id": "A2200001", "name": "연세대학교원주세브란스기독병원",
 *     "durationMinutes": 11, "durationText": "약 11분", "erBeds": "5",
 *     "availabilityStatus": "여유", "hasBlockingNotice": false,
 *     "recommendationScore": 10.0, "recommendationReason": "응급실 5석 여유 · 차단 공지 없음"
 *   }
 */
}
