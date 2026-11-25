package com.yonsei119.dto;

/*
 * [역할 및 실행 시점]
 * - 역할: 실도로 예상 도착 시간(ETA)과 병상 여유도·차단 공지 점수를 합산해 매긴 추천 응급실 1곳의 성적표 DTO
 * - 실행 시점: `GET /api/directions/rank` 요청 시 `NaverDirectionsService.rankHospitalsByDrivingTime()`에서 생성됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   NaverDirectionsService.rankHospitalsByDrivingTime()
 *   ├── 병렬 ETA 조회 + HospitalRecommendationScorer.evaluate() 평가
 *   └── 수용최적(`optimal`) / 최단시간(`fastest`) 정렬 후 `rank` 1~N 부여 ──> List<HospitalEtaRankDto> 반환
 *   ──> EmergencyApiController.rankDirections() ──> Jackson JSON 직렬화
 *   ──> frontend/js/directions-eta.js의 `loadEtaRanking()` 수신 ──> `#eta-rank-box`에 추천 순위 목록 렌더링
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 19개 불변 필드와 생성자, `.rank()`, `.recommendationScore()`, `.hasBlockingNotice()` 등 자동 Getter 생성
 *
 * [프론트엔드 연결 및 IDE 추적 가이드]
 * - 프론트엔드 사용처: `frontend/js/directions-eta.js` (`loadEtaRanking()`)
 * - 전체 검색(`Ctrl + Shift + F`): `/api/directions/rank` 또는 `recommendationReason`
 *
 * [실행 방법 및 JSON 예시]
 * - 호출 예시: `curl "http://localhost:8080/api/directions/rank?startLat=37.3190&startLng=127.9012&radiusKm=50&limit=5&mode=optimal"`
 * - JSON 출력 예시:
 *   [
 *     {
 *       "rank": 1,
 *       "id": "A2200001",
 *       "name": "연세대학교원주세브란스기독병원",
 *       "typeGroup": "regional",
 *       "typeLabel": "권역응급의료센터",
 *       "regional": true,
 *       "erBeds": "5",
 *       "straightDistanceKm": 4.2,
 *       "drivingDistanceKm": 6.7,
 *       "durationMinutes": 11,
 *       "durationText": "약 11분",
 *       "tollFare": 0,
 *       "taxiFare": 9400,
 *       "lat": 37.31912,
 *       "lng": 127.94561,
 *       "availabilityStatus": "여유",
 *       "hasBlockingNotice": false,
 *       "recommendationScore": 9.8,
 *       "recommendationReason": "응급실 5석 여유 · 차단 공지 없음"
 *     }
 *   ]
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
