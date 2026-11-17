import {
    DEFAULT_NAVER_CLIENT_ID,
    DEFAULT_NAVER_DARK_STYLE_ID
} from './constants.js';
/*
 * [JS 문법] import { ... } from './파일경로.js' : 분리된 상수 모듈(`constants.js`)에서 필요한 상수만 선택해 가져오는 ES Module 구문임.
 * [주의] 브라우저 네이티브 ES 모듈에서는 상대 경로 뒤에 `.js` 확장자를 반드시 생략 없이 적어야 정확히 로드됨.
 */

export const DEFAULT_ORIGIN = {
    lat: 37.5666805,
    lng: 126.9784147,
    label: '서울시청'
};
/*
 * [내가 지은 이름] DEFAULT_ORIGIN : GPS 신호가 없는 데스크톱 PC 환경, GPS 미수신 상황, 또는 '초기화' 버튼을 눌렀을 때 기준이 되는 기본 위치(서울시청) 좌표 객체임.
 * [데이터 흐름] 앱 구동 직후 `search-controls.js:syncFrontendConfig()`가 백엔드 `GET /api/config` 응답을 받아 `application.yml`의 서울시청 기본 좌표와 동기화함.
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
    symptomPreset: 'all',
    onlyAvailableBeds: false,
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
    hospitals: [],
    markers: [],
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
 * [JS 내장 도구(타입)] new Map() : 키-값 쌍을 $O(1)$ 해시 테이블로 빠르게 넣고 빼는 자바스크립트 표준 컬렉션임 (이름 변경 불가).
 *   (형제 컬렉션 비교: 중복 없는 집합 `new Set()`, 일반 객체 `{}`보다 잦은 추가·삭제와 순서 보장에 유리)
 * [내가 지은 이름] state : 프론트엔드 모든 병렬 모듈(`map-engine`, `markers-cluster`, `directions-eta`, `hospital-sheet`, `search-controls`)이
 *   함께 바라보는 '단일 진실 공급원(Single Source of Truth, 119 종합상황실 메인 전광판)' 런타임 상태 객체임.
 * [새로 추가된 핵심 상태 필드]
 * - symptomPreset     : 현재 선택된 원터치 증상 프리셋 키 (`'all'`, `'pediatric'`, `'stroke'`, `'cardiac'`, `'trauma'`, `'obstetrics'`, `'burn'`, `'dialysis'`)
 * - onlyAvailableBeds : 응급실 일반병상(`hvec`) 1석 이상 가용 병원만 남기는 필터 스위치 (`true` / `false`)
 * - etaRankMode       : 실도로 추천 정렬 기준 (`'optimal'` 수용최적 핑퐁방지 vs `'fastest'` 순수 최단시간)
 * - sheetHalfPeek     : 모바일 경로 표시 중 바텀시트가 하단 268px 요약 높이(Half-Peek)로 걸쳐 있는지 여부
 * - detailCache       : `GET /api/hospitals/{hpid}`로 온디맨드 조회한 개별 병원의 전체 원본 상세 데이터를 재사용하는 캐시 `Map`
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
 * [내가 지은 이름] uiCallbacks : 하위 계층 모듈(예: 지도 엔진 `map-engine.js`)이 상위 계층 모듈(예: 출발점 변경 `search-controls.js`)을
 *   순환 참조(Circular Import) 없이 깔끔하게 호출할 수 있도록 함수 포인터를 꽂아 두는 인터폰 스위치 보드임.
 */

export function registerUiCallbacks(handlers) {
    Object.assign(uiCallbacks, handlers);
}
/*
 * [JS 문법] export function : 외부 모듈(`app.js`)에서 호출할 수 있는 공개 함수를 선언함.
 * [JS 내장 함수] Object.assign(대상객체, 원본객체) : 전달받은 콜백 함수들을 `uiCallbacks` 객체에 한 번에 복사해 등록하는 내장 함수임 (이름 변경 불가).
 * [내가 지은 이름] registerUiCallbacks(콜백 등록 함수명), handlers(전달받은 함수 묶음 매개변수)
 */
