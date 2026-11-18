package com.yonsei119.dto;
/*
 * [자바 문법]
 * - package : FrontendConfigDto.java 파일이 속한 패키지 경로를 선언하는 키워드임 (이름 변경 불가).
 *
 * [패키지명]
 * - com.yonsei119.dto : 프론트엔드 초기 설정값 등 서버와 클라이언트 사이를 오가는 DTO 패키지임.
 */

public record FrontendConfigDto(
        String naverClientId,
        String naverDarkStyleId,
        double defaultLat,
        double defaultLng,
        String defaultLabel
) {
/*
 * [자바 문법 및 record 자동 생성 요소]
 * - public : 다른 패키지(controller 등)에서도 FrontendConfigDto 레코드에 접근할 수 있게 열어 주는 제어자임 (이름 변경 불가).
 * - record : 한 번 만들면 값을 바꿀 수 없는(불변) 데이터 전달용 타입 키워드임 (이름 변경 불가).
 * - double : 위도·경도 같은 소수점 실수를 담는 자바 기본형임 (이름 변경 불가).
 * - 생성자 (record 자동 생성) : 5개 필드를 받는 new FrontendConfigDto(...)가 자동 생성됨.
 * - 필드 조회 메서드 (record 자동 생성) : 각 필드명과 같은 조회 메서드가 자동 생성됨.
 *   · 조회 메서드: .naverClientId(), .naverDarkStyleId(), .defaultLat(), .defaultLng(), .defaultLabel()
 * - 공통 표준 메서드 (record 자동 생성) : equals(Object), hashCode(), toString()이 자동 생성됨 (이름 변경 불가).
 *
 * [자바 내장 클래스 및 타입]
 * - String (java.lang.String) : 글자를 저장하는 자바 표준 불변 문자열 클래스임 (이름 변경 불가).
 *
 * [레코드명 및 필드명]
 * - FrontendConfigDto : 프론트엔드가 시작될 때 네이버 지도 키와 기본 출발 좌표를 받는 공개 설정 DTO임.
 * - naverClientId : application.yml의 yonsei119.naver.client-id에서 읽은 공개 Client ID.
 * - naverDarkStyleId : application.yml의 yonsei119.naver.dark-style-id에서 읽은 다크 지도 스타일 UUID.
 * - defaultLat : application.yml의 yonsei119.default-origin.lat에서 읽은 기본 출발지 위도 (기본 37.5666805).
 * - defaultLng : application.yml의 yonsei119.default-origin.lng에서 읽은 기본 출발지 경도 (기본 126.9784147).
 * - defaultLabel : application.yml의 yonsei119.default-origin.label에서 읽은 기본 출발지 이름 (기본 "서울시청").
 *
 * [보안 분리 구조]
 * - 백엔드 설정 Yonsei119Properties.Naver에는 비밀키 clientSecret도 들어 있으나 FrontendConfigDto 레코드에는 넣지 않음.
 * - 비밀키 필드가 아예 없으므로 JSON 변환 과정에서 브라우저로 비밀키가 새어 나갈 위험을 막음.
 *
 * [동작 흐름]
 * - 설정 읽기 -> 컨트롤러 생성 -> JSON 변환 -> 프론트 초기화 순서로 전달됨.
 *   application.yml -> Yonsei119Properties (properties.naver(), properties.defaultOrigin()) 바인딩
 *   ──> EmergencyApiController.getConfig() -> 공개 5개 값으로 new FrontendConfigDto(...) 생성
 *   ──> ResponseEntity.ok(config) 반환 -> Spring Jackson이 객체 -> JSON 문자열 자동 변환
 *   ──> frontend/js/search-controls.js (syncFrontendConfig())가 fetch('/api/config', ...)로 수신
 *   └── DEFAULT_ORIGIN, state.naverDarkStyleId, ensureNaverMapSdkLoaded(cfg.naverClientId) 동기화
 *
 * [실행 방법 및 JSON 예시]
 * - URL 출처 : application.yml(server.port: ${PORT:8080}, 기본 8080) + @RequestMapping("/api") + @GetMapping("/config")
 * - 최종 URL : http://localhost:8080/api/config (EmergencyApiController.getConfig())
 * - 서버 실행 : 프로젝트 루트에서 `.\gradlew.bat bootRun` 실행.
 * - 호출 예시 : `curl "http://localhost:8080/api/config"` 또는 브라우저에서 `http://localhost:8080/api/config` 접속.
 * - JSON 출력 예시 :
 *   {
 *     "naverClientId": "xfbxloc8km",
 *     "naverDarkStyleId": "4b12b380-f70c-4d42-85df-ecf7961ff041",
 *     "defaultLat": 37.5666805,
 *     "defaultLng": 126.9784147,
 *     "defaultLabel": "서울시청"
 *   }
 */
}
