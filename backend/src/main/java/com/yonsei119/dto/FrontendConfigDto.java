package com.yonsei119.dto;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 프론트엔드 지도 구동에 필요한 공개 설정값 5개만 골라 전달하는 웰컴 카드 DTO
 *          (서버 전용 비밀키 `clientSecret` 유출을 구조적으로 원천 차단함)
 * - 실행 시점 : 브라우저가 `GET /api/config`를 요청할 때만 생성됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [search-controls.js]      [EmergencyApiController]             [FrontendConfigDto]
 *              |                           |                                 |
 *              |-- 1. GET /api/config ---->|                                 |  초기 공개 설정 요청
 *              |                           |-- 2. new FrontendConfigDto() -->|  공개 키 · 기본 출발지 매핑
 *              |                           |<-- 3. configDto ----------------|  불변 설정 객체 생성 완료
 *              |<-- 4. 200 OK (JSON) ------|                                 |  지도 SDK 키 · 출발지 반영
 *              v                           v                                 v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record : 불변 데이터 클래스 선언 키워드 (5개 인자 생성자 · Getter 자동생성)
 *   ㄴ String : 공개 Client ID · 다크 스타일 ID · 출발지 이름을 담는 표준 내장 클래스
 *   ㄴ double : 기본 출발 위도 · 경도 실수를 담는 기본형 키워드
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson: 자동 생성된 Getter를 읽어 JSON 텍스트로 변환
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ EmergencyApiController.java : `getConfig()`
 *   ㄴ Yonsei119BackendTests.java  : Test 8 시크릿 미노출 검증
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/search-controls.js : `syncFrontendConfig()`
 * - 실행 예시 : `curl http://localhost:8080/api/config`
 */
public record FrontendConfigDto(
        String naverClientId,
        String naverDarkStyleId,
        double defaultLat,
        double defaultLng,
        String defaultLabel
) {
}
