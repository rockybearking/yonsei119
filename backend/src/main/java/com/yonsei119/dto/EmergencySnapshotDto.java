package com.yonsei119.dto;

import java.util.List;
import java.util.Map;
/*
 * [자바 문법] package, import : 전국 응급의료기관 통합 스냅샷 응답 그릇 패키지 선언 및 표준 컬렉션 불러오기임.
 * [자바/스프링/라이브러리 내장 도구(타입)] List, Map (이름 변경 불가)
 */

public record EmergencySnapshotDto(
        String updatedAt,
        boolean cached,
        int totalCount,
        int tertiaryCount,
        int regionalCount,
        int medicalCount,
        int traumaCount,
        int otherCount,
        Map<String, Boolean> sources,
        Map<String, Integer> endpointCounts,
        List<HospitalDto> hospitals
) {
/*
 * [자바 문법] public record, boolean, int
 * [자바/스프링/라이브러리 내장 도구(타입)] String, Map<String, Boolean>, Map<String, Integer>, List<HospitalDto>
 *   (참고: 제네릭 <...> 안에는 기본형 boolean, int 대신 대문자 래퍼 타입 Boolean, Integer를 써야 하는 것이 자바 문법 규칙임)
 * [내가 지은 이름]
 * - 대문자 타입명: EmergencySnapshotDto, HospitalDto
 * - 소문자 필드명: updatedAt(KST 갱신시각), cached(캐시 히트 여부), totalCount(전체 기관수), tertiaryCount(상급종합수),
 *   regionalCount(권역응급수), medicalCount(의료원수), traumaCount(권역외상수), otherCount(일반기타수),
 *   sources(7대 API별 성공 여부), endpointCounts(7대 API별 수신 건수), hospitals(전국 병원 배열)
 * [최종 변환 JSON 구조 예시]
 *   GET /api/hospitals
 *   └──> {
 *          "updatedAt": "2026-11-17T18:20:00+09:00",
 *          "cached": true,
 *          "totalCount": 531,
 *          "sources": { "list": true, "beds": true, "messages": true, ... },
 *          "hospitals": [ { "id": "A2200001", "name": "연세대학교원주세브란스기독병원", ... }, ... ]
 *        }
 */
}
