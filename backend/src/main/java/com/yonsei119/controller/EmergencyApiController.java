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
 * [1. 역할 및 실행 시점]
 * - 역할 : 브라우저(JS)와 Render 플랫폼의 HTTP 요청을 받아 담당 서비스(주방장)에게
 *          전달하고 JSON 응답을 돌려주는 API 창구 (식당 홀 서빙 직원 역할)
 * - 실행 시점 : 서버 기동 시 `@RestController` 싱글톤 빈으로 생성되며,
 *              클라이언트가 `/api/...` URL을 호출할 때만 각 메서드가 실행됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [Browser / Render]      [EmergencyApiController]      [Emergency / Naver Service]
 *             |                          |                              |
 *             |-- 1. GET /api/... ------>|                              |  HTTP GET 요청 진입
 *             |                          |-- 2. validate params         |  좌표 · hpid · ETag 검증
 *             |                          |-- 3. invoke service -------->|  담당 비즈니스 서비스 호출
 *             |                          |<-- 4. DTO / JSON bytes ------|  처리 결과 및 ETag 반환
 *             |<-- 5. HTTP 200/304/503 --|                              |  JSON 응답 및 캐시 헤더 전송
 *             v                          v                              v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ String / boolean / int / double : 문자열 · 논리 · 정수 · 실수 기본 타입
 *   ㄴ Map                             : JSON 키-값 응답을 담는 표준 내장 인터페이스
 *   ㄴ LinkedHashMap                   : 넣은 키 순서를 유지하는 표준 내장 Map 구현 클래스
 *   ㄴ List                            : 순서 있는 목록을 다루는 표준 내장 인터페이스
 *   ㄴ Instant.now()                   : 현재 UTC 시각을 구하는 표준 내장 시간 메서드
 *   ㄴ Runtime.version                 : 실행 중인 Java 버전(27)을 확인하는 표준 내장 메서드
 *   ㄴ Pattern                         : 병원 기관코드(`hpid`) 형식을 검사하는 정규식 표준 내장 클래스
 * - Spring 프레임워크
 *   ㄴ @RestController : 모든 메서드 반환값을 JSON 응답 본문으로 직렬화하는 어노테이션
 *   ㄴ @RequestMapping : 공통 상위 URL(`/api`)을 지정하는 어노테이션
 *   ㄴ @GetMapping     : HTTP GET 요청 세부 경로를 연결하는 어노테이션
 *   ㄴ @RequestParam   : 쿼리 스트링(`?compact=true` 등)을 매개변수로 바인딩하는 어노테이션
 *   ㄴ @PathVariable   : 경로 변수(`/{hpid}`)를 추출하는 어노테이션
 *   ㄴ @RequestHeader  : 요청 헤더(`If-None-Match`)를 읽는 어노테이션
 *   ㄴ ResponseEntity  : HTTP 상태 코드 · 헤더 · 본문을 함께 조립하는 응답 래퍼 클래스
 * - 외부 라이브러리 (자동 동작)
 *   ㄴ Jackson         : 반환된 DTO `record`의 자동 Getter를 읽어 JSON 문자열로 자동 변환
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 엔드포인트별 프론트엔드 / 인프라 연결처
 *   ㄴ GET /api/health           : `render.yaml` (`healthCheckPath`)
 *   ㄴ GET /api/config           : `frontend/js/search-controls.js` (`syncFrontendConfig`)
 *   ㄴ GET /api/hospitals        : `frontend/js/search-controls.js` (`fetchData`)
 *   ㄴ GET /api/hospitals/{hpid} : `frontend/js/hospital-sheet.js` (`hydrateHospitalDetailIfNeeded`)
 *   ㄴ GET /api/directions       : `frontend/js/directions-eta.js` (`loadDirectionsForHospital`)
 *   ㄴ GET /api/directions/rank  : `frontend/js/directions-eta.js` (`loadEtaRanking`)
 *   ㄴ GET /api/reverse-geocode  : `frontend/js/search-controls.js` (`updateOriginAddress`)
 *   ㄴ GET /api/geocode          : `frontend/js/search-controls.js` (`geocodeAndMoveOrigin`)
 * - IntelliJ 추적 단축키
 *   ㄴ Java 호출 계층 보기 : 메서드명 위에서 `Ctrl + Alt + H`
 *   ㄴ 프론트엔드 연결 검색 : `Ctrl + Shift + F`로 `/api/directions` 등 URL 검색
 */
@RestController
@RequestMapping("/api")
public class EmergencyApiController {

    private static final Pattern HPID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{3,24}$");

    private final Yonsei119Properties properties;
    private final EmergencyDataService emergencyDataService;
    private final NaverDirectionsService naverDirectionsService;
    private final NaverGeocodingService naverGeocodingService;

    // 생성자가 1개뿐이므로 @Autowired 생략 시에도 스프링이 4개 빈을 자동 주입(DI)함
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
     * [역할 및 시퀀스 흐름]
     * - 역할 : Render 무료 플랜 콜드스타트 시 초기 병원 캐시 적재 여부를 알려주는 헬스체크 API
     *
     *       [Render Proxy]       [EmergencyApiController]       [EmergencyDataService]
     *              |                         |                             |
     *              |-- 1. GET /api/health -->|                             |  헬스체크 호출
     *              |                         |-- 2. isReadyForTraffic() -->|  초기 캐시 준비 여부 확인
     *              |                         |<-- 3. ready (boolean) ------|  true 또는 false 반환
     *         +----+-------------------------+-----------------------------+------------+
     *         | [alt : ready == false]                                                  |  초기 7종 공공데이터 적재 중
     *         |    |<-- 4a. 503 WARMING_UP --|                             |            |  Render 로딩 화면 유지
     *         +----+-------------------------+-----------------------------+------------+
     *         | [else : ready == true]                                                  |  초기 캐시 적재 완료
     *         |    |<-- 4b. 200 UP ----------|                             |            |  완성된 네이버 지도로 연결
     *         +----+-------------------------+-----------------------------+------------+
     *              v                         v                             v
     *
     * - 사용처
     *   ㄴ render.yaml                : `healthCheckPath: /api/health`
     *   ㄴ Yonsei119BackendTests.java : Test 14 콜드스타트 503 -> 200 전환 검증
     * - 실행 예시 : `curl -i http://localhost:8080/api/health`
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        boolean ready = emergencyDataService.isReadyForTraffic();
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
     * [역할 및 시퀀스 흐름]
     * - 역할 : 프론트엔드 초기 구동에 필요한 공개 설정 5개만 전달하는 API (`clientSecret` 제외)
     * - 특징 : 외부 호출이나 가공이 없는 단순 설정 조회이므로 Service 계층을 거치지 않고 즉시 반환함
     *
     *    [search-controls.js]          [EmergencyApiController]      [Yonsei119Properties]
     *              |                               |                           |
     *              |-- 1. GET /api/config -------->|                           |  초기 설정 요청
     *              |                               |-- 2. read public props -->|  공개 키 · 기본 출발지 조회
     *              |                               |<-- 3. 5 public fields ----|  clientSecret 제외 반환
     *              |<-- 4. 200 FrontendConfigDto --|                           |  JSON 직렬화 응답
     *              v                               v                           v
     *
     * - 사용처
     *   ㄴ frontend/js/search-controls.js : `syncFrontendConfig()`
     * - 실행 예시 : `curl http://localhost:8080/api/config`
     */
    @GetMapping("/config")
    public ResponseEntity<FrontendConfigDto> getConfig() {
        FrontendConfigDto config = new FrontendConfigDto(
                properties.naver().clientId(),
                properties.naver().darkStyleId(),
                properties.defaultOrigin().lat(),
                properties.defaultOrigin().lng(),
                properties.defaultOrigin().label()
        );
        return ResponseEntity.ok(config);
    }

    /*
     * [역할 및 시퀀스 흐름]
     * - 역할 : 전국 응급의료기관 통합 목록(사전 직렬화 JSON 바이트 + ETag)을 반환하는 핵심 API
     *
     *       [search-controls.js]         [EmergencyApiController]           [EmergencyDataService]
     *                 |                              |                                 |
     *                 |-- 1. GET /api/hospitals ---->|                                 |  If-None-Match 헤더 포함
     *                 |                              |-- 2. getSerializedSnapshot() -->|  사전 직렬화 스냅샷 조회
     *                 |                              |<-- 3. bytes + ETag -------------|  UTF-8 바이트 · ETag 반환
     *            +----+------------------------------+---------------------------------+------------+
     *            | [alt : ETag matches]                                                             |  데이터 변동 없음
     *            |    |<-- 4a. 304 Not Modified -----|                                 |            |  본문 없이 0바이트 응답
     *            +----+------------------------------+---------------------------------+------------+
     *            | [else : ETag changed]                                                            |  병상 · 공지 변동 발생
     *            |    |<-- 4b. 200 OK (JSON bytes) --|                                 |            |  최신 병원 목록 바이트 전송
     *            +----+------------------------------+---------------------------------+------------+
     *                 v                              v                                 v
     *
     * - 사용처
     *   ㄴ frontend/js/search-controls.js : `fetchData()` (초기 로드 · 60초 자동 동기화)
     * - 실행 예시 : `curl "http://localhost:8080/api/hospitals?compact=true"`
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
     * - 역할 : 자바 통합 테스트에서 바이트 배열 대신 `EmergencySnapshotDto` 객체로 직접 검증할 때 사용
     * - 사용처
     *   ㄴ Yonsei119BackendTests.java : Test 4 경량 목록 · 단건 상세 비교 검증
     */
    public ResponseEntity<EmergencySnapshotDto> getHospitals(
            boolean refresh,
            boolean compact
    ) {
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(refresh, compact);
        return ResponseEntity.ok(snapshot);
    }

    /*
     * [역할 및 사용처]
     * - 역할 : 병원 1곳의 60여 개 모든 원시 태그를 100% 무손실로 반환하는 단건 상세 API
     * - 사용처
     *   ㄴ frontend/js/hospital-sheet.js : `hydrateHospitalDetailIfNeeded()` (개발자 모드 열람 시)
     * - 실행 예시 : `curl http://localhost:8080/api/hospitals/A2200001`
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
     * [역할 및 사용처]
     * - 역할 : 출발지~병원 간 네이버 실시간 자동차 경로 · 요금 · 대안 옵션을 조회하는 API
     *          (해상 페리 항로 포함 시 `code = -304` 반환으로 울릉도 등 도서 경로 안내 차단)
     * - 사용처
     *   ㄴ frontend/js/directions-eta.js : `loadDirectionsForHospital()`, `refreshActiveRoute()`
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
     * [역할 및 사용처]
     * - 역할 : 반경(기본 `50 km`) 내 응급실의 실도로 주행시간과 병상 여유도를 평가해 추천 순위를 반환함
     * - 사용처
     *   ㄴ frontend/js/directions-eta.js : `loadEtaRanking()` (`#eta-rank-box`)
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
     * [역할 및 사용처]
     * - 역할 : 위경도 좌표를 한국어 도로명·지번·요약 주소로 변환하는 역지오코딩 API
     * - 사용처
     *   ㄴ frontend/js/search-controls.js : `updateOriginAddress()`
     */
    @GetMapping("/reverse-geocode")
    public ResponseEntity<ReverseGeocodeResponseDto> reverseGeocode(
            @RequestParam(name = "lat") double lat,
            @RequestParam(name = "lng") double lng
    ) {
        return ResponseEntity.ok(naverGeocodingService.reverseGeocode(lat, lng));
    }

    /*
     * [역할 및 사용처]
     * - 역할 : 주소·지명 검색어를 위경도 후보 목록으로 변환하는 3단계 하이브리드 지오코딩 API
     * - 사용처
     *   ㄴ frontend/js/search-controls.js : `geocodeAndMoveOrigin()`
     */
    @GetMapping("/geocode")
    public ResponseEntity<GeocodeResponseDto> geocode(
            @RequestParam(name = "query") String query
    ) {
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(false, true);
        return ResponseEntity.ok(naverGeocodingService.geocode(query, snapshot.hospitals()));
    }
}
