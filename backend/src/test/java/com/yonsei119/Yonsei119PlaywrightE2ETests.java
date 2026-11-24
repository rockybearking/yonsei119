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
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    @AfterEach
    void clearTestSnapshot() {
        emergencyDataService.setCachedSnapshotForTest(null);
    }

    @Test
    @DisplayName("E2E 1. Render 콜드스타트 503 지연·복구 중에도 다크모드 유지 및 CSP 위반이 0건이어야 한다")
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

    @Test
    @DisplayName("E2E 2. 툴바 원형 버튼 크기·정렬, 음성안내, ETA 추천순위가 동작하고 제거된 필터·최근조회 UI가 없어야 한다")
    void testSheetTtsCircleButtonSizeAndEtaRanking() {
        emergencyDataService.setCachedSnapshotForTest(buildTwoHospitalSnapshot());

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
            page.waitForFunction("() => (window.__YONSEI119_DIAGNOSTICS__?.getState()?.hospitals?.length || 0) === 2");

            assertEquals(0, page.locator("#bed-alert-toggle").count());
            assertEquals(0, page.locator("#lang-select").count());
            assertEquals(0, page.locator("#symptom-chips-bar").count());
            assertEquals(0, page.locator("#quick-hospitals-bar").count());

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
            assertThat(page.locator("#sheet-tts-btn")).isVisible();
            assertThat(page.locator("#sheet-tts-btn")).containsText("음성 안내");

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

    private EmergencySnapshotDto buildTwoHospitalSnapshot() {
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
                        )
                ),
                "basic", List.of(
                        Map.of("hpid", "A2200001", "dutyemclsname", "권역응급의료센터", "dutytel1", "033-741-0114", "dutytel3", "033-741-1119"),
                        Map.of("hpid", "A1100001", "dutyemclsname", "권역응급의료센터", "dutytel1", "02-2228-0114", "dutytel3", "02-2228-8888")
                ),
                "beds", List.of(
                        Map.of("hpid", "A2200001", "hvec", "0", "hvs01", "30"),
                        Map.of("hpid", "A1100001", "hvec", "6", "hvs01", "40")
                ),
                "messages", List.of(),
                "severe", List.of(
                        Map.of("hpid", "A2200001", "mkioskty1", "Y", "mkioskty28", "Y"),
                        Map.of("hpid", "A1100001", "mkioskty1", "Y")
                ),
                "traumaList", List.of(),
                "traumaBasic", List.of()
        );
        return emergencyDataService.mergeDatasetsIntoSnapshot(rawDatasets);
    }

    private static List<String> readCspViolations(Page page) {
        Object raw = page.evaluate("() => window.__cspViolations || []");
        if (raw instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        return List.of();
    }

    private static void dismissNoticeIfOpen(Page page) {
        page.waitForFunction("() => Boolean(window.__YONSEI119_DIAGNOSTICS__)");
        Locator noticeConfirm = page.locator("#notice-confirm");
        if (noticeConfirm.isVisible()) {
            noticeConfirm.click();
        }
    }

    private static void recordUnexpectedPageError(String error, List<String> target) {
        if (error.contains("oapi.map.naver.com") && error.contains("removeDOMListener")) {
            return;
        }
        target.add(error);
    }

    private static void recordUnexpectedConsoleError(ConsoleMessage msg, List<String> target) {
        if (!"error".equals(msg.type())) {
            return;
        }
        String text = msg.text();
        if (text.contains("503")) {
            return;
        }
        String location = msg.location().toLowerCase(java.util.Locale.ROOT);
        if (text.contains("401") && (location.contains("naver.com") || location.contains("naver.net"))) {
            return;
        }
        target.add(text);
    }
}
