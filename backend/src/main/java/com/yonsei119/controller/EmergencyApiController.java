package com.yonsei119.controller;

import com.yonsei119.config.Yonsei119Properties;
import com.yonsei119.dto.DirectionsResponseDto;
import com.yonsei119.dto.EmergencySnapshotDto;
import com.yonsei119.dto.FrontendConfigDto;
import com.yonsei119.dto.GeocodeResponseDto;
import com.yonsei119.dto.HospitalDto;
import com.yonsei119.dto.HospitalEtaRankDto;
import com.yonsei119.dto.ReverseGeocodeResponseDto;
import com.yonsei119.service.EmergencyDataService;
import com.yonsei119.service.NaverDirectionsService;
import com.yonsei119.service.NaverGeocodingService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
/*
 * [자바 문법] package, import : 브라우저의 fetch('/api/...') 주문을 가장 먼저 받는 REST API 카운터 패키지 선언 및 스프링 웹 도구 불러오기임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - ResponseEntity<T> : HTTP 상태 코드(200 OK, 404 Not Found 등)와 응답 데이터(JSON 도시락)를 함께 포장해 보내는 공식 봉투 타입임 (이름 변경 불가).
 * - Instant, Map, LinkedHashMap, List : 현재 시각 기록 및 JSON 구조 생성용 표준 타입임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @RestController (출처: org.springframework.web.bind.annotation) : 모든 메서드의 반환 객체를 자동으로 JSON 문자열로 직렬화해 응답하는 REST 전용 컨트롤러 스위치임
 *   (형제 어노테이션: HTML 뷰 템플릿을 반환하는 @Controller, 비즈니스 로직 @Service, 데이터 저장소 @Repository).
 * - @RequestMapping("/api") (출처: org.springframework.web.bind.annotation) : 이 클래스 안의 모든 URL 앞에 공통으로 "/api" 접두사를 붙여 줌.
 * - @GetMapping (출처: org.springframework.web.bind.annotation) : HTTP GET 조회 요청을 연결함
 *   (목적별 형제 어노테이션: 생성 @PostMapping, 전체수정 @PutMapping, 일부수정 @PatchMapping, 삭제 @DeleteMapping).
 * - @RequestParam, @PathVariable : 주소창의 쿼리스트링(?refresh=true)과 경로 변수(/hospitals/{hpid})를 자바 변수로 꺼내 줌.
 */

@RestController
@RequestMapping("/api")
public class EmergencyApiController {
/*
 * [스프링/라이브러리 내장 어노테이션] @RestController, @RequestMapping("/api")
 * [자바 문법] public class
 * [내가 지은 이름] EmergencyApiController : 연세 119 시스템의 8개 핵심 REST API 엔드포인트를 총괄하는 관문 컨트롤러 클래스임.
 * [핵심 원리 & 식당 카운터 비유]
 * - 손님(프론트엔드 JS)이 카운터(/api/...)에 주문서를 내밀면, 카운터 직원은 직접 요리하지 않고
 *   응급데이터 주방장(EmergencyDataService), 길찾기 주방장(NaverDirectionsService), 주소번역 주방장(NaverGeocodingService)에게 전달한 뒤
 *   완성된 요리(DTO)를 깔끔한 JSON 도시락(ResponseEntity)에 담아 손님에게 내어줌.
 */

    private final Yonsei119Properties properties;
    private final EmergencyDataService emergencyDataService;
    private final NaverDirectionsService naverDirectionsService;
    private final NaverGeocodingService naverGeocodingService;
    /*
     * [자바 문법] private final : 외부에서 임의 변경할 수 없고 생성 시점에 한 번만 꽂히는 안전한 상자 선언임.
     * [내가 지은 이름]
     * - 대문자 시작 타입명(설계도): Yonsei119Properties, EmergencyDataService, NaverDirectionsService, NaverGeocodingService
     * - 소문자 시작 변수명(실제 상자): properties, emergencyDataService, naverDirectionsService, naverGeocodingService
     */

    public EmergencyApiController(
            Yonsei119Properties properties,
            EmergencyDataService emergencyDataService,
            NaverDirectionsService naverDirectionsService,
            NaverGeocodingService naverGeocodingService
    ) {
    /*
     * [자바 문법] public EmergencyApiController(...) : 스프링이 서버 부팅 시 4개의 싱글톤 객체를 자동으로 꽂아주는 생성자(생성자 주입 DI)임.
     */
        this.properties = properties;
        this.emergencyDataService = emergencyDataService;
        this.naverDirectionsService = naverDirectionsService;
        this.naverGeocodingService = naverGeocodingService;
        /*
         * [핵심 실행 코드] 전달받은 4개의 핵심 부품을 컨트롤러 멤버 변수에 단단히 연결함.
         */
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
    /*
     * [스프링/라이브러리 내장 어노테이션] @GetMapping("/health") -> 최종 URL: GET /api/health (형제: @PostMapping, @PutMapping, @DeleteMapping)
     * [자바/스프링/라이브러리 내장 도구(타입)] ResponseEntity<Map<String, Object>> (이름 변경 불가)
     * [내가 지은 이름] health(함수명), "/health"(하위 경로)
     */
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "UP");
        body.put("service", "yonsei119-backend");
        body.put("timestamp", Instant.now().toString());
        body.put("javaVersion", Runtime.version().toString());
        return ResponseEntity.ok(body);
        /*
         * [스프링/자바 내장 함수] ResponseEntity.ok(body) : HTTP 200 OK 상태 코드와 함께 JSON 응답을 반환함
         *   (형제 함수: ResponseEntity.notFound().build(), ResponseEntity.badRequest().body(...), ResponseEntity.status(500).body(...)).
         * [응답 JSON 예시]
         *   GET http://localhost:8080/api/health
         *   └──> { "status": "UP", "service": "yonsei119-backend", "timestamp": "2026-11-17T09:30:00Z", "javaVersion": "17.0.21..." }
         */
    }

    @GetMapping("/config")
    public ResponseEntity<FrontendConfigDto> getConfig() {
    /*
     * [스프링/라이브러리 내장 어노테이션] @GetMapping("/config") -> 최종 URL: GET /api/config
     * [내가 지은 이름] FrontendConfigDto(반환 DTO 타입), getConfig(함수명)
     */
        FrontendConfigDto config = new FrontendConfigDto(
                properties.naver().clientId(),
                properties.naver().darkStyleId(),
                properties.defaultOrigin().lat(),
                properties.defaultOrigin().lng(),
                properties.defaultOrigin().label()
        );
        return ResponseEntity.ok(config);
        /*
         * [보안 & 아키텍처 핵심 원리]
         * - 프론트엔드가 이 API에서 naverClientId와 naverDarkStyleId를 받아 동적으로 네이버 지도 SDK를 검증·로드하므로,
         *   HTML 하드코딩 없이 환경변수(.env) 하나로 백엔드·프론트엔드 지도 키가 완벽히 통일됨 (clientSecret은 절대 미포함).
         */
    }

    @GetMapping("/hospitals")
    public ResponseEntity<EmergencySnapshotDto> getHospitals(
            @RequestParam(name = "refresh", defaultValue = "false") boolean refresh,
            @RequestParam(name = "compact", defaultValue = "false") boolean compact
    ) {
    /*
     * [스프링/라이브러리 내장 어노테이션]
     * - @GetMapping("/hospitals") -> 최종 URL: GET /api/hospitals
     * - @RequestParam(name = "...", defaultValue = "false") : 쿼리 파라미터가 생략되면 자동으로 false 기본값을 채워 줌 (형제: @PathVariable, @RequestHeader, @RequestBody).
     * [내가 지은 이름] getHospitals(함수명), refresh(강제 새로고침 여부), compact(모바일 경량 요약 모드 여부)
     */
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(refresh, compact);
        return ResponseEntity.ok(snapshot);
        /*
         * [요청 URL별 동작 예시]
         * 1) GET /api/hospitals?compact=true         : 프론트엔드 초기 접속 (불필요한 대용량 원문 제외 경량 스냅샷 0.01초 반환)
         * 2) GET /api/hospitals?refresh=true&compact=true : 상단 '새로고침' 버튼 클릭 (공공데이터 즉시 재수집 후 반환)
         * 3) GET /api/hospitals                      : 전체 원본 필드 포함 통합 스냅샷 반환
         */
    }

    @GetMapping("/hospitals/{hpid}")
    public ResponseEntity<HospitalDto> getHospitalDetail(
            @PathVariable(name = "hpid") String hpid
    ) {
    /*
     * [스프링/라이브러리 내장 어노테이션]
     * - @GetMapping("/hospitals/{hpid}") -> 최종 URL 예시: GET /api/hospitals/A2200001
     * - @PathVariable(name = "hpid") : URL 경로의 {hpid} 자리에 적힌 병원 코드를 문자열 변수 hpid에 쏙 뽑아 넣어 줌.
     * [내가 지은 이름] getHospitalDetail(함수명), hpid(기관 고유코드 변수명)
     */
        if (hpid == null || !hpid.trim().matches("^[A-Za-z0-9_-]{3,24}$")) {
            return ResponseEntity.badRequest().build();
        }
        HospitalDto detail = emergencyDataService.getHospitalById(hpid);
        if (detail == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(detail);
        /*
         * [스프링/자바 내장 함수] ResponseEntity.badRequest().build() (HTTP 400), ResponseEntity.notFound().build() (HTTP 404), ResponseEntity.ok(detail) (HTTP 200)
         * [핵심 원리] 사용자가 병원 상세 시트의 '개발자 모드(원본 필드 전체 대조)'를 열 때 이 엔드포인트를 호출하여 basic 60여 개 원본 XML 태그까지 100% 무손실로 확인함.
         */
    }

    @GetMapping("/directions")
    public ResponseEntity<DirectionsResponseDto> getDirections(
            @RequestParam(name = "startLat") double startLat,
            @RequestParam(name = "startLng") double startLng,
            @RequestParam(name = "goalLat") double goalLat,
            @RequestParam(name = "goalLng") double goalLng,
            @RequestParam(name = "apiType", defaultValue = "directions5") String apiType,
            @RequestParam(name = "option", defaultValue = "trafast") String option,
            @RequestParam(name = "waypoints", defaultValue = "") String waypoints
    ) {
    /*
     * [스프링/라이브러리 내장 어노테이션] @GetMapping("/directions") -> 최종 URL: GET /api/directions
     * [내가 지은 이름] getDirections(함수명), startLat, startLng(출발 좌표), goalLat, goalLng(목표 병원 좌표), apiType, option, waypoints
     */
        DirectionsResponseDto result = naverDirectionsService.getDrivingRoute(
                startLat, startLng, goalLat, goalLng, apiType, option, waypoints
        );
        return ResponseEntity.ok(result);
        /*
         * [호출 URL 및 데이터 흐름 예시]
         *   GET /api/directions?startLat=37.3190&startLng=127.9012&goalLat=37.3191&goalLng=127.9456&apiType=directions5&option=trafast
         *   └──> NaverDirectionsService -> DirectionsResponseDto (폴리라인 path + 정밀 혼잡도 sections + 4대 대안 경로 alternatives 반환)
         */
    }

    @GetMapping("/directions/rank")
    public ResponseEntity<List<HospitalEtaRankDto>> rankDirections(
            @RequestParam(name = "startLat") double startLat,
            @RequestParam(name = "startLng") double startLng,
            @RequestParam(name = "radiusKm", defaultValue = "20") double radiusKm,
            @RequestParam(name = "limit", defaultValue = "5") int limit,
            @RequestParam(name = "includeRegional", defaultValue = "true") boolean includeRegional,
            @RequestParam(name = "includeTertiary", defaultValue = "true") boolean includeTertiary,
            @RequestParam(name = "includeMedical", defaultValue = "true") boolean includeMedical,
            @RequestParam(name = "includeOther", defaultValue = "false") boolean includeOther,
            @RequestParam(name = "onlyAvailable", defaultValue = "false") boolean onlyAvailable,
            @RequestParam(name = "symptom", defaultValue = "all") String symptom,
            @RequestParam(name = "mode", defaultValue = "optimal") String mode,
            @RequestParam(name = "option", defaultValue = "trafast") String option
    ) {
    /*
     * [스프링/라이브러리 내장 어노테이션] @GetMapping("/directions/rank") -> 최종 URL: GET /api/directions/rank
     * [내가 지은 이름] rankDirections(함수명), includeRegional~includeOther(4대 종별 동기화), onlyAvailable(가용 병상만), symptom(증상 프리셋), mode("optimal"|"fastest")
     */
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(false, false);
        List<HospitalEtaRankDto> ranked = naverDirectionsService.rankHospitalsByDrivingTime(
                snapshot.hospitals(), startLat, startLng, radiusKm, limit,
                includeRegional, includeTertiary, includeMedical, includeOther,
                onlyAvailable, symptom, mode, option
        );
        return ResponseEntity.ok(ranked);
        /*
         * [호출 URL 예시]
         *   GET /api/directions/rank?startLat=37.3190&startLng=127.9012&radiusKm=20&mode=optimal&symptom=stroke&onlyAvailable=true
         *   └──> 뇌졸중·뇌출혈 수용 가능 + 차단 공지 없음 + 가용 병상 보유 병원들의 실도로 주행시간·수용성 최적 순위 리스트 반환
         */
    }

    @GetMapping("/reverse-geocode")
    public ResponseEntity<ReverseGeocodeResponseDto> reverseGeocode(
            @RequestParam(name = "lat") double lat,
            @RequestParam(name = "lng") double lng
    ) {
    /*
     * [스프링/라이브러리 내장 어노테이션] @GetMapping("/reverse-geocode") -> 최종 URL: GET /api/reverse-geocode
     * [내가 지은 이름] reverseGeocode(함수명), lat(위도), lng(경도)
     */
        return ResponseEntity.ok(naverGeocodingService.reverseGeocode(lat, lng));
        /*
         * [호출 예시] GET /api/reverse-geocode?lat=37.3190&lng=127.9012 -> "강원 원주시 흥업면" 도로명·행정동 주소 반환
         */
    }

    @GetMapping("/geocode")
    public ResponseEntity<GeocodeResponseDto> geocode(
            @RequestParam(name = "query") String query
    ) {
    /*
     * [스프링/라이브러리 내장 어노테이션] @GetMapping("/geocode") -> 최종 URL: GET /api/geocode
     * [내가 지은 이름] geocode(함수명), query(사용자 입력 주소·장소 검색어)
     */
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(false, true);
        return ResponseEntity.ok(naverGeocodingService.geocode(query, snapshot.hospitals()));
        /*
         * [호출 예시] GET /api/geocode?query=연세대길 1 -> 위경도 좌표 리스트 반환
         */
    }
}
