package com.yonsei119.dto;

import java.util.List;
import java.util.Map;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 7대 공공데이터를 합친 전국 응급의료기관 전체 목록과 종별 통계를
 *          한 번에 포장해 전달하는 대형 세트 도시락 그릇 (DTO)
 * - 실행 시점 : `EmergencyDataService`가 초기 워밍업 또는 60초 자동 갱신을 마칠 때 생성됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [EmergencyDataService]        [EmergencySnapshotDto]      [ApiController]           [search-controls.js]
 *               |                             |                       |                            |
 *               |-- 1. new SnapshotDto() ---->|                       |                            |  전국 병원 목록 · 통계 포장
 *               |-- 2. pre-serialize + ETag   |                       |                            |  UTF-8 바이트 · SHA-256 생성
 *               |                             |                       |<-- 3. GET /api/hospitals --|  경량 목록 스냅샷 요청
 *               |<-- 4. getSerialized() ------|-----------------------|                            |  사전 직렬화 패키지 조회
 *               |-- bytes + ETag -------------|---------------------->|-- 5. 200 OK / 304 -------->|  즉시 응답 및 지도 마커 갱신
 *               v                             v                       v                            v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record          : 11개 불변 필드 · 생성자 · `.hospitals()` 등 Getter 자동생성 키워드
 *   ㄴ String          : 갱신 시각(ISO-8601 KST) 문자열을 담는 표준 내장 클래스
 *   ㄴ boolean / int   : 캐시 적중 여부 · 기관 수 통계를 담는 기본형 키워드
 *   ㄴ Map             : 엔드포인트별 수집 성공 여부 · 건수를 담는 표준 내장 인터페이스
 *   ㄴ Boolean/Integer : 제네릭 Map 값 타입으로 쓰이는 표준 내장 래퍼 클래스
 *   ㄴ List            : 전체 `HospitalDto` 목록을 담는 표준 내장 인터페이스
 * - 프로젝트 내부 타입
 *   ㄴ HospitalDto    : 개별 병원 상세 정보를 담는 record
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson        : `JsonMapper.writeValueAsBytes()` 호출 시 UTF-8 JSON으로 직렬화
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ EmergencyDataService.java   : `mergeDatasetsIntoSnapshot()`, `storeSnapshotIndexes()`
 *   ㄴ EmergencyApiController.java : `getHospitalsHttp()`, `getHospitals()`, `rankDirections()`
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/search-controls.js : `fetchData()`, `applySnapshotToState()`
 * - IntelliJ 추적 단축키
 *   ㄴ 호출 계층 보기 : `EmergencySnapshotDto` 위에서 `Ctrl + Alt + H`
 *   ㄴ 연결 문자열 검색 : `Ctrl + Shift + F`로 `endpointCounts` 또는 `/api/hospitals` 검색
 *
 * [5. 실행 방법 및 JSON 예시]
 * - 호출 예시 : `curl "http://localhost:8080/api/hospitals?compact=true"`
 * - JSON 출력 예시 :
 *   {
 *     "updatedAt": "2026-11-25T22:30:00+09:00",
 *     "cached": true,
 *     "totalCount": 530,
 *     "tertiaryCount": 47,
 *     "regionalCount": 44,
 *     "hospitals": [{ "id": "A2200001", "name": "연세대학교원주세브란스기독병원" }]
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
