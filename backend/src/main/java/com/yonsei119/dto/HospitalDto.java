package com.yonsei119.dto;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
/*
 * [자바 문법] package, import : 단일 응급의료기관의 통합 도메인 데이터를 담는 DTO 패키지와 표준 컬렉션 도구를 불러옴.
 * [자바/스프링/라이브러리 내장 도구(타입)] List, Map, Set, LinkedHashMap : 순서 있는 목록·키-값 사전·중복 없는 집합 내장 타입임 (이름 변경 불가).
 */

public record HospitalDto(
        String id,
        String name,
        String address,
        String tel,
        String erTel,
        double lat,
        double lng,
        boolean regional,
        HospitalTypeDto type,
        Map<String, String> basic,
        Map<String, String> trauma,
        Map<String, String> beds,
        List<Map<String, String>> messages,
        Map<String, String> severe
) {
/*
 * [자바 문법] public record, double(실수형), boolean(논리형)
 * [자바/스프링/라이브러리 내장 도구(타입)] String, Map<String, String>, List<Map<String, String>> (이름 변경 불가)
 * [내가 지은 이름]
 * - 대문자 타입명: HospitalDto, HospitalTypeDto
 * - 소문자 필드명: id(기관코드 HPID), name(병원명), address(주소), tel(대표전화), erTel(응급실 직통전화), lat(위도), lng(경도),
 *   regional(권역응급 여부), type(종별 객체), basic(기본정보 맵), trauma(외상센터 맵), beds(실시간 병상 맵), messages(긴급공지 리스트), severe(28대 중증질환 맵)
 * [핵심 도메인 규칙 (절대 변경 주의)]
 * - beds 맵 안의 병상 값(예: hvec="-4", hv28="")은 int 숫자로 바꾸지 않고 String 원본 그대로 보관함.
 *   ├── "-4" : 정원보다 4명을 더 수용 중인 '초과수용(포화)' 현장 지표
 *   ├── "0"  : 잔여 병상 0석 '만실'
 *   └── ""   : 해당 병상 미운영 또는 '미보고(-)' (절대 "0"으로 왜곡 금지)
 */

    public HospitalDto toCompactSummary(Set<String> allowedBedKeys) {
    /*
     * [자바 문법] public HospitalDto : 초기 목록 조회(?compact=true) 시 불필요한 대용량 원문(basic 60여 개 태그 등)을 덜어낸 경량 복제본을 반환하는 메서드임.
     * [자바/스프링/라이브러리 내장 도구(타입)] Set<String> (이름 변경 불가)
     * [내가 지은 이름] toCompactSummary(함수명), allowedBedKeys(화면 매트릭스 렌더링에 실제 쓰이는 병상·장비 키 집합)
     */
        Map<String, String> compactBasic = basic == null || basic.isEmpty()
                ? Map.of()
                : extractNonEmptyKeys(basic, List.of("dutyemclsname", "dutydivnam", "dgididname", "dutyeryn"));

        Map<String, String> compactTrauma = (trauma != null && !trauma.isEmpty())
                ? Map.of("designated", "Y")
                : null;

        Map<String, String> compactBeds = null;
        if (beds != null) {
            if (allowedBedKeys == null || allowedBedKeys.isEmpty()) {
                compactBeds = beds;
            } else {
                Map<String, String> filtered = new LinkedHashMap<>();
                for (Map.Entry<String, String> entry : beds.entrySet()) {
                    if (allowedBedKeys.contains(entry.getKey())) {
                        filtered.put(entry.getKey(), entry.getValue());
                    }
                }
                compactBeds = Map.copyOf(filtered);
            }
        }

        return new HospitalDto(
                id, name, address, tel, erTel, lat, lng, regional, type,
                compactBasic, compactTrauma, compactBeds, messages, severe
        );
        /*
         * [스프링/자바 내장 함수] Map.of(...), Map.copyOf(...) : 수정 불가능한 안전한 불변 맵을 생성함 (이름 변경 불가).
         * [경량화 전·후 데이터 비교 예시]
         * - 전체 상세 조회 (GET /api/hospitals/A2200001): basic(진료시간표·약도설명 등 65개 원본 키 전체 포함) -> 개발자 모드 100% 대조용
         * - 초기 목록 조회 (GET /api/hospitals?compact=true): 지도·증상필터·병상보드 필수 필드만 유지 -> 모바일 초기 JSON 용량 대폭 절감
         */
    }

    private static Map<String, String> extractNonEmptyKeys(Map<String, String> source, List<String> keys) {
    /*
     * [자바 문법] private static : 이 레코드 내부에서만 쓰는 키 선별 보조 함수임.
     * [내가 지은 이름] extractNonEmptyKeys, source, keys
     */
        Map<String, String> picked = new LinkedHashMap<>();
        for (String key : keys) {
            String val = source.get(key);
            if (val != null && !val.isBlank()) {
                picked.put(key, val);
            }
        }
        return Map.copyOf(picked);
        /*
         * [스프링/자바 내장 함수] val.isBlank(), Map.copyOf(...) (이름 변경 불가)
         */
    }
}
