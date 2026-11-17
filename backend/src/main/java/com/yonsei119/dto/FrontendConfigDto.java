package com.yonsei119.dto;
/*
 * [자바 문법] package : 프론트엔드 초기화용 공개 설정값만 선별해 전달하는 DTO 패키지 선언임.
 */

public record FrontendConfigDto(
        String naverClientId,
        String naverDarkStyleId,
        double defaultLat,
        double defaultLng,
        String defaultLabel
) {
/*
 * [자바 문법] public record, double(실수 기본형)
 * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
 * [내가 지은 이름]
 * - 대문자 타입명: FrontendConfigDto
 * - 소문자 필드명: naverClientId(공개 지도 SDK 키), naverDarkStyleId(다크 스타일 UUID), defaultLat(기본 위도), defaultLng(기본 경도), defaultLabel(기본 위치명)
 * [핵심 보안 원리 & 비유]
 * - 식당 주방 금고(Yonsei119Properties)에는 비밀키(clientSecret)도 함께 들어 있지만,
 * - 손님 테이블(/api/config)로 내보내는 이 도시락(FrontendConfigDto)에는 비밀키 칸 자체를 아예 만들지 않아 실수로라도 유출될 가능성을 0%로 차단함.
 * [변환 JSON 예시]
 *   GET /api/config
 *   └──> { "naverClientId": "xfbxloc8km", "naverDarkStyleId": "4b12b380-...", "defaultLat": 37.5666805, "defaultLng": 126.9784147, "defaultLabel": "서울시청" }
 */
}
