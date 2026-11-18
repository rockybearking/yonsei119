package com.yonsei119.dto;
/*
 * [자바 문법]
 * - package : HospitalEtaRankDto.java 파일이 속한 패키지 경로를 선언하는 키워드임 (이름 변경 불가).
 *
 * [패키지명]
 * - com.yonsei119.dto : 주변 응급실 추천 순위 응답 등 컨트롤러가 JSON으로 보내는 DTO 패키지임.
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
 * [자바 문법 및 record 자동 생성 요소]
 * - public : 다른 패키지에서도 HospitalEtaRankDto 레코드에 접근할 수 있게 열어 주는 제어자임 (이름 변경 불가).
 * - record : 한 번 만들면 값을 바꿀 수 없는(불변) 데이터 전달용 타입 키워드임 (이름 변경 불가).
 * - int, boolean, double : 일반 정수, 참/거짓 논리값, 소수점 실수를 담는 자바 기본형임 (이름 변경 불가).
 * - 생성자 (record 자동 생성) : 19개 필드를 채우는 new HospitalEtaRankDto(...)가 자동 생성됨.
 * - 필드 조회 메서드 (record 자동 생성) : 각 필드명과 같은 조회 메서드가 자동 생성됨.
 *   · 순위·기관: .rank(), .id(), .name(), .typeGroup(), .typeLabel(), .regional(), .erBeds()
 *   · 거리·시간·요금: .straightDistanceKm(), .drivingDistanceKm(), .durationMinutes(),
 *     .durationText(), .tollFare(), .taxiFare()
 *   · 위치·추천 점수: .lat(), .lng(), .availabilityStatus(), .hasBlockingNotice(),
 *     .recommendationScore(), .recommendationReason()
 * - 공통 표준 메서드 (record 자동 생성) : equals(Object), hashCode(), toString()이 자동 생성됨 (이름 변경 불가).
 *
 * [자바 내장 클래스 및 타입]
 * - String (java.lang.String) : 글자를 저장하는 자바 표준 불변 문자열 클래스임 (이름 변경 불가).
 *
 * [레코드명 및 필드명]
 * - HospitalEtaRankDto : 실도로 주행 시간과 병상 여유도·공지 점수를 합쳐 매긴 추천 순위 1건 DTO임.
 * - rank : 최종 정렬 후 부여된 추천 순위 (1부터 N까지 정수, 정렬 전 임시 객체에서는 0).
 * - id, name, regional : 기관 고유코드(HPID), 응급의료기관명, 권역응급의료센터 지정 여부.
 * - typeGroup, typeLabel : 종별 그룹 코드("regional" | "tertiary" | "medical" | "other") 및 한글 명칭.
 * - erBeds : 응급실 일반병상(hvec) 원본 문자열 (예: "-4", "0", "5", "").
 * - straightDistanceKm : 출발지에서 병원까지의 직선거리 (km, 소수 첫째 자리 반올림).
 * - drivingDistanceKm : 네이버 Directions 5 실도로 주행거리 (km, 실패 시 직선거리 대체).
 * - durationMinutes, durationText : 예상 주행 소요 시간 (분 정수 및 "약 11분", "약 N분(추정)" 문구).
 * - tollFare, taxiFare, lat, lng : 예상 통행료·택시 요금(원) 및 병원 위도·경도.
 * - availabilityStatus : 병상 여유도 5단계 상태 문자열 ("여유" | "혼잡" | "만실" | "초과수용" | "미보고").
 * - hasBlockingNotice : 현재 유효한 수용·진료 차단 공지 존재 여부 (true 또는 false).
 * - recommendationScore : 주행 시간(분)에 페널티·보너스를 합산한 추천 점수 (낮을수록 우선 추천).
 * - recommendationReason : 추천·주의 근거 요약 문구 (예: "응급실 5석 여유 · 차단 공지 없음").
 *
 * [동작 흐름]
 * - 병렬 평가 -> 순위 부여 -> 컨트롤러 -> JSON 변환 -> 프론트 표시 순서로 동작함.
 *   NaverDirectionsService.rankHospitalsByDrivingTime(...) 실행
 *   ├── 1단계: 병렬 작업에서 HospitalRecommendationScorer.evaluate() 결과로 rank=0 임시 객체 생성
 *   └── 2단계: optimal/fastest 기준 정렬 후 1부터 순위를 매겨 최종 List<HospitalEtaRankDto> 생성
 *   ──> EmergencyApiController.rankDirections(...) -> ResponseEntity.ok(ranked) 반환
 *   ──> Spring Jackson이 record 조회 메서드를 읽어 객체 목록 -> JSON 배열로 자동 변환
 *   ──> frontend/js/directions-eta.js (loadEtaRanking())가 fetch('/api/directions/rank?...')로 수신
 *   └── #eta-rank-box 영역에 1~N위 추천 목록과 포화 경고 배지를 그림
 *
 * [실행 방법 및 JSON 예시]
 * - URL 출처 : application.yml(server.port: ${PORT:8080}, 기본 8080) + @RequestMapping("/api") + @GetMapping("/directions/rank")
 * - 최종 URL : http://localhost:8080/api/directions/rank (EmergencyApiController.rankDirections())
 * - 서버 실행 : 프로젝트 루트에서 `.\gradlew.bat bootRun` 실행.
 * - 호출 예시 : `curl "http://localhost:8080/api/directions/rank?startLat=37.3190&startLng=127.9012&radiusKm=20&limit=5&mode=optimal&symptom=stroke"`
 * - JSON 출력 예시 :
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
 *       "recommendationScore": 10.0,
 *       "recommendationReason": "응급실 5석 여유 · 차단 공지 없음"
 *     }
 *   ]
 */
}
