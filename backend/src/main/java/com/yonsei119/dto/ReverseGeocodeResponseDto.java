package com.yonsei119.dto;
/*
 * [자바 문법]
 * - package : ReverseGeocodeResponseDto.java 파일이 속한 패키지 경로를 선언하는 키워드임 (이름 변경 불가).
 *
 * [패키지명]
 * - com.yonsei119.dto : 위경도 좌표를 한국어 주소로 바꾼 역지오코딩 응답 등 API 전달용 DTO 패키지임.
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
/*
 * [자바 문법 및 record 자동 생성 요소]
 * - public : 다른 패키지(service, controller, test)에서도 ReverseGeocodeResponseDto 레코드에 접근할 수 있게 열어 주는 제어자임 (이름 변경 불가).
 * - record : 한 번 만들면 값을 바꿀 수 없는(불변) 데이터 전달용 타입 키워드임 (이름 변경 불가).
 * - int, double : 32비트 정수와 소수점 실수를 담는 자바 기본형임 (이름 변경 불가).
 * - 생성자 (record 자동 생성) : 8개 필드를 받는 new ReverseGeocodeResponseDto(...)가 자동 생성됨.
 * - 필드 조회 메서드 (record 자동 생성) : 각 필드명과 같은 조회 메서드가 자동 생성됨.
 *   · 상태·좌표: .code(), .message(), .lat(), .lng()
 *   · 변환 주소: .shortAddress(), .fullAddress(), .roadAddress(), .jibunAddress()
 * - 공통 표준 메서드 (record 자동 생성) : equals(Object), hashCode(), toString()이 자동 생성됨 (이름 변경 불가).
 *
 * [자바 내장 클래스 및 타입]
 * - String (java.lang.String) : 글자를 저장하는 자바 표준 불변 문자열 클래스임 (이름 변경 불가).
 *
 * [레코드명 및 필드명]
 * - ReverseGeocodeResponseDto : 위도·경도 좌표에 맞는 요약·도로명·지번 주소를 반환하는 DTO임.
 * - code : 결과 코드 (0=성공, -1=좌표 오류·인증키 미설정·네트워크 실패, -2=JSON 파싱 오류, 그 외=API 오류 코드).
 * - message : 처리 상태 또는 오류 안내 문자열 (정상 변환 시 "ok").
 * - lat, lng : 요청한 WGS84 위도·경도 실수 (좌표 범위 오류 시 0.0).
 * - shortAddress : 시·도 약칭 + 시·군·구 + 읍·면·동 요약 주소 (예: "강원 원주시 흥업면", 폴백 시 좌표 문구).
 * - fullAddress : 도로명 주소, 없으면 지번 주소, 둘 다 없으면 요약 주소를 채운 대표 전체 주소.
 * - roadAddress : 도로명 주소 전체 문자열 (예: "강원특별자치도 원주시 연세대길 1 연세대학교 미래캠퍼스").
 * - jibunAddress : 지번 주소 전체 문자열.
 *
 * [동작 흐름]
 * - 좌표 변환 -> 캐시 -> 컨트롤러 -> JSON 변환 -> 프론트 주소 표시 순서로 동작함.
 *   NaverGeocodingService (reverseGeocode(), parseReverseGeocodeJson()) -> new ReverseGeocodeResponseDto(...) 생성
 *   ├── code == 0 정상 결과는 reverseGeocodeCache에 600초 저장 (NaverDirectionsService.reverseGeocode()도 위임)
 *   └── EmergencyApiController.reverseGeocode(...) -> ResponseEntity.ok(...) 반환
 *   ──> Spring Jackson이 record 조회 메서드를 읽어 객체 -> JSON 문자열 자동 변환
 *   ──> frontend/js/search-controls.js (updateOriginAddress())가 fetch('/api/reverse-geocode?...')로 수신
 *   └── state.originAddress에 저장 후 updateRadiusUI()로 화면 출발 기준 주소를 갱신함
 *
 * [실행 방법 및 JSON 예시]
 * - URL 출처 : application.yml(server.port: ${PORT:8080}, 기본 8080) + @RequestMapping("/api") + @GetMapping("/reverse-geocode")
 * - 최종 URL : http://localhost:8080/api/reverse-geocode?lat=...&lng=... (EmergencyApiController.reverseGeocode())
 * - 서버 실행 : 프로젝트 루트에서 `.\gradlew.bat bootRun` 실행.
 * - 호출 예시 : `curl "http://localhost:8080/api/reverse-geocode?lat=37.3190&lng=127.9012"` (브라우저 접속 가능)
 * - JSON 출력 예시 :
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
}
