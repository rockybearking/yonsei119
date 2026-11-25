package com.yonsei119.dto;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 위경도 좌표를 한국어 요약·도로명·지번 주소로 바꾼 결과를 담는 역지오코딩 그릇 (DTO)
 * - 실행 시점 : `GET /api/reverse-geocode` 요청 시 생성되어 10분간 캐싱됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [search-controls.js]              [ApiController]          [GeocodingService]         [ReverseGeocodeDto]
 *              |                              |                          |                          |
 *              |-- 1. GET /reverse-geocode -->|-- 2. reverseGeocode() -->|                          |  좌표 -> 한국어 주소 요청
 *              |                              |                          |-- 3. new ReverseDto() -->|  요약 · 도로명 · 지번 포장
 *              |<-- 4. 200 JSON --------------|<-- cached 10m -----------|<-- dto ------------------|  하단 출발 기준 주소 갱신
 *              v                              v                          v                          v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record       : 8개 불변 필드 · 생성자 · `.shortAddress()` 등 Getter 자동생성 키워드
 *   ㄴ String       : 상태 메시지 및 한국어 주소 문자열을 담는 표준 내장 클래스
 *   ㄴ int / double : 응답 코드 및 위경도 실수를 담는 기본형 키워드
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson     : 응답 객체를 JSON 문자열로 자동 직렬화
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ NaverGeocodingService.java  : `reverseGeocode()`, `parseReverseGeocodeJson()`
 *   ㄴ EmergencyApiController.java : `reverseGeocode()`
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/search-controls.js : `updateOriginAddress()`
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
