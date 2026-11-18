package com.yonsei119.dto;

import java.util.List;
import java.util.Map;
/*
 * [자바 문법]
 * - package : EmergencySnapshotDto.java 파일이 속한 패키지 경로를 선언하는 키워드임 (이름 변경 불가).
 * - import : java.util 패키지의 자바 표준 컬렉션 인터페이스를 가져오는 키워드임 (이름 변경 불가).
 *
 * [패키지명]
 * - com.yonsei119.dto : 전국 응급의료기관 통합 스냅샷 등 컨트롤러가 JSON으로 보내는 DTO 패키지임.
 *
 * [자바 내장 클래스 및 타입]
 * - java.util.List : 순서대로 여러 데이터를 담는 자바 표준 제네릭 목록 인터페이스임 (이름 변경 불가).
 * - java.util.Map : 키와 값을 짝지어 저장하는 자바 표준 제네릭 맵 인터페이스임 (이름 변경 불가).
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
 * [자바 문법 및 record 자동 생성 요소]
 * - public : 다른 패키지에서도 EmergencySnapshotDto 레코드에 접근할 수 있게 열어 주는 제어자임 (이름 변경 불가).
 * - record : 한 번 만들면 값을 바꿀 수 없는(불변) 데이터 전달용 타입 키워드임 (이름 변경 불가).
 * - boolean, int : 참/거짓 논리값과 32비트 정수를 담는 자바 기본형임 (이름 변경 불가).
 * - 생성자 (record 자동 생성) : 11개 필드를 채우는 new EmergencySnapshotDto(...)가 자동 생성됨.
 * - 필드 조회 메서드 (record 자동 생성) : 각 필드명과 같은 조회 메서드가 자동 생성됨.
 *   · 메타·통계: .updatedAt(), .cached(), .totalCount(), .tertiaryCount(), .regionalCount()
 *   · 종별·데이터: .medicalCount(), .traumaCount(), .otherCount(), .sources(), .endpointCounts(), .hospitals()
 * - 공통 표준 메서드 (record 자동 생성) : equals(Object), hashCode(), toString()이 자동 생성됨 (이름 변경 불가).
 *
 * [자바 내장 클래스 및 타입]
 * - String (java.lang.String) : 글자를 저장하는 자바 표준 불변 문자열 클래스임 (이름 변경 불가).
 * - Map<K, V> (java.util.Map) : 키와 값을 짝지어 저장하는 자바 표준 제네릭 맵 인터페이스임 (이름 변경 불가).
 * - List<E> (java.util.List) : 순서대로 값을 담는 자바 표준 제네릭 목록 인터페이스임 (이름 변경 불가).
 * - Boolean, Integer (java.lang) : 제네릭 꺾쇠(<...>) 안에 boolean, int 대신 넣는 래퍼 클래스임 (이름 변경 불가).
 *
 * [프로젝트 내부 타입]
 * - HospitalDto : 같은 com.yonsei119.dto 패키지의 병원 DTO로 hospitals(List<HospitalDto>)의 원소 타입임.
 *
 * [레코드명 및 필드명]
 * - EmergencySnapshotDto : 7대 공공데이터를 병합한 전국 응급의료기관 스냅샷과 통계를 담는 DTO임.
 * - updatedAt : 한국 표준시(Asia/Seoul) 기준 갱신 시각 문자열 (예: "2026-11-17T18:20:00+09:00").
 * - cached : 캐시 재사용 응답 여부 (새로 수집한 직후는 false, 캐시 재사용이면 true).
 * - totalCount : 유효 좌표 검사를 통과해 최종 포함된 전체 응급의료기관 수.
 * - tertiaryCount, regionalCount, medicalCount : 상급종합병원, 권역응급의료센터, 의료원 기관 수.
 * - traumaCount, otherCount : 권역외상센터 데이터가 있는 기관 수 및 일반·기타 기관 수.
 * - sources : 7대 공공데이터별 수신 성공 여부 맵 (list, basic, beds, messages, severe, traumaList, traumaBasic).
 * - endpointCounts : 7대 공공데이터별 원본 수신 건수 맵 (Map<String, Integer>).
 * - hospitals : 교차 병합된 개별 병원 정보(HospitalDto) 목록.
 *
 * [동작 흐름]
 * - 수집 병합 -> 캐시 색인 -> 컨트롤러 -> JSON 변환 -> 프론트 수신 순서로 동작함.
 *   EmergencyDataService.mergeDatasetsIntoSnapshot(...) -> new EmergencySnapshotDto(...) 최초 생성 (cached=false)
 *   ──> refreshCacheSynchronously(...) -> storeSnapshotIndexes(fresh) 호출
 *   ├── cachedSnapshot에 전체 원본 저장, cachedCompactSnapshot에 경량 new EmergencySnapshotDto(...) 저장
 *   └── getSnapshot(...) -> 캐시가 유효하면 asCachedSnapshot(target)으로 cached=true 사본 반환
 *   ──> EmergencyApiController (getHospitals(), rankDirections(), geocode())가 조회·반환
 *   ──> Spring Jackson이 record 조회 메서드를 읽어 객체 -> JSON 문자열 자동 변환
 *   ──> frontend/js/search-controls.js (fetchData())가 fetch('/api/hospitals?...')로 수신
 *   └── applySnapshotToState()로 지도 마커·목록·오프라인 백업(saveOfflineSnapshot)에 반영
 *
 * [실행 방법 및 JSON 예시]
 * - URL 출처 : application.yml(server.port: ${PORT:8080}, 기본 8080) + @RequestMapping("/api") + @GetMapping("/hospitals")
 * - 최종 URL : http://localhost:8080/api/hospitals (refresh, compact 기본값은 모두 false)
 * - 서버 실행 : 프로젝트 루트에서 `.\gradlew.bat bootRun` 실행.
 * - 경량 조회 : `curl "http://localhost:8080/api/hospitals?compact=true"`
 * - 강제 갱신 : `curl "http://localhost:8080/api/hospitals?refresh=true&compact=true"`
 * - 전체 조회 : `curl "http://localhost:8080/api/hospitals"` (브라우저 접속도 가능함)
 * - JSON 출력 예시 :
 *   {
 *     "updatedAt": "2026-11-17T18:20:00+09:00",
 *     "cached": true,
 *     "totalCount": 531,
 *     "tertiaryCount": 47,
 *     "regionalCount": 44,
 *     "medicalCount": 35,
 *     "traumaCount": 17,
 *     "otherCount": 449,
 *     "sources": {
 *       "list": true, "basic": true, "beds": true, "messages": true,
 *       "severe": true, "traumaList": true, "traumaBasic": true
 *     },
 *     "endpointCounts": {
 *       "list": 531, "basic": 531, "beds": 531, "messages": 120,
 *       "severe": 531, "traumaList": 17, "traumaBasic": 17
 *     },
 *     "hospitals": [
 *       {
 *         "id": "A2200001",
 *         "name": "연세대학교원주세브란스기독병원",
 *         "regional": true,
 *         "type": { "group": "tertiary", "label": "상급종합병원", "accent": "#d34458", "priority": 1 }
 *       }
 *     ]
 *   }
 */
}
