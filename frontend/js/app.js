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
    renderSymptomChips,
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
 * [JS 문법] import { ... } from './모듈파일.js' : 같은 `js/` 폴더 내에 병렬 독립된 8개 ES 모듈을 가져와 조립함.
 * [전체 모듈 아키텍처 — 식당 총괄 지배인과 전문 파트 비유]
 *   frontend/js/app.js (총괄 오케스트레이터 진입점)
 *   ├── js/constants.js       (고정 메뉴판 & 공공데이터 코드 사전)
 *   ├── js/state.js           (종합상황실 공유 전광판 & 콜백 스위치)
 *   ├── js/utils.js           (데이터 손질·한국어 차단공지 분석·거리 계산 도구함)
 *   ├── js/map-engine.js      (네이버 WebGL 지도·GPU 오버레이·교통 레이어 엔진)
 *   ├── js/markers-cluster.js ($O(N)$ 공간 해시 클러스터링·병상 여유 신호등 마커)
 *   ├── js/directions-eta.js  (Directions 5/15 경로선·수용최적 ETA 랭킹)
 *   ├── js/hospital-sheet.js  (3단 반응형 시트·Half-Peek·3사 내비·공유·E-Gen 보드)
 *   └── js/search-controls.js (증상 프리셋 칩·검색·오프라인 금고·다크테마·PWA 워커)
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
 * [내가 지은 이름] registerUiCallbacks : 하위 모듈들이 상위 모듈을 순환 의존(Circular Dependency) 없이 깨끗하게 호출할 수 있도록 이벤트 배선을 연결함.
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
 * [웹 접근성 WCAG 2.1.2 키보드 포커스 트랩 & ESC 계층적 닫기]
 * - `Escape` 키를 누르면 열려 있는 순서(`모달 다이얼로그 -> 모바일 메뉴 -> 반경 팝오버 -> 검색 자동완성 -> 상세 시트`)대로 가장 위쪽 창부터 자연스럽게 닫힘.
 * - 상세 시트가 전체 모달(`!state.sheetHalfPeek`)로 열려 있을 때는 `Tab` / `Shift+Tab`이 시트 안에서만 순환하도록 포커스 트랩을 유지하며,
 *   모바일 반열림(`state.sheetHalfPeek`) 상태일 때는 지도 버튼으로도 자유롭게 이동할 수 있게 허용함.
 */

async function init() {
    initThemeToggle();
    initSearchFocus();
    initPanels();
    initRadius();
    renderSymptomChips();
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
 * [JS 문법] async function init() : 프론트엔드 전체 모듈의 초기화를 총괄하는 메인 진입점 함수임 (Java의 `public static void main` 역할).
 * [내가 지은 이름] init, window.__YONSEI119_DIAGNOSTICS__(자동화 점검·디버깅용 런타임 진단 창구)
 * [비동기 부팅 파이프라인]
 *   1) 테마·검색·반경·증상칩·모바일 시트 레이아웃 즉시 초기화 (0ms)
 *   2) 네이버 WebGL 지도 마운트 (`mountNaverMap`)
 *   3) 백엔드 설정 동기화(`GET /api/config`), 경량 병원 스냅샷(`GET /api/hospitals?compact=true`), 현재 GPS 측정(`locate`), PWA 서비스 워커 등록을 병렬 비동기로 구동
 */

init();
/*
 * [핵심 실행 코드] `<script type="module" src="js/app.js">`는 표준상 자동으로 `defer`(HTML 파싱 완료 직후 실행) 모드로 동작하므로 `init()`을 즉시 호출함.
 */
