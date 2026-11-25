package com.yonsei119;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.ConsoleMessage;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.Route;
import com.microsoft.playwright.options.BoundingBox;
import com.microsoft.playwright.options.ServiceWorkerPolicy;
import com.yonsei119.dto.EmergencySnapshotDto;
import com.yonsei119.service.EmergencyDataService;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/*
 * [역할 및 실행 시점]
 * - 역할: 실제 헤드리스 Chromium 브라우저를 띄워 프론트엔드 UI(다크모드, 50km 기본 반경, 대학병원 정적 워터마크 로고,
 *         의료원 로고 제외, ETA 추천 순위, CSP 위반 0건)를 종단간(End-to-End) 검증하는 브라우저 통합 테스트
 * - 실행 시점: Gradle `e2eTest` 또는 `checkAll` 태스크 실행 시(`.\gradlew.bat checkAll --no-daemon`) 내장 Tomcat과 함께 구동됨
 *
 * [전체 검증 흐름]
 * - @BeforeAll launchChromiumBrowser() ──> 로컬 Chrome(또는 Edge 폴백) 헤드리스 브라우저 실행
 *   ├── E2E 1 : `/api/hospitals` 최초 503 장애 후 수동 새로고침 복구, 다크모드 유지, CSP 위반·미처리 예외 0건 검증
 *   └── E2E 2 : 기본 탐색 반경(50 km), 44px 터치 타깃, 대학교병원 워터마크(스크롤 시 위치 고정·다크/라이트 모드·의료원 제외), ETA 추천순위 검증
 * - @AfterEach clearTestSnapshot()     ──> 테스트 간 캐시 격리 초기화
 * - @AfterAll closeChromiumBrowser()   ──> 브라우저 및 Playwright 프로세스 종료
 *
 * [내장 / 프레임워크 / 라이브러리 구분]
 * - Java 표준 내장: List, ArrayList, Map, AtomicInteger, Pattern, Locale
 * - Spring Boot Test / JUnit 5: @SpringBootTest, @LocalServerPort, @BeforeAll, @AfterAll, @AfterEach, @Test
 * - 외부 라이브러리: Microsoft Playwright for Java (Browser, BrowserContext, Page, Locator, Route, PlaywrightAssertions)
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "yonsei119.nemc.auto-refresh-enabled=false",
                "yonsei119.nemc.service-key=",
                "yonsei119.naver.client-secret="
        }
)
class Yonsei119PlaywrightE2ETests {

    private static Playwright playwright;
    private static Browser browser;

    @LocalServerPort
    private int port;

    @Autowired
    private EmergencyDataService emergencyDataService;

    /** 전체 E2E 테스트 시작 전 1회 헤드리스 Chrome(미설치 환경 시 Edge) 브라우저를 기동함 */
    @BeforeAll
    static void launchChromiumBrowser() {
        playwright = Playwright.create();
        try {
            browser = playwright.chromium().launch(
                    new BrowserType.LaunchOptions()
                            .setHeadless(true)
                            .setChannel("chrome")
            );
        } catch (RuntimeException chromeError) {
            browser = playwright.chromium().launch(
                    new BrowserType.LaunchOptions()
                            .setHeadless(true)
                            .setChannel("msedge")
            );
        }
    }

    /** 전체 E2E 테스트 종료 후 브라우저와 Playwright 리소스를 해제함 */
    @AfterAll
    static void closeChromiumBrowser() {
        if (browser != null) {
            browser.close();
            browser = null;
        }
        if (playwright != null) {
            playwright.close();
            playwright = null;
        }
    }

    /** 각 테스트 종료마다 인메모리 병원 스냅샷을 비워 테스트 간 간섭을 방지함 */
    @AfterEach
    void clearTestSnapshot() {
        emergencyDataService.setCachedSnapshotForTest(null);
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 일시적 503 응답 발생 후 새로고침 복구 시에도 다크모드 스타일이 깨지지 않고 CSP 위반이 0건인지 검증함
     * - 흐름:
     *   첫 `/api/hospitals` 요청을 503으로 모의 응답 ──> 다크모드(`data-theme="dark"`) 및 실패 상태 메시지 확인
     *   ──> `#refresh-button` 클릭 시 정상 JSON 응답 ──> 원주세브란스 검색 노출 및 CSP·콘솔 오류 0건 검증
     */
    @Test
    @DisplayName("E2E 1. 콜드스타트 503 지연·복구 중에도 다크모드 유지 및 CSP 위반이 0건이어야 한다")
    void testColdStart503ResilienceDarkModeAndZeroCspViolations() {
        try (BrowserContext context = browser.newContext(
                new Browser.NewContextOptions()
                        .setViewportSize(1280, 800)
                        .setServiceWorkers(ServiceWorkerPolicy.BLOCK)
        )) {
            Page page = context.newPage();
            List<String> pageErrors = new ArrayList<>();
            List<String> appConsoleErrors = new ArrayList<>();
            page.onPageError(err -> recordUnexpectedPageError(err, pageErrors));
            page.onConsoleMessage(msg -> recordUnexpectedConsoleError(msg, appConsoleErrors));

            page.addInitScript("""
                    window.__cspViolations = [];
                    window.__observedStatuses = [];
                    document.addEventListener('securitypolicyviolation', event => {
                        window.__cspViolations.push(`${event.violatedDirective}:${event.blockedURI}`);
                    });
                    document.addEventListener('DOMContentLoaded', () => {
                        const statusEl = document.getElementById('status');
                        if (statusEl) {
                            new MutationObserver(() => {
                                const text = (statusEl.textContent || '').trim();
                                if (text) {
                                    window.__observedStatuses.push(text);
                                }
                            }).observe(statusEl, { childList: true, characterData: true, subtree: true });
                        }
                    });
                    """);

            AtomicInteger hospitalRequests = new AtomicInteger(0);
            String recoveryPayload = """
                    {
                      "updatedAt": "2026-11-24T13:30:00+09:00",
                      "cached": false,
                      "totalCount": 1,
                      "tertiaryCount": 1,
                      "regionalCount": 1,
                      "medicalCount": 0,
                      "traumaCount": 1,
                      "otherCount": 0,
                      "sources": {"list":true,"basic":true,"beds":true,"messages":true,"severe":true,"traumaList":true,"traumaBasic":true},
                      "endpointCounts": {"list":1,"basic":1,"beds":1,"messages":0,"severe":1,"traumaList":1,"traumaBasic":1},
                      "hospitals": [{
                        "id": "A2200001",
                        "name": "연세대학교원주세브란스기독병원",
                        "address": "서울특별시 중구 세종대로 110 인근",
                        "tel": "033-741-0114",
                        "erTel": "033-741-1119",
                        "lat": 37.5620,
                        "lng": 126.9420,
                        "regional": true,
                        "type": {"group":"tertiary","label":"상급종합병원","accent":"#d34458","priority":1},
                        "basic": {"dutyemclsname":"권역응급의료센터"},
                        "trauma": {"designated":"Y"},
                        "beds": {"hvec":"5","hvs01":"30"},
                        "messages": [],
                        "severe": {"mkioskty1":"Y"}
                      }]
                    }
                    """;

            page.route("**/api/hospitals**", route -> {
                if (hospitalRequests.incrementAndGet() == 1) {
                    route.fulfill(new Route.FulfillOptions()
                            .setStatus(503)
                            .setContentType("text/html; charset=utf-8")
                            .setBody("<html><body><h1>503 Service Unavailable</h1></body></html>"));
                } else {
                    route.fulfill(new Route.FulfillOptions()
                            .setStatus(200)
                            .setContentType("application/json; charset=utf-8")
                            .setBody(recoveryPayload));
                }
            });

            page.navigate("http://localhost:" + port + "/");

            assertEquals("dark", page.locator("html").getAttribute("data-theme"));
            assertThat(page.locator("html")).hasClass(Pattern.compile("\\bdark-mode\\b"));
            assertThat(page.locator("body")).hasClass(Pattern.compile("\\bdark-mode\\b"));

            dismissNoticeIfOpen(page);

            page.waitForFunction("() => !document.getElementById('refresh-button')?.disabled");
            page.waitForFunction("() => (window.__observedStatuses || []).some(text => text.includes('조회 실패'))");

            page.locator("#refresh-button").click();
            page.waitForFunction("() => (window.__YONSEI119_DIAGNOSTICS__?.getState()?.hospitals?.length || 0) === 1");

            page.locator("#keyword").fill("원주세브란스");
            assertThat(page.locator("#search-results .result-button").first())
                    .containsText("연세대학교원주세브란스기독병원");

            List<String> cspViolations = readCspViolations(page);
            assertTrue(cspViolations.isEmpty(), "CSP 위반이 없어야 합니다: " + cspViolations);
            assertTrue(pageErrors.isEmpty(), "페이지 미처리 예외가 없어야 합니다: " + pageErrors);
            assertTrue(appConsoleErrors.isEmpty(), "예기치 않은 콘솔 오류가 없어야 합니다: " + appConsoleErrors);
        }
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 기본 탐색 반경(50 km), 툴바 버튼 규격(>=44px), 대학교병원 정적 배경 로고(스크롤 시 고정·다크모드 주의 배너 대비·라이트모드·의료원 제외),
     *         ETA 추천순위 동작 및 음성안내 UI 제거 상태를 실제 브라우저에서 검증함
     */
    @Test
    @DisplayName("E2E 2. 기본 탐색 반경 50km, 툴바 버튼 규격, 대학교병원 정적 배경 로고(스크롤 고정·테마·의료원 제외), ETA 추천순위가 동작해야 한다")
    void testUniversityWatermarkStaticScrollMedicalExclusionAndEtaRanking() {
        emergencyDataService.setCachedSnapshotForTest(buildThreeHospitalSnapshot());

        try (BrowserContext context = browser.newContext(
                new Browser.NewContextOptions().setViewportSize(1280, 800)
        )) {
            Page page = context.newPage();
            List<String> pageErrors = new ArrayList<>();
            page.onPageError(err -> recordUnexpectedPageError(err, pageErrors));
            page.addInitScript("""
                    window.__cspViolations = [];
                    document.addEventListener('securitypolicyviolation', event => {
                        window.__cspViolations.push(`${event.violatedDirective}:${event.blockedURI}`);
                    });
                    """);

            page.navigate("http://localhost:" + port + "/");
            dismissNoticeIfOpen(page);
            page.waitForFunction("() => (window.__YONSEI119_DIAGNOSTICS__?.getState()?.hospitals?.length || 0) === 3");

            assertEquals("50", page.locator("#radius").inputValue());
            assertThat(page.locator("#radius-value")).hasText("50 km");

            assertEquals(0, page.locator("#bed-alert-toggle").count());
            assertEquals(0, page.locator("#lang-select").count());
            assertEquals(0, page.locator("#symptom-chips-bar").count());
            assertEquals(0, page.locator("#quick-hospitals-bar").count());
            assertEquals(0, page.locator("#sheet-tts-btn").count());

            BoundingBox radiusBox = page.locator("#radius-button").boundingBox();
            BoundingBox locationBox = page.locator("#location-button").boundingBox();
            assertNotNull(radiusBox);
            assertNotNull(locationBox);
            assertTrue(
                    radiusBox.width >= 44 && radiusBox.height >= 44,
                    "반경 버튼 크기가 44px 이상이어야 합니다: " + radiusBox.width + "x" + radiusBox.height
            );
            assertTrue(
                    locationBox.width >= 44 && locationBox.height >= 44,
                    "내위치 버튼 크기가 44px 이상이어야 합니다: " + locationBox.width + "x" + locationBox.height
            );
            assertTrue(Math.abs(radiusBox.y - locationBox.y) < 4, "툴바 원형 버튼이 한 줄에 정렬되어야 합니다.");

            page.locator("#keyword").fill("원주세브란스");
            Locator resultBtn = page.locator("#search-results .result-button").first();
            assertThat(resultBtn).containsText("연세대학교원주세브란스기독병원");
            resultBtn.click();

            assertThat(page.locator("#sheet")).hasClass(Pattern.compile("\\bopen\\b"));
            assertThat(page.locator("#sheet")).hasClass(Pattern.compile("\\bhas-univ-logo\\b"));
            assertEquals(0, page.locator("#sheet-tts-btn").count());
            assertThat(page.locator("#sheet-univ-watermark")).isVisible();
            page.waitForFunction("() => document.getElementById('sheet-univ-logo')?.complete && document.getElementById('sheet-univ-logo')?.naturalWidth > 0");
            assertTrue(
                    String.valueOf(page.locator("#sheet-univ-logo").getAttribute("src")).contains("universities/yonsei.svg"),
                    "연세대학교 로고 배경이 연결되어야 합니다."
            );

            String safetyBgDark = (String) page.evaluate(
                    "() => getComputedStyle(document.querySelector('#sheet .safety-note')).backgroundColor"
            );
            assertNotNull(safetyBgDark);
            assertTrue(
                    safetyBgDark.contains("120, 53, 15"),
                    "다크모드 대학병원 시트에서도 상단 주의 배너(.safety-note)가 어두운 배경을 유지해야 합니다: " + safetyBgDark
            );

            BoundingBox beforeScrollLogoBox = page.locator("#sheet-univ-logo").boundingBox();
            assertNotNull(beforeScrollLogoBox);
            page.evaluate("""
                    () => {
                        const scroller = document.querySelector('#sheet .sheet-scroll');
                        if (scroller) {
                            scroller.scrollTop = 360;
                        }
                    }
                    """);
            Number scrolledTop = (Number) page.evaluate("() => document.querySelector('#sheet .sheet-scroll')?.scrollTop || 0");
            assertNotNull(scrolledTop);
            assertTrue(scrolledTop.doubleValue() > 100, "시트 내부 스크롤이 이동해야 합니다: " + scrolledTop);
            BoundingBox afterScrollLogoBox = page.locator("#sheet-univ-logo").boundingBox();
            assertNotNull(afterScrollLogoBox);
            assertTrue(
                    Math.abs(beforeScrollLogoBox.y - afterScrollLogoBox.y) < 1.0,
                    "스크롤 중에도 대학교 배경 로고 Y 위치가 정적으로 유지되어야 합니다."
            );

            page.locator("#sheet-close").click();
            assertThat(page.locator("#sheet")).not().hasClass(Pattern.compile("\\bopen\\b"));

            page.locator("#theme-toggle").click();
            assertEquals("light", page.locator("html").getAttribute("data-theme"));

            page.locator("#keyword").fill("연세세브란스");
            Locator lightUnivBtn = page.locator("#search-results .result-button").first();
            assertThat(lightUnivBtn).containsText("연세세브란스병원");
            lightUnivBtn.click();

            assertThat(page.locator("#sheet")).hasClass(Pattern.compile("\\bopen\\b"));
            assertThat(page.locator("#sheet")).hasClass(Pattern.compile("\\bhas-univ-logo\\b"));
            assertThat(page.locator("#sheet-univ-watermark")).isVisible();
            assertTrue(
                    String.valueOf(page.locator("#sheet-univ-logo").getAttribute("src")).contains("universities/yonsei.svg"),
                    "라이트 모드에서도 연세세브란스병원에 연세대학교 로고가 표시되어야 합니다."
            );
            page.locator("#sheet-close").click();

            page.locator("#keyword").fill("서울의료원");
            Locator medicalBtn = page.locator("#search-results .result-button").first();
            assertThat(medicalBtn).containsText("서울특별시서울의료원");
            medicalBtn.click();

            assertThat(page.locator("#sheet")).hasClass(Pattern.compile("\\bopen\\b"));
            assertThat(page.locator("#sheet")).not().hasClass(Pattern.compile("\\bhas-univ-logo\\b"));
            assertThat(page.locator("#sheet-univ-watermark")).isHidden();

            page.locator("#sheet-close").click();
            assertThat(page.locator("#sheet")).not().hasClass(Pattern.compile("\\bopen\\b"));

            page.locator("#eta-rank-btn").click();
            Locator etaBox = page.locator("#eta-rank-box");
            assertThat(etaBox).isVisible();
            assertThat(etaBox.locator(".eta-rank-item").first()).isVisible();

            List<String> cspViolations = readCspViolations(page);
            assertTrue(cspViolations.isEmpty(), "CSP 위반이 없어야 합니다: " + cspViolations);
            assertTrue(pageErrors.isEmpty(), "페이지 미처리 예외가 없어야 합니다: " + pageErrors);
        }
    }

    /** 대학교병원 2곳(원주세브란스·신촌세브란스)과 지방의료원 1곳(서울의료원)으로 구성된 E2E 검증용 스냅샷을 생성함 */
    private EmergencySnapshotDto buildThreeHospitalSnapshot() {
        Map<String, List<Map<String, String>>> rawDatasets = Map.of(
                "list", List.of(
                        Map.of(
                                "hpid", "A2200001",
                                "dutyname", "연세대학교원주세브란스기독병원",
                                "wgs84lat", "37.5620",
                                "wgs84lon", "126.9420",
                                "dutyaddr", "서울특별시 서대문구 연세로 50 인근"
                        ),
                        Map.of(
                                "hpid", "A1100001",
                                "dutyname", "연세세브란스병원",
                                "wgs84lat", "37.5680",
                                "wgs84lon", "126.9680",
                                "dutyaddr", "서울특별시 서대문구 연세로 50-1"
                        ),
                        Map.of(
                                "hpid", "A1100035",
                                "dutyname", "서울특별시서울의료원",
                                "wgs84lat", "37.5710",
                                "wgs84lon", "126.9760",
                                "dutyaddr", "서울특별시 중랑구 신내로 156"
                        )
                ),
                "basic", List.of(
                        Map.of("hpid", "A2200001", "dutyemclsname", "권역응급의료센터", "dutytel1", "033-741-0114", "dutytel3", "033-741-1119"),
                        Map.of("hpid", "A1100001", "dutyemclsname", "권역응급의료센터", "dutytel1", "02-2228-0114", "dutytel3", "02-2228-8888"),
                        Map.of("hpid", "A1100035", "dutyemclsname", "권역응급의료센터", "dutytel1", "02-2276-7000", "dutytel3", "02-2276-7119")
                ),
                "beds", List.of(
                        Map.of("hpid", "A2200001", "hvec", "0", "hvs01", "30"),
                        Map.of("hpid", "A1100001", "hvec", "6", "hvs01", "40"),
                        Map.of("hpid", "A1100035", "hvec", "4", "hvs01", "25")
                ),
                "messages", List.of(),
                "severe", List.of(
                        Map.of("hpid", "A2200001", "mkioskty1", "Y", "mkioskty28", "Y"),
                        Map.of("hpid", "A1100001", "mkioskty1", "Y"),
                        Map.of("hpid", "A1100035", "mkioskty1", "Y")
                ),
                "traumaList", List.of(),
                "traumaBasic", List.of()
        );
        return emergencyDataService.mergeDatasetsIntoSnapshot(rawDatasets);
    }

    /** 브라우저에 기록된 CSP 위반 이벤트 목록을 읽어 반환함 */
    private static List<String> readCspViolations(Page page) {
        Object raw = page.evaluate("() => window.__cspViolations || []");
        if (raw instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        return List.of();
    }

    /** 최초 접속 시 나타나는 안전 안내 모달이 열려 있으면 확인 버튼을 눌러 닫음 */
    private static void dismissNoticeIfOpen(Page page) {
        page.waitForFunction("() => Boolean(window.__YONSEI119_DIAGNOSTICS__)");
        Locator noticeConfirm = page.locator("#notice-confirm");
        if (noticeConfirm.isVisible()) {
            noticeConfirm.click();
        }
    }

    /** 헤드리스 WebGL 없는 환경에서 외부 네이버 지도 SDK가 남기는 알려진 무해 예외를 제외하고 페이지 오류를 수집함 */
    private static void recordUnexpectedPageError(String error, List<String> target) {
        if (error.contains("oapi.map.naver.com")
                && (error.contains("removeDOMListener")
                || error.contains("_isGLModeActive")
                || error.contains("hasValue"))) {
            return;
        }
        target.add(error);
    }

    /** 의도된 503 테스트 응답과 로컬 도메인 미등록에 따른 네이버 타일 401을 제외한 앱 자체 콘솔 에러만 수집함 */
    private static void recordUnexpectedConsoleError(ConsoleMessage msg, List<String> target) {
        if (!"error".equals(msg.type())) {
            return;
        }
        String text = msg.text();
        if (text.contains("503")) {
            return;
        }
        String location = msg.location().toLowerCase(Locale.ROOT);
        if (text.contains("401") && (location.contains("naver.com") || location.contains("naver.net"))) {
            return;
        }
        target.add(text);
    }
}
