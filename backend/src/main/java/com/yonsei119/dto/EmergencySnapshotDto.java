package com.yonsei119.dto;

import java.util.List;
import java.util.Map;

/*
 * [역할 및 실행 시점]
 * - 역할: 7대 공공데이터를 합친 전국 응급의료기관 전체 목록과 종별 통계를 한 번에 포장해 전달하는 대형 세트 도시락 DTO
 * - 실행 시점: `EmergencyDataService.mergeDatasetsIntoSnapshot()` 및 `storeSnapshotIndexes()` 실행 시 생성되어 메모리에 상주함
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   EmergencyDataService.mergeDatasetsIntoSnapshot() ──> 원본 EmergencySnapshotDto 생성
 *   ──> storeSnapshotIndexes() ──> 경량판(`cachedCompactSnapshot`) + 사전 직렬화 JSON 바이트 + ETag 생성
 *   ──> EmergencyApiController.getHospitalsHttp() (`/api/hospitals?compact=true`)
 *   ──> frontend/js/search-controls.js의 `fetchData()` 수신 ──> `applySnapshotToState()`로 지도 마커·검색 목록·오프라인 백업 갱신
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 11개 불변 필드와 생성자, `.updatedAt()`, `.hospitals()` 등 자동 Getter를 컴파일러가 자동 생성함
 * - Java 표준 내장 타입: `String`, `Map<K, V>`, `List<E>`, `Boolean`, `Integer`
 *
 * [프론트엔드 연결 및 IDE 추적 가이드]
 * - 프론트엔드 사용처: `frontend/js/search-controls.js` (`data.hospitals`, `data.sources`, `data.updatedAt` 참조)
 * - Java 호출 추적: `Ctrl + Alt + H` | 프론트엔드 검색: `Ctrl + Shift + F`로 `/api/hospitals` 또는 `endpointCounts` 검색
 *
 * [실행 방법 및 JSON 예시]
 * - 경량 조회: `curl "http://localhost:8080/api/hospitals?compact=true"`
 * - 강제 갱신: `curl "http://localhost:8080/api/hospitals?refresh=true&compact=true"`
 * - JSON 출력 예시:
 *   {
 *     "updatedAt": "2026-11-25T19:40:00+09:00",
 *     "cached": true,
 *     "totalCount": 530,
 *     "tertiaryCount": 47,
 *     "regionalCount": 44,
 *     "medicalCount": 35,
 *     "traumaCount": 21,
 *     "otherCount": 448,
 *     "sources": { "list": true, "basic": true, "beds": true, "messages": true, "severe": true, "traumaList": true, "traumaBasic": true },
 *     "endpointCounts": { "list": 530, "basic": 530, "beds": 415, "messages": 751, "severe": 439, "traumaList": 21, "traumaBasic": 21 },
 *     "hospitals": [{ "id": "A2200001", "name": "연세대학교원주세브란스기독병원", "regional": true }]
 *   }
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
}
