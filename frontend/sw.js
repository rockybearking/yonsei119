const CACHE_NAME = 'yonsei119-pwa-v261117-r2';
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

async function networkFirstWithSnapshotFallback(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const freshResponse = await fetch(request);
        if (freshResponse && freshResponse.ok) {
            cache.put(request, freshResponse.clone());
        }
        return freshResponse;
    } catch {
        const cached = await cache.match('/api/hospitals?compact=true')
            || await cache.match('/api/hospitals')
            || await cache.match(request);
        if (cached) {
            const headers = new Headers(cached.headers);
            headers.set('X-Yonsei119-Offline-Fallback', '1');
            return new Response(cached.body, {
                status: 200,
                statusText: 'OK (Offline Snapshot)',
                headers
            });
        }
        throw new Error('네트워크 오프라인 및 저장된 병원 스냅샷 없음');
    }
}
/*
 * [JS 문법]
 * - async function / await : 비동기 캐시·네트워크 호출을 위에서 아래로 순서대로 작성함.
 * - try { ... } catch { ... } : 예외 변수를 생략하고 네트워크 단절 오류를 잡아 처리함.
 * - && / || / if / return / throw new Error(...) : 응답 확인과 대체 경로 시도 후 실패 시 오류를 던짐.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - caches.open(cacheName) : 캐시 저장소 버킷을 비동기로 여는 메서드임.
 * - fetch(request) : 서버로 실제 HTTP 요청을 보내는 Fetch API 함수임.
 * - Response.prototype.ok / .clone() : 2xx 성공 확인과 본문 스트림 1회 읽기 제약을 우회하는 복제 메서드임.
 * - cache.put(request, response) : 요청과 응답 쌍을 캐시에 저장·갱신하는 메서드임.
 * - cache.match(key) : 저장된 캐시에서 키와 일치하는 응답을 찾는 메서드임.
 * - new Headers(init) / headers.set(name, value) : 기존 헤더를 복사해 새 헤더를 추가하는 API임.
 * - new Response(body, init) : 본문과 상태·헤더를 조합해 새 응답 객체를 만드는 생성자임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `networkFirstWithSnapshotFallback`, `request`.
 * - 지역 변수명 : `cache`(열린 캐시), `freshResponse`(서버 응답), `cached`(캐시 응답), `headers`(복제 헤더).
 *
 * [동작 흐름]
 * - 호출 출처 : `fetch` 핸들러가 `/api/hospitals*` 또는 `/api/config` 요청 시 호출함.
 * - 흐름 :
 *   ├── 온라인 성공(2xx) ──> `cache.put()` 갱신 ──> `freshResponse` 그대로 반환
 *   ├── 오프라인·실패 ──> `cache.match('/api/hospitals?compact=true')` -> `'/api/hospitals'` -> `request` 조회
 *   │   └── 캐시 발견 ──> `X-Yonsei119-Offline-Fallback: 1` 헤더 추가 후 `200` 응답 반환
 *   └── 캐시도 없음 ──> `Error` 발생 ──> `search-controls.js`가 `OFFLINE_SNAPSHOT_KEY` 2차 백업 사용
 */

async function networkFirstAsset(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const fresh = await fetch(request);
        if (fresh && (fresh.ok || fresh.status === 304)) {
            if (fresh.ok) {
                cache.put(request, fresh.clone());
            }
            return fresh;
        }
    } catch {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
    }
    return fetch(request);
}
/*
 * [JS 문법]
 * - async function / await / try { ... } catch { ... } : 정적 파일 요청과 캐시 폴백을 비동기로 제어함.
 * - if / === / || / && / return : 상태 코드 조건에 따라 캐시 저장과 반환을 분기함.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - caches.open(cacheName) / cache.put(request, response) / cache.match(request) : 캐시 저장·조회 메서드임.
 * - fetch(request) / Response.prototype.clone() : 네트워크 요청과 응답 복제 메서드임.
 * - Response.prototype.ok / .status : HTTP `200` 성공과 `304 Not Modified` 재검증 응답을 구분하는 속성임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `networkFirstAsset`, `request`.
 * - 지역 변수명 : `cache`(열린 캐시), `fresh`(서버 최신 응답), `cached`(캐시 저장 응답).
 *
 * [동작 흐름]
 * - 호출 출처 : `fetch` 핸들러가 `APP_SHELL_ASSETS`에 속한 HTML·CSS·JS·매니페스트 요청 시 호출함.
 * - 흐름 :
 *   ├── 온라인 200 OK ──> `cache.put()` 갱신 ──> 최신 파일 반환
 *   ├── 온라인 304 Not Modified ──> 캐시 저장 생략 ──> `fresh` 그대로 반환 (`WebConfig` ETag 검증)
 *   └── 오프라인·단절 ──> `cache.match(request)` 조회 ──> 있으면 캐시 반환 / 없으면 `fetch` 오류 전파
 */
