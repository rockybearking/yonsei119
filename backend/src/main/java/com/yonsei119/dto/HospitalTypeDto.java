package com.yonsei119.dto;
/*
 * [자바 문법]
 * - package : HospitalTypeDto.java 파일이 속한 패키지 경로를 선언하는 키워드임 (이름 변경 불가).
 *
 * [패키지명]
 * - com.yonsei119.dto : 프론트엔드와 백엔드 사이를 오가는 HTTP 응답 데이터 전송용 DTO 패키지임.
 */

public record HospitalTypeDto(
        String group,
        String label,
        String accent,
        int priority
) {
/*
 * [자바 문법 및 record 자동 생성 요소]
 * - public : 다른 패키지(service, controller, test)에서도 HospitalTypeDto 레코드에 접근할 수 있게 열어 주는 제어자임 (이름 변경 불가).
 * - record : 한 번 만들면 값을 바꿀 수 없는(불변) 데이터 전달용 타입 키워드임 (이름 변경 불가).
 * - int : 32비트 정수를 담는 자바 기본형임 (이름 변경 불가).
 * - 생성자 (record 자동 생성) : 4개 필드를 받는 new HospitalTypeDto(...)가 자동 생성됨.
 * - 필드 조회 메서드 (record 자동 생성) : .group(), .label(), .accent(), .priority()가 자동 생성됨.
 * - 공통 표준 메서드 (record 자동 생성) : equals(Object), hashCode(), toString()이 자동 생성됨 (이름 변경 불가).
 *
 * [자바 내장 클래스 및 타입]
 * - String (java.lang.String) : 글자를 저장하는 자바 표준 불변 문자열 클래스임 (이름 변경 불가).
 *
 * [레코드명 및 필드명]
 * - HospitalTypeDto : 응급의료기관의 종별 그룹, 표시 이름, 색상, 정렬 순서를 담는 불변 DTO임.
 * - group : 종별 구분 코드 ("tertiary" | "medical" | "other").
 * - label : 화면 표시용 한글 종별명 ("상급종합병원" | "의료원" | "일반·기타 응급의료기관").
 * - accent : 종별 구분용 대표 HEX 색상 문자열 ("#d34458", "#2879ce", "#738295").
 * - priority : 종별 정렬 우선순위 정수 (1=상급종합병원, 2=의료원, 3=일반·기타 응급의료기관).
 *
 * [동작 흐름]
 * - 분류 상수 -> 병원 DTO 포함 -> 컨트롤러 -> JSON 변환 -> 프론트 필터링 순서로 쓰임.
 *   HospitalClassifier 정적 상수(TYPE_TERTIARY, TYPE_MEDICAL, TYPE_OTHER)로 new HospitalTypeDto(...) 생성
 *   ──> HospitalClassifier.classify(...) -> EmergencyDataService.mergeDatasetsIntoSnapshot(...)에서 HospitalDto.type 설정
 *   ──> EmergencyApiController (getHospitals(), getHospitalDetail())가 HospitalDto 안에 포함해 반환
 *   ──> Spring Jackson이 type 키 아래의 중첩 JSON 객체로 자동 변환
 *   ──> frontend/js/search-controls.js (fetchData()) 수신 -> markers-cluster.js·hospital-sheet.js에서 종별 필터·라벨 표시
 *
 * [실행 방법 및 JSON 예시]
 * - URL 출처 : 단독 API는 없으며 application.yml(8080) + @RequestMapping("/api") + /hospitals 응답 안에 포함됨.
 * - 최종 URL : http://localhost:8080/api/hospitals?compact=true 또는 http://localhost:8080/api/hospitals/A2200001
 * - 서버 실행 : 프로젝트 루트에서 `.\gradlew.bat bootRun` 실행.
 * - 호출 예시 : `curl "http://localhost:8080/api/hospitals/A2200001"` 또는 브라우저 직접 접속.
 * - JSON 출력 예시 (HospitalDto 내부 type 필드 변환 결과) :
 *   {
 *     "id": "A2200001",
 *     "name": "연세대학교원주세브란스기독병원",
 *     "regional": true,
 *     "type": {
 *       "group": "tertiary",
 *       "label": "상급종합병원",
 *       "accent": "#d34458",
 *       "priority": 1
 *     }
 *   }
 */
}
