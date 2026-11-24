const CACHE_NAME = 'yonsei119-pwa-v261125-r2';
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
 * [JS 문법]
 * - const : 재할당이 불가능한 블록 스코프 상수 선언 키워드임.
 *   · 비교 : 값을 다시 대입해야 하는 변수는 `let`으로 선언함.
 * - 배열 리터럴 `[ ... ]` : 여러 문자열 경로를 순서대로 묶은 배열임.
 *
 * [프로젝트 상수명]
 * - `CACHE_NAME` : 현재 서비스 워커가 쓰는 Cache Storage 버킷 이름 문자열임.
 *   · 배포 시 `CACHE_NAME` 버전 문자열을 바꾸면 구버전 캐시가 자동 삭제됨.
 * - `APP_SHELL_ASSETS` : 오프라인 시에도 기본 화면이 열리게 미리 저장할 21개 앱 쉘 경로 목록임.
 *   · 구성 : `/`와 `index.html`, `manifest.webmanifest`, CSS 8개, JS 10개.
 *
 * [동작 흐름]
 * - 등록 출처 : `search-controls.js`의 `registerServiceWorker()`가 호출함.
 * - 흐름 : `window` `'load'` 이벤트 ──> `navigator.serviceWorker.register('/sw.js')` ──> 백그라운드 등록
 * - 백엔드 서빙 연결 :
 *   ├── `/` ──> `WebConfig.addViewControllers()`가 `forward:/index.html`로 포워딩
 *   ├── 정적 CSS·JS ──> `WebConfig.addResourceHandlers()`가 `noCache`·Weak ETag로 응답
 *   └── `/manifest.webmanifest` ──> `SecurityHeadersFilter`가 매니페스트 MIME 타입 보호
 */

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});
/*
 * [JS 문법]
 * - 화살표 함수 (`param => ...`) : 콜백 함수를 짧게 작성하는 ES6 함수 표현식임.
 * - Promise 체이닝 (`.then(...)`) : 앞선 비동기 작업 완료 후 다음 단계를 이어 실행함.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - self : 서비스 워커 전용 전역 스코프(`ServiceWorkerGlobalScope`)를 가리키는 내장 객체임.
 *   · 비교 : 일반 브라우저 탭의 `window`에 해당함.
 * - self.addEventListener('install', handler) : 워커 최초 설치나 파일 변경 시 실행되는 이벤트 등록임.
 * - event.waitUntil(promise) : 전달된 Promise가 끝날 때까지 설치 단계를 종료하지 않고 대기함.
 * - caches.open(cacheName) : 지정한 이름의 `Cache` 저장소를 비동기로 여는 메서드임.
 * - cache.addAll(urls) : 배열에 담긴 모든 URL을 가져와 응답을 캐시에 일괄 저장하는 메서드임.
 * - self.skipWaiting() : 대기 상태(`waiting`)를 건너뛰고 즉시 활성화(`activate`)로 전환하는 메서드임.
 *
 * [동작 흐름]
 * - 호출 출처 : 브라우저가 `/sw.js`를 처음 설치하거나 파일 바이트 변경을 감지할 때 실행됨.
 * - 흐름 : `self` `'install'` ──> `caches.open(CACHE_NAME)` ──> `cache.addAll(APP_SHELL_ASSETS)` ──> `self.skipWaiting()`
 * - 결과 : 앱 쉘 21개 파일 저장이 완료되면 대기 없이 바로 활성화 단계로 넘어감.
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
 * [JS 문법]
 * - !== : 값과 자료형을 엄격히 비교하는 불일치 연산자임.
 * - 화살표 함수 암묵적 반환 (`x => ...`) : 중괄호 없이 단일 표현식 결과를 바로 반환함.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - self.addEventListener('activate', handler) : 새 서비스 워커가 활성화될 때 실행되는 이벤트 등록임.
 * - event.waitUntil(promise) : 캐시 정리와 제어권 확보가 끝날 때까지 활성화 단계를 유지함.
 * - caches.keys() : 현재 출처(`origin`)에 저장된 모든 캐시 이름 배열을 반환하는 메서드임.
 * - Array.prototype.filter() / .map() : 조건에 맞는 키만 추린 뒤 새 배열로 변환하는 메서드임.
 * - caches.delete(cacheName) : 더 이상 쓰지 않는 캐시 버킷을 삭제하는 `CacheStorage` 메서드임.
 * - Promise.all(promises) : 여러 비동기 작업이 모두 끝날 때까지 병렬로 기다리는 정적 메서드임.
 * - self.clients.claim() : 열려 있는 제어 범위 내 탭의 요청을 즉시 가로채게 권한을 가져오는 메서드임.
 *
 * [동작 흐름]
 * - 호출 출처 : `'install'`과 `skipWaiting()` 완료 직후 새 서비스 워커가 활성화될 때 실행됨.
 * - 흐름 : `self` `'activate'` ──> `caches.keys()` ──> `key !== CACHE_NAME` 필터링 ──> `caches.delete(oldKey)` ──> `self.clients.claim()`
 * - 효과 : 구버전 캐시 잔여물과 파일 혼용을 없애고 현재 열린 탭까지 즉시 새 워커로 제어함.
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

    if (url.pathname.startsWith('/api/hospitals') || url.pathname === '/api/config') {
        event.respondWith(networkFirstWithSnapshotFallback(request));
        return;
    }

    if (APP_SHELL_ASSETS.includes(url.pathname)) {
        event.respondWith(networkFirstAsset(request));
    }
});
/*
 * [JS 문법]
 * - const / if / !== / === / || / return : 조건을 검사해 해당 없으면 일찍 반환해 기본 네트워크로 넘김.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - self.addEventListener('fetch', handler) : 제어 범위 내 HTTP 요청을 가로채는 이벤트 등록임.
 * - event.request / request.method : 가로챈 `Request` 객체와 HTTP 메서드(`'GET'` 등) 속성임.
 * - new URL(urlString) : URL 문자열을 파싱해 `origin`과 `pathname`을 분리하는 내장 생성자임.
 * - self.location.origin : 서비스 워커가 실행 중인 현재 출처(프로토콜+호스트+포트) 문자열임.
 * - String.prototype.startsWith(prefix) : 문자열이 지정한 접두사로 시작하는지 검사하는 메서드임.
 * - Array.prototype.includes(item) : 배열에 특정 값이 포함되어 있는지 확인하는 메서드임.
 * - event.respondWith(promise) : 기본 fetch 대신 직접 만든 응답 Promise를 돌려주게 하는 메서드임.
 *
 * [지역 변수명]
 * - `request` : 가로챈 이벤트에서 꺼낸 원본 `Request` 객체.
 * - `url` : `request.url`을 파싱해 경로 비교에 쓰는 `URL` 객체.
 *
 * [동작 흐름]
 * - `self` `'fetch'` 요청 분기 ──> GET·출처·경로별 응답 전략 선택 :
 *   ├── `GET`이 아님 / 외부 출처(네이버 지도·웹폰트) ──> `return`으로 브라우저 기본 요청 통과
 *   ├── `/api/hospitals*` 또는 `/api/config` ──> `networkFirstWithSnapshotFallback(request)`
 *   ├── `APP_SHELL_ASSETS` 포함 정적 경로 ──> `networkFirstAsset(request)`
 *   └── `/api/directions*`, `/api/geocode*`, `/api/health` ──> 캐시 없이 항상 실시간 서버 조회
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
 * [JS 문법]
 * - async function / await : 비동기 캐시·네트워크 호출을 위에서 아래로 순서대로 작성함.
 * - try { ... } catch { ... } : 네트워크 단절 및 Render 기동 중 비정상 응답을 잡아 안전 캐시로 폴백함.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - caches.open(cacheName) / fetch(request) / cache.put(request, response) / cache.match(key)
 * - Response.prototype.ok / .clone() / new Headers(init) / new Response(body, init)
 *
 * [동작 흐름]
 * - `/api/config`는 `/api/config` 캐시와만 매칭하고, `/api/hospitals*`는 병원 스냅샷 캐시와만 매칭함.
 * - Render 콜드스타트 중 HTTP 502/503 또는 HTML 대기 페이지가 와도 JSON Content-Type 검증 후 캐시로 안전 폴백함.
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
/*
 * [JS 문법]
 * - async function / await / try ... catch ... finally : 정적 자산 요청 타임아웃과 MIME 검증 폴백을 제어함.
 *
 * [동작 흐름]
 * - 온라인 200 OK + 올바른 MIME(`text/css`, `javascript`, `text/html`) ──> `cache.put()` 갱신 후 반환
 * - Render 기동 중 502/503, HTML 대기 페이지, 4.5초 타임아웃 ──> 저장된 정상 `cached` 애셋 반환 (다크 CSS 누락 방지)
 */
