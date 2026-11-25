package com.yonsei119.dto;

import java.util.List;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 주소·지명 검색어에 대한 위경도 좌표 후보 목록을 전달하는 검색 결과 그릇 (DTO)
 * - 실행 시점 : `GET /api/geocode?query=...` 요청 시 생성되어 10분간 캐싱됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [search-controls.js]          [ApiController]        [GeocodingService]        [GeocodeResponseDto]
 *              |                          |                        |                          |
 *              |-- 1. GET /api/geocode -->|-- 2. geocode(query) -->|                          |  주소 · 장소 검색 요청
 *              |                          |                        |-- 3. new GeocodeDto() -->|  위경도 후보 리스트 포장
 *              |<-- 4. 200 JSON ----------|<-- cached 10m ---------|<-- dto ------------------|  출발 기준점 이동 반영
 *              v                          v                        v                          v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record       : 바깥 `GeocodeResponseDto` 및 중첩 `GeocodeItemDto` 선언 키워드 (자동생성)
 *   ㄴ String       : 검색어 · 장소명 · 도로명/지번 주소를 담는 표준 내장 클래스
 *   ㄴ int / double : 상태 코드 · 위경도 실수를 담는 기본형 키워드
 *   ㄴ List         : 검색 결과 후보 목록을 담는 표준 내장 인터페이스
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson     : 응답 객체를 JSON 텍스트로 자동 변환
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ NaverGeocodingService.java  : `geocode()`, `parseGeocodeJson()`
 *   ㄴ EmergencyApiController.java : `geocode()`
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/search-controls.js : `geocodeAndMoveOrigin()`
 */
public record GeocodeResponseDto(
        int code,
        String query,
        List<GeocodeItemDto> items
) {

    /** 검색된 개별 장소 1곳의 명칭 · 도로명주소 · 지번주소 · 위경도를 담는 중첩 레코드 */
    public record GeocodeItemDto(
            String title,
            String roadAddress,
            String jibunAddress,
            double lat,
            double lng
    ) {
    }
}
