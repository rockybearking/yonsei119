package com.yonsei119.dto;

import java.util.List;
/*
 * [자바 문법] package, import : 검색어(주소·지역·장소명)를 위경도 좌표로 변환한 지오코딩(Geocoding) 응답 DTO 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)] List (이름 변경 불가)
 */

public record GeocodeResponseDto(
        int code,
        String query,
        List<GeocodeItemDto> items
) {
/*
 * [자바 문법] public record, int
 * [자바/스프링/라이브러리 내장 도구(타입)] String, List<GeocodeItemDto> (이름 변경 불가)
 * [내가 지은 이름]
 * - 대문자 타입명: GeocodeResponseDto, GeocodeItemDto
 * - 소문자 필드명: code(0이면 검색 성공, 404면 결과 없음), query(원본 검색어), items(검색된 좌표 후보 리스트)
 * [변환 JSON 예시]
 *   GET /api/geocode?query=원주시청
 *   └──> { "code": 0, "query": "원주시청", "items": [ { "title": "원주시청", "lat": 37.3422, "lng": 127.9202, ... } ] }
 */

    public record GeocodeItemDto(
            String title,
            String roadAddress,
            String jibunAddress,
            double lat,
            double lng
    ) {
    /*
     * [자바 문법] public record, double
     * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
     * [내가 지은 이름] GeocodeItemDto(대문자 타입명) / title(표시 제목), roadAddress(도로명), jibunAddress(지번), lat(위도), lng(경도)
     */
    }
}
