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
 * [자바 문법]
 * - package : HTTP REST API 요청을 받는 컨트롤러 패키지(com.yonsei119.controller) 선언문임.
 * - import : 설정 모델, DTO 7종, 서비스 3종과 스프링 웹·자바 표준 타입을 가져오는 선언문임.
 *
 * [패키지명]
 * - com.yonsei119.controller : 연세 119 백엔드의 HTTP API 진입점 컨트롤러 패키지명임.
 *
 * [프로젝트 내부 정의 타입 (import)]
 * - 설정 (com.yonsei119.config) : Yonsei119Properties
 * - 응답 DTO (com.yonsei119.dto) :
 *   · DirectionsResponseDto, EmergencySnapshotDto, FrontendConfigDto, GeocodeResponseDto
 *   · HospitalDto, HospitalEtaRankDto, ReverseGeocodeResponseDto
 * - 서비스 (com.yonsei119.service) : EmergencyDataService, NaverDirectionsService, NaverGeocodingService
 *
 * [자바/스프링 내장 타입 (이름 변경 불가)]
 * - ResponseEntity<T> (출처: org.springframework.http 패키지) : HTTP 상태 코드(200, 400, 404)와 응답 본문을 감싸는 클래스임.
 * - Instant (출처: java.time 패키지) : UTC 기준 현재 시각을 표현하는 불변 클래스임.
 * - Map<K, V>, LinkedHashMap<K, V>, List<E> (출처: java.util 패키지) : 키-값 사전, 순서 유지 해시맵, 순서 있는 목록 타입임.
 */

@RestController
@RequestMapping("/api")
public class EmergencyApiController {
/*
 * [스프링 내장 어노테이션]
 * - @RestController 정의 (출처: org.springframework.web.bind.annotation.RestController, 이름 변경 불가)
 *   · 역할 : @Controller와 @ResponseBody를 합쳐 메서드 반환 객체를 JSON으로 직렬화해 HTTP 응답 본문으로 바로 내려보내는 어노테이션임.
 * - @RestController 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 EmergencyApiController 클래스 (health()·getConfig() 등 8개 API 메서드 전체)
 *   · 작동 원리 : @Controller와 @ResponseBody를 합쳐 EmergencyApiController 메서드 반환값을 JSON으로 직렬화해 응답 본문에 씀.
 *   · 비교 : HTML 뷰를 반환하는 @Controller, 서비스 @Service, 저장소 @Repository, 전역 예외 처리 @RestControllerAdvice가 있음.
 * - @RequestMapping 정의 (출처: org.springframework.web.bind.annotation.RequestMapping, 이름 변경 불가)
 *   · 역할 : 클래스나 메서드에 공통 요청 URL 경로와 HTTP 메서드 매핑 규칙을 지정하는 스프링 웹 라우팅 어노테이션임.
 * - @RequestMapping("/api") 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 EmergencyApiController 클래스
 *   · 작동 원리 : EmergencyApiController 내부 8개 @GetMapping 경로 앞에 공통 접두사 "/api"를 붙여 라우팅 표에 등록함.
 *   · 비교 : HTTP 메서드가 고정된 축약형 @GetMapping, @PostMapping, @PutMapping, @PatchMapping, @DeleteMapping이 있음.
 *
 * [자바 문법]
 * - public class : 스프링 컨트롤러 빈으로 등록되는 공개 클래스 선언임.
 *
 * [클래스명]
 * - EmergencyApiController : 연세 119 백엔드의 8개 공개 HTTP GET API를 제공하는 컨트롤러 클래스명임.
 *
 * [동작 흐름]
 * - 호출 출처 : 프론트엔드 JS(fetch('/api/...')), Render 헬스 체크, 백엔드 통합 테스트가 HTTP GET 요청 전송.
 * - 흐름 :
 *   1) HTTP GET /api/... 도착 ──> DispatcherServlet이 8개 메서드 중 하나를 매핑 호출
 *   2) 파라미터 바인딩·입력 검증 ──> 서비스 계층 위임
 *      ├── EmergencyDataService : 스냅샷·병원 상세 조회
 *      ├── NaverDirectionsService : 실시간 경로·ETA 순위 계산
 *      └── NaverGeocodingService : 주소 ↔ 좌표 변환
 * - 반환값 : ResponseEntity로 감싼 DTO·컬렉션이 Jackson JSON 직렬화를 거쳐 클라이언트로 전달됨.
 */

    private final Yonsei119Properties properties;
    private final EmergencyDataService emergencyDataService;
    private final NaverDirectionsService naverDirectionsService;
    private final NaverGeocodingService naverGeocodingService;
    /*
     * [자바 문법]
     * - private final : 클래스 내부에서만 접근하며 생성자 주입 후 바꿀 수 없는 불변 멤버 필드 선언임.
     *
     * [프로젝트 내부 정의 타입]
     * - Yonsei119Properties : application.yml 설정 record 빈.
     * - EmergencyDataService : 7대 공공데이터 병합 및 Hot/Cold 캐시 관리 서비스 빈.
     * - NaverDirectionsService : 네이버 Directions 5/15 경로 탐색 및 ETA 순위 서비스 빈.
     * - NaverGeocodingService : 네이버 역지오코딩 및 3단계 하이브리드 지오코딩 서비스 빈.
     *
     * [필드명 (멤버 변수)]
     * - properties, emergencyDataService, naverDirectionsService, naverGeocodingService.
     */

    public EmergencyApiController(
            Yonsei119Properties properties,
            EmergencyDataService emergencyDataService,
            NaverDirectionsService naverDirectionsService,
            NaverGeocodingService naverGeocodingService
    ) {
    /*
     * [자바 문법]
     * - public EmergencyApiController(...) : 생성자가 1개뿐이므로 @Autowired 없이 스프링이 4개 빈을 자동 주입함.
     *
     * [생성자 및 매개변수명]
     * - 생성자명 : EmergencyApiController.
     * - 매개변수명 : properties, emergencyDataService, naverDirectionsService, naverGeocodingService.
     */
        this.properties = properties;
        this.emergencyDataService = emergencyDataService;
        this.naverDirectionsService = naverDirectionsService;
        this.naverGeocodingService = naverGeocodingService;
        /*
         * [자바 문법]
         * - this.필드명 = 매개변수명 : 현재 컨트롤러 인스턴스의 멤버 필드에 주입받은 빈 참조를 저장함.
         *
         * [동작 흐름]
         * - 호출 출처 : 서버 부팅 시 스프링 컨테이너가 컨트롤러 빈 생성 시점에 4개 협력 빈을 넘겨 호출함.
         * - 흐름 : 생성자 매개변수 4개 ──> 각각 this.* 멤버 필드에 대입 완료.
         * - 전달 대상 : 이후 health() 등 8개 API 엔드포인트가 요청 시 properties·emergencyDataService·naverDirectionsService·naverGeocodingService 필드를 참조함.
         */
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
    /*
     * [스프링 내장 어노테이션]
     * - @GetMapping 정의 (출처: org.springframework.web.bind.annotation.GetMapping, 이름 변경 불가)
     *   · 역할 : 데이터 조회용 HTTP GET 요청 URL을 특정 컨트롤러 메서드에 연결해 주는 @RequestMapping(method = GET) 축약 어노테이션임.
     * - @GetMapping("/health") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyApiController.health() 메서드
     *   · 작동 원리 : 클래스 선언부 @RequestMapping("/api")와 합쳐 GET /api/health 요청 시 DispatcherServlet이 health()를 호출함.
     *   · 비교 : 생성 @PostMapping, 전체 교체 @PutMapping, 부분 수정 @PatchMapping, 삭제 @DeleteMapping이 있음.
     *
     * [자바 문법]
     * - public : 스프링 DispatcherServlet이 외부에서 호출할 수 있게 공개함.
     * - ResponseEntity<Map<String, Object>> : 중첩 제네릭 반환 타입 선언임.
     *
     * [자바/스프링 내장 타입 (이름 변경 불가)]
     * - ResponseEntity<T> (출처: org.springframework.http 패키지), Map<K, V> (출처: java.util 패키지), String·Object (java.lang).
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : health (매개변수 없음).
     */
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "UP");
        body.put("service", "yonsei119-backend");
        body.put("timestamp", Instant.now().toString());
        body.put("javaVersion", Runtime.version().toString());
        return ResponseEntity.ok(body);
        /*
         * [자바 문법]
         * - new LinkedHashMap<>() : 왼쪽 변수 타입을 보고 <> 안의 타입을 컴파일러가 자동 추론함.
         * - return : 생성한 ResponseEntity 응답 객체를 반환함.
         *
         * [자바/스프링 내장 생성자 및 메서드 (이름 변경 불가)]
         * - new LinkedHashMap<>() (출처: java.util 패키지) : JSON 변환 시 키 삽입 순서를 유지하는 해시맵 생성자임.
         * - Map.put(K key, V value) (출처: java.util 패키지) : 맵에 키-값 쌍을 저장하는 메서드임.
         * - Instant.now(), Object.toString() : 현재 UTC 시각을 구해 ISO-8601 문자열로 바꾸는 메서드임.
         * - Runtime.version() (출처: java.lang 패키지) : 현재 실행 중인 자바 JVM 버전 정보를 조회함.
         * - ResponseEntity.ok(T body) (출처: org.springframework.http 패키지) : HTTP 200 OK 상태 코드와 응답 본문을 묶음.
         *   · 형제 비교 : ResponseEntity.badRequest().build(), ResponseEntity.notFound().build() 등이 있음.
         *
         * [지역 변수명]
         * - body : 응답 JSON 키-값을 담는 Map<String, Object> 지역 변수명.
         *
         * [동작 흐름]
         * - 호출 출처 : Render 배포 플랫폼의 헬스 체크 프로브 또는 통합 테스트에서 GET /api/health 요청.
         * - 흐름 : LinkedHashMap 생성 ──> status·service·timestamp·javaVersion 순서 삽입 ──> ResponseEntity.ok(body) 반환.
         * - 전달 대상 : Jackson이 body 맵을 JSON으로 직렬화해 HTTP 200 OK 응답을 보냄.
         *
         * [URL 생성 출처 및 프론트엔드 호출부]
         * - URL 생성 : application.yml server.port(${PORT:8080}) + @RequestMapping("/api") + @GetMapping("/health")
         *   · 최종 URL : http://localhost:8080/api/health
         * - 호출부 : 프론트엔드 JS에서는 부르지 않으며, render.yaml의 healthCheckPath 및 백엔드 통합 테스트에서 호출함.
         *
         * [실행 방법]
         * - 서버 기동 : .\gradlew.bat bootRun (또는 Yonsei119Application.main() 실행)
         * - 호출 예시 : 브라우저 http://localhost:8080/api/health 또는 curl http://localhost:8080/api/health
         *
         * [실행 결과 예시]
         * - HTTP 200 OK : {"status":"UP","service":"yonsei119-backend","timestamp":"2026-11-18T10:00:00Z","javaVersion":"<실행 중인 JDK 버전 문자열>"}
         */
    }

    @GetMapping("/config")
    public ResponseEntity<FrontendConfigDto> getConfig() {
    /*
     * [스프링 내장 어노테이션]
     * - @GetMapping 정의 (출처: org.springframework.web.bind.annotation.GetMapping, 이름 변경 불가)
     *   · 역할 : 데이터 조회용 HTTP GET 요청 URL을 특정 컨트롤러 메서드에 연결해 주는 @RequestMapping(method = GET) 축약 어노테이션임.
     * - @GetMapping("/config") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyApiController.getConfig() 메서드
     *   · 작동 원리 : 클래스 선언부 @RequestMapping("/api")와 합쳐 GET /api/config 요청 시 DispatcherServlet이 getConfig()를 호출함.
     *   · 비교 : 생성 @PostMapping, 전체 교체 @PutMapping, 부분 수정 @PatchMapping, 삭제 @DeleteMapping이 있음.
     *
     * [자바 문법]
     * - public, ResponseEntity<FrontendConfigDto> 제네릭 타입 지정.
     *
     * [스프링 내장 타입 (이름 변경 불가)]
     * - ResponseEntity<T> (출처: org.springframework.http 패키지).
     *
     * [프로젝트 내부 정의 타입]
     * - FrontendConfigDto (출처: com.yonsei119.dto 패키지) : 공개 지도 키·다크 스타일 ID·기본 출발 좌표를 담는 record DTO임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : getConfig (매개변수 없음).
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
         * [자바 문법]
         * - new : FrontendConfigDto record 객체를 생성하는 연산자임.
         * - return : HTTP 200 응답 객체를 반환함.
         *
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - ResponseEntity.ok(T body) (출처: org.springframework.http 패키지) : 조회한 결과 객체를 HTTP 200 본문으로 감쌈.
         *
         * [프로젝트 내부 생성자 및 호출 메서드]
         * - new FrontendConfigDto(...) : 공개 필드 5개만 받는 생성자임 (clientSecret 비밀키는 제외함).
         * - properties.naver().clientId(), .darkStyleId() : application.yml의 yonsei119.naver.* 값을 읽는 record 조회 메서드임.
         * - properties.defaultOrigin().lat(), .lng(), .label() : yonsei119.default-origin.* 값을 읽는 record 조회 메서드임.
         *
         * [지역 변수명]
         * - config : 생성된 FrontendConfigDto 인스턴스를 담는 지역 변수명.
         *
         * [동작 흐름]
         * - 호출 출처 : 프론트엔드 초기화 시 search-controls.js의 syncFrontendConfig()가 GET /api/config 요청.
         * - 흐름 : properties 공개 설정 5개 조회 ──> FrontendConfigDto 생성 ──> ResponseEntity.ok(config) 반환.
         * - 전달 대상 : 프론트엔드 syncFrontendConfig()가 응답을 받아 네이버 지도 SDK 로드 및 기본 출발점을 설정함.
         *
         * [URL 생성 출처 및 프론트엔드 호출부]
         * - URL 생성 : application.yml server.port(${PORT:8080}) + @RequestMapping("/api") + @GetMapping("/config")
         *   · 최종 URL : http://localhost:8080/api/config
         * - 프론트엔드 호출부 :
         *   · frontend/js/search-controls.js : syncFrontendConfig()에서 fetch('/api/config') 호출
         *   · frontend/js/app.js : init() 초기화 시 syncFrontendConfig() 실행
         *
         * [실행 방법]
         * - 서버 기동 : .\gradlew.bat bootRun (또는 Yonsei119Application.main() 실행)
         * - 호출 예시 : 브라우저 http://localhost:8080/api/config 또는 curl http://localhost:8080/api/config
         *
         * [실행 결과 예시]
         * - HTTP 200 OK : {"naverClientId":"xfbxloc8km","naverDarkStyleId":"4b12b380-f70c-4d42-85df-ecf7961ff041","defaultLat":37.5666805,"defaultLng":126.9784147,"defaultLabel":"서울시청"}
         */
    }

    @GetMapping("/hospitals")
    public ResponseEntity<EmergencySnapshotDto> getHospitals(
            @RequestParam(name = "refresh", defaultValue = "false") boolean refresh,
            @RequestParam(name = "compact", defaultValue = "false") boolean compact
    ) {
    /*
     * [스프링 내장 어노테이션]
     * - @GetMapping 정의 (출처: org.springframework.web.bind.annotation.GetMapping, 이름 변경 불가)
     *   · 역할 : 데이터 조회용 HTTP GET 요청 URL을 특정 컨트롤러 메서드에 연결해 주는 @RequestMapping(method = GET) 축약 어노테이션임.
     * - @GetMapping("/hospitals") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyApiController.getHospitals(boolean refresh, boolean compact) 메서드
     *   · 작동 원리 : @RequestMapping("/api")와 합쳐 GET /api/hospitals 요청 시 DispatcherServlet이 getHospitals()를 호출함.
     *   · 비교 : 생성 @PostMapping, 전체 교체 @PutMapping, 부분 수정 @PatchMapping, 삭제 @DeleteMapping이 있음.
     * - @RequestParam 정의 (출처: org.springframework.web.bind.annotation.RequestParam, 이름 변경 불가)
     *   · 역할 : 요청 URL의 쿼리스트링(?이름=값) 파라미터를 읽어 컨트롤러 메서드 매개변수 타입으로 자동 변환·전달하는 어노테이션임.
     * - @RequestParam(name = "refresh" / "compact", defaultValue = "false") 현재 코드 적용
     *   · 적용 대상 : getHospitals()의 refresh(boolean), compact(boolean) 매개변수
     *   · 작동 원리 : ?refresh=...&compact=... 쿼리 문자열을 boolean으로 변환해 바인딩하며 생략 시 "false" 기본값을 적용함.
     *   · 비교 : 경로 변수 @PathVariable, 요청 헤더 @RequestHeader, JSON 본문 @RequestBody, 폼 @ModelAttribute가 있음.
     *
     * [자바 문법]
     * - public, 기본형 boolean, ResponseEntity<EmergencySnapshotDto> 반환 타입 선언.
     *
     * [스프링 내장 타입 (이름 변경 불가)]
     * - ResponseEntity<T> (출처: org.springframework.http 패키지).
     *
     * [프로젝트 내부 정의 타입]
     * - EmergencySnapshotDto (출처: com.yonsei119.dto 패키지) : 전국 응급의료기관 통합 스냅샷 record DTO임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : getHospitals.
     * - 매개변수명 :
     *   · refresh : true면 캐시 강제 갱신 시도 여부.
     *   · compact : true면 장문 basic·미사용 병상 키를 뺀 경량 목록 반환 여부.
     */
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(refresh, compact);
        return ResponseEntity.ok(snapshot);
        /*
         * [자바 문법]
         * - return : 조회한 결과 객체를 HTTP 200 응답에 실어 반환함.
         *
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - ResponseEntity.ok(T body) (출처: org.springframework.http 패키지) : 조회한 결과 객체를 HTTP 200 본문으로 감쌈.
         *
         * [프로젝트 내부 호출 메서드]
         * - emergencyDataService.getSnapshot(refresh, compact) : Hot/Cold 캐시 정책에 따라 전체 또는 경량 스냅샷을 반환함.
         *
         * [지역 변수명]
         * - snapshot : 서비스 계층에서 돌려받은 EmergencySnapshotDto 인스턴스 변수명.
         *
         * [동작 흐름]
         * - 호출 출처 : search-controls.js의 fetchData(forceRefresh)가 초기 로딩·새로고침 시 GET /api/hospitals 요청.
         * - 흐름 :
         *   1) emergencyDataService.getSnapshot(refresh, compact) 호출 ──> 캐시 유효성·15초 쿨다운 확인
         *   ├── compact=true ──> 경량 스냅샷 반환 ──> ResponseEntity.ok(snapshot)
         *   └── compact=false ──> 전체 스냅샷 반환 ──> ResponseEntity.ok(snapshot)
         * - 전달 대상 : 프론트엔드 fetchData()가 localStorage 백업 저장 및 지도 마커·자동완성 목록을 그림.
         *
         * [URL 생성 출처 및 프론트엔드 호출부]
         * - URL 생성 : application.yml server.port(${PORT:8080}) + @RequestMapping("/api") + @GetMapping("/hospitals")
         *   · 최종 URL : http://localhost:8080/api/hospitals
         * - 프론트엔드 호출부 :
         *   · frontend/js/search-controls.js : fetchData(forceRefresh)에서 호출
         *   · 일반 조회는 /api/hospitals?compact=true, 수동 새로고침은 ?refresh=true&compact=true 전달
         *   · frontend/js/app.js : init() 및 loadData() 경유 호출
         *
         * [실행 방법]
         * - 서버 기동 : .\gradlew.bat bootRun (또는 Yonsei119Application.main() 실행)
         * - 호출 예시 : http://localhost:8080/api/hospitals?compact=true 또는 curl "http://localhost:8080/api/hospitals?refresh=true&compact=true"
         *
         * [실행 결과 예시]
         * - compact=true 호출 시
         *   · HTTP 200 OK : {"updatedAt":"2026-11-18T19:00:00+09:00","cached":true,"totalCount":531,"tertiaryCount":47,"regionalCount":44,"medicalCount":31,"traumaCount":17,"otherCount":453,"sources":{"list":true,"basic":true,"beds":true,"messages":true,"severe":true,"traumaList":true,"traumaBasic":true},"endpointCounts":{"list":531,"basic":531,"beds":415,"messages":120,"severe":412,"traumaList":17,"traumaBasic":17},"hospitals":[{"id":"A2200001","name":"연세대학교원주세브란스기독병원","address":"강원특별자치도 원주시 일산로 20","tel":"033-741-0114","erTel":"033-741-1119","lat":37.31912,"lng":127.94561,"regional":true,"type":{"group":"tertiary","label":"상급종합병원","accent":"#d34458","priority":1},"basic":{"dutyemclsname":"권역응급의료센터"},"trauma":{"designated":"Y"},"beds":{"hvec":"-2","hvs01":"30"},"messages":[...],"severe":{...}}]}
         */
    }

    @GetMapping("/hospitals/{hpid}")
    public ResponseEntity<HospitalDto> getHospitalDetail(
            @PathVariable(name = "hpid") String hpid
    ) {
    /*
     * [스프링 내장 어노테이션]
     * - @GetMapping 정의 (출처: org.springframework.web.bind.annotation.GetMapping, 이름 변경 불가)
     *   · 역할 : 데이터 조회용 HTTP GET 요청 URL을 특정 컨트롤러 메서드에 연결해 주는 @RequestMapping(method = GET) 축약 어노테이션임.
     * - @GetMapping("/hospitals/{hpid}") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyApiController.getHospitalDetail(String hpid) 메서드
     *   · 작동 원리 : @RequestMapping("/api")와 합쳐 GET /api/hospitals/{hpid} 요청 시 DispatcherServlet이 getHospitalDetail()을 호출함.
     *   · 비교 : 생성 @PostMapping, 전체 교체 @PutMapping, 부분 수정 @PatchMapping, 삭제 @DeleteMapping이 있음.
     * - @PathVariable 정의 (출처: org.springframework.web.bind.annotation.PathVariable, 이름 변경 불가)
     *   · 역할 : 요청 URL 경로의 중괄호 변수 구간(/{이름})에 들어온 값을 추출해 컨트롤러 메서드 매개변수에 전달하는 어노테이션임.
     * - @PathVariable(name = "hpid") 현재 코드 적용
     *   · 적용 대상 : getHospitalDetail()의 hpid(String) 매개변수
     *   · 작동 원리 : URL 경로 중괄호 자리({hpid})에 들어온 병원 기관 코드 문자열을 추출해 hpid 매개변수에 바인딩함.
     *   · 비교 : 쿼리스트링 @RequestParam, 요청 헤더 @RequestHeader, 행렬 변수 @MatrixVariable이 있음.
     *
     * [자바 문법]
     * - public, ResponseEntity<HospitalDto> 제네릭 타입 선언.
     *
     * [자바/스프링 내장 타입 (이름 변경 불가)]
     * - ResponseEntity<T> (출처: org.springframework.http 패키지), String (출처: java.lang 패키지).
     *
     * [프로젝트 내부 정의 타입]
     * - HospitalDto (출처: com.yonsei119.dto 패키지) : 병원 1곳의 전체 원본 필드(basic·trauma·beds·messages·severe) DTO임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : getHospitalDetail.
     * - 매개변수명 : hpid (조회할 병원 기관 고유코드, 예: "A2200001").
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
         * [자바 문법]
         * - if { ... } : 입력 형식 오류와 미존재 분기를 처리하는 조건문임.
         * - ==, ||, 논리 부정(!hpid...), null : null 비교, OR 연산(앞이 참이면 뒤 생략), 참/거짓 반전 연산자임.
         * - return : 각 조건에 맞는 HTTP 상태 응답을 바로 돌려줌.
         *
         * [자바/스프링 내장 메서드 (이름 변경 불가)]
         * - String.trim() (출처: java.lang 패키지) : 문자열 앞뒤 공백을 제거함.
         * - String.matches(String regex) (출처: java.lang 패키지) : 정규식과 전체 일치 여부를 검사해 비정상 입력을 막음.
         * - ResponseEntity.badRequest().build() (출처: org.springframework.http 패키지) : 본문 없는 HTTP 400 응답을 만듦.
         * - ResponseEntity.notFound().build() (출처: org.springframework.http 패키지) : 본문 없는 HTTP 404 응답을 만듦.
         * - ResponseEntity.ok(T body) (출처: org.springframework.http 패키지) : 조회한 결과 객체를 HTTP 200 OK 본문으로 감쌈.
         *
         * [프로젝트 내부 호출 메서드]
         * - emergencyDataService.getHospitalById(hpid) : cachedHospitalById 해시 인덱스에서 hpid 값에 맞는 원본 HospitalDto를 O(1) 조회함.
         *
         * [지역 변수명]
         * - detail : 조회된 병원 전체 상세 DTO (없으면 null).
         *
         * [동작 흐름]
         * - 호출 출처 : hospital-sheet.js의 hydrateHospitalDetailIfNeeded()가 개발자 모드 열람 시 GET /api/hospitals/{hpid} 요청.
         * - 흐름 :
         *   ├── hpid가 null이거나 영문·숫자·_·- 3~24자가 아님 ──> HTTP 400 Bad Request 반환
         *   ├── emergencyDataService.getHospitalById(hpid) 결과가 null ──> HTTP 404 Not Found 반환
         *   └── 유효한 병원 상세 조회 성공 ──> ResponseEntity.ok(detail) (HTTP 200 OK) 반환
         * - 전달 대상 : 프론트엔드가 JSON을 state.detailCache에 저장하고 개발자 모드 원본 대조표를 렌더링함.
         *
         * [URL 생성 출처 및 프론트엔드 호출부]
         * - URL 생성 : application.yml server.port(${PORT:8080}) + @RequestMapping("/api") + @GetMapping("/hospitals/{hpid}")
         *   · 최종 URL 예시 : http://localhost:8080/api/hospitals/A2200001
         * - 프론트엔드 호출부 :
         *   · frontend/js/hospital-sheet.js : hydrateHospitalDetailIfNeeded()에서 fetch 호출
         *   · renderDeveloperInspector()가 개발자 모드 아코디언 열람 시 온디맨드 요청함
         *
         * [실행 방법]
         * - 서버 기동 : .\gradlew.bat bootRun (또는 Yonsei119Application.main() 실행)
         * - 호출 예시 : http://localhost:8080/api/hospitals/A2200001 또는 curl -i http://localhost:8080/api/hospitals/A2200001
         *
         * [실행 결과 예시]
         * - 유효 HPID 호출 시
         *   · HTTP 200 OK : {"id":"A2200001","name":"연세대학교원주세브란스기독병원","address":"강원특별자치도 원주시 일산로 20","tel":"033-741-0114","erTel":"033-741-1119","lat":37.31912,"lng":127.94561,"regional":true,"type":{"group":"tertiary","label":"상급종합병원","accent":"#d34458","priority":1},"basic":{"dutyemclsname":"권역응급의료센터","dutyetc":"..."},"trauma":{"dutyemclsname":"권역외상센터"},"beds":{"hvec":"-2","hvs01":"30",...},"messages":[...],"severe":{...}}
         * - 형식 오류 (/api/hospitals/A1 등) : 본문 없이 HTTP 400 Bad Request 반환
         * - 미존재 ID (/api/hospitals/NO_SUCH_ID) : 본문 없이 HTTP 404 Not Found 반환
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
     * [스프링 내장 어노테이션]
     * - @GetMapping 정의 (출처: org.springframework.web.bind.annotation.GetMapping, 이름 변경 불가)
     *   · 역할 : 데이터 조회용 HTTP GET 요청 URL을 특정 컨트롤러 메서드에 연결해 주는 @RequestMapping(method = GET) 축약 어노테이션임.
     * - @GetMapping("/directions") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyApiController.getDirections(...) 메서드
     *   · 작동 원리 : @RequestMapping("/api")와 합쳐 GET /api/directions 요청 시 DispatcherServlet이 getDirections()를 호출함.
     *   · 비교 : 생성 @PostMapping, 전체 교체 @PutMapping, 부분 수정 @PatchMapping, 삭제 @DeleteMapping이 있음.
     * - @RequestParam 정의 (출처: org.springframework.web.bind.annotation.RequestParam, 이름 변경 불가)
     *   · 역할 : 요청 URL의 쿼리스트링(?이름=값) 파라미터를 읽어 컨트롤러 메서드 매개변수 타입으로 자동 변환·전달하는 어노테이션임.
     * - @RequestParam(...) 현재 코드 적용
     *   · 적용 대상 : getDirections()의 startLat·startLng·goalLat·goalLng(필수) 및 apiType·option·waypoints(선택) 7개 매개변수
     *   · 작동 원리 : 쿼리 파라미터를 double·String으로 바인딩하며 필수값 누락 시 HTTP 400을 내고 선택값은 defaultValue를 적용함.
     *   · 비교 : 경로 변수 @PathVariable, 요청 헤더 @RequestHeader, JSON 본문 @RequestBody, 폼 @ModelAttribute가 있음.
     *
     * [자바 문법]
     * - public, 기본형 double, ResponseEntity<DirectionsResponseDto> 제네릭 타입 선언.
     *
     * [자바/스프링 내장 타입 (이름 변경 불가)]
     * - ResponseEntity<T> (출처: org.springframework.http 패키지), String (출처: java.lang 패키지).
     *
     * [프로젝트 내부 정의 타입]
     * - DirectionsResponseDto (출처: com.yonsei119.dto 패키지) : 경로 좌표선·혼잡 구간·회전 안내·4대 옵션 비교 DTO임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : getDirections.
     * - 매개변수명 :
     *   · startLat, startLng : 출발지 위도·경도.
     *   · goalLat, goalLng : 도착 병원 위도·경도.
     *   · apiType, option, waypoints : API 종류("directions5"|"directions15"), 경로 옵션("trafast" 등), 경유지("경도,위도").
     */
        DirectionsResponseDto result = naverDirectionsService.getDrivingRoute(
                startLat, startLng, goalLat, goalLng, apiType, option, waypoints
        );
        return ResponseEntity.ok(result);
        /*
         * [자바 문법]
         * - return : 서비스 계층 결과를 ResponseEntity에 담아 반환함.
         *
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - ResponseEntity.ok(T body) (출처: org.springframework.http 패키지) : 조회한 결과 객체를 HTTP 200 본문으로 감쌈.
         *
         * [프로젝트 내부 호출 메서드]
         * - naverDirectionsService.getDrivingRoute(...) :
         *   · 좌표·경유지 검증 후 routeCache(60초 TTL)를 먼저 조회함.
         *   · 캐시 미스 시 네이버 Directions API를 병렬 호출해 4대 옵션 비교 결과를 만듦.
         *
         * [지역 변수명]
         * - result : 경로 탐색 결과가 담긴 DirectionsResponseDto 변수명.
         *
         * [동작 흐름]
         * - 호출 출처 : directions-eta.js의 loadDirectionsForHospital()·refreshActiveRoute()가 GET /api/directions 요청.
         * - 흐름 : 7개 파라미터 전달 ──> naverDirectionsService.getDrivingRoute() ──> ResponseEntity.ok(result) 반환.
         * - 전달 대상 : 프론트엔드가 JSON을 받아 4대 경로 옵션 카드, ETA·요금 KPI, 지도 경로선을 그림.
         *
         * [URL 생성 출처 및 프론트엔드 호출부]
         * - URL 생성 : application.yml server.port(${PORT:8080}) + @RequestMapping("/api") + @GetMapping("/directions")
         *   · 최종 URL : http://localhost:8080/api/directions
         * - 프론트엔드 호출부 :
         *   · frontend/js/directions-eta.js : refreshActiveRoute() 및 loadDirectionsForHospital()에서 호출
         *
         * [실행 방법]
         * - 서버 기동 : .\gradlew.bat bootRun (또는 Yonsei119Application.main() 실행)
         * - 호출 예시 : curl "http://localhost:8080/api/directions?startLat=37.3190&startLng=127.9012&goalLat=37.3191&goalLng=127.9456&apiType=directions5&option=trafast"
         *
         * [실행 결과 예시]
         * - 탐색 성공 시
         *   · HTTP 200 OK : {"apiType":"directions5","apiLabel":"Directions 5","option":"trafast","optionLabel":"실시간 빠른길","code":0,"message":"ok","distanceMeters":6700,"distanceKm":6.7,"durationMs":660000,"durationMinutes":11,"durationText":"약 11분","departureTime":"2026-11-18T19:00:00","tollFare":0,"taxiFare":9200,"fuelPrice":850,"path":[[127.9012,37.319],[127.9456,37.3191]],"sections":[{"pointIndex":0,"pointCount":1,"distance":6700,"name":"서원대로","congestion":1,"speed":42}],"guidePrompts":["연세대길 방면 우회전","목적지 도착"],"alternatives":[{"option":"trafast","optionLabel":"실시간 빠른길","distanceMeters":6700,"distanceKm":6.7,"durationMs":660000,"durationMinutes":11,"durationText":"약 11분","tollFare":0,"taxiFare":9200,"fuelPrice":850}]}
         * - 좌표 오류·인증키 미설정 시 : code -400 등 오류 DTO 반환 (필수 파라미터 누락 시 HTTP 400 반환)
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
     * [스프링 내장 어노테이션]
     * - @GetMapping 정의 (출처: org.springframework.web.bind.annotation.GetMapping, 이름 변경 불가)
     *   · 역할 : 데이터 조회용 HTTP GET 요청 URL을 특정 컨트롤러 메서드에 연결해 주는 @RequestMapping(method = GET) 축약 어노테이션임.
     * - @GetMapping("/directions/rank") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyApiController.rankDirections(...) 메서드
     *   · 작동 원리 : @RequestMapping("/api")와 합쳐 GET /api/directions/rank 요청 시 DispatcherServlet이 rankDirections()를 호출함.
     *   · 비교 : 생성 @PostMapping, 전체 교체 @PutMapping, 부분 수정 @PatchMapping, 삭제 @DeleteMapping이 있음.
     * - @RequestParam 정의 (출처: org.springframework.web.bind.annotation.RequestParam, 이름 변경 불가)
     *   · 역할 : 요청 URL의 쿼리스트링(?이름=값) 파라미터를 읽어 컨트롤러 메서드 매개변수 타입으로 자동 변환·전달하는 어노테이션임.
     * - @RequestParam(...) 현재 코드 적용
     *   · 적용 대상 : rankDirections()의 startLat·startLng(필수) 및 선택 10개 매개변수
     *   · 선택 매개변수 : radiusKm·limit·includeRegional·includeTertiary·includeMedical·includeOther·onlyAvailable·symptom·mode·option
     *   · 작동 원리 : 쿼리 문자열을 double·int·boolean·String으로 바인딩하며 선택 10개는 생략 시 defaultValue를 자동 주입함.
     *   · 비교 : 경로 변수 @PathVariable, 요청 헤더 @RequestHeader, JSON 본문 @RequestBody, 폼 @ModelAttribute가 있음.
     *
     * [자바 문법]
     * - public, 기본형 double·int·boolean, ResponseEntity<List<HospitalEtaRankDto>> 중첩 제네릭 선언.
     *
     * [자바/스프링 내장 타입 (이름 변경 불가)]
     * - ResponseEntity<T> (출처: org.springframework.http 패키지), List<E> (출처: java.util 패키지), String (java.lang).
     *
     * [프로젝트 내부 정의 타입]
     * - HospitalEtaRankDto (출처: com.yonsei119.dto 패키지) : 순위·실도로 거리·예상 시간·병상 상태·추천 점수 DTO임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : rankDirections.
     * - 매개변수명 :
     *   · startLat, startLng, radiusKm(기본 20km), limit(최대 개수, 기본 5).
     *   · includeRegional~includeOther(4대 종별 필터), onlyAvailable(가용 병상 보유만), symptom(증상 프리셋).
     *   · mode("optimal"|"fastest"), option(주행 옵션).
     */
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(false, false);
        List<HospitalEtaRankDto> ranked = naverDirectionsService.rankHospitalsByDrivingTime(
                snapshot.hospitals(), startLat, startLng, radiusKm, limit,
                includeRegional, includeTertiary, includeMedical, includeOther,
                onlyAvailable, symptom, mode, option
        );
        return ResponseEntity.ok(ranked);
        /*
         * [자바 문법]
         * - return : 정렬된 추천 병원 목록을 HTTP 200 응답으로 반환함.
         *
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - ResponseEntity.ok(T body) (출처: org.springframework.http 패키지) : 조회한 결과 목록을 HTTP 200 본문으로 감쌈.
         *
         * [프로젝트 내부 정의 타입 및 호출 메서드]
         * - EmergencySnapshotDto : 전체 병원 목록을 담은 스냅샷 record DTO.
         * - emergencyDataService.getSnapshot(false, false) : 캐시된 전체 응급의료 스냅샷을 조회함.
         * - snapshot.hospitals() : EmergencySnapshotDto에서 병원 목록(List)을 꺼내는 record 조회 메서드임.
         * - naverDirectionsService.rankHospitalsByDrivingTime(...) :
         *   · 조건 필터링 ──> 후보 병원 병렬 ETA 조회 ──> HospitalRecommendationScorer 점수화 및 순위 정렬 수행.
         *
         * [지역 변수명]
         * - snapshot : 전체 병원 목록을 꺼내기 위해 조회한 EmergencySnapshotDto 변수명.
         * - ranked : 우선순위 정렬이 끝난 HospitalEtaRankDto 목록 변수명.
         *
         * [동작 흐름]
         * - 호출 출처 : directions-eta.js의 loadEtaRanking()이 추천 순위 열기·필터 변경 시 GET /api/directions/rank 요청.
         * - 흐름 :
         *   1) emergencyDataService.getSnapshot(false, false) ──> 최신 전체 병원 스냅샷 획득
         *   2) naverDirectionsService.rankHospitalsByDrivingTime(...) ──> 병렬 ETA·추천 점수 순위 계산
         *   3) ResponseEntity.ok(ranked) ──> HTTP 200 OK JSON 배열 반환
         * - 전달 대상 : 프론트엔드 loadEtaRanking()이 JSON 배열을 받아 #eta-rank-box 추천 목록을 렌더링함.
         *
         * [URL 생성 출처 및 프론트엔드 호출부]
         * - URL 생성 : application.yml server.port(${PORT:8080}) + @RequestMapping("/api") + @GetMapping("/directions/rank")
         *   · 최종 URL : http://localhost:8080/api/directions/rank
         * - 프론트엔드 호출부 :
         *   · frontend/js/directions-eta.js : loadEtaRanking()에서 fetch 호출
         *   · frontend/js/app.js(#eta-rank-btn·종별 체크박스) 및 search-controls.js(반경·증상·출발점) 변경 시 연동됨
         *
         * [실행 방법]
         * - 서버 기동 : .\gradlew.bat bootRun (또는 Yonsei119Application.main() 실행)
         * - 호출 예시 : curl "http://localhost:8080/api/directions/rank?startLat=37.3190&startLng=127.9012&radiusKm=20&limit=5&mode=optimal&symptom=stroke&onlyAvailable=true"
         *
         * [실행 결과 예시]
         * - 조건 일치 병원 존재 시
         *   · HTTP 200 OK : [{"rank":1,"id":"A2200001","name":"연세대학교원주세브란스기독병원","typeGroup":"tertiary","typeLabel":"상급종합병원","regional":true,"erBeds":"5","straightDistanceKm":3.9,"drivingDistanceKm":6.7,"durationMinutes":11,"durationText":"약 11분","tollFare":0,"taxiFare":9200,"lat":37.31912,"lng":127.94561,"availabilityStatus":"여유","hasBlockingNotice":false,"recommendationScore":8.8,"recommendationReason":"응급실 5석 여유 · 차단 공지 없음 · 뇌졸중·뇌출혈 수용 가능"}]
         * - 조건 일치 병원 없음 또는 좌표 오류 시 : 빈 배열 [] 반환 (startLat·startLng 누락 시 HTTP 400 반환)
         */
    }

    @GetMapping("/reverse-geocode")
    public ResponseEntity<ReverseGeocodeResponseDto> reverseGeocode(
            @RequestParam(name = "lat") double lat,
            @RequestParam(name = "lng") double lng
    ) {
    /*
     * [스프링 내장 어노테이션]
     * - @GetMapping 정의 (출처: org.springframework.web.bind.annotation.GetMapping, 이름 변경 불가)
     *   · 역할 : 데이터 조회용 HTTP GET 요청 URL을 특정 컨트롤러 메서드에 연결해 주는 @RequestMapping(method = GET) 축약 어노테이션임.
     * - @GetMapping("/reverse-geocode") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyApiController.reverseGeocode(double lat, double lng) 메서드
     *   · 작동 원리 : @RequestMapping("/api")와 합쳐 GET /api/reverse-geocode 요청 시 DispatcherServlet이 reverseGeocode()를 호출함.
     *   · 비교 : 생성 @PostMapping, 전체 교체 @PutMapping, 부분 수정 @PatchMapping, 삭제 @DeleteMapping이 있음.
     * - @RequestParam 정의 (출처: org.springframework.web.bind.annotation.RequestParam, 이름 변경 불가)
     *   · 역할 : 요청 URL의 쿼리스트링(?이름=값) 파라미터를 읽어 컨트롤러 메서드 매개변수 타입으로 자동 변환·전달하는 어노테이션임.
     * - @RequestParam(name = "lat" / "lng") 현재 코드 적용
     *   · 적용 대상 : reverseGeocode()의 lat(double), lng(double) 필수 매개변수
     *   · 작동 원리 : 쿼리스트링 ?lat=...&lng=... 값을 double로 변환해 바인딩하며 하나라도 누락되면 HTTP 400을 반환함.
     *   · 비교 : 경로 변수 @PathVariable, 요청 헤더 @RequestHeader, JSON 본문 @RequestBody, 폼 @ModelAttribute가 있음.
     *
     * [자바 문법]
     * - public, 기본형 double, ResponseEntity<ReverseGeocodeResponseDto> 제네릭 타입 선언.
     *
     * [스프링 내장 타입 (이름 변경 불가)]
     * - ResponseEntity<T> (출처: org.springframework.http 패키지).
     *
     * [프로젝트 내부 정의 타입]
     * - ReverseGeocodeResponseDto (출처: com.yonsei119.dto 패키지) : 요약·전체·도로명·지번 주소를 담는 record DTO임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : reverseGeocode.
     * - 매개변수명 : lat(위도), lng(경도).
     */
        return ResponseEntity.ok(naverGeocodingService.reverseGeocode(lat, lng));
        /*
         * [자바 문법]
         * - return : 변환된 주소 DTO를 HTTP 200 응답으로 바로 반환함.
         *
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - ResponseEntity.ok(T body) (출처: org.springframework.http 패키지) : 조회한 결과 객체를 HTTP 200 본문으로 감쌈.
         *
         * [프로젝트 내부 호출 메서드]
         * - naverGeocodingService.reverseGeocode(lat, lng) : 좌표 검증, 10분 TTL 캐시 확인, 네이버 역지오코딩 API 호출·파싱을 수행함.
         *
         * [동작 흐름]
         * - 호출 출처 : search-controls.js의 updateOriginAddress()가 출발 좌표 확정·변경 시 GET /api/reverse-geocode 요청.
         * - 흐름 : naverGeocodingService.reverseGeocode(lat, lng) ──> ReverseGeocodeResponseDto ──> ResponseEntity.ok(...) 반환.
         * - 전달 대상 : 프론트엔드 updateOriginAddress()가 shortAddress·fullAddress를 읽어 출발 기준 표시줄을 갱신함.
         *
         * [URL 생성 출처 및 프론트엔드 호출부]
         * - URL 생성 : application.yml server.port(${PORT:8080}) + @RequestMapping("/api") + @GetMapping("/reverse-geocode")
         *   · 최종 URL : http://localhost:8080/api/reverse-geocode
         * - 프론트엔드 호출부 :
         *   · frontend/js/search-controls.js : updateOriginAddress()에서 fetch 호출
         *   · frontend/js/app.js 초기화·locate()·setCustomOrigin() 실행 시 연동 호출됨
         *
         * [실행 방법]
         * - 서버 기동 : .\gradlew.bat bootRun (또는 Yonsei119Application.main() 실행)
         * - 호출 예시 : curl "http://localhost:8080/api/reverse-geocode?lat=37.3190&lng=127.9012"
         *
         * [실행 결과 예시]
         * - 변환 성공 시
         *   · HTTP 200 OK : {"code":0,"message":"ok","lat":37.319,"lng":127.9012,"shortAddress":"강원 원주시 흥업면","fullAddress":"강원특별자치도 원주시 흥업면 연세대길 1 연세대학교 미래캠퍼스","roadAddress":"강원특별자치도 원주시 흥업면 연세대길 1 연세대학교 미래캠퍼스","jibunAddress":"강원특별자치도 원주시 흥업면 매지리 1496"}
         * - 좌표 오류 또는 인증키 미설정 시
         *   · HTTP 200 OK : {"code":-1,"message":"API 인증키 미설정","lat":37.319,"lng":127.9012,"shortAddress":"위도 37.3190, 경도 127.9012","fullAddress":"위도 37.3190, 경도 127.9012","roadAddress":"","jibunAddress":""}
         */
    }

    @GetMapping("/geocode")
    public ResponseEntity<GeocodeResponseDto> geocode(
            @RequestParam(name = "query") String query
    ) {
    /*
     * [스프링 내장 어노테이션]
     * - @GetMapping 정의 (출처: org.springframework.web.bind.annotation.GetMapping, 이름 변경 불가)
     *   · 역할 : 데이터 조회용 HTTP GET 요청 URL을 특정 컨트롤러 메서드에 연결해 주는 @RequestMapping(method = GET) 축약 어노테이션임.
     * - @GetMapping("/geocode") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 EmergencyApiController.geocode(String query) 메서드
     *   · 작동 원리 : @RequestMapping("/api")와 합쳐 GET /api/geocode 요청 시 DispatcherServlet이 geocode()를 호출함.
     *   · 비교 : 생성 @PostMapping, 전체 교체 @PutMapping, 부분 수정 @PatchMapping, 삭제 @DeleteMapping이 있음.
     * - @RequestParam 정의 (출처: org.springframework.web.bind.annotation.RequestParam, 이름 변경 불가)
     *   · 역할 : 요청 URL의 쿼리스트링(?이름=값) 파라미터를 읽어 컨트롤러 메서드 매개변수 타입으로 자동 변환·전달하는 어노테이션임.
     * - @RequestParam(name = "query") 현재 코드 적용
     *   · 적용 대상 : geocode()의 query(String) 필수 매개변수
     *   · 작동 원리 : URL 쿼리스트링 ?query=... 검색어 문자열을 추출해 바인딩하며 누락 시 스프링이 HTTP 400을 반환함.
     *   · 비교 : 경로 변수 @PathVariable, 요청 헤더 @RequestHeader, JSON 본문 @RequestBody, 폼 @ModelAttribute가 있음.
     *
     * [자바 문법]
     * - public, ResponseEntity<GeocodeResponseDto> 제네릭 타입 선언.
     *
     * [자바/스프링 내장 타입 (이름 변경 불가)]
     * - ResponseEntity<T> (출처: org.springframework.http 패키지), String (출처: java.lang 패키지).
     *
     * [프로젝트 내부 정의 타입]
     * - GeocodeResponseDto (출처: com.yonsei119.dto 패키지) : 검색 상태 코드·검색어·좌표 후보 목록을 담는 record DTO임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : geocode.
     * - 매개변수명 : query (사용자가 입력한 도로명·지번·장소명 검색어).
     */
        EmergencySnapshotDto snapshot = emergencyDataService.getSnapshot(false, true);
        return ResponseEntity.ok(naverGeocodingService.geocode(query, snapshot.hospitals()));
        /*
         * [자바 문법]
         * - return : 지오코딩 응답 DTO를 HTTP 200 응답으로 반환함.
         *
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - ResponseEntity.ok(T body) (출처: org.springframework.http 패키지) : 조회한 결과 객체를 HTTP 200 본문으로 감쌈.
         *
         * [프로젝트 내부 정의 타입 및 호출 메서드]
         * - EmergencySnapshotDto : 병원 목록 참조용 스냅샷 DTO.
         * - emergencyDataService.getSnapshot(false, true) : 병원명·주소·좌표만 필요하므로 경량(compact=true) 스냅샷을 조회함.
         * - snapshot.hospitals() : 병원 목록(List)을 꺼내는 record 조회 메서드임.
         * - naverGeocodingService.geocode(query, ...) : 1단계 NCP ──> 2단계 병원 주소록 ──> 3단계 Nominatim 순으로 검색함.
         *
         * [지역 변수명]
         * - snapshot : 2단계 병원 주소록 매칭에 넘길 경량 스냅샷 변수명.
         *
         * [동작 흐름]
         * - 호출 출처 : search-controls.js의 geocodeAndMoveOrigin()이 주소 출발점 이동 시 GET /api/geocode 요청.
         * - 흐름 :
         *   1) emergencyDataService.getSnapshot(false, true) ──> 경량 병원 목록 획득
         *   2) naverGeocodingService.geocode(query, snapshot.hospitals()) ──> 3단계 하이브리드 지오코딩 수행
         *   3) ResponseEntity.ok(...) ──> HTTP 200 OK JSON 반환
         * - 전달 대상 : 프론트엔드 geocodeAndMoveOrigin()이 items[0] 좌표로 출발 기준점을 이동시킴.
         *
         * [URL 생성 출처 및 프론트엔드 호출부]
         * - URL 생성 : application.yml server.port(${PORT:8080}) + @RequestMapping("/api") + @GetMapping("/geocode")
         *   · 최종 URL : http://localhost:8080/api/geocode
         * - 프론트엔드 호출부 : frontend/js/search-controls.js의 geocodeAndMoveOrigin()에서 fetch 호출함.
         *
         * [실행 방법]
         * - 서버 기동 : .\gradlew.bat bootRun (또는 Yonsei119Application.main() 실행)
         * - 호출 예시 : curl --get --data-urlencode "query=연세대길 1" http://localhost:8080/api/geocode
         *
         * [실행 결과 예시]
         * - 검색 성공 시
         *   · HTTP 200 OK : {"code":0,"query":"연세대길 1","items":[{"title":"강원특별자치도 원주시 흥업면 연세대길 1","roadAddress":"강원특별자치도 원주시 흥업면 연세대길 1","jibunAddress":"강원특별자치도 원주시 흥업면 매지리 1496","lat":37.280875,"lng":127.9009998}]}
         * - 검색 결과 없음 시
         *   · HTTP 200 OK : {"code":404,"query":"존재하지않는장소","items":[]}
         */
    }
}
