package com.yonsei119.dto;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 병원 1곳의 기본정보·병상·응급메시지·중증질환 정보를 담는 불변 도시락 그릇 (DTO)
 * - 실행 시점 : 서버 시작 시 미리 생성되지 않으며, 7종 공공데이터 병합 시점에만 생성됨
 * - 데이터 무결성 규칙 :
 *   ㄴ `beds` 값(`"-4"` 초과수용, `"0"` 만실, `""` 미보고)은 숫자로 바꾸지 않고 원문 그대로 보존함
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [Client JS]             [ApiController]           [DataService]               [HospitalDto]
 *            |                         |                        |                           |
 *            |                         |                        |-- 1. new HospitalDto() -->|  7종 병합 원본 객체 생성
 *       +----+-------------------------+------------------------+---------------------------+--------+
 *       | [alt : GET /api/hospitals?compact=true]                                                    |  초기 로딩 · 60초 자동 갱신
 *       |    |-- 2a. GET /hospitals -->|-- 3a. getSnapshot() -->|-- 4a. toCompact() ------->|        |  필수 병상 태그만 추출
 *       |    |<-- 5a. 200 OK ----------|<-- JSON bytes ---------|<-- compactDto ------------|        |  경량 병원 목록 수신
 *       +----+-------------------------+------------------------+---------------------------+--------+
 *       | [else : GET /api/hospitals/{hpid}]                                                         |  개발자 모드 단건 상세 조회
 *       |    |-- 2b. GET /{hpid} ----->|-- 3b. getById(hpid) -->|                           |        |  O(1) 해시맵 단건 조회
 *       |    |<-- 4b. 200 OK ----------|<-- full HospitalDto ---|                           |        |  60개 원시 태그 100% 수신
 *       +----+-------------------------+------------------------+---------------------------+--------+
 *            v                         v                        v                           v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record           : 불변 데이터 클래스 선언 키워드 (생성자 · .id() 등 Getter 자동생성)
 *   ㄴ String           : 문자열을 다루는 표준 내장 클래스
 *   ㄴ double / boolean : 실수 좌표 · 참/거짓을 담는 기본 자료형 키워드
 *   ㄴ Map              : 키-값 쌍을 다루는 표준 내장 인터페이스
 *   ㄴ LinkedHashMap    : 입력 순서를 유지하는 표준 내장 Map 구현 클래스
 *   ㄴ List             : 순서 있는 목록을 다루는 표준 내장 인터페이스
 *   ㄴ Set              : 중복 없는 집합을 다루는 표준 내장 인터페이스
 *   ㄴ Map.copyOf()     : 수정 불가능한 불변 Map을 만드는 표준 내장 정적 메서드
 * - 프로젝트 내부 타입
 *   ㄴ HospitalTypeDto : 병원 종별 분류(상급종합·권역·의료원·기타) 정보를 담는 record
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson         : 응답 시 record의 자동 생성 Getter를 읽어 JSON 문자열로 자동 직렬화
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ EmergencyDataService.java         : mergeDatasetsIntoSnapshot(), storeSnapshotIndexes()
 *   ㄴ EmergencyApiController.java       : getHospitalDetail()
 *   ㄴ NaverDirectionsService.java       : rankHospitalsByDrivingTime()
 *   ㄴ HospitalRecommendationScorer.java : evaluate(), matchesSymptomPreset()
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/search-controls.js : fetchData() (초기 목록 및 실시간 갱신)
 *   ㄴ frontend/js/markers-cluster.js : updateMarkers() (지도 위 병상 카드 표시)
 *   ㄴ frontend/js/hospital-sheet.js  : openHospital(), hydrateHospitalDetailIfNeeded()
 *   ㄴ frontend/js/user-features.js   : resolveUniversityHospitalLogo() (대학로고 매칭)
 * - IntelliJ 추적 단축키
 *   ㄴ Java 호출 계층 보기 : `HospitalDto` 위에서 `Ctrl + Alt + H`
 *   ㄴ 프론트엔드 연결 검색 : `Ctrl + Shift + F`로 `/api/hospitals` 또는 `erTel` 검색
 *
 * [5. 실행 방법 및 JSON 예시]
 * - 호출 예시 : `curl http://localhost:8080/api/hospitals/A2200001`
 * - JSON 출력 예시 :
 *   {
 *     "id": "A2200001",
 *     "name": "연세대학교원주세브란스기독병원",
 *     "erTel": "033-741-1119",
 *     "lat": 37.31912,
 *     "lng": 127.94561,
 *     "regional": true,
 *     "beds": { "hvec": "-2", "hvs01": "30" }
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
     * [역할 및 사용처]
     * - 역할 : 초기 목록(`?compact=true`) 전송 크기를 줄이기 위해 장문 약도 설명(`dutyetc` 등)을 빼고
     *          UI 전광판 필수 병상·연락처·장비·공지·중증질환 키만 추린 경량 복사본을 반환함
     * - 사용처
     *   ㄴ EmergencyDataService.java : `storeSnapshotIndexes()`
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
