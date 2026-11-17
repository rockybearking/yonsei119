package com.yonsei119.service;

import com.yonsei119.config.Yonsei119Properties;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
/*
 * [자바 문법] package, import : 국립중앙의료원(NEMC) 공공데이터 XML OpenAPI 통신 전담 패키지 선언 및 HTTP·비동기·보안 XML 파서 도구 불러오기임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - HttpClient, HttpRequest, HttpResponse : Java 11+ 표준 비동기/동기 HTTP 통신 도구임 (이름 변경 불가 / 스프링 진영 형제 도구: RestClient, WebClient, RestTemplate).
 * - DocumentBuilderFactory, Document, NodeList : W3C 표준 DOM XML 파서 도구임 (이름 변경 불가).
 * - CompletableFuture, ExecutorService, ConcurrentHashMap : 멀티스레드 병렬 API 수집 및 스레드 안전 백업 캐시 도구임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @Component (출처: org.springframework.stereotype) : 스프링 빈으로 등록하여 EmergencyDataService에 자동 주입함.
 * - @PreDestroy (출처: jakarta.annotation) : 서버 종료 직전에 백그라운드 스레드 풀을 깔끔히 정리하도록 호출되는 생명주기 어노테이션임 (형제: @PostConstruct).
 */

@Component
public class NmcOpenApiClient {
/*
 * [스프링/라이브러리 내장 어노테이션] @Component
 * [자바 문법] public class
 * [내가 지은 이름] NmcOpenApiClient : 국립중앙의료원 7대 XML OpenAPI를 Hot(실시간 3종) / Cold(마스터 4종)로 나누어 병렬 수집·해석하는 클라이언트 클래스임.
 * [핵심 원리 & 비유]
 * - 식당의 '새벽 도매시장 식자재 구매팀'임.
 * - 매일 안 바뀌는 쌀·간장(Cold 4종: 기관목록·기본정보·외상목록·외상기본)은 6시간마다 한 번 사 오고,
 * - 시시각각 변하는 신선 해산물(Hot 3종: 실시간 병상·긴급공지·28대 중증질환)은 3분마다 빠르게 사 와서 트래픽은 아끼고 신선도는 극대화함.
 */

    private static final Logger log = LoggerFactory.getLogger(NmcOpenApiClient.class);
    private static final int DEFAULT_ROWS_PER_PAGE = 1000;
    private static final int MAX_PAGES = 10;
    private static final int MAX_CONCURRENT_REQUESTS = 2;
    private static final int MAX_ATTEMPTS_PER_PAGE = 3;
    private static final long RETRY_BASE_BACKOFF_MS = 800L;
    /*
     * [자바 문법] private static final, int, long
     * [자바/스프링/라이브러리 내장 도구(타입)] Logger, LoggerFactory : 서버 콘솔에 시간·클래스명과 함께 상태 기록을 남기는 표준 로거임 (System.out.println 대신 실무 필수 사용).
     * [내가 지은 이름]
     * - DEFAULT_ROWS_PER_PAGE(1페이지당 1000건 조회 -> 전국 약 530개 병원을 단 1번 요청으로 수신)
     * - MAX_CONCURRENT_REQUESTS(저사양 0.1 vCPU 컨테이너 보호용 동시 연결 상한 2개)
     * - MAX_ATTEMPTS_PER_PAGE(실패 시 최대 3회 재시도), RETRY_BASE_BACKOFF_MS(800ms -> 1600ms 지수 백오프 대기 시간)
     */

    public static final Map<String, String> COLD_ENDPOINTS = createColdEndpointMap();
    public static final Map<String, String> HOT_ENDPOINTS = createHotEndpointMap();
    public static final Map<String, String> ENDPOINTS = createAllEndpointMap();
    /*
     * [자바 문법] public static final
     * [자바/스프링/라이브러리 내장 도구(타입)] Map<String, String> (이름 변경 불가)
     * [내가 지은 이름]
     * - COLD_ENDPOINTS : 주소·좌표·전화번호 등 거의 변하지 않는 마스터 API 4종 사전
     * - HOT_ENDPOINTS  : 병상·긴급공지·중증수용 등 분 단위로 변하는 실시간 API 3종 사전
     * - ENDPOINTS      : 7종 전체 통합 사전
     */

    private static Map<String, String> createColdEndpointMap() {
    /*
     * [자바 문법] private static : 6시간 주기로 캐싱할 Cold 마스터 OpenAPI 4종 매핑을 조립함.
     * [내가 지은 이름] createColdEndpointMap
     */
        Map<String, String> map = new LinkedHashMap<>();
        map.put("list", "getEgytListInfoInqire");
        map.put("basic", "getEgytBassInfoInqire");
        map.put("traumaList", "getStrmListInfoInqire");
        map.put("traumaBasic", "getStrmBassInfoInqire");
        return Map.copyOf(map);
        /*
         * [스프링/자바 내장 함수] map.put(키, 값), Map.copyOf(map) (이름 변경 불가)
         */
    }

    private static Map<String, String> createHotEndpointMap() {
    /*
     * [자바 문법] private static : 3분 주기로 고속 갱신할 Hot 실시간 OpenAPI 3종 매핑을 조립함.
     * [내가 지은 이름] createHotEndpointMap
     */
        Map<String, String> map = new LinkedHashMap<>();
        map.put("beds", "getEmrrmRltmUsefulSckbdInfoInqire");
        map.put("messages", "getEmrrmSrsillDissMsgInqire");
        map.put("severe", "getSrsillDissAceptncPosblInfoInqire");
        return Map.copyOf(map);
        /*
         * [스프링/자바 내장 함수] map.put(...), Map.copyOf(...) (이름 변경 불가)
         */
    }

    private static Map<String, String> createAllEndpointMap() {
    /*
     * [자바 문법] private static : Cold 4종 + Hot 3종을 합친 전체 7종 매핑 사전을 조립함.
     * [내가 지은 이름] createAllEndpointMap
     */
        Map<String, String> map = new LinkedHashMap<>(COLD_ENDPOINTS);
        map.putAll(HOT_ENDPOINTS);
        return Map.copyOf(map);
        /*
         * [스프링/자바 내장 함수] map.putAll(...), Map.copyOf(...) (이름 변경 불가)
         */
    }

    private final Yonsei119Properties properties;
    private final HttpClient httpClient;
    private final ExecutorService fetchExecutor;
    private final Map<String, List<Map<String, String>>> lastSuccessfulByOperation = new ConcurrentHashMap<>();
    /*
     * [자바 문법] private final
     * [자바/스프링/라이브러리 내장 도구(타입)] HttpClient, ExecutorService, ConcurrentHashMap (이름 변경 불가)
     * [내가 지은 이름] properties(설정 상자), httpClient(HTTP 통신기), fetchExecutor(병렬 일꾼 풀), lastSuccessfulByOperation(장애 대비 마지막 정상 데이터 보관함)
     */

    public NmcOpenApiClient(Yonsei119Properties properties) {
    /*
     * [자바 문법] public NmcOpenApiClient(...) : 설정 프로퍼티를 주입받아 전용 스레드 풀과 HTTP/1.1 Keep-Alive 클라이언트를 생성하는 생성자임.
     * [내가 지은 이름] properties
     */
        this.properties = properties;
        long timeoutMs = Math.max(5000L, properties.nemc().requestTimeoutMs());
        this.fetchExecutor = Executors.newFixedThreadPool(MAX_CONCURRENT_REQUESTS, runnable -> {
            Thread thread = new Thread(runnable, "yonsei119-nemc-fetch");
            thread.setDaemon(true);
            return thread;
        });
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(timeoutMs))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        /*
         * [스프링/자바 내장 함수]
         * - Executors.newFixedThreadPool(...) : 지정된 개수(2개)의 스레드만 재사용하는 풀 생성 (형제 함수: newSingleThreadExecutor, newCachedThreadPool)
         * - HttpClient.newBuilder().version(...).connectTimeout(...).followRedirects(...).build() : 빌더 패턴으로 HTTP 클라이언트 조립 (이름 변경 불가)
         */
    }

    @PreDestroy
    public void shutdown() {
    /*
     * [스프링/라이브러리 내장 어노테이션] @PreDestroy : 서버 종료 시 자동 실행되어 스레드 누수를 막음.
     * [내가 지은 이름] shutdown
     */
        fetchExecutor.shutdownNow();
        /*
         * [스프링/자바 내장 함수] fetchExecutor.shutdownNow() (진행 중인 백그라운드 스레드를 즉시 안전 종료, 이름 변경 불가)
         */
    }

    public Map<String, List<Map<String, String>>> fetchAllDatasets() {
    /*
     * [자바 문법] public : 7개 전체 OpenAPI를 한꺼번에 병렬 수집해 반환함.
     * [내가 지은 이름] fetchAllDatasets
     */
        return fetchEndpointGroup(ENDPOINTS);
        /*
         * [핵심 원리] 내부 공통 병렬 수집 엔진(fetchEndpointGroup)에 7개 전체 사전을 넘겨 실행함.
         */
    }

    public Map<String, List<Map<String, String>>> fetchColdDatasets() {
    /*
     * [자바 문법] public : 주소·좌표·기본정보·외상센터 마스터 등 Cold 4종 API만 병렬 수집함.
     * [내가 지은 이름] fetchColdDatasets
     */
        return fetchEndpointGroup(COLD_ENDPOINTS);
        /*
         * [핵심 원리] 서버 기동 직후 및 6시간 경과 시에만 호출되어 공공데이터 일일 트래픽 소모를 크게 절감함.
         */
    }

    public Map<String, List<Map<String, String>>> fetchHotDatasets() {
    /*
     * [자바 문법] public : 실시간 병상(beds), 긴급공지(messages), 28대 중증질환(severe) Hot 3종 API만 빠르게 병렬 수집함.
     * [내가 지은 이름] fetchHotDatasets
     */
        return fetchEndpointGroup(HOT_ENDPOINTS);
        /*
         * [핵심 원리] 3분마다 가볍게 3개 실시간 엔드포인트만 조회하므로 병상 최신성이 비약적으로 향상됨.
         */
    }

    private Map<String, List<Map<String, String>>> fetchEndpointGroup(Map<String, String> targetEndpoints) {
    /*
     * [자바 문법] private : 전달받은 오퍼레이션 목록을 CompletableFuture로 동시에 비동기 요청하고 결과를 모으는 핵심 병렬 함수임.
     * [내가 지은 이름] fetchEndpointGroup(함수명), targetEndpoints(조회 대상 엔드포인트 맵)
     */
        Map<String, CompletableFuture<List<Map<String, String>>>> futures = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : targetEndpoints.entrySet()) {
            String key = entry.getKey();
            String operation = entry.getValue();
            futures.put(key, CompletableFuture.supplyAsync(() -> fetchAllPages(operation), fetchExecutor));
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
         * [스프링/자바 내장 함수]
         * - CompletableFuture.supplyAsync(작업, 스레드풀) : 결과를 반환하는 비동기 작업 시작 (반환값이 없을 때 쓰는 형제 함수: runAsync)
         * - .join() : 비동기 작업이 끝날 때까지 기다렸다가 결과 리스트를 꺼냄.
         * [병렬 수집 데이터 구조 예시]
         *   results = {
         *     "beds":     [ {"hpid": "A2200001", "hvec": "5", ...}, ... ],
         *     "messages": [ {"hpid": "A2200001", "symblkmsg": "...", ...} ],
         *     "severe":   [ {"hpid": "A2200001", "mkioskty1": "Y", ...}, ... ]
         *   }
         */
    }

    public List<Map<String, String>> fetchAllPages(String operation) {
    /*
     * [자바 문법] public : 단일 OpenAPI의 1페이지부터 마지막 페이지(totalCount 도달 시점)까지 자동 순회해 합치는 메서드임.
     * [내가 지은 이름] fetchAllPages(함수명), operation(공공데이터 오퍼레이션 영문명)
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
         * [자바 문법] while (조건) { ... break; } : 최대 MAX_PAGES(10페이지) 한도 안에서 필요한 페이지만큼만 반복함.
         * [핵심 원리] 수집에 완전히 성공했을 때만 lastSuccessfulByOperation 백업 금고를 갱신하고, 중간에 타임아웃이 나면 직전 정상 데이터를 꺼내 무중단 서비스를 보장함.
         */
    }

    public ParsedXmlPage fetchSinglePage(String operation, int pageNo, int numOfRows) {
    /*
     * [자바 문법] public, int
     * [내가 지은 이름] ParsedXmlPage(반환 레코드 타입명) / fetchSinglePage(함수명), operation, pageNo(페이지 번호), numOfRows(행 개수)
     */
        String encodedKey = ensureUrlEncodedServiceKey(properties.nemc().serviceKey());
        if (encodedKey.isEmpty()) {
            log.warn("NEMC_API_SERVICE_KEY 미설정으로 OpenAPI 호출 생략 (operation={}).", operation);
            return new ParsedXmlPage(0, List.of(), false);
        }
        String baseUrl = properties.nemc().baseUrl().replaceAll("/+$", "");
        String requestUrl = String.format(
                "%s/%s?serviceKey=%s&pageNo=%d&numOfRows=%d",
                baseUrl, operation, encodedKey, pageNo, numOfRows
        );
        /*
         * [스프링/자바 내장 함수] String.format(...) : 서식 지정자(%s 문자열, %d 정수)에 값을 끼워 넣어 요청 URL을 조립함.
         * [최종 완성된 URL 예시]
         *   https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire?serviceKey=인코딩된인증키&pageNo=1&numOfRows=1000
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
                 * [스프링/자바 내장 함수]
                 * - HttpRequest.newBuilder().uri(...).timeout(...).header(...).GET().build()
                 *   (형제 HTTP 메서드 함수: .POST(BodyPublishers.ofString(...)), .PUT(...), .DELETE())
                 * - httpClient.send(...) : UTF-8 문자열로 XML 응답 본문을 수신함 (비동기 형제 함수: .sendAsync(...)).
                 */

                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    if (attempt < MAX_ATTEMPTS_PER_PAGE) {
                        sleepBeforeRetry(attempt);
                        continue;
                    }
                    log.warn("NEMC OpenAPI HTTP 비정상 응답 (최종 실패): operation={}, status={}",
                            operation, response.statusCode());
                    return new ParsedXmlPage(0, List.of(), false);
                }

                ParsedXmlPage parsed = parseXmlResponse(response.body(), operation);
                if (!parsed.success() && attempt < MAX_ATTEMPTS_PER_PAGE) {
                    sleepBeforeRetry(attempt);
                    continue;
                }
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
        return new ParsedXmlPage(0, List.of(), false);
        /*
         * [핵심 원리] 공공데이터포털 게이트웨이가 순간적으로 흔들려도 800ms -> 1600ms 간격으로 자동 재시도하여 일시적 순단을 스스로 복구함.
         */
    }

    private static void sleepBeforeRetry(int attempt) {
    /*
     * [자바 문법] private static void : 재시도 전 지수 백오프(Exponential/Linear Backoff) 대기를 수행하는 보조 함수임.
     * [내가 지은 이름] sleepBeforeRetry, attempt(현재 시도 차수)
     */
        try {
            Thread.sleep(RETRY_BASE_BACKOFF_MS * attempt);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
        /*
         * [스프링/자바 내장 함수] Thread.sleep(...), Thread.currentThread().interrupt() (인터럽트 신호 복원 표준 관례, 이름 변경 불가)
         */
    }

    public static String ensureUrlEncodedServiceKey(String rawKey) {
    /*
     * [자바 문법] public static : 공공데이터포털 인증키(Encoding 키 / Decoding 키)의 이중 인코딩 사고를 원천 차단하는 정규화 함수임.
     * [내가 지은 이름] ensureUrlEncodedServiceKey(함수명), rawKey(원본 인증키 문자열)
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
         * [스프링/자바 내장 함수] URLEncoder.encode(문자열, StandardCharsets.UTF_8) (역변환 형제 도구: URLDecoder.decode)
         * [핵심 원리 & 변환 예시]
         * - 이미 '%'가 들어 있는 Encoding 인증키("abc%2Fdef%3D%3D") -> 그대로 통과 (이중 인코딩 %252F 에러 완벽 차단)
         * - 평문 Decoding 인증키("abc/def==") -> "abc%2Fdef%3D%3D"로 안전하게 1회 인코딩
         */
    }

    public ParsedXmlPage parseXmlResponse(String xmlText, String operation) {
    /*
     * [자바 문법] public : 공공데이터 XML 원문을 XXE 보안이 적용된 파서로 읽어 소문자 키 Map 리스트로 변환함.
     * [내가 지은 이름] ParsedXmlPage(반환 레코드), parseXmlResponse(함수명), xmlText(XML 문자열), operation(API 이름)
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
             * [보안 핵심 원리 — OWASP XXE(XML 외부 엔티티 주입) 방어]
             * - 외부에서 받은 XML 안에 악성 DOCTYPE이나 서버 내부 파일 읽기 명령이 숨어 있어도 원천 차단하도록 보안 스위치를 모두 잠금.
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

            int totalCount = 0;
            String totalCountText = getFirstTagText(doc, "totalCount");
            if (!totalCountText.isEmpty()) {
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
         * [XML -> Java Map 데이터 변환 예시]
         *   [원본 XML]                           [변환된 fieldMap]
         *   <item>
         *     <HPID>A2200001</HPID>        ──>   "hpid": "A2200001"  (모든 태그명을 소문자로 통일)
         *     <hvec>-4</hvec>              ──>   "hvec": "-4"        (초과수용 음수 문자열 보존)
         *     <hv28></hv28>                ──>   "hv28": ""          (결측 빈 문자열 보존, 0 왜곡 금지)
         *   </item>
         */
    }

    private static String getFirstTagText(Document doc, String tagName) {
    /*
     * [자바 문법] private static : XML 문서에서 특정 태그(resultCode, totalCount 등)의 첫 번째 텍스트 값을 안전하게 꺼내는 보조 함수임.
     * [내가 지은 이름] getFirstTagText, doc, tagName
     */
        NodeList list = doc.getElementsByTagName(tagName);
        if (list == null || list.getLength() == 0 || list.item(0) == null) {
            return "";
        }
        String text = list.item(0).getTextContent();
        return text != null ? text.trim() : "";
        /*
         * [스프링/자바 내장 함수] doc.getElementsByTagName(...), .getLength(), .item(0), .getTextContent() (이름 변경 불가)
         */
    }

    public record ParsedXmlPage(
            int totalCount,
            List<Map<String, String>> items,
            boolean success
    ) {
    /*
     * [자바 문법] public record, int, boolean
     * [내가 지은 이름] ParsedXmlPage(대문자 레코드명) / totalCount(전체 건수), items(파싱된 병원 행 리스트), success(정상 수신 여부)
     */
    }
}
