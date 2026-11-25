package com.yonsei119.dto;

import java.util.List;

/*
 * [역할 및 실행 시점]
 * - 역할: 네이버 자동차 길찾기 결과(경로선 좌표, 도로 구간별 혼잡도, 요금, 4대 옵션 비교)를 담아 프론트엔드로 배달하는 도시락 그릇 DTO
 * - 실행 시점: 서버 시작 시에는 생성되지 않으며, `NaverDirectionsService.parseDirectionsJson()`이 경로를 파싱할 때 생성되어 60초간 캐싱됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   NaverDirectionsService.parseDirectionsJson() ──> new DirectionsResponseDto(...) 생성
 *   ├── 정상 육로(code=0): routeCache에 60초 저장 ──> EmergencyApiController.getDirections() 반환
 *   ├── 도서 페리 항로 감지(code=-304) 또는 오류: createErrorResponse()로 빈 리스트 채운 안전 객체 반환
 *   └── Jackson JSON 자동 직렬화 ──> frontend/js/directions-eta.js (`loadDirectionsForHospital`, `refreshActiveRoute`) 수신
 *       └── `drawRouteOnMap()`이 지도 위 파란 기본 경로선 + 초록·주황·빨강 공식 혼잡도 구간선을 그림
 *
 * [자바 문법 및 자동 생성 요소]
 * - Java 내장 `record`: 19개 불변 필드와 전체 생성자, `.code()`, `.path()`, `.sections()` 등 자동 Getter, `equals`/`hashCode`/`toString`을 컴파일러가 자동 생성함
 * - Java 표준 내장 타입: `String`, `List<E>`, `Double`
 *
 * [프론트엔드 연결 및 IDE 추적 가이드]
 * - 프론트엔드 사용처: `frontend/js/directions-eta.js` (`data.path`, `data.sections`, `data.alternatives`, `data.guidePrompts` 참조)
 * - Java 호출 추적: 레코드명 위에서 `Ctrl + Alt + H` | 프론트엔드 검색: `Ctrl + Shift + F`로 `/api/directions` 또는 `guidePrompts` 검색
 *
 * [실행 방법 및 JSON 예시]
 * - 호출 예시: `curl "http://localhost:8080/api/directions?startLat=37.3190&startLng=127.9012&goalLat=37.3191&goalLng=127.9456&apiType=directions5&option=trafast"`
 * - JSON 출력 예시:
 *   {
 *     "apiType": "directions5",
 *     "apiLabel": "Directions 5",
 *     "option": "trafast",
 *     "optionLabel": "실시간 빠른길",
 *     "code": 0,
 *     "message": "길찾기를 성공하였습니다.",
 *     "distanceMeters": 6700,
 *     "distanceKm": 6.7,
 *     "durationMs": 660000,
 *     "durationMinutes": 11,
 *     "durationText": "약 11분",
 *     "departureTime": "2026-11-25T19:40:00",
 *     "tollFare": 0,
 *     "taxiFare": 9400,
 *     "fuelPrice": 890,
 *     "path": [[127.9012, 37.3190], [127.9456, 37.3191]],
 *     "sections": [{ "pointIndex": 0, "pointCount": 2, "distance": 6700, "name": "서원대로", "congestion": 1, "speed": 42 }],
 *     "guidePrompts": ["연세대길 방면 우회전", "목적지 도착"],
 *     "alternatives": [{ "option": "trafast", "optionLabel": "실시간 빠른길", "distanceMeters": 6700, "distanceKm": 6.7, "durationMs": 660000, "durationMinutes": 11, "durationText": "약 11분", "tollFare": 0, "taxiFare": 9400, "fuelPrice": 890 }]
 *   }
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

    /**
     * 네이버 공식 도로 구간 혼잡도 1건을 담는 중첩 레코드.
     * (`congestion`: 0=교통정보 없음/기본 파란선, 1=원활/초록, 2=서행/주황, 3=정체/빨강)
     */
    public record RouteSectionDto(
            int pointIndex,
            int pointCount,
            int distance,
            String name,
            int congestion,
            int speed
    ) {
    }

    /** 빠른길·최적·편한길·무료우선 등 주행 옵션별 예상 시간·거리·요금 비교 카드용 중첩 레코드 */
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
    }
}
