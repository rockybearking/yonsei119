/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 프론트엔드 전 모듈이 공유하는 중앙 상황판(전역 런타임 상태 저장소) 및 순환 참조 방지용 전화교환원(`uiCallbacks`)
 * - 실행 시점: `app.js` 부트스트랩 시 단 1개의 싱글톤 모듈 인스턴스로 메모리에 생성되어 앱 종료 시까지 공유됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   `constants.js` 기본값 로드 ──> `DEFAULT_ORIGIN` 및 `state` 생성
 *   ├── `app.js` ──> `registerUiCallbacks(...)`로 11개 상위 UI 함수 등록
 *   ├── `search-controls.js` ──> `/api/config`·`/api/hospitals` 수신 결과를 `DEFAULT_ORIGIN`·`state`에 반영
 *   └── `map-engine.js`·`markers-cluster.js`·`directions-eta.js`·`hospital-sheet.js` ──> `state` 조회·갱신 & `uiCallbacks` 간접 호출
 *
 * [사용처 및 IDE 추적 가이드]
 * - 참조 모듈: 프론트엔드 JS 모듈 전체 (`app.js`, `utils.js`, `map-engine.js`, `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`, `search-controls.js`)
 * - IntelliJ 추적 팁: `state` 속성명 또는 `onOpenHospital` 등 콜백명 위에서 `Ctrl + Shift + F`로 검색
 * ============================================================================
 */

import {
    DEFAULT_NAVER_CLIENT_ID,
    DEFAULT_NAVER_DARK_STYLE_ID
} from './constants.js';

/*
 * [역할 및 데이터 흐름]
 * - 역할: GPS 위치 권한 미허용·데스크톱 접속·초기화 버튼 클릭 시 기준이 되는 기본 출발 좌표(기본값: 서울시청)
 * - 흐름: 초기 상수 세팅 ──> `search-controls.js:syncFrontendConfig()`가 `GET /api/config`(`FrontendConfigDto`) 응답으로 서버 설정과 동기화
 * - 사용처: `utils.js:getOriginDisplayLabel()`, `directions-eta.js:resetOriginAndRoute()`, `search-controls.js:locate()`
 */
export const DEFAULT_ORIGIN = {
    lat: 37.5666805,
    lng: 126.9784147,
    label: '서울시청'
};

/*
 * [역할 및 내부 속성 그룹]
 * - 역할: 지도 객체, 병원 목록, 선택 병원, 활성 경로, 비동기 요청 취소기(`AbortController`), 진단 카운터를 한곳에 모은 공유 상태 객체
 * - 내장 타입 구분: `new Map()`은 O(1) 해시 탐색을 제공하는 JS 표준 내장 컬렉션임 (`markerMap`: 지도 카드 재사용, `detailCache`: 단건 상세 캐시)
 */
export const state = {
    map: null,
    circle: null,
    locationMarker: null,
    waypointMarker: null,
    routePolyline: null,
    routeOutlinePolyline: null,
    routeSectionPolylines: [],
    glRouteActive: false,
    glRouteMap: null,
    sheetRouteData: null,
    activeRoute: null,
    activeRouteController: null,
    locating: false,
    origin: { lat: DEFAULT_ORIGIN.lat, lng: DEFAULT_ORIGIN.lng },
    originLabel: DEFAULT_ORIGIN.label,
    originAddress: '',
    selectedDirectionOption: 'trafast',
    etaRankMode: 'optimal',
    sheetHalfPeek: false,
    offlineMode: false,
    initialDeepLinkHandled: false,
    mobileMenuOpen: false,
    trafficEnabled: false,
    trafficLayer: null,
    etaRankOpen: false,
    etaRankController: null,
    reverseGeocodeController: null,
    locationKnown: false,
    locationAccuracy: null,
    locationUpdated: null,
    lastUpdated: null,
    lastSnapshotEtag: null,
    autoRefreshTimerId: null,
    hospitals: [],
    markerMap: new Map(),
    detailCache: new Map(),
    selected: null,
    sources: {},
    controller: null,
    directionsController: null,
    loading: false,
    previousFocus: null,
    inflight: null,
    inflightForce: false,
    statusTimer: null,
    renderedDevHospitalRef: null,
    clusterItems: [],
    hasFitted: false,
    darkMode: true,
    naverClientId: DEFAULT_NAVER_CLIENT_ID,
    naverDarkStyleId: DEFAULT_NAVER_DARK_STYLE_ID,
    circleKey: null,
    circleMap: null,
    cardPointerDown: false,
    pendingMarkerUpdate: false,
    diagnostics: {
        circleCreatedCount: 0,
        markersUpdatedCount: 0,
        markersCreatedCount: 0,
        markersReusedCount: 0,
        markersRemovedCount: 0,
        glRouteUpdateCount: 0,
        idleEventCount: 0,
        themeSwitchCount: 0,
        detailHydratedCount: 0,
        lastHospitalOpened: null,
        lastError: null
    }
};

/*
 * [역할 및 데이터 흐름]
 * - 역할: 하위 모듈(`map-engine.js`, `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`)이 서로 직접 `import`하지 않고도
 *   상위 UI 동작을 호출할 수 있게 연결해 주는 콜백 슬롯 객체 (ES 모듈 순환 참조 차단)
 * - 흐름: `app.js`에서 `registerUiCallbacks(...)`로 함수 주입 ──> 각 모듈에서 `uiCallbacks.on*?.(...)`로 안전 호출
 */
export const uiCallbacks = {
    onUpdateMarkers: null,
    onDrawRouteOnMap: null,
    onHasRenderedRoute: null,
    onCustomOrigin: null,
    onOpenHospital: null,
    onCloseSheet: null,
    onSnapSheetHalfPeek: null,
    onExpandSheetFromHalfPeek: null,
    onUpdateRadiusUI: null,
    onUpdateOriginAddress: null,
    onCloseRadius: null
};

/*
 * [역할 및 호출처]
 * - 역할: 전달받은 핸들러 묶음을 `Object.assign`(JS 표준 내장 메서드)으로 `uiCallbacks` 슬롯에 일괄 연결함
 * - 호출처: `frontend/js/app.js` 최상단 부트스트랩 단계에서 1회 호출됨
 */
export function registerUiCallbacks(handlers) {
    Object.assign(uiCallbacks, handlers);
}
