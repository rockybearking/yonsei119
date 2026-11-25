package com.yonsei119.dto;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/*
 * [역할 및 실행 시점]
 * - 역할: 응급의료기관 1곳의 기본정보·권역외상·실시간 병상·응급메시지·28대 중증질환 정보를 하나로 묶은 병원 종합 차트 DTO
 * - 실행 시점: `EmergencyDataService.mergeDatasetsIntoSnapshot()` 병합 시 병원마다 1개씩 생성되며,
 *             초기 목록용 경량 사본은 `toCompactSummary()`를 통해 함께 만들어짐
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   7종 공공데이터 병합 ──> new HospitalDto(...) 원본 생성 (`cachedHospitalById` 보관)
 *   ├── 단건 상세 (`GET /api/hospitals/{hpid}`) ──> 원본 100% 그대로 반환 (`hospital-sheet.js:hydrateHospitalDetailIfNeeded`)
 *   └── 초기 목록 (`GET /api/hospitals?compact=true`) ──> `toCompactSummary(ESSENTIAL_UI_BED_KEYS)` 경량본 반환 (`search-controls.js:fetchData`)
 * - 응급의료 데이터 무결성 규칙:
 *   · `beds`의 값(예: `hvec="-4"`, `hv28=""`)은 숫자로 강제 변환하지 않고 원본 문자열 그대로 보존함!
 *     (`"-4"` = 정원 초과수용, `"0"` = 만실, `""` = 미운영·미보고)
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 14개 불변 필드와 생성자, `.id()`, `.beds()`, `.messages()`, `.severe()` 등 자동 Getter 생성
 * - Java 표준 내장: `Map`, `LinkedHashMap`, `List`, `Set`, `Map.copyOf`
 *
 * [프론트엔드 연결 및 IDE 추적 가이드]
 * - 프론트엔드 사용처: `markers-cluster.js`(지도 카드·병상 신호등), `hospital-sheet.js`(상세 시트 전광판), `user-features.js`(대학교 로고 매칭)
 * - Java 호출 추적: `Ctrl + Alt + H` | 프론트엔드 검색: `Ctrl + Shift + F`로 `/api/hospitals/` 검색
 *
 * [실행 방법 및 JSON 예시]
 * - 호출 예시: `curl http://localhost:8080/api/hospitals/A2200001`
 * - JSON 출력 예시:
 *   {
 *     "id": "A2200001",
 *     "name": "연세대학교원주세브란스기독병원",
 *     "address": "강원특별자치도 원주시 일산로 20",
 *     "tel": "033-741-0114",
 *     "erTel": "033-741-1119",
 *     "lat": 37.31912,
 *     "lng": 127.94561,
 *     "regional": true,
 *     "type": { "group": "tertiary", "label": "상급종합병원", "accent": "#d34458", "priority": 1 },
 *     "basic": { "dutyemclsname": "권역응급의료센터" },
 *     "trauma": { "dutyemclsname": "권역외상센터" },
 *     "beds": { "hvec": "-2", "hvs01": "30" },
 *     "messages": [{ "symblkmsg": "소아응급 진료 가능", "symblkmsgtyp": "응급" }],
 *     "severe": { "mkioskty1": "Y", "mkioskty28": "Y" }
 *   }
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
     * [역할 및 데이터 흐름]
     * - 역할: 초기 전체 병원 목록(`?compact=true`)의 전송 용량을 줄이기 위해 장문 약도 설명(`dutyetc` 등)을 빼고
     *         화면 UI에서 즉시 쓰는 핵심 병상·장비·공지·중증질환 필드만 남긴 경량 사본을 생성함
     * - 사용처: EmergencyDataService.storeSnapshotIndexes()
     */
    public HospitalDto toCompactSummary(Set<String> allowedBedKeys) {
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
    }

    private static Map<String, String> extractNonEmptyKeys(Map<String, String> source, List<String> keys) {
        Map<String, String> picked = new LinkedHashMap<>();
        for (String key : keys) {
            String val = source.get(key);
            if (val != null && !val.isBlank()) {
                picked.put(key, val);
            }
        }
        return Map.copyOf(picked);
    }
}
