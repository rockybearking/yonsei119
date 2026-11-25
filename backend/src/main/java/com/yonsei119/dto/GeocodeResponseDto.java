package com.yonsei119.dto;

import java.util.List;

/*
 * [역할 및 실행 시점]
 * - 역할: 주소·장소 검색어에 대한 위경도 좌표 후보 목록을 담아 브라우저로 전달하는 주소 검색 결과 그릇 DTO
 * - 실행 시점: `GET /api/geocode?query=...` 호출 시 `NaverGeocodingService.geocode()`에서 생성되어 10분간 캐싱됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   NaverGeocodingService.geocode() [1단계 네이버 ──> 2단계 병원 주소록 ──> 3단계 Nominatim]
 *   ──> new GeocodeResponseDto(code, query, items) ──> EmergencyApiController.geocode()
 *   ──> Jackson JSON 직렬화 ──> frontend/js/search-controls.js의 `geocodeAndMoveOrigin()` 수신
 *   ──> `data.items[0]`의 `lat`, `lng`로 출발 기준점 이동 및 지도 카메라 이동
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 바깥 `GeocodeResponseDto` 및 내부 `GeocodeItemDto`의 생성자와 Getter 자동 생성
 *
 * [프론트엔드 연결 및 IDE 추적 가이드]
 * - 프론트엔드 사용처: `frontend/js/search-controls.js` (`geocodeAndMoveOrigin()`)
 * - 전체 검색(`Ctrl + Shift + F`): `/api/geocode`
 *
 * [실행 방법 및 JSON 예시]
 * - 호출 예시: `curl --get --data-urlencode "query=원주시청" http://localhost:8080/api/geocode`
 * - JSON 출력 예시:
 *   {
 *     "code": 0,
 *     "query": "원주시청",
 *     "items": [{ "title": "원주시청", "roadAddress": "강원특별자치도 원주시 시청로 1", "jibunAddress": "강원특별자치도 원주시 무실동 1", "lat": 37.3422, "lng": 127.9202 }]
 *   }
 */
public record GeocodeResponseDto(
        int code,
        String query,
        List<GeocodeItemDto> items
) {

    /** 검색된 개별 장소 1곳의 명칭·도로명주소·지번주소·위경도를 담는 중첩 레코드 */
    public record GeocodeItemDto(
            String title,
            String roadAddress,
            String jibunAddress,
            double lat,
            double lng
    ) {
    }
}
