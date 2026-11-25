/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 오프라인 비상 백업 창고 관리자 (PWA 서비스 워커)
 *   · 평상시 온라인에서는 최신 서버 응답과 Render 콜드스타트 대기 화면을 그대로 통과시키고,
 *     인터넷이 완전히 끊긴 오프라인 재난 상황에서만 미리 저장해 둔 화면·병원 데이터를 꺼내 줌
 * - 실행 시점: 페이지 로드 완료 후 `js/search-controls.js`의 `registerServiceWorker()`가
 *   `navigator.serviceWorker.register('/sw.js')`를 호출할 때 브라우저 백그라운드 스레드에서 구동됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   브라우저 요청 발생 ──> `self` `'fetch'` 이벤트 가로채기
 *   ├── 문서 진입(`navigate`, `/`, `/index.html`) ──> `networkFirstNavigation()`
 *   │   ├── 온라인(Render 깨어나는 중 502/503 포함): 타임아웃 없이 서버/Render 응답 그대로 표시 (Render 로딩 화면 보존!)
 *   │   └── 완전 오프라인(네트워크 단절 `catch`): 저장된 `/index.html` 비상 반환
 *   ├── 데이터 API(`/api/hospitals*`, `/api/config`) ──> `networkFirstWithSnapshotFallback()`
 *   │   ├── 온라인 정상 JSON(또는 304): 최신 캐시 갱신 후 반환
 *   │   └── 오프라인·장애: `X-Yonsei119-Offline-Fallback: 1` 헤더를 붙여 마지막 스냅샷 반환
 *   ├── 정적 CSS·JS·매니페스트(`APP_SHELL_ASSETS`) ──> `networkFirstAsset()` (4.5초 내 최신 파일 우선)
 *   └── 실시간 경로·주소·헬스체크(`/api/directions*`, `/api/geocode*`, `/api/health`) ──> 워커 개입 없이 서버 직통
 *
 * [사용처 및 IDE 추적 가이드]
 * - 등록 호출처: `frontend/js/search-controls.js` -> `registerServiceWorker()`
 * - 오프라인 헤더 수신처: `frontend/js/search-controls.js` -> `fetchData()` (`X-Yonsei119-Offline-Fallback`)
 * - 백엔드 정적 서빙 연결: `WebConfig.java`, `SecurityHeadersFilter.java` (`X-Frame-Options: SAMEORIGIN`)
 * - IntelliJ 추적 팁: `Ctrl + Shift + F`로 `yonsei119-pwa-` 또는 `X-Yonsei119-Offline-Fallback` 검색
 * ============================================================================
 */

// [상수] 서비스 워커 캐시 저장소 버전 이름 (배포 시 버전을 올리면 activate 단계에서 구버전 캐시가 자동 삭제됨)
const CACHE_NAME = 'yonsei119-pwa-v261125-r3';

// [상수] 오프라인 비상 상황에서도 기본 화면이 열리도록 미리 담아 둘 22개 앱 쉘(App Shell) 정적 경로 목록
const APP_SHELL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/css/style.css',
    '/css/panels-toolbar.css',
    '/css/map-overlays.css',
    '/css/sheet-egen.css',
    '/css/directions-eta.css',
    '/css/dialogs-toast.css',
    '/css/dark-theme.css',
    '/css/responsive.css',
    '/js/app.js',
    '/js/theme-init.js',
    '/js/constants.js',
    '/js/state.js',
    '/js/utils.js',
    '/js/user-features.js',
    '/js/map-engine.js',
    '/js/markers-cluster.js',
    '/js/directions-eta.js',
    '/js/hospital-sheet.js',
    '/js/search-controls.js'
];

/*
 * [역할 및 실행 시점]
 * - 역할: 서비스 워커 최초 설치 또는 버전(`CACHE_NAME`) 변경 시 앱 쉘 22개 파일을 미리 저장함
 * - 흐름: `'install'` 발생 ──> `caches.open(CACHE_NAME)` ──> `cache.addAll(APP_SHELL_ASSETS)` ──> `self.skipWaiting()` 즉시 활성화 전환
 * - 내장 API 구분: `self`, `caches.open`, `cache.addAll`, `self.skipWaiting`, `event.waitUntil`은 브라우저 Service Worker 표준 내장 API임
 */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

/*
 * [역할 및 실행 시점]
 * - 역할: 새 서비스 워커가 활성화될 때 이전 버전 캐시 버킷을 청소하고 열린 탭 제어권을 즉시 확보함
 * - 흐름: `'activate'` 발생 ──> `caches.keys()` 조회 ──> `CACHE_NAME`과 다른 구버전 `caches.delete()` ──> `self.clients.claim()`
 * - 내장 API 구분: `caches.keys`, `caches.delete`, `Promise.all`, `self.clients.claim`은 JS·브라우저 표준 내장 API임
 */
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(oldKey => caches.delete(oldKey))
            )
        ).then(() => self.clients.claim())
    );
});

/*
 * [역할 및 실행 시점]
 * - 역할: 브라우저에서 나가는 동일 출처(Same-Origin) GET 요청을 경로 성격에 따라 알맞은 캐시 전략으로 분기함
 * - 실행 시점: 서비스 워커 활성화 이후 페이지 이동·정적 파일 로드·API 호출 시마다 자동 실행됨
 * - 분기 구조:
 *   GET & 동일 출처 확인
 *   ├── 문서 진입(`request.mode === 'navigate'`, `/`, `/index.html`) ──> `networkFirstNavigation(request)`
 *   ├── 병원·설정 API(`/api/hospitals*`, `/api/config`)            ──> `networkFirstWithSnapshotFallback(request)`
 *   ├── 정적 CSS·JS·매니페스트(`APP_SHELL_ASSETS`)                 ──> `networkFirstAsset(request)`
 *   └── 그 외(`/api/directions*`, `/api/geocode*`, `/api/health`) ──> 기본 브라우저 네트워크 직통
 */
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (url.pathname.startsWith('/api/hospitals') || url.pathname === '/api/config') {
        event.respondWith(networkFirstWithSnapshotFallback(request));
        return;
    }

    if (APP_SHELL_ASSETS.includes(url.pathname)) {
        event.respondWith(networkFirstAsset(request));
    }
});

/*
 * [역할 및 데이터 흐름]
 * - 역할: 정적 자산 응답이 Render 대기 HTML 페이지 등으로 잘못 내려오지 않았는지 확장자별 MIME 타입을 검증함
 * - 호출처: `networkFirstAsset(request)` 내부에서 캐시 저장 전 검증용으로 호출됨
 * - 흐름: HTTP 304 통과 ──> 2xx(`response.ok`) 확인 ──> `.css`/`.js`/`.webmanifest`/`.html`별 `Content-Type` 일치 여부 반환
 */
function isValidAssetResponse(request, response) {
    if (!response) {
        return false;
    }
    if (response.status === 304) {
        return true;
    }
    if (!response.ok) {
        return false;
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const pathname = new URL(request.url).pathname.toLowerCase();
    if (pathname.endsWith('.css')) {
        return contentType.includes('text/css');
    }
    if (pathname.endsWith('.js')) {
        return contentType.includes('javascript');
    }
    if (pathname.endsWith('.webmanifest')) {
        return contentType.includes('json') || contentType.includes('manifest');
    }
    if (pathname === '/' || pathname.endsWith('.html')) {
        return contentType.includes('text/html');
    }
    return true;
}

/*
 * [역할 및 데이터 흐름 — Render 무료 플랜 콜드스타트 버그 방지 핵심]
 * - 역할: 최초 사이트 접속(`/`, `/index.html`) 시 4.5초 강제 중단 없이 서버·Render 응답을 그대로 브라우저에 전달함
 * - 왜 필요한가?
 *   · 기존에는 문서 요청에도 4.5초 타임아웃과 502/503 캐시 대체가 걸려 있어, Render 무료 서버가 잠들어 있을 때
 *     Render 기본 로딩 화면이 사라지고 빈 지도에 '정보 확인 중…'만 길게 뜨는 현상이 발생했음
 * - 흐름:
 *   `fetch(request)` (타임아웃 없음)
 *   ├── 온라인 응답 수신 성공:
 *   │   ├── Spring Boot 보안 필터(`X-Frame-Options: SAMEORIGIN`)가 찍힌 정상 HTML일 때만 캐시 갱신
 *   │   └── Render 스핀업 대기 화면을 포함한 원본 `fresh` 응답을 그대로 브라우저에 반환
 *   └── 네트워크 완전 단절(`catch`): 저장된 `/index.html` 캐시본을 꺼내 오프라인 화면 복구
 * - 호출처: `self` `'fetch'` 이벤트 리스너의 문서 진입 분기
 */
async function networkFirstNavigation(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const fresh = await fetch(request);
        const contentType = (fresh?.headers?.get('content-type') || '').toLowerCase();
        const isGenuineAppHtml =
            fresh &&
            fresh.ok &&
            contentType.includes('text/html') &&
            fresh.headers.get('x-frame-options') === 'SAMEORIGIN';

        if (isGenuineAppHtml) {
            cache.put(request, fresh.clone());
        }
        return fresh;
    } catch (err) {
        const cached =
            (await cache.match(request)) ||
            (await cache.match('/index.html')) ||
            (await cache.match('/'));
        if (cached) {
            return cached;
        }
        throw err;
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 병원 목록(`/api/hospitals*`)과 공개 설정(`/api/config`)을 온라인 우선으로 조회하되, 장애·오프라인 시 마지막 정상 JSON을 복원함
 * - 흐름:
 *   `fetch(request)`
 *   ├── `If-None-Match` 조건부 요청에 대한 `304 Not Modified` ──> 그대로 반환
 *   ├── `200 OK` + `application/json` ──> `cache.put()` 백업 갱신 후 최신 응답 반환
 *   └── 비정상 응답 또는 네트워크 단절(`catch`) ──> `X-Yonsei119-Offline-Fallback: 1` 헤더를 붙여 백업 JSON 반환
 * - 호출처: `self` `'fetch'` 이벤트 리스너, 수신처는 `js/search-controls.js`의 `fetchData()`
 */
async function networkFirstWithSnapshotFallback(request) {
    const cache = await caches.open(CACHE_NAME);
    const pathname = new URL(request.url).pathname;
    const buildOfflineResponse = cached => {
        const headers = new Headers(cached.headers);
        headers.set('X-Yonsei119-Offline-Fallback', '1');
        return new Response(cached.body, {
            status: 200,
            statusText: 'OK (Offline Snapshot)',
            headers
        });
    };
    const matchOfflineCache = async () => {
        if (pathname === '/api/config') {
            return (await cache.match(request)) || (await cache.match('/api/config'));
        }
        return (
            (await cache.match(request)) ||
            (await cache.match('/api/hospitals?compact=true')) ||
            (await cache.match('/api/hospitals'))
        );
    };

    try {
        const freshResponse = await fetch(request);
        if (freshResponse && freshResponse.status === 304 && request.headers.get('if-none-match')) {
            return freshResponse;
        }
        const contentType = (freshResponse?.headers?.get('content-type') || '').toLowerCase();
        if (freshResponse && freshResponse.ok && contentType.includes('application/json')) {
            cache.put(request, freshResponse.clone());
            return freshResponse;
        }
        const cached = await matchOfflineCache();
        if (cached) {
            return buildOfflineResponse(cached);
        }
        return freshResponse;
    } catch {
        const cached = await matchOfflineCache();
        if (cached) {
            return buildOfflineResponse(cached);
        }
        throw new Error('네트워크 오프라인 및 저장된 백업 응답 없음');
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 정적 스타일시트(`.css`), 모듈 스크립트(`.js`), 매니페스트 요청을 온라인 우선(최대 4.5초 대기)으로 가져오고 실패 시 캐시로 복원함
 * - 흐름:
 *   캐시 확인 후 4.5초 `AbortController` 설정 ──> `fetch(request)`
 *   ├── `isValidAssetResponse()` 통과: `200 OK`면 캐시 갱신 후 반환 (`304`도 그대로 반환)
 *   └── MIME 불일치·타임아웃·오프라인: 저장된 `cached` 정적 파일 반환 (다크 테마 CSS 누락 방지)
 * - 호출처: `self` `'fetch'` 이벤트 리스너의 `APP_SHELL_ASSETS` 분기
 */
async function networkFirstAsset(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const controller = new AbortController();
    const timeoutId = cached ? setTimeout(() => controller.abort(), 4500) : null;

    try {
        const fresh = await fetch(request, { signal: controller.signal });
        if (isValidAssetResponse(request, fresh)) {
            if (fresh.ok) {
                cache.put(request, fresh.clone());
            }
            return fresh;
        }
        if (cached) {
            return cached;
        }
        return fresh;
    } catch (err) {
        if (cached) {
            return cached;
        }
        throw err;
    } finally {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    }
}
