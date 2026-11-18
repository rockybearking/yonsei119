import {
    DEFAULT_NAVER_CLIENT_ID,
    DEFAULT_NAVER_DARK_STYLE_ID
} from './constants.js';
/*
 * [JS 문법]
 * - import { ... } from './파일.js' : 다른 ES 모듈이 내보낸 상수를 현재 파일로 가져옴.
 * - 상대 경로 확장자(`.js`) : 브라우저 네이티브 모듈 로더는 확장자 생략을 허용하지 않음.
 *
 * [연동 모듈]
 * - `./constants.js` : `DEFAULT_NAVER_CLIENT_ID`, `DEFAULT_NAVER_DARK_STYLE_ID` 상수를 제공함.
 *
 * [동작 흐름]
 * - 호출 시점 : `index.html`의 `modulepreload` 후 `app.js`가 `state.js`를 임포트할 때 실행됨.
 * - 흐름 : `constants.js` 상수 로드 ──> `DEFAULT_ORIGIN` 및 `state` 기본값 초기화
 */

export const DEFAULT_ORIGIN = {
    lat: 37.5666805,
    lng: 126.9784147,
    label: '서울시청'
};
/*
 * [JS 문법]
 * - export const : 변수 재할당은 막고 외부 모듈에서 임포트해 읽을 수 있게 공개하는 선언임.
 *   · 참고 : `const`로 선언한 객체라도 내부 속성(`lat`, `lng`, `label`) 값은 변경 가능함.
 * - 객체 리터럴 `{ ... }` : 위도·경도·명칭을 하나의 기준 좌표 객체로 묶음.
 *
 * [프로젝트 상수 및 속성명]
 * - 상수명 : `DEFAULT_ORIGIN` (위치 권한 거부나 초기화 시 쓰는 기본 기준 좌표 객체).
 * - 속성명 :
 *   · `lat` : 기본 위도(`37.5666805`, 서울시청 기준).
 *   · `lng` : 기본 경도(`126.9784147`, 서울시청 기준).
 *   · `label` : 화면에 표시할 기본 기준점 이름(`'서울시청'`).
 *
 * [동작 흐름]
 * - 호출 출처 : `search-controls.js`의 `syncFrontendConfig()`가 초기 설정 응답을 받을 때 실행됨.
 * - 흐름 : `GET /api/config` (`FrontendConfigDto`) ──> `defaultLat`·`defaultLng`·`defaultLabel` 수신 ──> `DEFAULT_ORIGIN` 덮어쓰기
 * - 전달 대상 : `application.yml`의 `yonsei119.default-origin.*` 설정값이 프론트엔드와 일치됨.
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
 * [JS 문법]
 * - export const : 모든 모듈이 같은 단일 객체 참조를 공유하도록 내보내는 선언임.
 * - 리터럴 표기 : `null`(비어 있음), `true`/`false`(논리값), `[]`(빈 배열), `{}`(빈 객체).
 *
 * [JS 내장 생성자 (이름 변경 불가)]
 * - new Map() : 키-값 쌍을 저장하고 평균 O(1) 속도로 조회·추가·삭제하는 내장 컬렉션임.
 *   · 특징 : 삽입 순서를 유지하며 일반 객체(`{}`)와 달리 프로토타입 키 충돌이 없음.
 *   · 비교 : 중복 없는 단일 값 목록은 `new Set()`을 사용함.
 *
 * [프로젝트 상태 객체 및 속성명]
 * - 객체명 : `state` (프론트엔드 전역 런타임 상태를 한곳에 모은 공유 저장소).
 * - 지도·레이어·경로 속성 :
 *   · `map` / `circle` : 네이버 지도 인스턴스와 탐색 반경 원 오버레이.
 *   · `locationMarker` / `waypointMarker` : 출발지 마커와 경유지 마커.
 *   · `routePolyline` / `routeOutlinePolyline` / `routeSectionPolylines` : 2D 경로선 폴백 객체.
 *   · `glRouteActive` / `glRouteMap` : WebGL 경로 활성 여부와 대상 지도 참조.
 *   · `sheetRouteData` / `activeRoute` : 시트 미리보기 경로와 지도에 표시 중인 경로 데이터.
 *   · `trafficEnabled` / `trafficLayer` : 실시간 교통 레이어 켜짐 상태와 레이어 객체.
 * - 비동기 요청 취소·중복 제어 속성 :
 *   · `controller` / `directionsController` : 병원 목록과 상세 경로 요청 `AbortController`.
 *   · `activeRouteController` / `etaRankController` / `reverseGeocodeController` : 활성 경로·순위·역지오코딩 취소 제어기.
 *   · `inflight` / `inflightForce` / `loading` / `statusTimer` : 중복 요청 병합과 상태 토스트 타이머.
 * - 출발지·필터·정렬·UI 모드 속성 :
 *   · `locating` / `origin` / `originLabel` / `originAddress` : 현재 위치 탐색 중 여부와 출발 기준 정보.
 *   · `selectedDirectionOption` / `symptomPreset` / `onlyAvailableBeds` : 경로 옵션(`'trafast'`)과 증상·병상 필터.
 *   · `etaRankMode` / `sheetHalfPeek` / `offlineMode` : 순위 정렬(`'optimal'`/`'fastest'`), 반열림, 오프라인 상태.
 *   · `initialDeepLinkHandled` / `mobileMenuOpen` / `etaRankOpen` : 딥링크·모바일 메뉴·순위 패널 열림 상태.
 *   · `locationKnown` / `locationAccuracy` / `locationUpdated` / `lastUpdated` : 위치 확인 여부와 갱신 시각.
 * - 병원 데이터·마커·캐시 속성 :
 *   · `hospitals` / `markers` / `clusterItems` : 병원 목록, 레거시 마커, 클러스터 모달 목록.
 *   · `markerMap` / `detailCache` : 병원 ID별 오버레이 `Map`과 단건 상세 캐시 `Map`.
 *   · `selected` / `sources` / `previousFocus` : 선택 병원, 7대 데이터 소스 상태, 이전 포커스 요소.
 *   · `renderedDevHospitalRef` / `hasFitted` : 개발자 모드 중복 렌더 방지와 초기 맞춤 여부.
 * - 테마·SDK·최적화·진단 속성 :
 *   · `darkMode` / `naverClientId` / `naverDarkStyleId` : 다크 모드 여부와 네이버 지도 설정.
 *   · `circleKey` / `circleMap` / `cardPointerDown` / `pendingMarkerUpdate` : 원 재생성 방지 및 입력 중 갱신 지연 플래그.
 *   · `diagnostics` : 생성·재사용·제거·오류·이벤트 횟수를 기록하는 런타임 진단 객체.
 *
 * [동작 흐름]
 * - 공유 구조 : `app.js`, `map-engine.js`, `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`, `search-controls.js`, `utils.js`가 모두 직접 참조함.
 * - 진단 노출 : `app.js:init()` ──> `state.diagnostics` 메서드 연결 ──> `window.__YONSEI119_DIAGNOSTICS__` 등록
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
 * [JS 문법]
 * - export const : 콜백 슬롯 객체 참조를 고정한 채 외부에 공개함.
 * - null 리터럴 : 연결 전 초기 빈 슬롯을 뜻하며, 호출 시 `?.()` 옵셔널 체이닝으로 안전하게 실행함.
 *
 * [프로젝트 상태 객체 및 속성명]
 * - 객체명 : `uiCallbacks` (모듈 간 순환 참조 없이 UI 함수를 간접 호출하는 콜백 저장소).
 * - 속성명 :
 *   · `onUpdateMarkers` / `onDrawRouteOnMap` / `onHasRenderedRoute` : 마커 갱신 및 경로 제어 슬롯.
 *   · `onCustomOrigin` / `onOpenHospital` / `onCloseSheet` : 출발지 변경 및 상세 시트 열기·닫기 슬롯.
 *   · `onSnapSheetHalfPeek` / `onExpandSheetFromHalfPeek` : 모바일 시트 반열림·전체 펼침 슬롯.
 *   · `onUpdateRadiusUI` / `onUpdateOriginAddress` / `onCloseRadius` : 반경·주소·팝오버 닫기 슬롯.
 *
 * [동작 흐름]
 * - 순환 참조 방지 구조 : `map-engine.js`·`markers-cluster.js`·`directions-eta.js`·`hospital-sheet.js`가 서로 직접 임포트하지 않음.
 * - 흐름 : 하위 모듈 이벤트 발생 ──> `uiCallbacks.on*?.()` 간접 호출 ──> `app.js`가 연결한 실제 UI 함수 실행
 */

export function registerUiCallbacks(handlers) {
    Object.assign(uiCallbacks, handlers);
}
/*
 * [JS 문법]
 * - export function : 외부 모듈에서 호출할 수 있는 공개 함수 선언문임.
 *
 * [JS 내장 메서드 (이름 변경 불가)]
 * - Object.assign(target, source) : `source`의 자체 열거 가능 속성을 `target` 객체에 복사해 덮어씀.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : `registerUiCallbacks` (콜백 핸들러 일괄 등록 함수).
 * - 매개변수명 : `handlers` (각 슬롯에 연결할 함수들이 담긴 객체).
 *
 * [동작 흐름]
 * - 호출 출처 : `app.js`가 모듈 로딩 시점에 11개 구현 함수를 모아 호출함.
 * - 연결 목록 :
 *   · `updateMarkers`, `drawRouteOnMap`, `hasRenderedRoute`, `setCustomOrigin`
 *   · `openHospital`, `closeSheet`, `snapSheetToHalfPeek`, `expandSheetFromHalfPeek`
 *   · `updateRadiusUI`, `updateOriginAddress`, `closeRadius`
 * - 흐름 : `app.js` ──> `registerUiCallbacks(handlers)` ──> `Object.assign(uiCallbacks, handlers)` ──> 하위 모듈 간접 호출 준비 완료
 */
