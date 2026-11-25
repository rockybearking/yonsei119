package com.yonsei119.dto;

/*
 * [역할 및 실행 시점]
 * - 역할: 프론트엔드가 지도를 띄울 때 필요한 공개 설정값 5개만 골라 담아 주는 웰컴 카드 DTO (비밀키 유출 원천 차단 그릇)
 * - 실행 시점: 브라우저가 `GET /api/config`를 요청할 때 `EmergencyApiController.getConfig()` 내부에서 생성됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   application.yml (`yonsei119.naver.*`, `default-origin.*`) ──> Yonsei119Properties
 *   ──> EmergencyApiController.getConfig() ──> new FrontendConfigDto(...) (비밀키 `clientSecret` 제외!)
 *   ──> Jackson JSON 직렬화 ──> frontend/js/search-controls.js의 `syncFrontendConfig()` 수신
 *   ──> `ensureNaverMapSdkLoaded(cfg.naverClientId)` 및 기본 출발지 동기화
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 5개 인자 생성자와 `.naverClientId()`, `.naverDarkStyleId()`, `.defaultLat()` 등 자동 Getter 생성
 *
 * [프론트엔드 연결 및 IDE 추적 가이드]
 * - 프론트엔드 사용처: `frontend/js/search-controls.js` (`syncFrontendConfig()`)
 * - 전체 검색(`Ctrl + Shift + F`): `/api/config` 또는 `naverDarkStyleId`
 *
 * [실행 방법 및 JSON 예시]
 * - 호출 예시: `curl http://localhost:8080/api/config`
 * - JSON 출력 예시:
 *   {
 *     "naverClientId": "xfbxloc8km",
 *     "naverDarkStyleId": "4b12b380-f70c-4d42-85df-ecf7961ff041",
 *     "defaultLat": 37.5666805,
 *     "defaultLng": 126.9784147,
 *     "defaultLabel": "서울시청"
 *   }
 */
public record FrontendConfigDto(
        String naverClientId,
        String naverDarkStyleId,
        double defaultLat,
        double defaultLng,
        String defaultLabel
) {
}
