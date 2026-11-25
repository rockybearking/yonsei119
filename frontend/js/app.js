/*
 * ============================================================================
 * [1. 역할 및 실행 시점]
 * - 역할 : 프론트엔드 모든 모듈을 연결하고 초기 지도를 띄우는 총지배인(메인 진입점)
 * - 실행 시점 : `index.html`의 `<script type="module" src="js/app.js">`에 의해
 *              HTML 문서 파싱 완료 직후 자동으로 딱 1번 실행됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [index.html]               [app.js]                       [map-engine.js]      [search-controls.js]
 *             |                        |                                 |                       |
 *             |-- 1. load ES module -->|                                 |                       |  DOM 파싱 직후 진입
 *             |                        |-- 2. registerUiCallbacks()      |                       |  12개 콜백 · 이벤트 바인딩
 *             |                        |-- 3. mountNaverMap() ---------->|                       |  WebGL / 2D 지도 마운트
 *        +----+------------------------+---------------------------------+-----------------------+-----------+
 *        | [par : async startup requests]                                                                    |  초기 비동기 병렬 연동
 *        |    |                        |-- 4a. syncFrontendConfig() -----|---------------------->|           |  /api/config 공개 설정 동기화
 *        |    |                        |-- 4b. loadData(false) ----------|---------------------->|           |  /api/hospitals 초기 목록 수신
 *        |    |                        |-- 4c. startAutoRefreshLoop() ---|---------------------->|           |  60초 실시간 무음 갱신 가동
 *        +----+------------------------+---------------------------------+-----------------------+-----------+
 *             v                        v                                 v                       v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 외부 SDK / 프로젝트 내부)]
 * - JS / 브라우저 표준 내장
 *   ㄴ async / await             : 비동기 작업을 순서대로 제어하는 표준 문법 키워드
 *   ㄴ document.addEventListener : 키보드·클릭 등 DOM 이벤트를 감지하는 브라우저 메서드
 *   ㄴ requestAnimationFrame()   : 화면 주사율에 맞춰 리사이즈를 1회만 실행하는 내장 함수
 *   ㄴ URLSearchParams           : 주소창 쿼리(`?preview=...`)를 파싱하는 표준 내장 클래스
 *   ㄴ getComputedStyle()        : 요소에 최종 적용된 CSS 속성을 읽는 브라우저 내장 함수
 * - 외부 SDK / 라이브러리
 *   ㄴ window.naver.maps        : 네이버 지도 v3 WebGL · LatLngBounds 객체
 * - 프로젝트 내부 모듈
 *   ㄴ constants.js / state.js / utils.js / user-features.js
 *   ㄴ map-engine.js / markers-cluster.js / directions-eta.js
 *   ㄴ hospital-sheet.js / search-controls.js
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 로드 위치
 *   ㄴ frontend/index.html : `<script type="module" src="js/app.js">`
 * - 외부 진단 연결처
 *   ㄴ Yonsei119PlaywrightE2ETests.java : `window.__YONSEI119_DIAGNOSTICS__` 참조
 * - IntelliJ 추적 단축키
 *   ㄴ 선언부 바로 이동 : 호출된 함수명 위에서 `Ctrl + B`
 *   ㄴ 전체 문자열 검색 : `Ctrl + Shift + F`로 `__YONSEI119_DIAGNOSTICS__` 검색
 * ============================================================================
 */

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
    loadEtaRanking,
    scheduleActiveRouteCttSync
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
    startAutoRefreshLoop,
    syncFrontendConfig,
    syncMobileMenuPlacement,
    toggleMobileMenu,
    updateOriginAddress,
    updateRadiusUI,
    updateSearch,
    updateSummary
} from './search-controls.js';

// 하위 모듈 간 순환 import 없이 상위 동작을 호출할 수 있도록 12개 콜백을 등록함
registerUiCallbacks({
    onUpdateMarkers: updateMarkers,
    onDrawRouteOnMap: drawRouteOnMap,
    onHasRenderedRoute: hasRenderedRoute,
    onTrafficTilesUpdated: scheduleActiveRouteCttSync,
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
 * [역할 및 시퀀스 흐름]
 * - 역할 : `Escape` 단계별 닫기 및 병원 상세 모달(`#sheet`) 내 `Tab` 포커스 순환 처리
 *
 *       [User Keypress]      [bindGlobalKeyboardNavigation]              [Open UI Layer]
 *              |                            |                                   |
 *              |-- 1. keydown event ------->|                                   |  키보드 입력 감지
 *         +----+----------------------------+-----------------------------------+---------+
 *         | [alt : event.key === 'Escape']                                                |  단계별 닫기 우선순위
 *         |    |                            |-- 2a. close top layer ----------->|         |  모달->메뉴->반경->검색->시트
 *         +----+----------------------------+-----------------------------------+---------+
 *         | [else : event.key === 'Tab']                                                  |  전체 모달 시트 열림 상태
 *         |    |                            |-- 2b. trap focus inside #sheet -->|         |  첫·마지막 요소 순환 고정
 *         +----+----------------------------+-----------------------------------+---------+
 *              v                            v                                   v
 *
 * - 사용처
 *   ㄴ frontend/js/app.js : `init()` 내부에서 1회 호출
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
 * [역할 및 사용처]
 * - 역할 : 전체 UI 컨트롤 바인딩, 네이버 지도 마운트, 초기 스냅샷 및 60초 자동 갱신 시작
 * - 사용처
 *   ㄴ frontend/js/app.js : 파일 최하단 `init()` 진입 호출
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

    // 창 크기 변경 시 프레임당 1회만 시트·메뉴·마커·전광판 레이아웃을 재계산함
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
    startAutoRefreshLoop();
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

init();
