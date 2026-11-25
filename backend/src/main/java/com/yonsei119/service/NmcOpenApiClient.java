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
 * [1. 역할 및 실행 시점]
 * - 역할 : 국립중앙의료원(NEMC) 7대 응급의료 XML OpenAPI에서 원시 데이터를
 *          받아오는 외부 조달 담당관 (신선 식자재 구매팀 역할)
 * - 실행 시점 : 서버 시작 시 `@Component` 싱글톤 빈으로 생성되며,
 *              `EmergencyDataService`가 캐시를 적재·갱신할 때마다 호출됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [EmergencyDataService]          [NmcOpenApiClient]             [NEMC OpenAPI (XML)]
 *                  |                             |                               |
 *             +----+-----------------------------+-------------------------------+-----------+
 *             | [alt : 60s cycle vs initial/6h cycle]                                        |  수집 범위 분기
 *             |    |-- 1a. fetchHotDatasets() -->|                               |           |  실시간 3종(병상·공지·질환)
 *             +----+-----------------------------+-------------------------------+-----------+
 *             | [else : startup or 6h expired]                                               |  전체 마스터 갱신 시점
 *             |    |-- 1b. fetchAllDatasets() -->|                               |           |  전체 7종(마스터4 + 실시간3)
 *             +----+-----------------------------+-------------------------------+-----------+
 *                  |                             |-- 2. GET XML (Semaphore 4) -->|  가상 스레드 병렬 호출
 *                  |                             |<-- 3. XML response -----------|  원본 XML 수신
 *                  |                             |-- 4. parseXmlResponse()       |  음수 병상(-4) · 공란 보존
 *                  |<-- 5. parsed datasets ------|                               |  장애 시 직전 정상본 폴백
 *                  v                             v                               v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record                   : 내부 `ParsedXmlPage` 결과 레코드 선언 키워드 (자동생성)
 *   ㄴ HttpClient / HttpRequest : 외부 REST XML 호출용 표준 내장 HTTP 클라이언트
 *   ㄴ DocumentBuilderFactory   : XXE 보안 설정이 적용된 표준 내장 XML DOM 파서
 *   ㄴ CompletableFuture        : 여러 OpenAPI를 동시에 호출하는 비동기 표준 내장 클래스
 *   ㄴ Executors                : Java 27 가상 스레드 풀을 생성하는 표준 내장 팩토리
 *   ㄴ Semaphore                : 동시 요청 수를 최대 4개로 제한하는 동기화 클래스
 *   ㄴ ConcurrentHashMap        : 스레드 안전한 직전 성공 백업 저장소 클래스
 *   ㄴ URLEncoder               : 인증키 및 파라미터 URL 인코딩 표준 내장 클래스
 * - Spring 프레임워크
 *   ㄴ @Component / @Autowired : 스프링 빈 자동 등록 및 생성자 의존성 주입 어노테이션
 *   ㄴ ObjectProvider          : 선택적 메트릭 빈을 안전하게 조회하는 인터페이스
 * - 외부 라이브러리
 *   ㄴ SLF4J (`Logger`)        : 수집 건수 · 장애 폴백 로그 기록 라이브러리
 *   ㄴ Micrometer              : 엔드포인트별 응답 시간 · 성공률 측정 라이브러리
 *   ㄴ Jakarta (`@PreDestroy`) : 서버 종료 시 가상 스레드 풀 정리 어노테이션
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ EmergencyDataService.java  : `buildFreshSnapshot()`에서 `fetchHotDatasets()` 호출
 *   ㄴ Yonsei119BackendTests.java : Test 2 · Test 3 · Test 6 XML 무손실 파싱 검증
 * - IntelliJ 추적 단축키
 *   ㄴ 호출 계층 보기 : 메서드명 위에서 `Ctrl + Alt + H`
 *   ㄴ 오퍼레이션 검색 : `Ctrl + Shift + F`로 `getEmrrmRltmUsefulSckbdInfoInqire` 검색
 */
@Component
public class NmcOpenApiClient {

    private static final Logger log = LoggerFactory.getLogger(NmcOpenApiClient.class);
    private static final int DEFAULT_ROWS_PER_PAGE = 1000;
    private static final int MAX_PAGES = 10;
    // 콜드스타트 시 7개 엔드포인트를 2번의 짧은 웨이브로 빠르게 받아오도록 동시 요청 상한을 4개로 설정
    private static final int MAX_CONCURRENT_REQUESTS = 4;
    private static final int MAX_ATTEMPTS_PER_PAGE = 3;
    private static final long RETRY_BASE_BACKOFF_MS = 800L;
    private static final Pattern TRAILING_SLASH_PATTERN = Pattern.compile("/+$");

    /** 주소·좌표·기본정보·외상센터 지정 여부 등 변동이 드문 마스터 데이터 4종 (6시간 캐시) */
    public static final Map<String, String> COLD_ENDPOINTS = createColdEndpointMap();

    /** 가용 병상·실시간 응급메시지·28대 중증질환 수용 가능 여부 등 분 단위로 변하는 실시간 데이터 3종 (60초 캐시) */
    public static final Map<String, String> HOT_ENDPOINTS = createHotEndpointMap();

    /** COLD 4종 + HOT 3종을 합친 전체 7대 공공데이터 오퍼레이션 맵 */
    public static final Map<String, String> ENDPOINTS = createAllEndpointMap();

    private static Map<String, String> createColdEndpointMap() {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("list", "getEgytListInfoInqire");
        map.put("basic", "getEgytBassInfoInqire");
        map.put("traumaList", "getStrmListInfoInqire");
        map.put("traumaBasic", "getStrmBassInfoInqire");
        // [Java 표준 내장] Map.copyOf()로 수정 불가능한 불변 맵을 만들어 외부 변경을 차단함
        return Map.copyOf(map);
    }

    private static Map<String, String> createHotEndpointMap() {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("beds", "getEmrrmRltmUsefulSckbdInfoInqire");
        map.put("messages", "getEmrrmSrsillDissMsgInqire");
        map.put("severe", "getSrsillDissAceptncPosblInfoInqire");
        return Map.copyOf(map);
    }

    private static Map<String, String> createAllEndpointMap() {
        Map<String, String> map = new LinkedHashMap<>(COLD_ENDPOINTS);
        map.putAll(HOT_ENDPOINTS);
        return Map.copyOf(map);
    }

    private final Yonsei119Properties properties;
    private final HttpClient httpClient;
    private final ExecutorService fetchExecutor;
    private final Semaphore concurrencyLimiter = new Semaphore(MAX_CONCURRENT_REQUESTS);
    private final Map<String, List<Map<String, String>>> lastSuccessfulByOperation = new ConcurrentHashMap<>();
    private final MeterRegistry meterRegistry;

    public NmcOpenApiClient(Yonsei119Properties properties) {
        this(properties, null);
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: HTTP 클라이언트와 Java 27 가상 스레드 실행기를 준비하는 생성자
     * - 실행 시점: 서버 부팅 시 스프링이 Yonsei119Properties와 MeterRegistry를 자동 주입하며 1회 실행됨
     */
    @Autowired
    public NmcOpenApiClient(
            Yonsei119Properties properties,
            ObjectProvider<MeterRegistry> meterRegistryProvider
    ) {
        this.properties = properties;
        this.meterRegistry = meterRegistryProvider != null ? meterRegistryProvider.getIfAvailable() : null;
        long timeoutMs = Math.max(5000L, properties.nemc().requestTimeoutMs());
        // [Java 21+ 내장] 가상 스레드 실행기로 네트워크 대기 중 OS 스레드가 블로킹되지 않게 함
        this.fetchExecutor = Executors.newThreadPerTaskExecutor(
                Thread.ofVirtual().name("yonsei119-nemc-fetch-", 0).factory()
        );
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(timeoutMs))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    /*
     * [역할 및 실행 시점]
     * - 역할: 서버 종료 직전에 가상 스레드 실행기와 HTTP 연결 풀을 깔끔하게 닫음
     * - 사용처: 스프링 컨테이너 종료 시 @PreDestroy 생명주기 콜백으로 자동 호출됨
     */
    @PreDestroy
    public void shutdown() {
        fetchExecutor.shutdownNow();
        httpClient.close();
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 7개 전체 OpenAPI(마스터 4종 + 실시간 3종)를 병렬로 일괄 수집함
     * - 흐름: EmergencyDataService.buildFreshSnapshot(true 또는 최초 기동) -> fetchAllDatasets() -> fetchEndpointGroup(ENDPOINTS)
     * - 사용처: EmergencyDataService.buildFreshSnapshot()
     */
    public Map<String, List<Map<String, String>>> fetchAllDatasets() {
        return fetchEndpointGroup(ENDPOINTS);
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 실시간으로 자주 바뀌는 Hot 3종(병상·응급메시지·중증질환)만 가볍게 병렬 수집함
     * - 흐름: EmergencyDataService.buildFreshSnapshot(false) -> fetchHotDatasets() -> fetchEndpointGroup(HOT_ENDPOINTS)
     * - 사용처: EmergencyDataService.buildFreshSnapshot() (60초 주기 백그라운드 갱신 시 호출)
     */
    public Map<String, List<Map<String, String>>> fetchHotDatasets() {
        return fetchEndpointGroup(HOT_ENDPOINTS);
    }

    /*
     * [전체 호출 및 데이터 흐름]
     * - 흐름:
     *   targetEndpoints 순회 -> CompletableFuture.supplyAsync()로 가상 스레드에 병렬 작업 등록
     *   ㄴ Semaphore(4) 허가 획득 -> fetchAllPages(operation) 실행 -> 허가 반납
     *   ㄴ 모든 Future 결과 join() 회수
     *       ㄴ 성공 시: 파싱된 기관 리스트 저장
     *       ㄴ 예외 시: lastSuccessfulByOperation에 보관된 직전 정상 데이터로 대체
     */
    private Map<String, List<Map<String, String>>> fetchEndpointGroup(Map<String, String> targetEndpoints) {
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

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 하나의 OpenAPI 오퍼레이션을 1페이지부터 끝 페이지까지 순회해 모든 행을 합침
     * - 흐름:
     *   page=1..10 반복 -> fetchSinglePage(operation, page, 1000)
     *   ㄴ page * 1000 >= totalCount 도달 시 루프 종료 -> lastSuccessfulByOperation 갱신 후 불변 리스트 반환
     *   ㄴ 중간 페이지 실패 시 -> 직전 정상 캐시(fallback)가 더 완전하면 fallback 반환
     * - 사용처: fetchEndpointGroup() 내부에서 호출됨
     */
    public List<Map<String, String>> fetchAllPages(String operation) {
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
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 단일 페이지 XML 데이터를 HTTP GET으로 요청하고 실패 시 최대 3회(800ms, 1600ms 간격) 재시도함
     * - 흐름:
     *   서비스키 확인 -> ensureUrlEncodedServiceKey() -> 요청 URL 조립
     *   -> httpClient.send() -> HTTP 2xx 확인 -> parseXmlResponse() 파싱 결과 반환
     * - 요청 URL 구조:
     *   https://apis.data.go.kr/B552657/ErmctInfoInqireService/{operation}?serviceKey={인증키}&pageNo=1&numOfRows=1000
     * - 사용처: fetchAllPages()에서 호출됨
     */
    public ParsedXmlPage fetchSinglePage(String operation, int pageNo, int numOfRows) {
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
    }

    private void recordOpenApiOutcome(String operation, String outcome) {
        if (meterRegistry != null) {
            meterRegistry.counter("yonsei119.nemc.openapi.calls", "operation", operation, "outcome", outcome)
                    .increment();
        }
    }

    private static void sleepBeforeRetry(int attempt) {
        try {
            Thread.sleep(RETRY_BASE_BACKOFF_MS * attempt);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 공공데이터포털의 Encoding 키('%' 포함)와 Decoding 평문 키를 판별해 이중 인코딩(%252F) 사고를 방지함
     * - 흐름: rawKey 입력 -> '%' 포함 시 그대로 반환 / 미포함 시 URLEncoder.encode(UTF-8) 1회 수행 후 반환
     * - 사용처: fetchSinglePage(), Yonsei119BackendTests.testServiceKeyEncodingAndHotColdSplit()
     */
    public static String ensureUrlEncodedServiceKey(String rawKey) {
        if (rawKey == null || rawKey.isBlank()) {
            return "";
        }
        String trimmed = rawKey.trim();
        if (trimmed.contains("%")) {
            return trimmed;
        }
        return URLEncoder.encode(trimmed, StandardCharsets.UTF_8);
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 공공데이터 XML 원문을 보안 DOM 파서로 읽어 소문자 태그 키 Map 목록으로 무손실 변환함
     * - 흐름:
     *   xmlText 수신 -> XXE 공격 차단 옵션 적용(DocumentBuilderFactory) -> resultCode == "00" 확인
     *   -> <item> 목록 순회 -> 태그명 소문자 통일(hpid, hvec 등) + 문자열 값 원형 저장 -> ParsedXmlPage 반환
     * - 도메인 무결성 핵심:
     *   · 음수 병상(예: hvec="-4" 정원 초과수용)과 빈 태그(예: hv28="" 미운영·미보고)를 숫자 0으로 바꾸지 않고 그대로 보존함!
     * - 사용처: fetchSinglePage(), Yonsei119BackendTests(Test 2, Test 6)
     */
    public ParsedXmlPage parseXmlResponse(String xmlText, String operation) {
        if (xmlText == null || xmlText.isBlank()) {
            return new ParsedXmlPage(0, List.of(), false);
        }

        try {
            // [Java 표준 내장 XML 보안 설정] 외부 엔티티 주입(XXE) 공격을 원천 차단함
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);

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
                        // 오퍼레이션마다 대소문자가 다른 태그(HPID, hpid, MKioskTy1 등)를 소문자로 통일
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
    }

    private static String getFirstTagText(Document doc, String tagName) {
        NodeList list = doc.getElementsByTagName(tagName);
        if (list == null || list.getLength() == 0 || list.item(0) == null) {
            return "";
        }
        String text = list.item(0).getTextContent();
        return text != null ? text.trim() : "";
    }

    /*
     * [역할 및 자동 생성 요소]
     * - 역할: XML 1페이지 파싱 결과를 담아 나르는 내부 도시락 그릇 (record 불변 객체)
     * - Java record 자동 생성: 생성자 new ParsedXmlPage(...) 및 .totalCount(), .items(), .success() 조회 메서드 자동 생성
     */
    public record ParsedXmlPage(
            int totalCount,
            List<Map<String, String>> items,
            boolean success
    ) {
    }
}
