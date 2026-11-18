package com.yonsei119.dto;

import java.util.List;
/*
 * [자바 문법]
 * - package : GeocodeResponseDto.java 파일이 속한 패키지 경로를 선언하는 키워드임 (이름 변경 불가).
 * - import : java.util.List 인터페이스를 GeocodeResponseDto.java 파일에서 쓰기 위해 불러오는 키워드임 (이름 변경 불가).
 *
 * [패키지명]
 * - com.yonsei119.dto : 주소 검색(지오코딩) 응답 등 HTTP API 데이터 전달용 DTO 패키지임.
 *
 * [자바 내장 클래스 및 타입]
 * - java.util.List : 순서대로 여러 데이터를 담는 자바 표준 제네릭 목록 인터페이스임 (이름 변경 불가).
 */

public record GeocodeResponseDto(
        int code,
        String query,
        List<GeocodeItemDto> items
) {
/*
 * [자바 문법 및 record 자동 생성 요소]
 * - public : 다른 패키지에서도 GeocodeResponseDto 레코드에 접근할 수 있게 열어 주는 제어자임 (이름 변경 불가).
 * - record : 한 번 만들면 값을 바꿀 수 없는(불변) 데이터 전달용 타입 키워드임 (이름 변경 불가).
 * - int : 32비트 정수를 담는 자바 기본형임 (이름 변경 불가).
 * - 생성자 (record 자동 생성) : 3개 필드를 받는 new GeocodeResponseDto(...)가 자동 생성됨.
 * - 필드 조회 메서드 (record 자동 생성) : .code(), .query(), .items() 조회 메서드가 자동 생성됨.
 * - 공통 표준 메서드 (record 자동 생성) : equals(Object), hashCode(), toString()이 자동 생성됨 (이름 변경 불가).
 *
 * [자바 내장 클래스 및 타입]
 * - String (java.lang.String) : 글자를 저장하는 자바 표준 불변 문자열 클래스임 (이름 변경 불가).
 * - List<E> (java.util.List) : 순서대로 값을 담는 자바 표준 제네릭 목록 인터페이스임 (이름 변경 불가).
 *
 * [프로젝트 내부 타입]
 * - GeocodeItemDto : 검색된 개별 장소의 이름, 도로명·지번 주소, 위경도를 담는 내부 중첩 레코드임.
 *
 * [레코드명 및 필드명]
 * - GeocodeResponseDto : 주소·장소 검색 결과 상태와 좌표 후보 목록(List<GeocodeItemDto>)을 담는 DTO임.
 * - code : 처리 결과 코드 (0=1건 이상 찾음, -1=빈 검색어 오류, 404=검색 결과 없음).
 * - query : 앞뒤 공백을 자르고 최대 120자로 맞춘 검색어 문자열.
 * - items : 검색된 위치 후보(GeocodeItemDto) 불변 목록.
 *
 * [동작 흐름]
 * - 3단계 검색 -> 캐시 -> 컨트롤러 -> JSON 변환 -> 프론트 이동 순서로 동작함.
 *   NaverGeocodingService.geocode(...) -> 빈 검색어면 new GeocodeResponseDto(-1, "", List.of()) 즉시 반환
 *   ├── 1단계 네이버 Geocoding -> 2단계 병원 목록 메모리 검색 -> 3단계 OpenStreetMap Nominatim 검색
 *   └── new GeocodeResponseDto(...) 생성 후 geocodeCache에 600초 저장 (NaverDirectionsService.geocode()도 위임)
 *   ──> EmergencyApiController.geocode(...) -> ResponseEntity.ok(...) 반환
 *   ──> Spring Jackson이 record 조회 메서드를 읽어 객체 -> JSON 문자열 자동 변환
 *   ──> frontend/js/search-controls.js (geocodeAndMoveOrigin())가 fetch('/api/geocode?...')로 수신
 *   └── 첫 번째 후보(data.items[0])의 lat, lng 좌표로 setCustomOrigin()과 지도 이동 실행
 *
 * [실행 방법 및 JSON 예시]
 * - URL 출처 : application.yml(server.port: ${PORT:8080}, 기본 8080) + @RequestMapping("/api") + @GetMapping("/geocode")
 * - 최종 URL : http://localhost:8080/api/geocode?query=... (EmergencyApiController.geocode())
 * - 서버 실행 : 프로젝트 루트에서 `.\gradlew.bat bootRun` 실행.
 * - 호출 예시 : `curl "http://localhost:8080/api/geocode?query=%EC%9B%90%EC%A3%BC%EC%8B%9C%EC%B2%AD"`
 * - 브라우저 예시 : `http://localhost:8080/api/geocode?query=연세대길 1` 접속.
 * - JSON 출력 예시 :
 *   {
 *     "code": 0,
 *     "query": "원주시청",
 *     "items": [
 *       {
 *         "title": "원주시청",
 *         "roadAddress": "강원특별자치도 원주시 시청로 1",
 *         "jibunAddress": "강원특별자치도 원주시 무실동 1",
 *         "lat": 37.3422,
 *         "lng": 127.9202
 *       }
 *     ]
 *   }
 */

    public record GeocodeItemDto(
            String title,
            String roadAddress,
            String jibunAddress,
            double lat,
            double lng
    ) {
    /*
     * [자바 문법 및 record 자동 생성 요소]
     * - public, record, double : 외부 공개 불변 중첩 레코드와 소수점 실수 기본형임 (이름 변경 불가).
     * - 생성자·조회 메서드 (record 자동 생성) : new GeocodeItemDto(...)와 5개 조회 메서드가 자동 생성됨.
     *   · 조회 메서드: .title(), .roadAddress(), .jibunAddress(), .lat(), .lng()
     *   · 공통 표준 메서드: equals(Object), hashCode(), toString() (이름 변경 불가).
     *
     * [자바 내장 클래스 및 타입]
     * - String (java.lang.String) : 장소 이름과 주소를 담는 자바 표준 문자열 클래스임 (이름 변경 불가).
     *
     * [중첩 레코드명 및 필드명]
     * - GeocodeItemDto : GeocodeResponseDto.items 목록에 들어가는 위치 후보 1건 레코드임.
     * - title : 화면 표시용 위치 이름 (네이버는 도로명/지번 주소, 병원·Nominatim은 기관명/장소명).
     * - roadAddress : 도로명 주소 (Nominatim 결과에서는 전체 표시 주소).
     * - jibunAddress : 지번 주소 (Nominatim 결과에서는 전체 표시 주소).
     * - lat, lng : WGS84 위도(네이버 원본 "y") 및 경도(네이버 원본 "x") 실수.
     *
     * [동작 흐름]
     * - 파싱 생성 -> 상위 DTO 포함 -> JSON 변환 -> 프론트 좌표 적용 순서로 쓰임.
     *   NaverGeocodingService (parseGeocodeJson(), geocode() 보조 검색) -> new GeocodeItemDto(...) 생성
     *   ──> GeocodeResponseDto.items 목록에 담겨 컨트롤러로 전달
     *   ──> EmergencyApiController.geocode(...) -> Jackson 객체 -> JSON 자동 변환
     *   ──> frontend/js/search-controls.js (geocodeAndMoveOrigin())가 data.items[0] 좌표를 지도에 반영
     */
    }
}
