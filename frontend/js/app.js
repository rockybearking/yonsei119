import {
    EMERGENCY_BED_ITEMS,
    EQUIPMENT_TABLE_ITEMS,
    GL_ROUTE_SOURCE_ID,
    INPATIENT_BED_SECTIONS,
    SEVERE_DISEASE_GROUPS
} from './constants.js';
import {
    registerUiCallbacks,
    state
} from './state.js';
import {
    byId,
    hasMobileGpsHardware,
    setStatus,
    updateMarquees
} from './utils.js';
import {
    loadPersistedUserPrefs
} from './user-features.js';
import {
    ensureNaverMapSdkLoaded,
    fitBounds,
    getHospitalLatLng,
    mountNaverMap,
    toggleTrafficLayer
} from './map-engine.js';
import {
    updateMarkers
} from './markers-cluster.js';
import {
    drawRouteOnMap,
    hasRenderedRoute,
    initDirectionsControls,
    loadEtaRanking
} from './directions-eta.js';
import {
    closeSheet,
    expandSheetFromHalfPeek,
    initSheetDrag,
    openHospital,
    renderDeveloperInspector,
    snapSheetToHalfPeek,
    syncResponsiveSheetLayout
} from './hospital-sheet.js';
import {
    closeRadius,
    handlePreviewMode,
    initNotice,
    initPanels,
    initRadius,
    initSearchFocus,
    initThemeToggle,
    loadData,
    locate,
    registerServiceWorker,
    setCustomOrigin,
    syncFrontendConfig,
    syncMobileMenuPlacement,
    toggleMobileMenu,
    updateOriginAddress,
    updateRadiusUI,
    updateSearch,
    updateSummary
} from './search-controls.js';
/*
 * [JS 문법]
 * - import { 심볼 } from './파일.js' : 다른 모듈이 export한 상수·함수를 가져오는 ES 모듈 구문임.
 * - 상대 경로와 확장자 : 브라우저 기본 ES 모듈 규약상 './'와 '.js' 확장자를 생략할 수 없음.
 * - 지연·엄격 실행 : HTML의 type="module"로 로드되면 파싱 후 실행(defer)과 엄격 모드가 자동 적용됨.
 *
 * [프로젝트 내부 모듈 및 가져오기 목록]
 * - ./constants.js : EMERGENCY_BED_ITEMS, EQUIPMENT_TABLE_ITEMS, GL_ROUTE_SOURCE_ID
 *   · INPATIENT_BED_SECTIONS, SEVERE_DISEASE_GROUPS (병상·장비·중증질환 스키마, 경로 소스 ID)
 * - ./state.js : registerUiCallbacks, state (전역 런타임 상태, 콜백 레지스트리 등록 함수)
 * - ./utils.js : byId, hasMobileGpsHardware, setStatus, updateMarquees (DOM·토스트·마키)
 * - ./map-engine.js : ensureNaverMapSdkLoaded, fitBounds, getHospitalLatLng
 *   · mountNaverMap, toggleTrafficLayer (SDK 로드, 지도 마운트, 좌표 캐싱, 교통 레이어)
 * - ./markers-cluster.js : updateMarkers (화면 내 필터링, 격자 클러스터링, 카드 DOM 갱신)
 * - ./directions-eta.js : drawRouteOnMap, hasRenderedRoute, initDirectionsControls, loadEtaRanking
 * - ./hospital-sheet.js : closeSheet, expandSheetFromHalfPeek, initSheetDrag, openHospital
 *   · renderDeveloperInspector, snapSheetToHalfPeek, syncResponsiveSheetLayout
 * - ./search-controls.js (검색·반경·위치·설정·테마·PWA 제어) :
 *   · closeRadius, handlePreviewMode, initNotice, initPanels, initRadius, initSearchFocus
 *   · initThemeToggle, loadData, locate, registerServiceWorker, renderSymptomChips
 *   · setCustomOrigin, syncFrontendConfig, syncMobileMenuPlacement, toggleMobileMenu
 *   · updateOriginAddress, updateRadiusUI, updateSearch, updateSummary
 *
 * [모듈 아키텍처]
 * - frontend/js/app.js : 애플리케이션 부팅, 콜백 배선, 전역 키보드·리사이즈 통합 진입점임.
 *   ├── js/constants.js       : UI 규격 픽셀 상수와 공공데이터 병상·장비·질환 코드 사전을 정의함.
 *   ├── js/state.js           : 전 모듈이 공유하는 state 객체와 uiCallbacks 레지스트리를 보관함.
 *   ├── js/utils.js           : DOM 노드 생성, 결측치·공지 판별, 구면거리, 토스트 유틸을 제공함.
 *   ├── js/map-engine.js      : 네이버 WebGL/2D 지도 마운트, SDK 로드, 오버레이, 반경 원, 교통을 제어함.
 *   ├── js/markers-cluster.js : O(N) 2차원 공간 격자 클러스터링과 키 비교 카드 DOM 재사용을 담당함.
 *   ├── js/directions-eta.js  : 네이버 Directions 경로 탐색, WebGL 경로 렌더링, ETA 순위를 처리함.
 *   ├── js/hospital-sheet.js  : 3단 반응형 상세 시트, Half-Peek 제스처, 내비 딥링크, 인스펙터를 담당함.
 *   └── js/search-controls.js : 증상 프리셋 칩, 자동완성 검색, 반경, GPS/지오코딩, PWA 워커를 처리함.
 */

registerUiCallbacks({
    onUpdateMarkers: updateMarkers,
    onDrawRouteOnMap: drawRouteOnMap,
    onHasRenderedRoute: hasRenderedRoute,
    onCustomOrigin: setCustomOrigin,
    onOpenHospital: openHospital,
    onCloseSheet: closeSheet,
    onSnapSheetHalfPeek: snapSheetToHalfPeek,
    onExpandSheetFromHalfPeek: expandSheetFromHalfPeek,
    onUpdateRadiusUI: updateRadiusUI,
    onUpdateOriginAddress: updateOriginAddress,
    onCloseRadius: closeRadius
});
/*
 * [프로젝트 내부 함수·콜백 레지스트리]
 * - registerUiCallbacks(handlers) : state.js의 공용 uiCallbacks 객체에 11개 콜백을 등록함.
 * - 마커·경로 : onUpdateMarkers -> updateMarkers, onDrawRouteOnMap -> drawRouteOnMap
 * - 경로·출발지 : onHasRenderedRoute -> hasRenderedRoute, onCustomOrigin -> setCustomOrigin
 * - 상세 시트 : onOpenHospital -> openHospital, onCloseSheet -> closeSheet
 * - 시트 제스처 : onSnapSheetHalfPeek -> snapSheetToHalfPeek, onExpandSheetFromHalfPeek
 * - 반경·주소 : onUpdateRadiusUI -> updateRadiusUI, onUpdateOriginAddress, onCloseRadius
 *
 * [동작 흐름]
 * - 배선 이유 : 하위 모듈이 상위 모듈을 직접 import하면 ES 모듈 순환 의존 문제가 발생함.
 * - app.js 최상위 평가 -> registerUiCallbacks() 1회 실행
 *   ├── state.js의 uiCallbacks 객체에 11개 함수 참조를 일괄 주입함.
 *   ├── 지도 우클릭·롱탭(map-engine.js) -> uiCallbacks.onCustomOrigin?.(...) 호출
 *   └── 마커·클러스터·ETA 클릭 -> uiCallbacks.onOpenHospital?.(...)로 상세 시트 실행
 */

function bindGlobalKeyboardNavigation() {
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            if (document.querySelector('dialog[open]')) {
                return;
            }
            if (state.mobileMenuOpen) {
                toggleMobileMenu(false);
                return;
            }
            const radiusPopover = byId('radius-popover');
            if (radiusPopover && !radiusPopover.hidden) {
                closeRadius(true);
                return;
            }
            const searchResults = byId('search-results');
            if (searchResults && !searchResults.hidden) {
                searchResults.hidden = true;
                byId('keyword')?.focus();
                return;
            }
            if (state.selected) {
                closeSheet();
            }
        }

        if (
            event.key === 'Tab' &&
            state.selected &&
            !state.sheetHalfPeek &&
            !document.querySelector('dialog[open]')
        ) {
            const sheet = byId('sheet');
            if (!sheet) {
                return;
            }
            const items = [
                ...sheet.querySelectorAll(
                    'button:not(:disabled), a[href], input, select, summary, [tabindex="0"]'
                )
            ].filter(item =>
                item.getClientRects().length &&
                getComputedStyle(item).visibility !== 'hidden'
            );

            const first = items[0];
            const last = items.at(-1);

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
    });
}
/*
 * [JS 문법]
 * - function fn() : 모듈 내부 전용 전역 키보드 접근성 바인딩 함수를 선언함.
 * - [...nodeList] : 전개 구문(...)으로 NodeList를 일반 배열로 바꿔 filter와 at을 사용함.
 * - obj?.method() : 옵셔널 체이닝(?.)으로 대상이 null이나 undefined여도 오류 없이 건너뜀.
 * - !expr : 논리 부정 연산자로 불리언 조건을 반대로 뒤집음.
 *
 * [JS/DOM 내장 API]
 * - document.addEventListener('keydown', fn) : 문서 전체의 키보드 입력 이벤트를 수신 등록함.
 * - document.querySelector(selector) : CSS 선택자와 일치하는 첫 DOM 요소를 탐색함.
 * - element.querySelectorAll(selector) : 내부에서 포커스 가능한 모든 후보 요소를 수집함.
 * - Array.prototype.filter() / Array.prototype.at(-1) : 가시 요소 필터링과 마지막 원소 조회 메서드임.
 * - element.getClientRects() : 요소가 화면에 차지하는 사각 영역 목록을 반환함(0이면 비표시).
 * - getComputedStyle(element).visibility : 요소에 최종 계산된 CSS visibility 속성을 읽음.
 * - document.activeElement : 현재 키보드 포커스가 위치한 DOM 요소를 가리킴.
 * - event.key / event.shiftKey / event.preventDefault() / element.focus() : 키 판별·포커스 제어 API임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수 : bindGlobalKeyboardNavigation() (매개변수 없음)
 * - DOM 참조 : radiusPopover(#radius-popover), searchResults(#search-results), sheet(#sheet)
 * - 지역 변수 : event(KeyboardEvent), items(보이는 포커스 요소 배열), first, last
 *
 * [동작 흐름]
 * - 호출 : init() 내부에서 초기 UI 이벤트 등록 시 1회 호출함.
 * - [Escape 키] document 'keydown' (event.key === 'Escape') -> 열린 UI를 바깥 계층부터 하나씩 닫음 :
 *   ├── dialog[open] 존재 -> 브라우저 기본 모달 닫기에 위임하고 조기 반환
 *   ├── state.mobileMenuOpen 참 -> toggleMobileMenu(false) 호출 후 반환
 *   ├── radiusPopover 열림 -> closeRadius(true)로 팝오버 닫고 반환
 *   ├── searchResults 열림 -> hidden = true 설정 후 #keyword 포커스 이동
 *   └── state.selected 존재 -> closeSheet()로 병원 상세 시트 닫음
 * - [Tab 키] document 'keydown' (event.key === 'Tab') -> 모달 시트(!state.sheetHalfPeek) 열림 시 포커스 순환 :
 *   ├── #sheet 내부 가시 포커스 요소(items)에서 first, last 추출
 *   ├── Shift+Tab & activeElement === first -> preventDefault() 후 last.focus()
 *   └── Tab & activeElement === last -> preventDefault() 후 first.focus()
 */

async function init() {
    loadPersistedUserPrefs();
    initThemeToggle();
    initSearchFocus();
    initPanels();
    initRadius();
    initDirectionsControls();
    updateSummary();

    syncResponsiveSheetLayout();
    syncMobileMenuPlacement();
    initSheetDrag();
    initNotice();

    byId('mobile-menu-btn')?.addEventListener('click', () => {
        toggleMobileMenu();
    });

    byId('status-toast-close')?.addEventListener('click', () => {
        setStatus('');
    });

    byId('developer-mode')?.addEventListener('toggle', () => {
        const devEl = byId('developer-mode');
        if (devEl?.open && state.selected) {
            if (state.renderedDevHospitalRef !== state.selected || !state.selected._detailHydrated) {
                renderDeveloperInspector(state.selected);
            }
        }
    });

    byId('cluster-close')?.addEventListener('click', () => {
        byId('cluster-dialog')?.close();
    });

    byId('cluster-zoom')?.addEventListener('click', () => {
        const clusterDialog = byId('cluster-dialog');
        if (!state.clusterItems.length || !window.naver?.maps) {
            clusterDialog?.close();
            return;
        }
        const firstPos = getHospitalLatLng(state.clusterItems[0]);
        const bounds = new window.naver.maps.LatLngBounds(firstPos, firstPos);
        for (let i = 1; i < state.clusterItems.length; i++) {
            const pos = getHospitalLatLng(state.clusterItems[i]);
            if (pos) {
                bounds.extend(pos);
            }
        }
        clusterDialog?.close();
        fitBounds(bounds);
    });

    updateRadiusUI();

    byId('search-form')?.addEventListener('submit', event => {
        event.preventDefault();
        updateSearch();
        byId('search-results')?.querySelector('button')?.click();
    });

    byId('keyword')?.addEventListener('input', updateSearch);
    byId('keyword')?.addEventListener('focus', updateSearch);
    byId('refresh-button')?.addEventListener('click', () => loadData(true));
    byId('location-button')?.addEventListener('click', locate);
    byId('traffic-toggle')?.addEventListener('click', toggleTrafficLayer);
    byId('eta-rank-btn')?.addEventListener('click', () => {
        const box = byId('eta-rank-box');
        if (state.etaRankOpen && box && !box.hidden) {
            state.etaRankOpen = false;
            box.hidden = true;
            byId('eta-rank-btn')?.setAttribute('aria-expanded', 'false');
        } else {
            loadEtaRanking();
        }
    });

    for (const id of [
        'filter-regional',
        'filter-tertiary',
        'filter-medical',
        'filter-other'
    ]) {
        byId(id)?.addEventListener('change', () => {
            updateMarkers();
            if (state.etaRankOpen) {
                loadEtaRanking();
            }
        });
    }

    byId('sheet-close')?.addEventListener('click', closeSheet);
    byId('sheet-dim')?.addEventListener('click', closeSheet);

    bindGlobalKeyboardNavigation();
    /*
     * [JS/DOM 내장 API]
     * - for (const item of iterable) : 배열 같은 반복 가능 객체의 원소를 순서대로 순회함.
     * - element.addEventListener(type, fn) : click·toggle·submit·input·change 이벤트를 등록함.
     * - event.preventDefault() : 폼 제출 시 페이지가 새로고침되는 기본 동작을 차단함.
     * - dialog.close() : HTML5 <dialog> 모달 창을 닫는 표준 메서드임.
     * - element.querySelector(sel) / element.click() : 요소 탐색 및 코드 기반 클릭 실행 API임.
     * - element.setAttribute(name, val) : aria-expanded 등 접근성 속성을 갱신함.
     *
     * [네이버 지도 SDK 내장 API]
     * - new naver.maps.LatLngBounds(sw, ne) : 남서·북동 좌표로 사각 경계 객체를 생성함.
     * - bounds.extend(latLng) : 추가 좌표가 포함되도록 사각 경계 범위를 확장함.
     *
     * [프로젝트 내부 변수·함수]
     * - DOM 참조 : devEl(#developer-mode), clusterDialog(#cluster-dialog), box(#eta-rank-box)
     * - 지역 변수 : firstPos(첫 병원 좌표), bounds(LatLngBounds), pos(병원 좌표), id(필터 ID)
     *
     * [동작 흐름]
     * - 동기 UI 초기화 -> 테마·검색·패널·반경·증상 칩·길찾기·시트·드래그·안내 모달 즉시 실행
     * - 메뉴·알림·모달·개발자 모드 이벤트 바인딩 :
     *   ├── #mobile-menu-btn 'click' -> toggleMobileMenu()
     *   ├── #status-toast-close 'click' -> setStatus('')
     *   ├── #developer-mode 'toggle' -> devEl?.open && state.selected 시 renderDeveloperInspector(state.selected)
     *   ├── #cluster-close 'click' -> byId('cluster-dialog')?.close()
     *   └── #cluster-zoom 'click' -> state.clusterItems 좌표로 bounds 계산 -> clusterDialog?.close() -> fitBounds(bounds)
     * - 검색·툴바·필터·시트 이벤트 바인딩 :
     *   ├── #search-form 'submit' -> preventDefault() -> updateSearch() -> #search-results button 첫 항목 click()
     *   ├── #keyword 'input' · #keyword 'focus' -> updateSearch()
     *   ├── #refresh-button 'click' -> loadData(true)
     *   ├── #location-button 'click' -> locate()
     *   ├── #traffic-toggle 'click' -> toggleTrafficLayer()
     *   ├── #eta-rank-btn 'click' -> 열림 시 state.etaRankOpen = false·box.hidden = true, 닫힘 시 loadEtaRanking()
     *   ├── #filter-regional·#filter-tertiary·#filter-medical·#filter-other 'change' -> updateMarkers() · 필요 시 loadEtaRanking()
     *   └── #sheet-close 'click' · #sheet-dim 'click' -> closeSheet(), 끝으로 bindGlobalKeyboardNavigation()
     */

    let resizeRafId = 0;
    window.addEventListener('resize', () => {
        if (resizeRafId) {
            return;
        }
        resizeRafId = requestAnimationFrame(() => {
            resizeRafId = 0;
            syncResponsiveSheetLayout();
            syncMobileMenuPlacement();
            updateMarkers();
            updateMarquees();
        });
    }, { passive: true });
    /*
     * [브라우저 Web API]
     * - window.addEventListener('resize', fn, { passive: true }) : 창 크기 변경 이벤트를 등록함.
     * - { passive: true } : preventDefault() 미사용을 알려 브라우저 렌더링 지연을 줄임.
     * - requestAnimationFrame(callback) : 다음 화면 그리기 주기에 맞춰 콜백을 1회 예약함.
     *
     * [프로젝트 내부 변수·함수]
     * - resizeRafId : 대기 중인 애니메이션 프레임 ID를 보관해 프레임당 1회 실행을 보장함.
     *
     * [동작 흐름]
     * - window 'resize' 연속 발생 -> resizeRafId가 0이 아니면 즉시 반환(중복 실행 방지)
     * - requestAnimationFrame 콜백 실행 -> resizeRafId = 0 초기화
     *   ├── syncResponsiveSheetLayout() : 화면 크기별 상세 시트 레이아웃 재조정
     *   ├── syncMobileMenuPlacement() : 모바일 메뉴 배치 갱신
     *   ├── updateMarkers() : 현재 화면 기준 마커·클러스터 재계산
     *   └── updateMarquees() : 긴 병원명 마키 스크롤 재계산
     */

    state.diagnostics.getState = () => state;
    state.diagnostics.hasRenderedRoute = hasRenderedRoute;
    state.diagnostics.glRouteSourceId = GL_ROUTE_SOURCE_ID;
    state.diagnostics.getSchemas = () => ({
        EMERGENCY_BED_ITEMS,
        INPATIENT_BED_SECTIONS,
        EQUIPMENT_TABLE_ITEMS,
        SEVERE_DISEASE_GROUPS
    });
    window.__YONSEI119_DIAGNOSTICS__ = state.diagnostics;
    /*
     * [프로젝트 내부 진단 객체]
     * - window.__YONSEI119_DIAGNOSTICS__ : 개발자 콘솔·테스트 조회용으로 state.diagnostics를 연결함.
     * - getState() : 런타임 state 객체 전체를 반환함.
     * - hasRenderedRoute : 지도에 경로가 렌더링되었는지 확인하는 함수를 연결함.
     * - glRouteSourceId : WebGL 경로 GeoJSON 소스 ID(GL_ROUTE_SOURCE_ID)를 노출함.
     * - getSchemas() : 4종 공공데이터 UI 스키마 상수 묶음을 반환함.
     */

    const locBtn = byId('location-button');
    const refBtn = byId('refresh-button');
    if (locBtn) {
        locBtn.disabled = true;
    }
    if (refBtn) {
        refBtn.disabled = true;
    }

    if (!window.naver?.maps) {
        await ensureNaverMapSdkLoaded();
    }

    if (window.naver?.maps) {
        mountNaverMap();
        if (locBtn) {
            locBtn.disabled = false;
        }
    } else {
        setStatus('네이버 지도 SDK를 불러오지 못했습니다. 네트워크 또는 API 키 설정을 확인하세요.');
    }

    syncFrontendConfig();
    loadData(false);
    registerServiceWorker();

    if (hasMobileGpsHardware() && navigator.geolocation && window.naver?.maps) {
        locate();
    } else {
        updateOriginAddress();
    }

    const previewMode = new URLSearchParams(window.location.search).get('preview');
    if (previewMode) {
        handlePreviewMode(previewMode);
    }
}
/*
 * [JS 문법]
 * - async function / await : 비동기 SDK 로드가 끝날 때까지 기다린 뒤 다음 단계를 실행함.
 * - !obj?.prop : 옵셔널 체이닝과 부정 연산자로 네임스페이스 미준비 상태를 안전하게 확인함.
 *
 * [브라우저 Web API]
 * - navigator.geolocation : 브라우저의 Geolocation 위치 API 지원 여부를 확인하는 객체임.
 * - new URLSearchParams(location.search).get(key) : URL 쿼리 문자열에서 지정 매개변수를 읽음.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수 : init() (프론트엔드 전체 부팅 순서를 조율하는 비동기 진입 함수)
 * - DOM 참조 : locBtn(#location-button), refBtn(#refresh-button)
 * - 지역 변수 : previewMode(URL ?preview= 쿼리 문자열 또는 null)
 *
 * [동작 흐름]
 * - 1단계 버튼 잠금 -> locBtn·refBtn을 disabled = true로 잠가 준비 전 클릭을 막음
 *   └── refBtn 잠금은 이후 loadData(false) 내부 finally 블록에서 자동 해제됨
 * - 2단계 지도 SDK -> !window.naver?.maps이면 await ensureNaverMapSdkLoaded()로 동적 로드
 *   ├── 로드 성공 -> mountNaverMap() 지도 마운트 후 locBtn.disabled = false 해제
 *   └── 로드 실패 -> setStatus(...)로 네트워크·API 키 점검 안내 토스트 표시
 * - 3단계 비동기 부팅 -> 설정·데이터·PWA 워커를 백그라운드로 초기화함
 *   ├── syncFrontendConfig() : GET /api/config로 기본 좌표·스타일·클라이언트 키 동기화
 *   ├── loadData(false) : GET /api/hospitals?compact=true 수신 후 마커·검색 갱신
 *   └── registerServiceWorker() : HTTPS·로컬호스트 환경에서 /sw.js 워커 등록
 * - 4단계 위치·미리보기 -> 기기 환경에 맞춰 출발지를 잡고 시연 모드를 확인함
 *   ├── 모바일 GPS 기기 & geolocation & SDK 준비 -> locate()로 정밀 GPS 측위 실행
 *   ├── 데스크톱 등 고정 환경 -> 기본 출발지(서울시청) 기준 updateOriginAddress() 호출
 *   └── previewMode 존재 -> handlePreviewMode(previewMode)로 미리보기 상태 자동 표시
 */

init();
/*
 * [실행 진입점]
 * - type="module" 스크립트는 HTML 문서 파싱 완료 뒤 지연 실행됨.
 * - DOM 트리가 모두 구축된 시점에 init()을 즉시 호출해 앱 부팅을 시작함.
 */