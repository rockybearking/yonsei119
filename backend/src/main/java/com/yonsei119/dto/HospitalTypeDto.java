package com.yonsei119.dto;

/*
 * [역할 및 실행 시점]
 * - 역할: 응급의료기관의 종별 그룹(`tertiary` | `medical` | `other`), 한글 이름, 대표 색상, 우선순위를 담는 이름표 DTO
 * - 실행 시점: `HospitalClassifier` 클래스가 로딩될 때 3개 정적 상수(`TYPE_TERTIARY`, `TYPE_MEDICAL`, `TYPE_OTHER`)로 미리 생성되어 모든 병원이 공유함
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   HospitalClassifier 정적 상수 ──> `HospitalClassifier.classify()` 반환 ──> `HospitalDto.type` 필드에 저장
 *   ──> `/api/hospitals` JSON 내 `hospital.type` 객체로 직렬화
 *   ──> 프론트엔드 `markers-cluster.js`, `hospital-sheet.js`, `user-features.js`에서 종별 색상·필터·배지 표시에 사용
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 4개 인자 생성자와 `.group()`, `.label()`, `.accent()`, `.priority()` 자동 Getter 생성
 *
 * [사용처 및 IDE 추적 가이드]
 * - 생성처: `HospitalClassifier.java` | 프론트엔드 참조: `hospital.type.group`, `hospital.type.label`
 */
public record HospitalTypeDto(
        String group,
        String label,
        String accent,
        int priority
) {
}
