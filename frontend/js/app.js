/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 프론트엔드 전체 모듈을 하나로 묶어 깨우는 총지배인(메인 부트스트랩 진입점)
 * - 실행 시점: `index.html`의 `<script type="module" src="js/app.js">`에 의해 HTML DOM 파싱 완료 직후 자동 1회 실행됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 부팅 순서:
 *   1) `registerUiCallbacks(...)` ──> 하위 모듈 간 순환 참조 방지용 11개 콜백 연결
 *   2) `init()` 동기 초기화 ──> 테마·검색·패널·반경(기본 50km)·길찾기·반응형 시트·이용 안내·키보드 접근성 바인딩
 *   3) 네이버 지도 SDK 확인 및 `mountNaverMap()` ──> `#map`에 WebGL/2D 지도 마운트
 *   4) 서버 연동 시작:
 *      ├── `syncFrontendConfig()`   ──> `GET /api/config`
 *      ├── `loadData(false)`        ──> `GET /api/hospitals?compact=true` 초기 스냅샷 수신
 *      ├── `startAutoRefreshLoop()` ──> 60초 주기 실시간 병상·응급메시지 무음 동기화 가동
 *      ├── `registerServiceWorker()` ──> `/sw.js` 오프라인 백업 워커 등록
 *      └── `locate()` 또는 `updateOriginAddress()` ──> 기기별 출발 좌표·주소 확정
 *
 * [사용처 및 IDE 추적 가이드]
 * - 로드 위치: `frontend/index.html` (`<script type="module" src="js/app.js" fetchpriority="high"></script>`)
 * - 런타임 진단 연결: 브라우저 콘솔 및 E2E 테스트(`Yonsei119PlaywrightE2ETests`)가 `window.__YONSEI119_DIAGNOSTICS__`를 참조함
 * - IntelliJ 추적 팁: 각 초기화 함수 위에서 `Ctrl + B`로 선언 모듈로 바로 이동 가능
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
    startAutoRefreshLoop,
    syncFrontendConfig,
    syncMobileMenuPlacement,
    toggleMobileMenu,
    updateOriginAddress,
    updateRadiusUI,
    updateSearch,
    updateSummary
} from './search-controls.js';

// [모듈 연결] 하위 모듈들이 서로 직접 import하지 않고 상위 UI 동작을 호출할 수 있도록 11개 콜백을 등록함
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
 * [역할 및 데이터 흐름]
 * - 역할: `Escape` 키 단계별 닫기와 병원 상세 모달 시트(`#sheet`) 내부 `Tab` 키 포커스 트랩(WCAG 2.1 접근성)을 처리함
 * - 흐름:
 *   ├── `Escape` 입력: 열린 `<dialog>` ──> 모바일 메뉴 ──> 반경 팝오버 ──> 검색 드롭다운 ──> 상세 시트 순으로 닫기
 *   └── `Tab` 입력: 전체 모달 시트가 열려 있을 때 첫 포커스 요소와 마지막 요소 사이를 순환시켜 배경 이탈을 막음
 * - 호출처: `init()` 내부에서 1회 호출
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
 * [역할 및 실행 시점]
 * - 역할: UI 컨트롤 이벤트 바인딩, 창 리사이즈 최적화, 진단 객체 노출, 지도 마운트 및 초기·주기적 데이터 수신을 순서대로 조율함
 * - 호출처: 파일 하단 `init()` 진입점
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

    // 창 크기 변경 시 프레임당 1회만 반응형 시트·모바일 메뉴·마커·전광판을 재계산함
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

    // 브라우저 콘솔 및 자동화 E2E 테스트가 내부 상태를 점검할 수 있도록 진단 객체를 연결함
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
