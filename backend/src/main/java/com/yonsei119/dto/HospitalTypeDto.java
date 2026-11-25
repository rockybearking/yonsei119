package com.yonsei119.dto;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 응급의료기관의 종별 그룹(`tertiary` | `medical` | `other`), 한글명,
 *          강조 색상, 표시 우선순위를 담는 불변 이름표 그릇 (DTO)
 * - 실행 시점 : `HospitalClassifier` 클래스 로딩 시 3개 정적 상수로 딱 1번 생성되어 재사용됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [HospitalClassifier]          [HospitalTypeDto]      [HospitalDto]                 [Client JS]
 *              |                           |                    |                            |
 *              |-- 1. new TypeDto(...) --->|                    |                            |  3대 종별 상수 최초 1회 생성
 *              |-- 2. classify() result ---|------------------->|                            |  병원별 판정 등급 주입
 *              |                           |                    |-- 3. JSON hospital.type -->|  배지 색상 · 종별 필터 반영
 *              v                           v                    v                            v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record : 불변 데이터 클래스 선언 키워드 (생성자 · `.group()`, `.label()` 등 자동생성)
 *   ㄴ String : 그룹 코드 · 한글 라벨 · 색상 HEX 문자열을 담는 표준 내장 클래스
 *   ㄴ int    : 정렬 우선순위(1~3)를 담는 정수 기본형 키워드
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson: `HospitalDto.type` 직렬화 시 JSON 객체로 자동 변환
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ HospitalClassifier.java : `TYPE_TERTIARY`, `TYPE_MEDICAL`, `TYPE_OTHER` 상수 정의
 *   ㄴ HospitalDto.java        : `type` 구성 필드
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/markers-cluster.js : 종별 체크박스 필터링 · 카드 배지 표시
 *   ㄴ frontend/js/hospital-sheet.js  : 상세 시트 상단 종별 배지 렌더링
 *   ㄴ frontend/js/user-features.js   : 의료원(`group === 'medical'`) 대학로고 제외 판정
 */
public record HospitalTypeDto(
        String group,
        String label,
        String accent,
        int priority
) {
}
