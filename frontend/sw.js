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
 * [JS 문법] const : 한 번 선언하면 재할당할 수 없는 상수 선언 키워드임 (형제 문법: 값이 변하는 let).
 * [내가 지은 이름] CACHE_NAME(서비스 워커 캐시 버전 이름), APP_SHELL_ASSETS(오프라인 대비 선제 저장할 핵심 정적 모듈 경로 배열)
 * [핵심 원리 & 비상 구급함 비유]
 * - 지하주차장·터널·통신 음영 지역에 들어갔을 때도 앱 화면과 직전 응급실 전화번호를 즉시 열어볼 수 있도록
 *   브라우저 내부 금고(Cache Storage)에 앱 뼈대 파일들을 미리 챙겨 두는 비상 구급함 목록임.
 */

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});
/*
 * [브라우저 내장 도구/함수]
 * - self : 서비스 워커 백그라운드 스레드 자신을 가리키는 내장 전역 객체임 (일반 창에서는 window, 이름 변경 불가).
 * - self.addEventListener('install', ...), event.waitUntil(...), caches.open(...), cache.addAll(...), self.skipWaiting() (모두 표준 Service Worker API, 이름 변경 불가)
 * [핵심 원리] 서비스 워커가 처음 설치될 때 APP_SHELL_ASSETS 목록을 브라우저 캐시에 저장하고 즉시 대기 없이 활성화 준비를 마침.
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
 * [브라우저 내장 함수] caches.keys(), caches.delete(...), Promise.all(...), self.clients.claim() (이름 변경 불가)
 * [핵심 원리] 새 버전(CACHE_NAME)이 켜지면 이전 버전의 낡은 캐시 상자들을 깨끗이 지워 용량 낭비와 구버전 충돌을 막음.
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
 * [브라우저 내장 도구/함수] new URL(...), event.respondWith(...) : 브라우저의 네트워크 요청을 가로채어 맞춤형 캐시 전략으로 응답함 (이름 변경 불가).
 * [요청 경로별 분기 원리]
 * - 외부 도메인(네이버 지도 타일 등)은 건드리지 않고 그대로 통과시킴.
 * - /api/hospitals 및 정적 파일은 항상 최신 서버 응답을 먼저 시도(Network-First)하되, 통신 두절 시에만 직전 정상 캐시로 폴백함.
 */

async function networkFirstWithSnapshotFallback(request) {
/*
 * [JS 문법] async function : 비동기 통신(await fetch)을 동기 코드처럼 읽기 쉽게 처리하는 함수 선언임.
 * [내가 지은 이름] networkFirstWithSnapshotFallback, request
 */
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
    /*
     * [브라우저 내장 도구/함수] fetch(...), freshResponse.clone(), cache.put(...), cache.match(...), new Headers(...), new Response(...) (이름 변경 불가)
     * [오프라인 폴백 흐름 예시]
     *   온라인 정상 ──> 서버 최신 병상 JSON 반환 + 백업본(clone) 캐시 갱신
     *   통신 음영   ──> 직전 저장된 스냅샷 반환 + 'X-Yonsei119-Offline-Fallback: 1' 헤더 부착 -> 프론트엔드가 오프라인 배너 안내 표시
     */
}

async function networkFirstAsset(request) {
/*
 * [JS 문법] async function : 정적 HTML/CSS/JS 파일도 개발·배포 수정이 즉시 반영되도록 네트워크 우선 조회 후 오프라인 시에만 캐시를 반환함.
 * [내가 지은 이름] networkFirstAsset, request
 */
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
    /*
     * [핵심 원리] 온라인일 때는 항상 최신 코드를 보여주고, 비행기 모드나 통신 장애일 때만 캐시된 앱 쉘을 꺼내 줌.
     */
}
