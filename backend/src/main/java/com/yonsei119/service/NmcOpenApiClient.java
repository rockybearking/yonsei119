package com.yonsei119.service;

import com.yonsei119.config.Yonsei119Properties;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import java.util.regex.Pattern;
/*
 * [자바 문법]
 * - package : NmcOpenApiClient.java 파일이 속한 패키지 경로를 선언함.
 * - import : 외부 패키지의 클래스와 인터페이스를 짧은 이름으로 불러옴.
 *
 * [패키지명]
 * - com.yonsei119.service : OpenAPI 수집, 데이터 병합, 병원 분류 서비스들이 모인 패키지임.
 *
 * [자바/스프링/라이브러리 내장 타입]
 * - Logger, LoggerFactory (org.slf4j) : 시간·로그레벨과 함께 실행 로그를 남기는 표준 로거임.
 * - HttpClient, HttpRequest, HttpResponse : Java 11+ 표준 HTTP 통신 클라이언트와 요청·응답 타입임.
 * - URI, URLEncoder, StandardCharsets, Duration : 주소 파싱, UTF-8 인코딩, 시간 간격 표현 타입임.
 * - DocumentBuilderFactory, DocumentBuilder, Document, Element, Node, NodeList : W3C DOM XML 파싱 타입임.
 * - InputSource, XMLConstants, StringReader : 문자열 XML 입력 변환과 XXE 보안 상수 타입임.
 * - List, Map, ArrayList, LinkedHashMap, Locale : 목록·사전 컬렉션과 로케일 기준 상수 타입임.
 * - CompletableFuture, ConcurrentHashMap, ExecutorService, Executors : 비동기 실행, 안전 맵, 스레드 풀 타입임.
 *
 * [프로젝트 내부 타입]
 * - Yonsei119Properties (com.yonsei119.config) : application.yml 설정값을 묶어 읽는 프로젝트 레코드임.
 */

@Component
public class NmcOpenApiClient {
/*
 * [스프링 내장 어노테이션]
 * - @Component 정의 (출처: org.springframework.stereotype.Component, 이름 변경 불가)
 *   · 역할 : 개발자가 작성한 클래스를 컴포넌트 스캔 대상에 포함해 스프링 싱글톤 빈으로 자동 생성·등록하는 범용 어노테이션임.
 * - @Component 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 NmcOpenApiClient 클래스
 *   · 작동 원리 : 컴포넌트 스캔 대상이 되어 서버 부팅 시 스프링 컨테이너가 NmcOpenApiClient 싱글톤 빈 1개를 생성·관리함.
 *   · 실행 시점 : 스프링 애플리케이션 컨텍스트 초기화(부팅) 시점임.
 *   · 비교 : @Service(비즈니스), @Repository(DB), @RestController(API)와 같은 빈 등록 계열임.
 *
 * [자바 문법]
 * - public class : 다른 패키지에서도 접근 가능한 공개 클래스를 선언함.
 *
 * [클래스명]
 * - NmcOpenApiClient : 국립중앙의료원(NEMC) 7종 XML OpenAPI를 수집·파싱·폴백하는 클라이언트임.
 *
 * [동작 흐름]
 * - 1) 상위 서비스 호출 -> fetchHotDatasets()(실시간 3종) 또는 fetchAllDatasets()(전체 7종) 분기
 * - 2) fetchEndpointGroup() -> 2개 데몬 스레드 풀(fetchExecutor)로 오퍼레이션 병렬 실행
 * - 3) fetchAllPages() ──> 1~10페이지 순회 ──> fetchSinglePage()로 HTTP GET·3회 재시도·XML 파싱
 * - 4) 오류 발생 시 ──> lastSuccessfulByOperation의 직전 정상 캐시로 폴백해 중단 방지
 */

    private static final Logger log = LoggerFactory.getLogger(NmcOpenApiClient.class);
    private static final int DEFAULT_ROWS_PER_PAGE = 1000;
    private static final int MAX_PAGES = 10;
    private static final int MAX_CONCURRENT_REQUESTS = 2;
    private static final int MAX_ATTEMPTS_PER_PAGE = 3;
    private static final long RETRY_BASE_BACKOFF_MS = 800L;
    private static final Pattern TRAILING_SLASH_PATTERN = Pattern.compile("/+$");
    /*
     * [자바 문법]
     * - private static final : 클래스 내부에서만 공유하며 값을 바꿀 수 없는 상수 선언임.
     * - int / long : 32비트 정수(int)와 64비트 큰 정수(long, 뒤 L 접미사) 기본형임.
     * - 클래스.class : 클래스 자체의 메타정보(Class 객체)를 전달하는 리터럴 문법임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Logger, LoggerFactory (org.slf4j) : 실행 로그를 기록하는 표준 로거 인터페이스와 팩토리임.
     *
     * [자바/스프링 내장 메서드]
     * - LoggerFactory.getLogger(클래스.class) : 전달한 클래스 이름의 Logger 인스턴스를 생성함.
     *
     * [상수명]
     * - log : 클래스 실행 로그 출력용 정적 로거 상수임.
     * - DEFAULT_ROWS_PER_PAGE (1000) : 1페이지당 요청 행 수임(전국 약 530개 기관을 보통 1회로 수신).
     * - MAX_PAGES (10) : totalCount 이상 응답 시 무한 루프를 막는 페이지 상한임.
     * - MAX_CONCURRENT_REQUESTS (2) : 게이트웨이·컨테이너 과부하를 막는 동시 요청 스레드 상한임.
     * - MAX_ATTEMPTS_PER_PAGE (3) : 한 페이지 요청 실패 시 최대 시도 횟수임.
     * - RETRY_BASE_BACKOFF_MS (800L) : 재시도 기본 대기(ms)로, 800ms -> 1,600ms 간격으로 대기함.
     */

    public static final Map<String, String> COLD_ENDPOINTS = createColdEndpointMap();
    public static final Map<String, String> HOT_ENDPOINTS = createHotEndpointMap();
    public static final Map<String, String> ENDPOINTS = createAllEndpointMap();
    /*
     * [자바 문법]
     * - public static final : 외부 클래스에서도 클래스명.상수명으로 읽는 정적 불변 상수임.
     * - 정적 메서드 초기화 : 클래스 로딩 시 우변 메서드가 1회 실행되어 상수가 확정됨.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, String> : 문자열 키와 값을 1:1로 짝짓는 자바 표준 제네릭 인터페이스임.
     *
     * [상수명]
     * - COLD_ENDPOINTS : 주소·좌표·기본정보·외상센터 등 변동이 적은 마스터 4종 불변 맵임.
     * - HOT_ENDPOINTS : 실시간 병상·공지·중증수용 등 변동이 잦은 실시간 3종 불변 맵임.
     * - ENDPOINTS : COLD_ENDPOINTS 4종과 HOT_ENDPOINTS 3종을 합친 전체 7종 불변 맵임.
     */

    private static Map<String, String> createColdEndpointMap() {
    /*
     * [자바 문법]
     * - private static : 클래스 내부 정적 상수 초기화 전용 비공개 정적 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, String> : 문자열 키-값 쌍을 담는 반환 인터페이스 타입임.
     *
     * [메서드명 및 매개변수명]
     * - createColdEndpointMap : 매개변수 없이 Cold 마스터 OpenAPI 4종 맵을 만들어 반환함.
     */
        Map<String, String> map = new LinkedHashMap<>();
        map.put("list", "getEgytListInfoInqire");
        map.put("basic", "getEgytBassInfoInqire");
        map.put("traumaList", "getStrmListInfoInqire");
        map.put("traumaBasic", "getStrmBassInfoInqire");
        return Map.copyOf(map);
        /*
         * [자바 문법]
         * - new / <> : 힙에 새 객체를 만들고 좌변 타입(<String, String>)을 자동 추론함.
         * - return : 완성된 불변 Map을 호출부로 반환함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map<String, String> : 키-값 저장소 인터페이스임.
         * - LinkedHashMap : 넣은 순서를 유지하는 Map 구현체임(HashMap은 순서 무관, TreeMap은 키 정렬).
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new LinkedHashMap<>() : 빈 LinkedHashMap 인스턴스를 생성함.
         * - Map.put(키, 값) : 지정한 키와 문자열 값을 짝지어 맵에 저장함.
         * - Map.copyOf(원본맵) : 모든 항목을 복사해 수정 불가능한(Unmodifiable) 불변 Map을 반환함.
         *
         * [지역 변수명]
         * - map : Cold 4종("list", "basic", "traumaList", "traumaBasic")을 순서대로 담는 임시 맵임.
         */
    }

    private static Map<String, String> createHotEndpointMap() {
    /*
     * [자바 문법]
     * - private static : 클래스 내부 정적 상수 초기화 전용 비공개 정적 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, String> : 문자열 키-값 쌍을 담는 반환 인터페이스 타입임.
     *
     * [메서드명 및 매개변수명]
     * - createHotEndpointMap : 매개변수 없이 실시간 Hot OpenAPI 3종 맵을 만들어 반환함.
     */
        Map<String, String> map = new LinkedHashMap<>();
        map.put("beds", "getEmrrmRltmUsefulSckbdInfoInqire");
        map.put("messages", "getEmrrmSrsillDissMsgInqire");
        map.put("severe", "getSrsillDissAceptncPosblInfoInqire");
        return Map.copyOf(map);
        /*
         * [자바 문법]
         * - new / <> / return : 새 맵 객체를 생성해 채운 뒤 불변 맵으로 반환함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map<String, String> : 키-값 쌍 컬렉션 인터페이스임.
         * - LinkedHashMap : 넣은 순서를 유지하는 Map 구현체임(HashMap은 순서 무관, TreeMap은 키 정렬).
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new LinkedHashMap<>() : 빈 LinkedHashMap 생성자임.
         * - Map.put(키, 값) : 지정한 키와 문자열 값을 매핑해 맵에 저장함.
         * - Map.copyOf(원본맵) : 조립이 끝난 맵을 수정 불가 불변 Map으로 복사해 반환함.
         *
         * [지역 변수명]
         * - map : Hot 3종("beds", "messages", "severe")을 순서대로 담는 임시 맵임.
         */
    }

    private static Map<String, String> createAllEndpointMap() {
    /*
     * [자바 문법]
     * - private static : 클래스 내부 정적 상수 초기화 전용 비공개 정적 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, String> : 문자열 키-값 쌍을 담는 반환 인터페이스 타입임.
     *
     * [메서드명 및 매개변수명]
     * - createAllEndpointMap : 매개변수 없이 Cold 4종과 Hot 3종을 합친 전체 7종 맵을 생성함.
     */
        Map<String, String> map = new LinkedHashMap<>(COLD_ENDPOINTS);
        map.putAll(HOT_ENDPOINTS);
        return Map.copyOf(map);
        /*
         * [자바 문법]
         * - new / <> / return : 복사 생성자로 맵을 만들고 나머지를 합쳐 불변 맵으로 반환함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map<String, String>, LinkedHashMap (입력 순서 유지 구현체).
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new LinkedHashMap<>(기존맵) : 기존 맵의 항목을 삽입 순서 그대로 복사해 생성함.
         * - Map.putAll(추가맵) : 전달한 맵의 모든 키-값 쌍을 기존 맵에 한꺼번에 추가함.
         * - Map.copyOf(원본맵) : 수정할 수 없는 불변 Map 복사본을 생성해 반환함.
         *
         * [지역 변수명]
         * - map : COLD_ENDPOINTS 4종과 HOT_ENDPOINTS 3종을 순서대로 합치는 임시 맵임.
         */
    }

    private final Yonsei119Properties properties;
    private final HttpClient httpClient;
    private final ExecutorService fetchExecutor;
    private final Semaphore concurrencyLimiter = new Semaphore(MAX_CONCURRENT_REQUESTS);
    private final Map<String, List<Map<String, String>>> lastSuccessfulByOperation = new ConcurrentHashMap<>();
    private final MeterRegistry meterRegistry;
    /*
     * [자바 문법]
     * - private final : 외부 접근을 막고 생성 시 1회 대입 후 변경을 금지하는 멤버 필드임.
     *
     * [프로젝트 내부 타입]
     * - Yonsei119Properties : application.yml 설정값을 바인딩하는 프로젝트 불변 설정 레코드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - HttpClient (java.net.http) : 내부 연결 풀을 재사용하는 스레드 안전 HTTP 클라이언트임.
     * - ExecutorService (java.util.concurrent) : 가상 스레드 기반 비동기 작업 제출과 종료를 관리하는 실행기임.
     * - Semaphore (java.util.concurrent) : 가상 스레드 환경에서도 외부 API 동시 호출 상한(2건)을 엄격히 유지함.
     * - Map, ConcurrentHashMap : 동시 읽기·쓰기에 안전한 맵임(HashMap은 멀티스레드 쓰기 시 충돌 위험).
     *
     * [자바/스프링 내장 생성자]
     * - new Semaphore(2) : 동시 NEMC 요청 허가 수를 최대 2개로 제한하는 세마포어를 생성함.
     * - new ConcurrentHashMap<>() : 스레드 안전한 해시맵 기본 생성자임.
     *
     * [필드명 (멤버 변수)]
     * - properties : NEMC 기본 URL, 인증키, 타임아웃 설정을 읽는 설정 레코드 필드임.
     * - httpClient : HTTP/1.1 GET 통신에 재사용하는 클라이언트 필드임.
     * - fetchExecutor : 오퍼레이션별 작업을 가상 스레드로 실행하는 실행기 필드임.
     * - concurrencyLimiter : 외부 공공 API 동시 요청을 최대 2건으로 제한하는 세마포어 필드임.
     * - lastSuccessfulByOperation : 오퍼레이션별 직전 정상 수집 목록을 저장하는 폴백 캐시 필드임.
     */

    public NmcOpenApiClient(Yonsei119Properties properties) {
        this(properties, null);
    }

    @Autowired
    public NmcOpenApiClient(
            Yonsei119Properties properties,
            ObjectProvider<MeterRegistry> meterRegistryProvider
    ) {
    /*
     * [자바 문법]
     * - public 생성자 : 반환 타입이 없으며 빈 생성 시 스프링 DI가 자동 호출하는 생성자임.
     *
     * [프로젝트 내부 타입]
     * - Yonsei119Properties : 설정 바인딩용 프로젝트 레코드로 스프링이 자동 주입함.
     *
     * [생성자 및 매개변수명]
     * - NmcOpenApiClient : 타임아웃·가상 스레드 실행기·HTTP 클라이언트·메트릭 레지스트리를 초기화하는 생성자임.
     * - properties / meterRegistryProvider : 스프링 의존성 주입으로 전달받는 설정·메트릭 객체 매개변수임.
     */
        this.properties = properties;
        this.meterRegistry = meterRegistryProvider != null ? meterRegistryProvider.getIfAvailable() : null;
        long timeoutMs = Math.max(5000L, properties.nemc().requestTimeoutMs());
        this.fetchExecutor = Executors.newThreadPerTaskExecutor(
                Thread.ofVirtual().name("yonsei119-nemc-fetch-", 0).factory()
        );
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(timeoutMs))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        /*
         * [자바 문법]
         * - this. : 매개변수와 이름이 겹칠 때 인스턴스 자신의 필드를 가리키는 참조 키워드임.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Math, Executors, Thread, HttpClient, HttpClient.Version, HttpClient.Redirect, Duration.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - Math.max(5000L, 값) : 설정값이 5초 미만이어도 최소 5,000ms를 보장함.
         * - Thread.ofVirtual().name(..., 0).factory() : 작업마다 경량 가상 스레드를 만드는 팩토리를 생성함.
         * - Executors.newThreadPerTaskExecutor(팩토리) : 블로킹 HTTP I/O 중 플랫폼 스레드를 점유하지 않도록 함.
         * - HttpClient.newBuilder() ... .build() : 빌더 체이닝으로 불변 HttpClient를 생성함.
         * - .version(HTTP_1_1) / .connectTimeout(기간) / .followRedirects(NORMAL) : 프로토콜·제한·리다이렉트 설정.
         * - Duration.ofMillis(밀리초) : 밀리초 숫자 값을 java.time.Duration 객체로 변환함.
         *
         * [프로젝트 내부 접근자]
         * - properties.nemc().requestTimeoutMs() : application.yml의 timeout 설정을 읽는 record 접근자임.
         *
         * [지역 변수명]
         * - timeoutMs : 최소 5,000ms 하한이 적용된 연결 제한 시간(ms) 변수임.
         */
    }

    @PreDestroy
    public void shutdown() {
    /*
     * [자바/스프링 내장 어노테이션]
     * - @PreDestroy 정의 (출처: jakarta.annotation.PreDestroy, 이름 변경 불가)
     *   · 역할 : 스프링 컨테이너가 종료되면서 빈을 소멸시키기 직전에 자원 정리용 메서드를 1회 자동 실행해 주는 생명주기 어노테이션임.
     * - @PreDestroy 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 NmcOpenApiClient.shutdown() 메서드
     *   · 작동 원리 : 스프링 컨테이너가 NmcOpenApiClient 빈을 소멸시키기 직전에 NmcOpenApiClient.shutdown() 메서드를 자동 호출함.
     *   · 실행 시점 : 서버 정상 종료(SIGTERM) 또는 테스트 컨텍스트 종료 시점임.
     *   · 비교 : 빈 초기화 직후 1회 실행되는 @PostConstruct와 대칭되는 종료 콜백임.
     *
     * [자바 문법]
     * - public void : 외부·컨테이너가 호출할 수 있고 반환값이 없는 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - shutdown : 매개변수 없이 서버 종료 시 실행기와 HttpClient 연결 자원을 닫는 정리 메서드임.
     */
        fetchExecutor.shutdownNow();
        httpClient.close();
        /*
         * [자바/스프링 내장 메서드]
         * - ExecutorService.shutdownNow() : 대기 작업을 취소하고 실행 중 스레드에 인터럽트를 걸어 즉시 종료함.
         * - HttpClient.close() (Java 21+) : 내부 연결 풀과 선택자 스레드 자원을 안전하게 닫음.
         */
    }

    public Map<String, List<Map<String, String>>> fetchAllDatasets() {
    /*
     * [자바 문법]
     * - public : 외부 서비스 클래스에서 호출 가능한 공개 메서드 선언임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, List<Map<String, String>>> : 데이터셋 키별 기관 목록(맵 리스트) 반환 타입임.
     *
     * [메서드명 및 매개변수명]
     * - fetchAllDatasets : 매개변수 없이 7대 OpenAPI 전체를 병렬 수집해 반환하는 메서드임.
     */
        return fetchEndpointGroup(ENDPOINTS);
        /*
         * [자바 문법]
         * - return : 내부 병렬 수집 메서드의 반환값을 호출부로 전달함.
         *
         * [동작 흐름]
         * - Cold 캐시 만료·강제 갱신 시 호출 -> ENDPOINTS(7종)를 fetchEndpointGroup()에 전달
         */
    }

    public Map<String, List<Map<String, String>>> fetchHotDatasets() {
    /*
     * [자바 문법]
     * - public : 외부 서비스 클래스에서 호출 가능한 공개 메서드 선언임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, List<Map<String, String>>> : Hot 3종 데이터셋 키별 파싱 결과 반환 타입임.
     *
     * [메서드명 및 매개변수명]
     * - fetchHotDatasets : 매개변수 없이 실시간 병상·공지·중증수용 Hot 3종만 수집하는 메서드임.
     */
        return fetchEndpointGroup(HOT_ENDPOINTS);
        /*
         * [자바 문법]
         * - return : Hot 3종 수집 결과를 그대로 반환함.
         *
         * [동작 흐름]
         * - Cold 캐시 유효 시 3분 주기 호출 -> HOT_ENDPOINTS(beds, messages, severe) 3종만 수집
         *   └── API 호출량을 7회에서 3회로 줄여 트래픽 절감 및 실시간성 유지
         */
    }

    private Map<String, List<Map<String, String>>> fetchEndpointGroup(Map<String, String> targetEndpoints) {
    /*
     * [자바 문법]
     * - private : 클래스 내부에서만 공통 병렬 수집 엔진으로 쓰는 비공개 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, List<Map<String, String>>>, Map<String, String>.
     *
     * [메서드명 및 매개변수명]
     * - fetchEndpointGroup : 대상 엔드포인트 그룹을 병렬 수집하고 예외 시 폴백을 적용해 합침.
     * - targetEndpoints : 내부 키와 NEMC 오퍼레이션 영문명이 짝지어진 입력 맵 매개변수임.
     */
        Map<String, CompletableFuture<List<Map<String, String>>>> futures = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : targetEndpoints.entrySet()) {
            String key = entry.getKey();
            String operation = entry.getValue();
            futures.put(key, CompletableFuture.supplyAsync(
                    () -> runWithPermit(concurrencyLimiter, () -> fetchAllPages(operation)),
                    fetchExecutor
            ));
        }

        Map<String, List<Map<String, String>>> results = new LinkedHashMap<>();
        for (Map.Entry<String, CompletableFuture<List<Map<String, String>>>> entry : futures.entrySet()) {
            String key = entry.getKey();
            String operation = targetEndpoints.get(key);
            try {
                results.put(key, entry.getValue().join());
            } catch (Exception ex) {
                List<Map<String, String>> fallback = lastSuccessfulByOperation.getOrDefault(operation, List.of());
                log.warn("NEMC OpenAPI [{}] 수집 예외 발생 — 직전 정상 데이터({}건)로 폴백: {}",
                        key, fallback.size(), ex.getMessage());
                results.put(key, fallback);
            }
        }
        return results;
        /*
         * [자바 문법]
         * - 향상된 for / 람다 : 컬렉션 항목을 순서대로 순회하고 비동기 작업 람다를 전달함.
         * - try { ... } catch (Exception ex) { ... } : 비동기 결과 대기 중 발생한 예외를 잡아 폴백함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map, LinkedHashMap, CompletableFuture, List, Map.Entry, Exception.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new LinkedHashMap<>() : 제출 순서대로 비동기 핸들과 결과를 담는 맵을 생성함.
         * - Map.entrySet() / Map.Entry.getKey() / getValue() : 맵의 키-값 쌍을 하나씩 꺼내 순회함.
         * - CompletableFuture.supplyAsync(작업, 스레드풀) : 반환값 있는 비동기 작업을 스레드 풀에 맡김.
         * - CompletableFuture.join() : 비동기 작업 완료까지 기다린 뒤 결과 값을 꺼냄.
         * - Map.getOrDefault(키, List.of()) : 키가 없으면 빈 불변 리스트 List.of()를 기본값으로 반환함.
         * - Logger.warn(...) / Exception.getMessage() : 예외 발생 시 폴백 건수와 원인을 경고 로그로 남김.
         *
         * [지역 변수명]
         * - futures : 데이터셋 키별 CompletableFuture 작업 핸들을 모아 두는 맵임.
         * - entry / key / operation : 현재 순회 중인 항목, 내부 키, NEMC 오퍼레이션 영문명임.
         * - results : 모든 오퍼레이션 수집 결과를 순서대로 모으는 반환 맵임.
         * - ex / fallback : 비동기 수집 예외 객체와 장애 시 대신 넣는 직전 정상 데이터임.
         *
         * [동작 흐름]
         * - 1) 첫 번째 루프 -> targetEndpoints의 fetchAllPages()를 fetchExecutor(2스레드)에 모두 제출
         * - 2) 두 번째 루프 ──> entry.getValue().join()으로 결과 순차 회수
         *   ├── 성공 시: results.put(key, 수집결과)
         *   └── 예외 시: results.put(key, lastSuccessfulByOperation 직전 정상 데이터)
         */
    }

    private static <T> T runWithPermit(Semaphore semaphore, Supplier<T> task) {
        boolean acquired = false;
        try {
            semaphore.acquire();
            acquired = true;
            return task.get();
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new CompletionException(ie);
        } finally {
            if (acquired) {
                semaphore.release();
            }
        }
    }

    public List<Map<String, String>> fetchAllPages(String operation) {
    /*
     * [자바 문법]
     * - public : 외부 서비스와 테스트 코드에서도 호출 가능한 공개 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - List<Map<String, String>>, String.
     *
     * [메서드명 및 매개변수명]
     * - fetchAllPages : 단일 OpenAPI의 1페이지부터 끝 페이지까지 순회해 전체 행을 합침.
     * - operation : 조회할 NEMC OpenAPI 오퍼레이션 영문명 매개변수임.
     */
        List<Map<String, String>> mergedItems = new ArrayList<>();
        int page = 1;
        boolean allPagesSucceeded = true;

        while (page <= MAX_PAGES) {
            ParsedXmlPage parsed = fetchSinglePage(operation, page, DEFAULT_ROWS_PER_PAGE);
            if (!parsed.success()) {
                allPagesSucceeded = false;
                break;
            }
            if (parsed.items().isEmpty()) {
                break;
            }
            mergedItems.addAll(parsed.items());
            if (parsed.totalCount() <= 0 || page * DEFAULT_ROWS_PER_PAGE >= parsed.totalCount()) {
                break;
            }
            page++;
        }

        if (allPagesSucceeded) {
            List<Map<String, String>> snapshot = List.copyOf(mergedItems);
            lastSuccessfulByOperation.put(operation, snapshot);
            return snapshot;
        }

        List<Map<String, String>> fallback = lastSuccessfulByOperation.get(operation);
        if (fallback != null && !fallback.isEmpty() && mergedItems.size() < fallback.size()) {
            log.warn("NEMC OpenAPI [{}] 일시 장애 감지 — 직전 정상 캐시({}건)를 유지합니다.", operation, fallback.size());
            return fallback;
        }
        return mergedItems;
        /*
         * [자바 문법]
         * - while (조건) / break / if : 조건이 참인 동안 페이지를 순회하고 종료 조건 시 탈출함.
         * - 후위 증가 page++ : 현재 페이지 처리 후 page 값을 1 증가시킴.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - List<Map<String, String>>, ArrayList (배열 기반 가변 리스트 구현체).
         *
         * [자바/스프링 내장 생성자·메서드]
         * - new ArrayList<>() : 여러 페이지 결과를 순서대로 누적할 빈 리스트를 생성함.
         * - List.isEmpty() / List.size() : 리스트가 비어 있는지 확인하거나 원소 개수를 셈.
         * - List.addAll(추가목록) : 현재 페이지의 기관 목록 전체를 누적 리스트 끝에 이어 붙임.
         * - List.copyOf(원본) : 수정 불가능한 불변 스냅샷 리스트를 새로 만들어 반환함.
         * - Map.put(키, 값) / Map.get(키) : 오퍼레이션별 직전 정상 결과 캐시를 저장하고 꺼냄.
         * - Logger.warn(...) : 중간 페이지 실패로 기존 캐시를 유지할 때 경고 로그를 남김.
         *
         * [프로젝트 내부 타입 및 접근자]
         * - ParsedXmlPage : NmcOpenApiClient 클래스 하단에 직접 정의한 XML 페이지 파싱 결과 레코드임.
         * - parsed.success() / items() / totalCount() : ParsedXmlPage record가 자동 생성한 접근자임.
         *
         * [지역 변수명]
         * - mergedItems : 1페이지부터 끝 페이지까지 모은 전체 기관 목록임.
         * - page / allPagesSucceeded : 현재 페이지 번호(1 시작)와 전 페이지 성공 여부 플래그임.
         * - parsed : fetchSinglePage()가 돌려준 단일 페이지 파싱 결과 레코드임.
         * - snapshot / fallback : 성공 시 저장할 불변 목록과 실패 시 꺼낸 직전 정상 캐시임.
         *
         * [동작 흐름]
         * - 1) page=1 ~ MAX_PAGES(10) 반복 -> fetchSinglePage(operation, page, 1000) 호출
         * - 2) 중단 분기
         *   ├── !parsed.success() -> allPagesSucceeded = false 표시 후 중단
         *   └── 빈 목록 또는 page * 1000 >= totalCount -> 정상 수집 완료
         * - 3) 후처리
         *   ├── 전체 성공 ──> lastSuccessfulByOperation 최신화 후 불변 snapshot 반환
         *   └── 부분 실패 ──> 기존 fallback이 더 많으면 fallback 반환, 아니면 mergedItems 반환
         */
    }

    public ParsedXmlPage fetchSinglePage(String operation, int pageNo, int numOfRows) {
    /*
     * [자바 문법]
     * - public / int : 외부에서 호출 가능하며 페이지 번호·행 수로 정수 기본형(int)을 받음.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [프로젝트 내부 타입]
     * - ParsedXmlPage : NmcOpenApiClient 클래스 하단에 직접 정의한 중첩 레코드 반환 타입임.
     *
     * [메서드명 및 매개변수명]
     * - fetchSinglePage : 지정된 오퍼레이션·페이지 범위의 XML을 조회·재시도·파싱함.
     * - operation / pageNo / numOfRows : NEMC 오퍼레이션 영문명, 페이지 번호(1 이상), 행 수임.
     */
        if (properties.nemc() == null || !properties.nemc().hasServiceKey()) {
            log.warn("NEMC_API_SERVICE_KEY 미설정 또는 예시 값으로 OpenAPI 호출 생략 (operation={}).", operation);
            recordOpenApiOutcome(operation, "skipped");
            return new ParsedXmlPage(0, List.of(), false);
        }
        String encodedKey = ensureUrlEncodedServiceKey(properties.nemc().serviceKey());
        if (encodedKey.isEmpty()) {
            log.warn("NEMC_API_SERVICE_KEY 미설정으로 OpenAPI 호출 생략 (operation={}).", operation);
            recordOpenApiOutcome(operation, "skipped");
            return new ParsedXmlPage(0, List.of(), false);
        }
        String baseUrl = TRAILING_SLASH_PATTERN.matcher(properties.nemc().baseUrl()).replaceAll("");
        String requestUrl = String.format(
                "%s/%s?serviceKey=%s&pageNo=%d&numOfRows=%d",
                baseUrl, operation, encodedKey, pageNo, numOfRows
        );
        /*
         * [자바 문법]
         * - if (조건) / new / return : 인증키가 비어 있으면 즉시 실패 결과를 반환하고 메서드를 끝냄.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - String, List.
         *
         * [자바/스프링 내장 메서드]
         * - String.isEmpty() : 문자열 길이가 0인지 확인함.
         * - List.of() : 원소가 0개인 빈 불변 리스트를 반환함.
         * - Logger.warn(...) : 인증키 미설정 경고를 출력함.
         * - String.replaceAll("/+$", "") : 주소 끝의 슬래시(/)를 모두 지워 이중 슬래시(//)를 막음.
         * - String.format(서식, 인자...) : %s(문자열), %d(정수) 자리에 값을 채워 URL 문자열을 만듦.
         *
         * [프로젝트 내부 타입·생성자·접근자]
         * - ParsedXmlPage : NmcOpenApiClient 클래스 하단에 직접 정의한 중첩 레코드 타입임.
         * - properties.nemc().serviceKey() / baseUrl() : application.yml 설정을 읽는 record 접근자임.
         * - new ParsedXmlPage(0, List.of(), false) : NmcOpenApiClient.ParsedXmlPage 중첩 레코드의 실패 결과 생성자임.
         *
         * [지역 변수명]
         * - encodedKey : 이중 인코딩을 막아 정규화한 인증키 문자열임.
         * - baseUrl : 끝 슬래시를 정리한 NEMC API 기본 주소임.
         * - requestUrl : 최종 조립된 HTTP GET 요청 URL 문자열임.
         *
         * [URL 조립 구조]
         * - 1단계 baseUrl : application.yml(yonsei119.nemc.base-url) -> 끝 슬래시 제거
         * - 2단계 경로 : "%s/%s" 서식으로 baseUrl + "/" + operation 연결
         * - 3단계 인증키 : "?serviceKey=" + ensureUrlEncodedServiceKey() 결과 연결
         * - 4단계 페이지 : "&pageNo=%d&numOfRows=%d"로 정수 파라미터 연결
         * - 완성 예시 : https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire?serviceKey=인증키&pageNo=1&numOfRows=1000
         */

        long timeoutMs = Math.max(5000L, properties.nemc().requestTimeoutMs());

        for (int attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt++) {
            try {
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(requestUrl))
                        .timeout(Duration.ofMillis(timeoutMs))
                        .header("Accept", "application/xml, text/xml, */*")
                        .GET()
                        .build();

                HttpResponse<String> response = httpClient.send(
                        request,
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
                );
                /*
                 * [자바 문법]
                 * - try { ... } : 네트워크 오류·타임아웃 예외가 날 수 있는 HTTP 송수신 구간을 감쌈.
                 * - 빌더 체이닝 : .uri().timeout().header().GET().build() 순서로 요청 설정을 이어 붙임.
                 *
                 * [자바/스프링/라이브러리 내장 타입]
                 * - HttpRequest, HttpResponse<String>, HttpResponse.BodyHandlers, URI, Duration, StandardCharsets.
                 *
                 * [자바/스프링 내장 생성자·메서드]
                 * - HttpRequest.newBuilder() ... .build() : 불변 HTTP 요청 객체를 조립·생성함.
                 * - URI.create(문자열) : 요청 URL 문자열을 java.net.URI 객체로 변환함.
                 * - Duration.ofMillis(밀리초) : 밀리초 단위 제한 시간을 Duration 객체로 만듦.
                 * - .header("Accept", ...) / .GET() : XML 우선 수신 헤더와 HTTP GET 방식을 지정함.
                 * - HttpClient.send(요청, BodyHandlers.ofString(UTF_8)) : 동기 전송 후 UTF-8 문자열 응답을 받음.
                 *
                 * [지역 변수명]
                 * - request : URI·타임아웃·Accept 헤더·GET 방식이 설정된 HTTP 요청 객체임.
                 * - response : HTTP 상태 코드와 UTF-8 XML 본문을 담은 응답 객체임.
                 */

                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    if (attempt < MAX_ATTEMPTS_PER_PAGE) {
                        sleepBeforeRetry(attempt);
                        continue;
                    }
                    log.warn("NEMC OpenAPI HTTP 비정상 응답 (최종 실패): operation={}, status={}",
                            operation, response.statusCode());
                    recordOpenApiOutcome(operation, "failure");
                    return new ParsedXmlPage(0, List.of(), false);
                }

                ParsedXmlPage parsed = parseXmlResponse(response.body(), operation);
                if (!parsed.success() && attempt < MAX_ATTEMPTS_PER_PAGE) {
                    sleepBeforeRetry(attempt);
                    continue;
                }
                recordOpenApiOutcome(operation, parsed.success() ? "success" : "failure");
                return parsed;
            } catch (Exception ex) {
                if (attempt < MAX_ATTEMPTS_PER_PAGE) {
                    sleepBeforeRetry(attempt);
                } else {
                    String reason = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
                    log.warn("NEMC OpenAPI 호출 실패 ({}회 시도 소진): operation={}, 사유={}",
                            MAX_ATTEMPTS_PER_PAGE, operation, reason);
                }
            }
        }
        recordOpenApiOutcome(operation, "failure");
        return new ParsedXmlPage(0, List.of(), false);
        /*
         * [자바 문법]
         * - for (int attempt = 1; ...) : 1차부터 최대 3차까지 요청을 반복 시도함.
         * - continue / ?: / catch (Exception ex) : 실패 시 재시도로 넘기거나 예외 메시지를 꺼냄.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Math, Exception, String, List.
         *
         * [자바/스프링 내장 메서드]
         * - Math.max(5000L, 값) : 최소 5,000ms 타임아웃 하한을 보장함.
         * - HttpResponse.statusCode() / body() : HTTP 상태 코드(2xx 정상)와 응답 XML 본문을 꺼냄.
         * - Throwable.getMessage() / getClass().getSimpleName() : 예외 메시지 또는 클래스 단축명을 꺼냄.
         * - Logger.warn(...) / List.of() : 최종 실패 로그를 남기고 빈 불변 리스트를 준비함.
         *
         * [프로젝트 내부 타입·생성자·접근자]
         * - ParsedXmlPage : XML 파싱 결과를 담는 NmcOpenApiClient 클래스 내부 중첩 레코드임.
         * - properties.nemc().requestTimeoutMs() : application.yml의 timeout 설정을 읽는 record 접근자임.
         * - new ParsedXmlPage(0, List.of(), false) : 실패 상태의 ParsedXmlPage 레코드를 생성함.
         *
         * [지역 변수명]
         * - timeoutMs / attempt : 보정된 제한 시간(ms)과 현재 시도 횟수(1~3)임.
         * - parsed / ex / reason : 파싱 결과 레코드, 발생한 예외, 로그용 사유 문자열임.
         *
         * [동작 흐름]
         * - attempt=1..3 -> HttpClient.send() ──> status 2xx & parsed.success()면 즉시 반환
         *   ├── 2xx 아님 / XML 에러 / 예외 & attempt < 3 -> sleepBeforeRetry(attempt) 대기 후 재시도
         *   └── 3회 모두 실패 -> 경고 로그 기록 후 실패 ParsedXmlPage(0, [], false) 반환
         */
    }

    private void recordOpenApiOutcome(String operation, String outcome) {
        if (meterRegistry != null) {
            meterRegistry.counter("yonsei119.nemc.openapi.calls", "operation", operation, "outcome", outcome)
                    .increment();
        }
    }

    private static void sleepBeforeRetry(int attempt) {
    /*
     * [자바 문법]
     * - private static void / int : 반환값 없이 정수 차수를 받아 대기하는 내부 정적 메서드임.
     *
     * [메서드명 및 매개변수명]
     * - sleepBeforeRetry : 재시도 간 일정 시간 현재 스레드를 대기시키는 메서드임.
     * - attempt : 현재 실패한 시도 차수(1이면 800ms, 2면 1,600ms 대기).
     */
        try {
            Thread.sleep(RETRY_BASE_BACKOFF_MS * attempt);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
        /*
         * [자바 문법]
         * - try { ... } catch (InterruptedException ie) { ... } : 체크 예외 필수 처리 구문임.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Thread, InterruptedException.
         *
         * [자바/스프링 내장 메서드]
         * - Thread.sleep(밀리초) : 지정한 시간(800ms * attempt) 동안 현재 스레드를 일시 정지함.
         * - Thread.currentThread().interrupt() : 지워진 인터럽트 상태를 복구해 종료 신호 유실을 막음.
         *
         * [지역 변수명]
         * - ie : 대기 중 인터럽트가 발생했을 때 잡은 InterruptedException 객체임.
         */
    }

    public static String ensureUrlEncodedServiceKey(String rawKey) {
    /*
     * [자바 문법]
     * - public static : 객체 생성 없이 외부에서도 호출 가능한 정적 인증키 정규화 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [메서드명 및 매개변수명]
     * - ensureUrlEncodedServiceKey : Encoding/Decoding 키를 이중 인코딩 없이 단일 인코딩으로 통일함.
     * - rawKey : 설정 또는 환경변수에서 읽어 온 원본 인증키 문자열 매개변수임.
     */
        if (rawKey == null || rawKey.isBlank()) {
            return "";
        }
        String trimmed = rawKey.trim();
        if (trimmed.contains("%")) {
            return trimmed;
        }
        return URLEncoder.encode(trimmed, StandardCharsets.UTF_8);
        /*
         * [자바 문법]
         * - if (조건) / return : null·빈 문자열과 이미 인코딩된 키를 조기 반환함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - String, URLEncoder, StandardCharsets.
         *
         * [자바/스프링 내장 메서드]
         * - String.isBlank() / trim() : 공백 여부를 확인하고 앞뒤 공백·개행을 제거함.
         * - String.contains("%") : 이미 % 인코딩된 키인지 확인해 이중 인코딩(%252F)을 막음.
         * - URLEncoder.encode(문자열, UTF_8) : 평문 키의 특수기호(/, +, =)를 1회 URL 인코딩함.
         *
         * [지역 변수명]
         * - trimmed : 앞뒤 공백이 제거된 인증키 문자열임.
         *
         * [데이터 변환 예시]
         * - Encoding 키("abc%2Fdef%3D%3D") -> 그대로 "abc%2Fdef%3D%3D" 반환
         * - Decoding 키("abc/def==") -> "abc%2Fdef%3D%3D"로 1회 인코딩 후 반환
         */
    }

    public ParsedXmlPage parseXmlResponse(String xmlText, String operation) {
    /*
     * [자바 문법]
     * - public : 테스트 코드에서도 XML 파서를 직접 검증할 수 있는 공개 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [프로젝트 내부 타입]
     * - ParsedXmlPage : NmcOpenApiClient 클래스 하단에 직접 정의한 중첩 레코드 반환 타입임.
     *
     * [메서드명 및 매개변수명]
     * - parseXmlResponse : NEMC XML을 보안 DOM 파서로 읽어 소문자 키 Map 리스트로 변환함.
     * - xmlText / operation : API 응답 XML 원문 문자열과 로그 식별용 오퍼레이션 영문명임.
     */
        if (xmlText == null || xmlText.isBlank()) {
            return new ParsedXmlPage(0, List.of(), false);
        }

        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            /*
             * [자바 문법]
             * - try { ... } : XML 파서 설정·파싱 중 발생하는 예외를 잡는 블록임.
             *
             * [자바/스프링/라이브러리 내장 타입]
             * - DocumentBuilderFactory (javax.xml.parsers), XMLConstants (javax.xml).
             *
             * [자바/스프링 내장 메서드]
             * - DocumentBuilderFactory.newInstance() : W3C DOM 파서 팩토리 인스턴스를 생성함.
             * - .setFeature(FEATURE_SECURE_PROCESSING, true) : XML 안전 제한 모드를 켬.
             * - .setFeature(".../disallow-doctype-decl", true) : XML 내부 DOCTYPE 선언 자체를 차단함.
             * - .setFeature(".../external-general-entities", false) : 외부 일반 엔티티 해석을 막음.
             * - .setFeature(".../external-parameter-entities", false) : 외부 파라미터 엔티티 해석을 막음.
             * - .setXIncludeAware(false) / .setExpandEntityReferences(false) : XInclude와 엔티티 확장을 끔.
             *
             * [지역 변수명]
             * - factory : OWASP XXE(XML 외부 엔티티 공격)를 막도록 보안 설정된 DOM 팩토리임.
             */

            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(new InputSource(new StringReader(xmlText)));

            String resultCode = getFirstTagText(doc, "resultCode");
            if (!resultCode.isEmpty() && !"00".equals(resultCode)) {
                String resultMsg = getFirstTagText(doc, "resultMsg");
                log.warn("NEMC OpenAPI 에러 응답: operation={}, resultCode={}, resultMsg={}",
                        operation, resultCode, resultMsg);
                return new ParsedXmlPage(0, List.of(), false);
            }

            int totalCount;
            String totalCountText = getFirstTagText(doc, "totalCount");
            if (totalCountText.isEmpty()) {
                totalCount = 0;
            } else {
                try {
                    totalCount = Integer.parseInt(totalCountText);
                } catch (NumberFormatException ignored) {
                    totalCount = 0;
                }
            }

            NodeList itemNodes = doc.getElementsByTagName("item");
            List<Map<String, String>> items = new ArrayList<>(itemNodes.getLength());
            for (int i = 0; i < itemNodes.getLength(); i++) {
                Node itemNode = itemNodes.item(i);
                if (itemNode.getNodeType() != Node.ELEMENT_NODE) {
                    continue;
                }
                Element itemElement = (Element) itemNode;
                NodeList children = itemElement.getChildNodes();
                Map<String, String> fieldMap = new LinkedHashMap<>();
                for (int j = 0; j < children.getLength(); j++) {
                    Node child = children.item(j);
                    if (child.getNodeType() == Node.ELEMENT_NODE) {
                        String key = child.getNodeName().toLowerCase(Locale.ROOT);
                        String value = child.getTextContent() != null ? child.getTextContent().trim() : "";
                        fieldMap.put(key, value);
                    }
                }
                if (!fieldMap.isEmpty()) {
                    items.add(fieldMap);
                }
            }
            return new ParsedXmlPage(totalCount, items, true);
        } catch (Exception ex) {
            log.warn("NEMC OpenAPI XML 파싱 실패: operation={}, 사유={}", operation, ex.getMessage());
            return new ParsedXmlPage(0, List.of(), false);
        }
        /*
         * [자바 문법]
         * - (Element) 다운캐스팅 : 범용 Node를 Element 하위 타입으로 명시 변환함.
         * - for 인덱스 루프 / continue / ?: : <item>과 자식 태그를 순회하고 null 텍스트를 ""로 처리함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - DocumentBuilder, Document, InputSource, StringReader, NodeList, Node, Element.
         * - List, ArrayList, Map, LinkedHashMap, Locale, Integer, NumberFormatException, Exception.
         *
         * [자바/스프링 내장 생성자·메서드]
         * - String.isBlank() / List.of() : 빈 XML 입력이면 파싱 없이 조기 종료 준비함.
         * - DocumentBuilderFactory.newDocumentBuilder() : 보안 옵션이 적용된 XML 파서를 생성함.
         * - new StringReader(문자열) / new InputSource(리더) : 문자열 XML을 파서 입력 소스로 감쌈.
         * - DocumentBuilder.parse(입력소스) : XML 문자열을 DOM 트리(Document)로 변환함.
         * - !"00".equals(코드) : 정상 코드 "00" 여부를 null 안전하게 비교함.
         * - Integer.parseInt(문자열) : totalCount 문자열을 정수로 바꾸고, 실패 시 0으로 유지함.
         * - Document.getElementsByTagName("item") : XML에서 모든 <item> 노드 목록을 찾음.
         * - new ArrayList<>(크기) : 예상 개수만큼 초기 용량을 잡아 리스트를 생성함.
         * - Node.getNodeType() == Node.ELEMENT_NODE : 텍스트·공백 노드를 거르고 태그 요소만 고름.
         * - Node.getNodeName().toLowerCase(Locale.ROOT) : 태그명을 로케일 영향 없이 소문자로 통일함.
         * - Node.getTextContent() / String.trim() : 태그 본문 문자열의 앞뒤 공백을 제거함.
         * - new LinkedHashMap<>() / Map.put(키, 값) / List.add(항목) : 기관별 태그 맵을 조립해 추가함.
         * - Logger.warn(...) / Exception.getMessage() : 파싱 실패 시 경고 로그를 남김.
         *
         * [프로젝트 내부 타입 및 생성자]
         * - ParsedXmlPage : XML 파싱 결과를 담는 NmcOpenApiClient 클래스 내부 중첩 레코드임.
         * - new ParsedXmlPage(totalCount, items, true) / (0, List.of(), false) : 성공·실패 레코드를 생성함.
         *
         * [지역 변수명]
         * - builder / doc / resultCode / resultMsg : DOM 파서, 루트 문서, 응답 코드·메시지 변수임.
         * - totalCount / totalCountText / itemNodes / items : 전체 건수 및 <item> 파싱 목록 변수임.
         * - itemNode / itemElement / children / fieldMap / child / key / value : 태그 순회·추출 변수임.
         * - ignored / ex : totalCount 변환 실패 및 파싱 예외 객체임.
         *
         * [데이터 변환 예시]
         * - 원본 : <item><HPID>A2200001</HPID><hvec>-4</hvec><hv28></hv28></item>
         * - 변환 : {"hpid": "A2200001", "hvec": "-4", "hv28": ""} (소문자 통일, 음수·빈값 보존)
         */
    }

    private static String getFirstTagText(Document doc, String tagName) {
    /*
     * [자바 문법]
     * - private static : 클래스 내부 XML 파서 전용 비공개 정적 보조 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String, Document.
     *
     * [메서드명 및 매개변수명]
     * - getFirstTagText : DOM Document에서 특정 태그명의 첫 요소 텍스트를 null 안전하게 꺼냄.
     * - doc / tagName : 파싱된 XML DOM 객체와 추출할 태그명("resultCode" 등)임.
     */
        NodeList list = doc.getElementsByTagName(tagName);
        if (list == null || list.getLength() == 0 || list.item(0) == null) {
            return "";
        }
        String text = list.item(0).getTextContent();
        return text != null ? text.trim() : "";
        /*
         * [자바 문법]
         * - if / == null / ?: / return : 노드가 없으면 ""를, 있으면 trim된 문자열을 반환함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - NodeList, String.
         *
         * [자바/스프링 내장 메서드]
         * - Document.getElementsByTagName(태그명) : 문서 전체에서 지정한 태그명 목록(NodeList)을 찾음.
         * - NodeList.getLength() / NodeList.item(0) : 일치 개수 확인 후 첫 번째 노드를 꺼냄.
         * - Node.getTextContent() / String.trim() : 노드 문자열을 꺼내 앞뒤 공백을 제거함.
         *
         * [지역 변수명]
         * - list / text : 태그와 일치하는 NodeList와 첫 노드의 원시 텍스트 변수임.
         */
    }

    public record ParsedXmlPage(
            int totalCount,
            List<Map<String, String>> items,
            boolean success
    ) {
    /*
     * [자바 문법]
     * - public record : 생성자·접근자(totalCount(), items(), success()) 등이 자동 생성되는 불변 타입임.
     * - int / boolean : 전체 건수 정수와 성공 여부 논리 기본형임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - List<Map<String, String>> : 파싱된 병원 행(소문자 태그 맵) 목록 타입임.
     *
     * [중첩 레코드명 및 컴포넌트명]
     * - ParsedXmlPage : 단일 XML 페이지의 파싱 결과를 묶어 돌려주는 중첩 레코드임.
     * - totalCount : XML 응답 헤더의 전체 데이터 건수 컴포넌트임.
     * - items : 요청한 XML 페이지에서 추출한 기관별 키-값 맵 목록 컴포넌트임.
     * - success : HTTP 2xx, resultCode 정상, XML 파싱이 모두 성공했는지 여부 컴포넌트임.
     */
    }
}
