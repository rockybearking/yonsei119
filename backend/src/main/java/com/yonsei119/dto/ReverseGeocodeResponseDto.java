package com.yonsei119.dto;
/*
 * [자바 문법] package : 위경도 좌표를 한국어 도로명·지번 주소로 변환한 역지오코딩(Reverse Geocoding) 응답 DTO 패키지 선언임.
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
 * [자바 문법] public record, int, double
 * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
 * [내가 지은 이름]
 * - 대문자 타입명: ReverseGeocodeResponseDto
 * - 소문자 필드명: code(0이면 변환 성공), message, lat(위도), lng(경도), shortAddress(시도+시군구+읍면동 요약),
 *   fullAddress(대표 전체 주소), roadAddress(도로명 주소), jibunAddress(지번 주소)
 * [변환 데이터 구조 예시]
 *   입력 좌표: lat=37.3190, lng=127.9012
 *   └──> { "code": 0, "shortAddress": "강원 원주시 흥업면", "roadAddress": "강원특별자치도 원주시 연세대길 1 연세대학교 미래캠퍼스", ... }
 */
}
