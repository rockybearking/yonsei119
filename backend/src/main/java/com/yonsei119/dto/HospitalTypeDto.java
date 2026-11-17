package com.yonsei119.dto;
/*
 * [자바 문법] package : 프론트엔드와 백엔드 사이를 오가는 데이터 도시락(DTO: Data Transfer Object) 전용 폴더(com.yonsei119.dto) 선언임.
 */

public record HospitalTypeDto(
        String group,
        String label,
        String accent,
        int priority
) {
/*
 * [자바 문법] public record, int(정수 기본형)
 * [자바/스프링/라이브러리 내장 도구(타입)] String : 자바 표준 문자열 타입임 (이름 변경 불가).
 * [내가 지은 이름]
 * - 대문자 타입명: HospitalTypeDto (응급의료기관 종별 분류 도시락 설계도)
 * - 소문자 변수(상자)명: group("tertiary"|"medical"|"other"), label("상급종합병원" 등 화면 표시명), accent(대표 HEX 색상), priority(정렬 우선순위 숫자)
 * [핵심 원리 & JSON 변환 예시]
 * - 스프링 부트 내장 Jackson 번역기가 이 record의 소문자 변수 이름을 그대로 JSON 키로 변환해 브라우저로 보냄:
 *   new HospitalTypeDto("tertiary", "상급종합병원", "#d34458", 1)
 *   └──> { "group": "tertiary", "label": "상급종합병원", "accent": "#d34458", "priority": 1 }
 */
}
