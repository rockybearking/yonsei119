/*
 * ============================================================================
 * [1. 역할 및 실행 시점]
 * - 역할 : 프론트엔드 전 모듈이 함께 보는 중앙 상황판(전역 상태 `state`) 및
 *          모듈 간 순환 참조를 막아 주는 전화교환원(`uiCallbacks`)
 * - 실행 시점 : `app.js`가 최초 로드될 때 단 1개의 싱글톤 객체로 메모리에 생성됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [app.js]                       [state.js]                  [search-controls.js]      [Map / Sheet Modules]
 *        |                               |                                |                         |
 *        |-- 1. registerUiCallbacks() -->|                                |                         |  12개 모듈 간 콜백 등록
 *        |                               |<-- 2. update state / ORIGIN ---|                         |  설정 · 병원 스냅샷 반영
 *        |                               |<-- 3. read state + callbacks --|-------------------------|  순환 참조 없이 상위 호출
 *        v                               v                                v                         v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 외부 SDK / 프로젝트 내부)]
 * - JS / 브라우저 표준 내장
 *   ㄴ export / const  : 모듈 외부 공개 및 재할당 불가 상수 선언 키워드
 *   ㄴ Map             : 키-값 해시 탐색(O(1))을 제공하는 표준 내장 클래스
 *   ㄴ Object.assign() : 객체 속성들을 대상 객체에 복사하는 표준 내장 정적 메서드
 * - 프로젝트 내부 모듈
 *   ㄴ constants.js   : 네이버 공개 Client ID · 다크 스타일 ID 초기 상수 제공
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 참조하는 프론트엔드 모듈
 *   ㄴ frontend/js/app.js             : registerUiCallbacks() 최초 등록 및 진단 연결
 *   ㄴ frontend/js/map-engine.js      : 지도 · 반경 원 · 교통 타일 상태 읽기/쓰기
 *   ㄴ frontend/js/directions-eta.js  : 활성 경로 · CTT 동기화 · ETA 순위 상태 관리
 *   ㄴ frontend/js/markers-cluster.js : markerMap 재사용 및 선택 병원 강조
 *   ㄴ frontend/js/hospital-sheet.js  : detailCache 조회 및 모달 시트 열림 상태 관리
 *   ㄴ frontend/js/search-controls.js : 병원 배열 · 출발 좌표 · ETag 갱신
 *   ㄴ frontend/js/utils.js           : 상태 토스트 타이머 및 출발지 라벨 조합
 * - IntelliJ 추적 단축키
 *   ㄴ 함수 호출 계층 보기 : `registerUiCallbacks` 위에서 `Ctrl + Alt + H`
 *   ㄴ 상태 속성 사용처 검색 : `Ctrl + Shift + F`로 `state.activeRoute` 등 검색
 * ============================================================================
 */

import {
    DEFAULT_NAVER_CLIENT_ID,
    DEFAULT_NAVER_DARK_STYLE_ID
} from './constants.js';

/*
 * [역할 및 데이터 흐름]
 * - 역할 : GPS 미허용 · 데스크톱 접속 · 초기화 시 기준이 되는 기본 출발 좌표(서울시청)
 * - 갱신처 : `search-controls.js : syncFrontendConfig()` (`GET /api/config` 응답 반영)
 * - 사용처
 *   ㄴ frontend/js/utils.js           : getOriginDisplayLabel()
 *   ㄴ frontend/js/directions-eta.js  : resetOriginAndRoute()
 *   ㄴ frontend/js/search-controls.js : locate()
 */
export const DEFAULT_ORIGIN = {
    lat: 37.5666805,
    lng: 126.9784147,
    label: '서울시청'
};

/*
 * [역할 및 내부 구성]
 * - 역할 : 지도 인스턴스, 병원 목록, 선택 병원, 활성 경로, 요청 취소기(`AbortController`),
 *          런타임 진단 카운터를 한곳에서 관리하는 전역 상태 저장소
 * - 주요 표준 내장 컬렉션
 *   ㄴ markerMap (new Map)   : `병원ID -> 지도 DOM 오버레이` 재사용 캐시
 *   ㄴ detailCache (new Map) : `병원ID -> 단건 상세 원본 DTO` 메모리 캐시
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
        cttMatchedRouteCount: 0,
        idleEventCount: 0,
        themeSwitchCount: 0,
        detailHydratedCount: 0,
        lastHospitalOpened: null,
        lastError: null
    }
};

/*
 * [역할 및 호출 구조]
 * - 역할 : 하위 모듈들이 서로 직접 `import`하지 않고 상위 동작을 호출하도록 중개하는 슬롯
 * - 등록처 : `frontend/js/app.js` 최상단 `registerUiCallbacks(...)`
 */
export const uiCallbacks = {
    onUpdateMarkers: null,
    onDrawRouteOnMap: null,
    onHasRenderedRoute: null,
    onTrafficTilesUpdated: null,
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
 * [역할 및 사용처]
 * - 역할 : 전달받은 콜백 함수 묶음을 `uiCallbacks` 객체에 일괄 주입함
 * - 사용처
 *   ㄴ frontend/js/app.js : 모듈 초기화 최상단에서 1회 호출
 */
export function registerUiCallbacks(handlers) {
    Object.assign(uiCallbacks, handlers);
}
