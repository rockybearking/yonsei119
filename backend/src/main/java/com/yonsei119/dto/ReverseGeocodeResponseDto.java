package com.yonsei119.dto;

/*
 * [역할 및 실행 시점]
 * - 역할: 위도·경도 좌표를 한국어 요약·도로명·지번 주소로 변환한 결과를 담아 전달하는 역지오코딩 응답 그릇 DTO
 * - 실행 시점: `GET /api/reverse-geocode?lat=...&lng=...` 요청 시 `NaverGeocodingService.reverseGeocode()`에서 생성되어 10분간 캐싱됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   NaverGeocodingService.reverseGeocode() ──> parseReverseGeocodeJson() ──> new ReverseGeocodeResponseDto(...)
 *   ──> EmergencyApiController.reverseGeocode() ──> Jackson JSON 직렬화
 *   ──> frontend/js/search-controls.js의 `updateOriginAddress()` 수신
 *   ──> `state.originAddress` 갱신 후 화면 하단 출발 기준 표시줄(`#origin-address-text`)에 주소 표시
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 8개 불변 필드와 생성자, `.code()`, `.shortAddress()`, `.fullAddress()` 등 자동 Getter 생성
 *
 * [프론트엔드 연결 및 IDE 추적 가이드]
 * - 프론트엔드 사용처: `frontend/js/search-controls.js` (`updateOriginAddress()`)
 * - 전체 검색(`Ctrl + Shift + F`): `/api/reverse-geocode` 또는 `shortAddress`
 *
 * [실행 방법 및 JSON 예시]
 * - 호출 예시: `curl "http://localhost:8080/api/reverse-geocode?lat=37.3190&lng=127.9012"`
 * - JSON 출력 예시:
 *   {
 *     "code": 0,
 *     "message": "ok",
 *     "lat": 37.319,
 *     "lng": 127.9012,
 *     "shortAddress": "강원 원주시 흥업면",
 *     "fullAddress": "강원특별자치도 원주시 연세대길 1 연세대학교 미래캠퍼스",
 *     "roadAddress": "강원특별자치도 원주시 연세대길 1 연세대학교 미래캠퍼스",
 *     "jibunAddress": ""
 *   }
 */
public record ReverseGeocodeResponseDto(
        int code,
        String message,
        double lat,
        double lng,
        String shortAddress,
        String fullAddress,
        String roadAddress,
        String jibunAddress
) {
}
