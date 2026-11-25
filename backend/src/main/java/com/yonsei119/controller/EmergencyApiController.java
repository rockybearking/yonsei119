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
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/*
 * [역할 및 실행 시점]
 * - 역할: 프론트엔드(브라우저)와 Render 클라우드의 HTTP 요청을 맞이해 알맞은 서비스(주방장)에게 전달하는 API 창구 (홀 서빙 직원 역할)
 * - 실행 시점: 서버 부팅 시 @RestController 싱글톤 빈으로 등록되며, 각 URL로 HTTP GET 요청이 들어올 때만 해당 메서드가 실행됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   클라이언트 fetch('/api/...') 요청
 *   ──> SecurityHeadersFilter ──> ApiRateLimitFilter ──> EmergencyApiController
 *       ├── GET /api/health            ──> health()             ──> 초기 캐시 준비 전 503(WARMING_UP) / 준비 후 200(UP)
 *       ├── GET /api/config            ──> getConfig()          ──> FrontendConfigDto (공개 지도 키·기본 좌표만 반환)
 *       ├── GET /api/hospitals         ──> getHospitalsHttp()   ──> 사전 직렬화 JSON 바이트 (200 OK 또는 ETag 일치 시 304)
 *       ├── GET /api/hospitals/{hpid}  ──> getHospitalDetail()  ──> HospitalDto (단건 전체 원시 필드 100% 반환)
 *       ├── GET /api/directions        ──> getDirections()      ──> DirectionsResponseDto (자동차 경로·구간 혼잡도·옵션 비교)
 *       ├── GET /api/directions/rank   ──> rankDirections()     ──> List<HospitalEtaRankDto> (반경 기본 50km 추천 순위)
 *       ├── GET /api/reverse-geocode   ──> reverseGeocode()     ──> ReverseGeocodeResponseDto (위경도 -> 한국어 주소)
 *       └── GET /api/geocode           ──> geocode()            ──> GeocodeResponseDto (검색어 -> 위경도 후보 목록)
 *
 * [내장 / 프레임워크 / 라이브러리 구분]
 * - Java 표준 내장: Map, LinkedHashMap, List, Instant, Runtime, Pattern
 * - Spring 프레임워크: @RestController, @RequestMapping, @GetMapping, @RequestParam, @PathVariable, @RequestHeader, ResponseEntity
 * - 외부 라이브러리(자동 동작): Jackson 3 (DTO record의 자동 생성 Getter를 읽어 JSON 문자열로 자동 직렬화)
 *
 * [사용처 및 IDE 추적 가이드]
 * - Java 호출 추적: 각 메서드명 위에서 `Ctrl + Alt + H` (Call Hierarchy)
 * - 프론트엔드(JS) 연결 찾기: `Ctrl + Shift + F`로 `/api/hospitals`, `/api/directions` 등 경로 문자열 검색
 */
@RestController
@RequestMapping("/api")
public class EmergencyApiController {

    private static final Pattern HPID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{3,24}$");

    private final Yonsei119Properties properties;
    private final EmergencyDataService emergencyDataService;
    private final NaverDirectionsService naverDirectionsService;
    private final NaverGeocodingService naverGeocodingService;

    // [스프링 내부 동작] 생성자가 1개뿐이므로 @Autowired 생략 시에도 스프링 컨테이너가 4개 빈을 자동 주입(DI)함
    public EmergencyApiController(
            Yonsei119Properties properties,
            EmergencyDataService emergencyDataService,
            NaverDirectionsService naverDirectionsService,
            NaverGeocodingService naverGeocodingService
    ) {
        this.properties = properties;
        this.emergencyDataService = emergencyDataService;
        this.naverDirectionsService = naverDirectionsService;
        this.naverGeocodingService = naverGeocodingService;
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 서버 생존 여부 및 초기 공공데이터 캐시 준비 상태를 Render 플랫폼에 알려주는 헬스체크 API
     * - 실행 시점: Render 배포 프록시(`healthCheckPath: /api/health`) 또는 모니터링 도구가 호출할 때 실행됨
     *
     * [전체 호출 및 데이터 흐름]
     * - 흐름:
     *   Render 헬스체크 GET /api/health ──> health() ──> emergencyDataService.isReadyForTraffic() 확인
     *   ├── false (초기 7종 공공데이터 적재 중) ──> HTTP 503 Service Unavailable ("WARMING_UP") 반환
     *   │   └── 효과: Render의 기본 로딩 화면이 유지되어 빈 지도에 '정보 확인 중'만 뜨는 콜드스타트 버그를 원천 차단함!
     *   └── true  (초기 캐시 준비 완료)        ──> HTTP 200 OK ("UP") 반환 ──> Render가 즉시 완성된 화면으로 연결함
     *
     * [사용처 및 IDE 추적 가이드]
     * - 사용처: render.yaml (`healthCheckPath: /api/health`), Yonsei119BackendTests
     * - 실행 예시: `curl -i http://localhost:8080/api/health`
     * - JSON 응답 예시:
     *   {"status":"UP","ready":true,"service":"yonsei119","timestamp":"2026-11-25T10:40:00Z","javaVersion":"27.0.1"}
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        boolean ready = emergencyDataService.isReadyForTraffic();
        // [Java 내장] LinkedHashMap은 넣은 순서대로 JSON 키 순서를 깔끔하게 유지함
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", ready ? "UP" : "WARMING_UP");
        body.put("ready", ready);
        body.put("service", "yonsei119");
        body.put("timestamp", Instant.now().toString());
        body.put("javaVersion", Runtime.version().toString());

        if (!ready) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .cacheControl(CacheControl.noStore())
                    .body(body);
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(body);
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 브라우저에 네이버 지도 공개 Client ID, 다크모드 스타일 ID, 기본 출발지 좌표를 전달하는 초기 설정 API (홀 서빙 직원 역할)
     * - 실행 시점: 서버 시작 시 자동 실행되지 않으며, 프론트엔드가 초기 구동 시 `/api/config`를 요청할 때만 호출됨
     *
     * [전체 호출 및 데이터 흐름]
     * - 흐름: 프론트엔드 fetch('/api/config') ──> getConfig() ──> new FrontendConfigDto(...) 생성 ──> HTTP 200 JSON 반환
     * - 특징: 외부 API 호출이나 복잡한 계산이 없는 단순 설정 조회이므로 Service 계층을 거치지 않고 즉시 반환함
     *         (보안을 위해 비밀키 `clientSecret`은 DTO 필드에서 아예 제외됨)
     *
     * [사용처 및 IDE 추적 가이드]
     * - 프론트엔드 사용처: frontend/js/search-controls.js의 `syncFrontendConfig()` (`Ctrl + Shift + F`로 `/api/config` 또는 `naverClientId` 검색)
     * - Java 호출 추적: 메서드명 위에서 `Ctrl + Alt + H`
     * - 실행 예시: `curl http://localhost:8080/api/config`
     * - JSON 응답 예시:
     *   {"naverClientId":"xfbxloc8km","naverDarkStyleId":"4b12b380-f70c-4d42-85df-ecf7961ff041","defaultLat":37.5666805,"defaultLng":126.9784147,"defaultLabel":"서울시청"}
     */
    @GetMapping("/config")
    public ResponseEntity<FrontendConfigDto> getConfig() {
        // [자바 문법] record인 FrontendConfigDto가 컴파일 시 자동 생성한 5개 인자 생성자에 설정값을 순서대로 1:1 매핑함
        FrontendConfigDto config = new FrontendConfigDto(
                properties.naver().clientId(),
                properties.naver().darkStyleId(),
                properties.defaultOrigin().lat(),
                properties.defaultOrigin().lng(),
                properties.defaultOrigin().label()
        );
        // [스프링 내부 동작] Jackson이 config의 자동 Getter를 읽어 JSON 텍스트로 직렬화한 뒤 HTTP 200 응답으로 전송함
        return ResponseEntity.ok(config);
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 전국 응급의료기관 통합 목록(병상·응급메시지·중증질환 포함)을 내려주는 핵심 스냅샷 API
     * - 실행 시점: 앱 최초 접속, 수동 새로고침 버튼 클릭, 또는 60초 자동 실시간 동기화 타이머가 호출할 때 실행됨
     *
     * [전체 호출 및 데이터 흐름]
     * - 흐름:
     *   프론트엔드 fetch('/api/hospitals?compact=true')
     *   ──> getHospitalsHttp() ──> emergencyDataService.getSerializedSnapshot(refresh, compact)
     *       ├── If-None-Match 헤더 == 현재 ETag (변동 없음) ──> 본문 없이 HTTP 304 Not Modified 반환 (데이터 사용량 0바이트!)
     *       └── 변동 있음 또는 첫 요청                      ──> 사전 직렬화된 UTF-8 JSON 바이트 + ETag 헤더와 함께 HTTP 200 반환
     *
     * [사용처 및 IDE 추적 가이드]
     * - 프론트엔드 사용처: frontend/js/search-controls.js의 `fetchData()` (`Ctrl + Shift + F`로 `/api/hospitals` 검색)
     * - 실행 예시: `curl "http://localhost:8080/api/hospitals?compact=true"`
     */
    @GetMapping(value = "/hospitals", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> getHospitalsHttp(
            @RequestParam(name = "refresh", defaultValue = "false") boolean refresh,
            @RequestParam(name = "compact", defaultValue = "false") boolean compact,
            @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch
    ) {
        EmergencyDataService.SerializedSnapshot serialized = emergencyDataService.getSerializedSnapshot(refresh, compact);
        if (EmergencyDataService.matchesEtag(ifNoneMatch, serialized.etag())) {
            emergencyDataService.recordNotModifiedHit(compact);
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
                    .header(HttpHeaders.ETAG, serialized.etag())
                    .cacheControl(CacheControl.noCache())
                    .build();
        }
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.ETAG, serialized.etag())
                .cacheControl(CacheControl.noCache())
                .body(serialized.jsonBytes());
    }

    /*
     * [역할 및 사용처]
     * - 역할: 백엔드 내부 및 통합 테스트 코드에서 바이트 배열 대신 자바 DTO(`EmergencySnapshotDto`)로 직접 조회할 때 쓰는 메서드
     * - 사용처: Yonsei119BackendTests.testDatasetCrossMergeAndCompactDetailSeparation()
     */
    public ResponseEntity<EmergencySnapshotDto> getHospitals(
            boolean refresh,
            boolean compact
    ) {
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(refresh, compact);
        return ResponseEntity.ok(snapshot);
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 특정 병원 1곳의 모든 공공데이터 원시 태그(60여 개 기본정보·전체 병상·외상·공지)를 무손실로 반환하는 단건 상세 API
     * - 실행 시점: 사용자가 병원 상세 시트 하단의 '개발자 모드(원본 데이터 대조)'를 펼칠 때 온디맨드로 호출됨
     *
     * [전체 호출 및 데이터 흐름]
     * - 흐름:
     *   프론트엔드 fetch('/api/hospitals/A2200001') ──> getHospitalDetail(hpid)
     *   ├── hpid 정규식 검증 실패 ──> HTTP 400 Bad Request
     *   ├── 캐시에 없는 기관코드  ──> HTTP 404 Not Found
     *   └── 조회 성공             ──> HTTP 200 OK + HospitalDto JSON 반환
     *
     * [사용처 및 IDE 추적 가이드]
     * - 프론트엔드 사용처: frontend/js/hospital-sheet.js의 `hydrateHospitalDetailIfNeeded()`
     * - 실행 예시: `curl http://localhost:8080/api/hospitals/A2200001`
     */
    @GetMapping("/hospitals/{hpid}")
    public ResponseEntity<HospitalDto> getHospitalDetail(
            @PathVariable(name = "hpid") String hpid
    ) {
        if (hpid == null || !HPID_PATTERN.matcher(hpid.trim()).matches()) {
            return ResponseEntity.badRequest().build();
        }
        HospitalDto detail = emergencyDataService.getHospitalById(hpid);
        if (detail == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(detail);
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 출발지에서 선택한 병원까지의 네이버 실시간 자동차 경로, 공식 도로 혼잡도(section), 4대 대안 옵션을 조회하는 API
     * - 실행 시점: 사용자가 병원 카드를 열어 상세 시트가 표시되거나 경로 옵션/경유지를 바꿀 때 호출됨
     *
     * [전체 호출 및 데이터 흐름]
     * - 흐름:
     *   프론트엔드 fetch('/api/directions?...') ──> getDirections()
     *   ──> naverDirectionsService.getDrivingRoute()
     *       ├── 육지↔울릉도 등 도서 페리 항로(guide.type 48/49) 감지 시 code=-304 자동차 경로 미제공 반환
     *       └── 정상 육로 시 네이버 공식 section 혼잡도(0~3) 그대로 보존해 DirectionsResponseDto 반환
     *
     * [사용처 및 IDE 추적 가이드]
     * - 프론트엔드 사용처: frontend/js/directions-eta.js의 `loadDirectionsForHospital()`, `refreshActiveRoute()`
     * - 실행 예시: `curl "http://localhost:8080/api/directions?startLat=37.5666&startLng=126.9784&goalLat=37.5622&goalLng=126.9408"`
     */
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
        DirectionsResponseDto result = naverDirectionsService.getDrivingRoute(
                startLat, startLng, goalLat, goalLng, apiType, option, waypoints
        );
        return ResponseEntity.ok(result);
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 반경(기본 50km) 내 응급실들의 실도로 도착 시간(ETA)과 병상 여유·차단 공지를 종합 평가해 최적 추천 순위를 매기는 API
     * - 실행 시점: 검색 패널의 '추천 순위' 버튼을 열거나 출발지·반경·종별 체크박스가 바뀔 때 호출됨
     *
     * [전체 호출 및 데이터 흐름]
     * - 흐름:
     *   프론트엔드 fetch('/api/directions/rank?...') ──> rankDirections()
     *   ──> emergencyDataService.getSnapshot(false, false)로 최신 병원 목록 조회
     *   ──> naverDirectionsService.rankHospitalsByDrivingTime() [병렬 ETA 조회 + HospitalRecommendationScorer 점수 산출]
     *   ──> 1~N위 List<HospitalEtaRankDto> JSON 배열 반환
     *
     * [사용처 및 IDE 추적 가이드]
     * - 프론트엔드 사용처: frontend/js/directions-eta.js의 `loadEtaRanking()` (`Ctrl + Shift + F`로 `/api/directions/rank` 검색)
     * - 실행 예시: `curl "http://localhost:8080/api/directions/rank?startLat=37.5666&startLng=126.9784&radiusKm=50&limit=5&mode=optimal"`
     */
    @GetMapping("/directions/rank")
    public ResponseEntity<List<HospitalEtaRankDto>> rankDirections(
            @RequestParam(name = "startLat") double startLat,
            @RequestParam(name = "startLng") double startLng,
            @RequestParam(name = "radiusKm", defaultValue = "50") double radiusKm,
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
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(false, false);
        List<HospitalEtaRankDto> ranked = naverDirectionsService.rankHospitalsByDrivingTime(
                snapshot.hospitals(), startLat, startLng, radiusKm, limit,
                includeRegional, includeTertiary, includeMedical, includeOther,
                onlyAvailable, symptom, mode, option
        );
        return ResponseEntity.ok(ranked);
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 지도의 위도·경도 좌표를 한국어 도로명·지번·요약 주소로 변환하는 역지오코딩 API
     * - 실행 시점: 내 위치(GPS) 측위, 지도 우클릭/롱탭 출발지 지정, 주소 이동 직후 출발 기준 주소를 표시할 때 호출됨
     *
     * [전체 호출 및 데이터 흐름]
     * - 흐름: 프론트엔드 fetch('/api/reverse-geocode?lat=...&lng=...') ──> naverGeocodingService.reverseGeocode() ──> JSON 반환
     *
     * [사용처 및 IDE 추적 가이드]
     * - 프론트엔드 사용처: frontend/js/search-controls.js의 `updateOriginAddress()`
     * - 실행 예시: `curl "http://localhost:8080/api/reverse-geocode?lat=37.5666&lng=126.9784"`
     */
    @GetMapping("/reverse-geocode")
    public ResponseEntity<ReverseGeocodeResponseDto> reverseGeocode(
            @RequestParam(name = "lat") double lat,
            @RequestParam(name = "lng") double lng
    ) {
        return ResponseEntity.ok(naverGeocodingService.reverseGeocode(lat, lng));
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 사용자가 검색창에 입력한 주소·지명·역 이름을 위경도 좌표로 변환하는 3단계 하이브리드 지오코딩 API
     * - 실행 시점: 검색 자동완성 하단의 '이 주소·지역으로 지도 출발점 이동' 클릭 또는 엔터 제출 시 호출됨
     *
     * [전체 호출 및 데이터 흐름]
     * - 흐름:
     *   프론트엔드 fetch('/api/geocode?query=...') ──> geocode()
     *   ──> 경량 병원 목록 확보 ──> naverGeocodingService.geocode() [1단계 네이버 ──> 2단계 병원 주소록 ──> 3단계 Nominatim]
     *   ──> GeocodeResponseDto JSON 반환
     *
     * [사용처 및 IDE 추적 가이드]
     * - 프론트엔드 사용처: frontend/js/search-controls.js의 `geocodeAndMoveOrigin()`
     * - 실행 예시: `curl --get --data-urlencode "query=원주시청" http://localhost:8080/api/geocode`
     */
    @GetMapping("/geocode")
    public ResponseEntity<GeocodeResponseDto> geocode(
            @RequestParam(name = "query") String query
    ) {
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(false, true);
        return ResponseEntity.ok(naverGeocodingService.geocode(query, snapshot.hospitals()));
    }
}
