package com.yonsei119.dto;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
/*
 * [자바 문법]
 * - package : HospitalDto.java 파일이 속한 패키지 경로를 선언하는 키워드임 (이름 변경 불가).
 * - import : java.util 패키지의 자바 표준 컬렉션 클래스·인터페이스를 가져오는 키워드임 (이름 변경 불가).
 *
 * [패키지명]
 * - com.yonsei119.dto : 단일 응급의료기관 통합 정보와 경량 요약 DTO를 담는 패키지임.
 *
 * [자바 내장 클래스 및 타입]
 * - java.util.LinkedHashMap : 넣은 순서를 그대로 유지하는 자바 표준 해시 맵 클래스임 (이름 변경 불가).
 * - java.util.List : 순서대로 데이터를 담는 자바 표준 목록 인터페이스임 (이름 변경 불가).
 * - java.util.Map : 키와 값을 짝지어 저장하는 자바 표준 맵 인터페이스임 (이름 변경 불가).
 * - java.util.Set : 중복 없이 값을 모으는 자바 표준 집합 인터페이스임 (이름 변경 불가).
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
 * [자바 문법 및 record 자동 생성 요소]
 * - public : 다른 패키지에서도 HospitalDto 레코드를 쓸 수 있게 열어 주는 제어자임 (이름 변경 불가).
 * - record : 한 번 만들면 값을 바꿀 수 없는(불변) 데이터 전달용 타입 키워드임 (이름 변경 불가).
 * - double, boolean : 소수점 실수와 참/거짓 논리값을 담는 자바 기본형임 (이름 변경 불가).
 * - 생성자 (record 자동 생성) : 14개 필드를 채우는 new HospitalDto(...)가 자동 생성됨.
 * - 필드 조회 메서드 (record 자동 생성) : 각 필드명과 같은 조회 메서드가 자동 생성됨.
 *   · 기본·위치: .id(), .name(), .address(), .tel(), .erTel(), .lat(), .lng(), .regional()
 *   · 분류·상세: .type(), .basic(), .trauma(), .beds(), .messages(), .severe()
 * - 공통 표준 메서드 (record 자동 생성) : equals(Object), hashCode(), toString()이 자동 생성됨 (이름 변경 불가).
 *
 * [자바 내장 클래스 및 타입]
 * - String (java.lang.String) : 글자를 저장하는 자바 표준 불변 문자열 클래스임 (이름 변경 불가).
 * - Map<K, V> (java.util.Map) : 키와 값을 짝지어 저장하는 자바 표준 제네릭 맵 인터페이스임 (이름 변경 불가).
 * - List<E> (java.util.List) : 순서대로 값을 담는 자바 표준 제네릭 목록 인터페이스임 (이름 변경 불가).
 *
 * [프로젝트 내부 타입]
 * - HospitalTypeDto : 같은 com.yonsei119.dto 패키지의 종별 분류 DTO로 type 필드의 타입임.
 *
 * [레코드명 및 필드명]
 * - HospitalDto : 7대 공공데이터를 기관코드(hpid) 기준으로 병합한 단일 병원 통합 DTO임.
 * - id, name, address : 기관 고유코드(HPID, 예: "A2200001"), 병원명, 도로명·소재지 주소.
 * - tel, erTel : 기관 대표 전화번호(dutytel1)와 응급실 직통 전화번호(dutytel3).
 * - lat, lng, regional, type : WGS84 위도·경도, 권역응급의료센터 여부, 종별 분류 정보(HospitalTypeDto).
 * - basic : 기관 기본정보 맵 (상세 조회는 60여 개 전체, 경량 조회는 핵심 4개 키만 유지).
 * - trauma : 권역외상센터 정보 맵 (미지정 기관은 null, 경량 조회는 {"designated":"Y"}만 유지).
 * - beds : 실시간 가용·기준 병상 및 의료 장비 상태 맵 (예: "hvec", "hvs01", "hv28").
 * - messages : 실시간 응급실·중증질환 진료 공지 목록 (List<Map<String, String>>).
 * - severe : 28대 중증응급질환 수용 가능 여부(mkioskty1~28) 맵 (Map<String, String>).
 *
 * [응급의료 도메인 데이터 무결성 규칙]
 * - beds의 병상 값(예: hvec="-4", hv28="")은 int로 바꾸지 않고 String 원본 그대로 보존함.
 * - "-4"는 정원 초과 수용, "0"은 잔여 병상 0석 만실, ""는 미운영·미보고이므로 빈 값을 "0"으로 바꾸지 않음.
 *
 * [동작 흐름]
 * - 병합 생성 -> 캐시·경량화 -> 컨트롤러 -> JSON 변환 -> 프론트 수신 순서로 동작함.
 *   EmergencyDataService.mergeDatasetsIntoSnapshot(...) -> new HospitalDto(...) 최초 생성
 *   ├── storeSnapshotIndexes(...) -> cachedHospitalById 색인 + toCompactSummary(...)로 경량 목록 생성
 *   └── EmergencyApiController (getHospitals() 목록, getHospitalDetail() 단건)가 조회·반환
 *   ──> Spring Jackson이 record 조회 메서드를 읽어 객체 -> JSON 문자열 자동 변환
 *   ├── 초기 목록: frontend/js/search-controls.js (fetchData())가 /api/hospitals?compact=true 수신
 *   └── 단건 상세: frontend/js/hospital-sheet.js (hydrateHospitalDetailIfNeeded())가 /api/hospitals/{id} 수신
 *
 * [실행 방법 및 JSON 예시]
 * - URL 출처 : application.yml(server.port: ${PORT:8080}, 기본 8080) + @RequestMapping("/api")
 *   · 목록 조회 : @GetMapping("/hospitals") -> http://localhost:8080/api/hospitals?compact=true
 *   · 단건 상세 : @GetMapping("/hospitals/{hpid}") -> http://localhost:8080/api/hospitals/A2200001
 * - 단건 예외 : hpid 형식 오류 시 HTTP 400, 없는 기관 코드면 HTTP 404 반환.
 * - 서버 실행 : 프로젝트 루트에서 `.\gradlew.bat bootRun` 실행.
 * - 호출 예시 : `curl "http://localhost:8080/api/hospitals/A2200001"` 또는 브라우저 직접 접속.
 * - JSON 출력 예시 (단건 상세 기준) :
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
 *     "basic": { "dutyemclsname": "권역응급의료센터", "dutydivnam": "종합병원" },
 *     "trauma": { "dutyemclsname": "권역외상센터" },
 *     "beds": { "hvec": "-2", "hvs01": "30" },
 *     "messages": [{ "symblkmsg": "소아응급 진료 가능", "symblkmsgtyp": "응급" }],
 *     "severe": { "mkioskty1": "Y", "mkioskty28": "Y" }
 *   }
 */

    public HospitalDto toCompactSummary(Set<String> allowedBedKeys) {
    /*
     * [자바 문법]
     * - public : 외부 서비스 클래스에서 toCompactSummary(...)를 호출할 수 있게 열어 주는 제어자임 (이름 변경 불가).
     * - 반환 타입 : 원본 HospitalDto 객체를 바꾸지 않고 크기를 줄인 새 불변 HospitalDto 객체를 반환함.
     *
     * [자바 내장 클래스 및 타입]
     * - Set<E> (java.util.Set) : 중복을 허용하지 않고 값을 모으는 자바 표준 제네릭 집합 인터페이스임 (이름 변경 불가).
     * - String (java.lang.String) : 글자를 저장하는 자바 표준 문자열 클래스임 (이름 변경 불가).
     *
     * [프로젝트 내부 메서드 및 매개변수]
     * - toCompactSummary : ?compact=true 응답 크기를 줄이기 위해 대용량 필드를 추려 경량 사본을 만드는 메서드임.
     * - allowedBedKeys : 화면 병상·장비 표에서 실제로 쓰는 키만 담은 화이트리스트 집합 매개변수임.
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
         * [자바 문법 및 처리 요약]
         * - 삼항 연산자(조건 ? 참값 : 거짓값) : basic·trauma 존재 여부에 따라 축약 맵을 바로 결정함.
         * - compactBasic : basic이 null이거나 비었으면 Map.of(), 값이 있으면 4개 핵심 키만 추출해 대입함.
         * - compactTrauma : trauma가 비어 있지 않으면 {"designated":"Y"} 표식 맵을, 없으면 null을 대입함.
         * - compactBeds 분기 : beds가 null이면 null을 유지하고, 허용 키 집합이 비었으면 beds 원본을 그대로 씀.
         * - for 반복문 필터링 : 허용 키 집합이 있으면 포함된 키만 filtered에 담은 뒤 Map.copyOf()로 불변 고정함.
         * - return new HospitalDto(...) : 나머지 11개 필드는 유지하고 basic·trauma·beds만 축약값으로 바꿔 반환함.
         *
         * [자바 내장 클래스 및 메서드]
         * - Map.of(...), List.of(...) : 수정할 수 없는 빈 맵·고정 맵·고정 목록을 만드는 자바 표준 메서드임 (이름 변경 불가).
         * - Map.isEmpty(), Set.isEmpty() : 컬렉션이 비어 있으면 true를 반환하는 자바 표준 메서드임 (이름 변경 불가).
         * - new LinkedHashMap<>() : 넣은 순서를 유지하는 자바 표준 가변 맵 생성자임 (이름 변경 불가).
         * - Map.entrySet(), Map.Entry.getKey(), Map.Entry.getValue() : 맵의 키-값 쌍을 하나씩 순회하는 표준 메서드임.
         * - Set.contains(Object) : 집합 안에 특정 키가 들어 있는지 검사하는 자바 표준 메서드임 (이름 변경 불가).
         * - Map.put(K, V) : 가변 맵에 키-값 한 쌍을 추가하는 자바 표준 메서드임 (이름 변경 불가).
         * - Map.copyOf(Map) : 가변 맵을 읽기 전용 불변 맵으로 복사하는 자바 표준 메서드임 (이름 변경 불가).
         *
         * [프로젝트 내부 메서드 및 지역 변수]
         * - extractNonEmptyKeys(...) : basic에서 핵심 4개 키의 비공백 값만 추려 오는 내부 보조 메서드임.
         * - compactBasic, compactTrauma, compactBeds : 각각 축약된 기본정보, 외상 표식, 필터링된 병상 맵 변수임.
         * - filtered, entry : 허용 키만 임시로 담는 LinkedHashMap과 반복 중인 키-값 쌍 변수임.
         *
         * [동작 흐름]
         * - 전체 스냅샷 색인 -> 경량 변환 -> 모바일 응답 크기 절감 순서로 동작함.
         *   EmergencyDataService.storeSnapshotIndexes(fullSnapshot) -> hospital.toCompactSummary(ESSENTIAL_UI_BED_KEYS) 호출
         *   ├── basic(60여 개 -> 4개), trauma({"designated":"Y"}), beds(허용 키만 보존) 축약
         *   └── new HospitalDto(...) 반환 -> cachedCompactSnapshot 저장 -> GET /api/hospitals?compact=true 응답 크기 절감
         */
    }

    private static Map<String, String> extractNonEmptyKeys(Map<String, String> source, List<String> keys) {
    /*
     * [자바 문법]
     * - private static : HospitalDto 레코드 내부에서만 인스턴스 없이 호출하는 정적 보조 메서드 선언임 (이름 변경 불가).
     * - 반환 타입 : 골라낸 키-값 쌍만 담은 불변 문자열 맵을 반환함.
     *
     * [자바 내장 클래스 및 타입]
     * - Map<K, V> (java.util.Map) : 키와 값을 짝지어 저장하는 자바 표준 맵 인터페이스임 (이름 변경 불가).
     * - List<E> (java.util.List) : 순서대로 값을 담는 자바 표준 목록 인터페이스임 (이름 변경 불가).
     * - String (java.lang.String) : 글자를 저장하는 자바 표준 문자열 클래스임 (이름 변경 불가).
     *
     * [프로젝트 내부 메서드 및 매개변수]
     * - extractNonEmptyKeys : 원본 맵에서 지정된 키 목록 중 비공백 유효 값만 뽑아내는 내부 메서드임.
     * - source, keys : 값을 찾을 원본 맵(basic)과 추출 순서를 정한 키 문자열 목록임.
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
         * [자바 문법 및 처리 요약]
         * - picked 생성 : keys 순서를 그대로 유지하도록 new LinkedHashMap<>()으로 가변 맵을 만듦.
         * - for (String key : keys) : 키 목록을 순서대로 돌며 source.get(key)로 값을 조회함.
         * - if (val != null && !val.isBlank()) : null이 아니고 공백만 있는 문자열이 아닐 때만 picked에 넣음.
         * - return Map.copyOf(picked) : 모아 둔 항목을 수정 불가 불변 맵으로 복사해 반환함.
         *
         * [자바 내장 클래스 및 메서드]
         * - new LinkedHashMap<>() : 넣은 순서를 유지하는 자바 표준 가변 맵 생성자임 (이름 변경 불가).
         * - Map.get(Object) : 맵에서 키에 해당하는 값을 꺼내는 자바 표준 메서드임 (이름 변경 불가).
         * - String.isBlank() : 빈 문자열("")이나 공백 문자만 있으면 true를 반환하는 자바 표준 메서드임.
         * - Map.put(K, V) : 가변 맵에 키-값 쌍을 저장하는 자바 표준 메서드임 (이름 변경 불가).
         * - Map.copyOf(Map) : 가변 맵을 읽기 전용 불변 맵으로 복사하는 자바 표준 메서드임 (이름 변경 불가).
         *
         * [지역 변수명]
         * - picked, key, val : 유효 항목을 담는 임시 맵, 현재 검사 중인 키, 조회한 문자열 값 변수임.
         *
         * [동작 흐름]
         * - toCompactSummary(...) -> extractNonEmptyKeys(basic, 4개 키) 호출
         *   ──> keys 순서대로 source.get(key) 조회 -> 비공백 값만 picked.put(key, val) 저장
         *   ──> Map.copyOf(picked) 불변 맵을 compactBasic으로 반환
         */
    }
}
