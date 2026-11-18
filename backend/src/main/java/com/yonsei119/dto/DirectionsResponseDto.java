package com.yonsei119.dto;

import java.util.List;
/*
 * [자바 문법]
 * - package : DirectionsResponseDto.java 파일이 속한 패키지 경로를 선언하는 키워드임 (이름 변경 불가).
 * - import : 다른 패키지에 있는 자바 표준 클래스를 가져오는 키워드임 (이름 변경 불가).
 *
 * [패키지명]
 * - com.yonsei119.dto : 서비스가 만든 응답 데이터를 컨트롤러가 JSON으로 보내는 DTO 패키지임.
 *
 * [자바 내장 클래스 및 타입]
 * - java.util.List : 순서대로 여러 데이터를 담는 자바 표준 목록 인터페이스임 (이름 변경 불가).
 */

public record DirectionsResponseDto(
        String apiType,
        String apiLabel,
        String option,
        String optionLabel,
        int code,
        String message,
        int distanceMeters,
        double distanceKm,
        long durationMs,
        int durationMinutes,
        String durationText,
        String departureTime,
        int tollFare,
        int taxiFare,
        int fuelPrice,
        List<List<Double>> path,
        List<RouteSectionDto> sections,
        List<String> guidePrompts,
        List<RouteOptionSummaryDto> alternatives
) {
/*
 * [자바 문법 및 record 자동 생성 요소]
 * - public : 다른 패키지에서도 DirectionsResponseDto 레코드를 쓸 수 있게 열어 주는 제어자임 (이름 변경 불가).
 * - record : 한 번 만들면 값을 바꿀 수 없는(불변) 데이터 전달용 타입 키워드임 (이름 변경 불가).
 * - int, double, long : 각각 일반 정수, 소수점 실수, 큰 정수를 담는 자바 기본형임 (이름 변경 불가).
 * - 생성자 (record 자동 생성) : 19개 필드를 모두 받아 객체를 만드는 new DirectionsResponseDto(...)가 생성됨.
 * - 필드 조회 메서드 (record 자동 생성) : 각 필드명과 같은 조회 메서드가 자동 생성됨.
 *   · 기본·상태: .apiType(), .apiLabel(), .option(), .optionLabel(), .code(), .message()
 *   · 거리·시간: .distanceMeters(), .distanceKm(), .durationMs(), .durationMinutes()
 *   · 시간·요금: .durationText(), .departureTime(), .tollFare(), .taxiFare(), .fuelPrice()
 *   · 경로·구간: .path(), .sections(), .guidePrompts(), .alternatives()
 * - 공통 표준 메서드 (record 자동 생성) : equals(Object), hashCode(), toString()이 자동 생성됨 (이름 변경 불가).
 *
 * [자바 내장 클래스 및 타입]
 * - String (java.lang.String) : 글자를 저장하는 자바 표준 불변 문자열 클래스임 (이름 변경 불가).
 * - List<E> (java.util.List) : 순서대로 값을 담는 자바 표준 제네릭 목록 인터페이스임 (이름 변경 불가).
 * - Double (java.lang.Double) : 제네릭 꺾쇠(<...>) 안에 double 대신 넣는 실수 래퍼 클래스임 (이름 변경 불가).
 *
 * [프로젝트 내부 타입]
 * - RouteSectionDto : 도로 구간별 혼잡도와 평균 속도를 담는 내부 중첩 레코드임.
 * - RouteOptionSummaryDto : 경로 옵션별 거리·시간·요금을 요약한 내부 중첩 레코드임.
 *
 * [레코드명 및 필드명]
 * - DirectionsResponseDto : 네이버 길찾기 응답을 화면용 구조로 정리해 담는 DTO임.
 * - apiType : 호출한 API 종류 식별 문자열 ("directions5" 또는 "directions15").
 * - apiLabel : 화면 표시용 API 이름 ("Directions 5" 또는 "Directions 15").
 * - option : 적용된 경로 옵션 코드 ("trafast", "traoptimal", "tracomfort", "traavoidtoll", "traavoidcaronly").
 * - optionLabel : 화면 표시용 옵션 한글 이름 ("실시간 빠른길", "실시간 최적" 등).
 * - code : 결과 코드 (0=성공, -400=좌표 오류, -1=인증키 미설정·네트워크 오류, -2=JSON 파싱 오류).
 * - message : 처리 상태 또는 오류 안내 문구.
 * - distanceMeters, distanceKm : 총 주행 거리 (미터 정수 / km 소수 첫째 자리 반올림).
 * - durationMs, durationMinutes : 총 예상 소요 시간 (밀리초 정수 / 분 정수, 최소 1분).
 * - durationText, departureTime : 한국어 소요 시간 문구 (예: "약 11분") 및 출발 기준 시각 문자열.
 * - tollFare, taxiFare, fuelPrice : 예상 통행료, 택시 요금, 유류비 (원 단위 정수).
 * - path : 경로선 좌표 목록 (각 원소는 [경도, 위도] 쌍을 담은 List<Double>).
 * - sections : 도로명·평균 속도·혼잡도 구간 목록 (List<RouteSectionDto>).
 * - guidePrompts : 우회전·직진 등 주행 안내 문구 목록 (List<String>).
 * - alternatives : 4~5개 탐색 옵션별 시간·거리·요금 비교 요약 목록 (List<RouteOptionSummaryDto>).
 *
 * [동작 흐름]
 * - 생성 -> 캐시 -> 컨트롤러 -> JSON 변환 -> 프론트 수신 순서로 전달됨.
 *   NaverDirectionsService.parseDirectionsJson(...) -> new DirectionsResponseDto(...) 생성
 *   ├── 오류·예외 시: createErrorResponse(...) -> 빈 List.of()를 채운 객체 생성
 *   └── NaverDirectionsService.routeCache에 60초 저장 후 재사용
 *   ──> EmergencyApiController.getDirections(...) -> ResponseEntity.ok(result) 반환
 *   ──> Spring Jackson이 record 조회 메서드를 읽어 객체 -> JSON 문자열 자동 변환
 *   ──> frontend/js/directions-eta.js (refreshActiveRoute(), loadDirectionsForHospital())가 fetch()로 수신
 *   └── buildRouteGeoJson(), drawRouteOnMap()으로 지도 경로선과 옵션 비교 UI를 그림
 *
 * [실행 방법 및 JSON 예시]
 * - URL 출처 : application.yml(server.port: ${PORT:8080}, 기본 8080) + @RequestMapping("/api") + @GetMapping("/directions")
 * - 최종 URL : http://localhost:8080/api/directions (EmergencyApiController.getDirections())
 * - 서버 실행 : 프로젝트 루트에서 `.\gradlew.bat bootRun` 실행.
 * - 호출 예시 : `curl "http://localhost:8080/api/directions?startLat=37.3190&startLng=127.9012&goalLat=37.3191&goalLng=127.9456&apiType=directions5&option=trafast"`
 * - JSON 출력 예시 :
 *   {
 *     "apiType": "directions5",
 *     "apiLabel": "Directions 5",
 *     "option": "trafast",
 *     "optionLabel": "실시간 빠른길",
 *     "code": 0,
 *     "message": "길찾기 성공",
 *     "distanceMeters": 6700,
 *     "distanceKm": 6.7,
 *     "durationMs": 660000,
 *     "durationMinutes": 11,
 *     "durationText": "약 11분",
 *     "departureTime": "2026-11-17T18:20:00",
 *     "tollFare": 0,
 *     "taxiFare": 9400,
 *     "fuelPrice": 890,
 *     "path": [[127.9012, 37.3190], [127.9456, 37.3191]],
 *     "sections": [{ "pointIndex": 0, "pointCount": 2, "distance": 6700, "name": "서원대로", "congestion": 2, "speed": 28 }],
 *     "guidePrompts": ["연세대길 방면 우회전", "목적지 도착"],
 *     "alternatives": [{
 *       "option": "trafast", "optionLabel": "실시간 빠른길",
 *       "distanceMeters": 6700, "distanceKm": 6.7, "durationMs": 660000,
 *       "durationMinutes": 11, "durationText": "약 11분",
 *       "tollFare": 0, "taxiFare": 9400, "fuelPrice": 890
 *     }]
 *   }
 */

    public record RouteSectionDto(
            int pointIndex,
            int pointCount,
            int distance,
            String name,
            int congestion,
            int speed
    ) {
    /*
     * [자바 문법 및 record 자동 생성 요소]
     * - public, record, int : 외부 공개 불변 중첩 레코드와 정수 기본형임 (이름 변경 불가).
     * - 생성자·조회 메서드 (record 자동 생성) : new RouteSectionDto(...)와 6개 조회 메서드가 자동 생성됨.
     *   · 조회 메서드: .pointIndex(), .pointCount(), .distance(), .name(), .congestion(), .speed()
     *   · 공통 표준 메서드: equals(Object), hashCode(), toString() (이름 변경 불가).
     *
     * [자바 내장 클래스 및 타입]
     * - String (java.lang.String) : 도로 구간 이름을 담는 자바 표준 문자열 클래스임 (이름 변경 불가).
     *
     * [중첩 레코드명 및 필드명]
     * - RouteSectionDto : DirectionsResponseDto.sections 목록의 원소로 쓰이는 도로 구간 레코드임.
     * - pointIndex : DirectionsResponseDto.path 좌표 목록에서 RouteSectionDto 구간이 시작하는 위치 번호(인덱스).
     * - pointCount : RouteSectionDto 구간을 구성하는 좌표 개수.
     * - distance : RouteSectionDto 구간의 거리 (미터 단위 정수).
     * - name : 도로명 또는 정리된 구간 이름.
     * - congestion : 구간 혼잡도 코드 (1=원활, 2=서행, 3=정체).
     * - speed : 구간 평균 주행 속도 (km/h 단위 정수).
     *
     * [동작 흐름]
     * - 분석 생성 -> 상위 DTO 포함 -> JSON 변환 -> 프론트 표시 흐름으로 쓰임.
     *   RouteCongestionAnalyzer.buildDetailedSections(...) -> new DirectionsResponseDto.RouteSectionDto(...) 생성
     *   ──> DirectionsResponseDto.sections 목록에 담겨 컨트롤러로 전달
     *   ──> EmergencyApiController.getDirections(...) -> Jackson 객체 -> JSON 자동 변환
     *   ──> frontend/js/directions-eta.js (buildRouteGeoJson(), loadDirectionsForHospital())가 fetch()로 수신
     *   └── 서행·정체 구간 색상 강조와 도로 혼잡 배지 표시에 사용
     */
    }

    public record RouteOptionSummaryDto(
            String option,
            String optionLabel,
            int distanceMeters,
            double distanceKm,
            long durationMs,
            int durationMinutes,
            String durationText,
            int tollFare,
            int taxiFare,
            int fuelPrice
    ) {
    /*
     * [자바 문법 및 record 자동 생성 요소]
     * - public, record, int, double, long : 외부 공개 불변 중첩 레코드와 숫자 기본형임 (이름 변경 불가).
     * - 생성자·조회 메서드 (record 자동 생성) : new RouteOptionSummaryDto(...)와 10개 조회 메서드가 자동 생성됨.
     *   · 조회 메서드: .option(), .optionLabel(), .distanceMeters(), .distanceKm(), .durationMs(),
     *     .durationMinutes(), .durationText(), .tollFare(), .taxiFare(), .fuelPrice()
     *   · 공통 표준 메서드: equals(Object), hashCode(), toString() (이름 변경 불가).
     *
     * [자바 내장 클래스 및 타입]
     * - String (java.lang.String) : 옵션 코드·이름·시간 문구를 담는 자바 표준 문자열 클래스임 (이름 변경 불가).
     *
     * [중첩 레코드명 및 필드명]
     * - RouteOptionSummaryDto : DirectionsResponseDto.alternatives 목록에 들어가는 옵션 요약 레코드임.
     * - option : 주행 탐색 옵션 코드 ("trafast", "traoptimal", "tracomfort", "traavoidtoll", "traavoidcaronly").
     * - optionLabel : 옵션 한글 이름 ("실시간 빠른길", "실시간 최적" 등).
     * - distanceMeters, distanceKm : 옵션별 총 주행 거리 (미터 / km).
     * - durationMs, durationMinutes, durationText : 옵션별 소요 시간 (밀리초 / 분 / 한국어 문구).
     * - tollFare, taxiFare, fuelPrice : 옵션별 예상 통행료, 택시 요금, 유류비 (원).
     *
     * [동작 흐름]
     * - 파싱 생성 -> DirectionsResponseDto 포함 -> JSON 변환 -> 프론트 비교 카드 렌더링으로 이어짐.
     *   NaverDirectionsService.parseDirectionsJson(...) -> 옵션별 new RouteOptionSummaryDto(...) 생성
     *   ──> DirectionsResponseDto.alternatives 목록에 담겨 컨트롤러로 전달
     *   ──> EmergencyApiController.getDirections(...) -> Jackson 객체 -> JSON 자동 변환
     *   ──> frontend/js/directions-eta.js (loadDirectionsForHospital())가 fetch()로 수신해 4종 비교 버튼을 그림
     */
    }
}
