package com.yonsei119.dto;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 실도로 도착 예상 시간(ETA)과 병상 여유도·차단 공지 점수를 종합해 매긴
 *          추천 응급실 1곳의 성적표 그릇 (DTO)
 * - 실행 시점 : `GET /api/directions/rank` 요청 시 `NaverDirectionsService`에서 생성됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [directions-eta.js]              [ApiController]         [DirectionsService]         [RecommendationScorer]
 *             |                              |                         |                             |
 *             |-- 1. GET /directions/rank -->|-- 2. rankHospitals() -->|                             |  반경 50km 추천 순위 요청
 *             |                              |                         |-- 3. evaluate(hosp, eta) -->|  병상 여유 · 차단 공지 심사
 *             |                              |                         |<-- 4. score + reason -------|  수용최적 가중치 점수 반환
 *             |<-- 5. 200 JSON --------------|<-- List<EtaRankDto> ----|                             |  상위 1~5위 추천 카드 표시
 *             v                              v                         v                             v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record                 : 19개 불변 필드 · 생성자 · `.rank()` 등 Getter 자동생성 키워드
 *   ㄴ String                 : 병원명 · 병상 원문 · 추천 사유를 담는 표준 내장 클래스
 *   ㄴ int / double / boolean : 순위·시간·요금 / 거리·점수 / 권역·차단공지 기본형 키워드
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson               : 응답 시 `List<HospitalEtaRankDto>`를 JSON 배열로 직렬화
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ NaverDirectionsService.java : `rankHospitalsByDrivingTime()`
 *   ㄴ EmergencyApiController.java : `rankDirections()`
 *   ㄴ Yonsei119BackendTests.java  : Test 12 수용최적 추천 순위 검증
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/directions-eta.js : `loadEtaRanking()` (`#eta-rank-box` 렌더링)
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
}
