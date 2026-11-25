/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 검색·반경·위치(GPS/지오코딩)·다크모드·실시간 자동동기화·PWA 워커를 총괄하는 관제 컨트롤러
 * - 실행 시점: `app.js:init()` 부팅 시 초기화 함수들이 1회 실행되며, 이후 사용자 조작 및 60초 자동 타이머마다 동작함
 *
 * [전체 호출 및 데이터 흐름]
 * - 핵심 데이터 동기화 흐름:
 *   `loadData()` / `startAutoRefreshLoop()` (60초 주기 무음 동기화)
 *   ──> `fetchData()` ──> `GET /api/hospitals?compact=true` (`If-None-Match` ETag 포함)
 *       ├── `304 Not Modified` ──> 병상·공지 변동 없음, `#updated-time` 갱신 시각만 최신화
 *       ├── `200 OK`           ──> `applySnapshotToState()` ──> 지도 카드·열린 시트 병상/공지 실시간 갱신
 *       └── 네트워크 단절      ──> 서비스 워커 캐시(`X-Yonsei119-Offline-Fallback`) 또는 `localStorage` 비상 스냅샷 복원
 *
 * [사용처 및 IDE 추적 가이드]
 * - 호출처: `app.js` (초기 부팅 및 이벤트 바인딩), `state.js`의 `uiCallbacks` (`map-engine.js`, `directions-eta.js`, `hospital-sheet.js`)
 * - 백엔드 연동 API: `/api/config`, `/api/hospitals`, `/api/geocode`, `/api/reverse-geocode` (`EmergencyApiController.java`)
 * - IntelliJ 추적 팁: `Ctrl + Alt + H` (호출 계층) 또는 `Ctrl + Shift + F`로 `/api/hospitals` 검색
 * ============================================================================
 */

import {
    AUTO_REFRESH_INTERVAL_MS,
    NOTICE_KEY,
    OFFLINE_SNAPSHOT_KEY
} from './constants.js';
import {
    DEFAULT_ORIGIN,
    state
} from './state.js';
import {
    bedValue,
    blurKeyword,
    byId,
    getBedTrafficInfo,
    getOriginDisplayLabel,
    installDialogLightDismiss,
    isGenuineGpsPosition,
    node,
    setStatus,
    yieldToMain
} from './utils.js';
import {
    ensureNaverMapSdkLoaded,
    fitRadius,
    focusHospitalOnMap,
    getHospitalLatLng,
    mountNaverMap,
    updateCircle,
    updateLocationMarker
} from './map-engine.js';
import {
    openCluster,
    updateMarkers
} from './markers-cluster.js';
import {
    loadDirectionsForHospital,
    loadEtaRanking,
    populateWaypointSelect,
    refreshActiveRoute
} from './directions-eta.js';
import {
    closeSheet,
    openHospital
} from './hospital-sheet.js';

let visibilitySyncBound = false;

/*
 * [역할 및 호출처]
 * - 역할: 툴바의 최근 동기화 시각(`<time id="updated-time">`)을 한국 표준시(24시간 `HH:MM`)로 갱신함
 * - 호출처: `app.js:init()`, `applySnapshotToState()`, `fetchData()`(`304` 응답 시)
 */
export function updateSummary() {
    const time = byId('updated-time');
    if (!time) {
        return;
    }

    time.textContent = state.lastUpdated
        ? state.lastUpdated.toLocaleTimeString('ko-KR', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
        : '확인 중';

    if (state.lastUpdated) {
        time.dateTime = state.lastUpdated.toISOString();
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 현재 선택된 탐색 반경(`#radius`, 기본 `50 km`)과 출발 기준 주소를 버튼·도움말·출발 표시줄에 동기화함
 * - 호출처: `app.js:init()`, `initRadius()`, `syncFrontendConfig()`, `locate()`, `updateOriginAddress()`, `setCustomOrigin()`, `directions-eta.js:resetOriginAndRoute()`
 */
export function updateRadiusUI() {
    const radiusSelect = byId('radius');
    if (!radiusSelect) {
        return;
    }
    const value = radiusSelect.value;
    const label = value === 'all' ? '전국' : `${value} km`;

    const radiusValEl = byId('radius-value');
    const radiusBtnEl = byId('radius-button');
    const radiusHelpEl = byId('radius-help');

    if (radiusValEl) {
        radiusValEl.textContent = label;
    }
    if (radiusBtnEl) {
        radiusBtnEl.setAttribute('aria-label', `탐색 반경 설정, 현재 ${label}`);
        radiusBtnEl.title = `탐색 반경: ${label}`;
    }

    const originDesc = getOriginDisplayLabel();
    if (radiusHelpEl) {
        radiusHelpEl.textContent = value === 'all'
            ? '전국 기관을 표시합니다. 선택하면 바로 적용됩니다.'
            : `${originDesc} 기준 · 선택하면 바로 적용됩니다.`;
    }

    const addrText = byId('origin-address-text');
    if (addrText) {
        addrText.textContent = `출발 기준: ${originDesc}`;
        addrText.title = `출발 기준: ${originDesc} (${state.origin.lat.toFixed(5)}, ${state.origin.lng.toFixed(5)})`;
    }

    const originResetBtn = byId('origin-reset-btn');
    if (originResetBtn) {
        originResetBtn.hidden = !state.locationKnown;
    }
}

/*
 * [역할 및 호출처]
 * - 역할: 열려 있는 반경 설정 팝오버(`#radius-popover`)를 닫고 필요 시 `#radius-button`으로 키보드 초점을 되돌림
 * - 호출처: `app.js`(`Escape` 키), `initRadius()`, `updateSearch()`, `toggleMobileMenu()`, `hospital-sheet.js:openHospital()`
 */
export function closeRadius(restoreFocus = false) {
    const popover = byId('radius-popover');
    const btn = byId('radius-button');
    if (!popover || !btn) {
        return;
    }
    popover.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {
        btn.focus();
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 반경 버튼·팝오버·`<select id="radius">` 변경 이벤트와 바깥 클릭 닫기 리스너를 등록함
 * - 흐름: `#radius` 값 변경 ──> `updateRadiusUI()` ──> `fitRadius()` 카메라·반경 원 조정 ──> `updateMarkers()` ──> 열린 ETA 순위 갱신
 * - 호출처: `app.js:init()`에서 1회 호출
 */
export function initRadius() {
    const button = byId('radius-button');
    const panel = byId('radius-popover');
    if (!button || !panel) {
        return;
    }

    button.addEventListener('click', () => {
        if (!panel.hidden) {
            closeRadius(true);
            return;
        }
        const results = byId('search-results');
        if (results) {
            results.hidden = true;
        }
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        byId('radius')?.focus();
    });

    byId('radius-close')?.addEventListener('click', () => closeRadius(true));

    byId('radius')?.addEventListener('change', () => {
        updateRadiusUI();
        fitRadius();
        updateMarkers();
        if (state.etaRankOpen) {
            loadEtaRanking();
        }
    });

    document.addEventListener('pointerdown', event => {
        if (!panel.hidden && !event.target.closest('.radius-tool')) {
            closeRadius();
        }
        if (state.mobileMenuOpen && !event.target.closest('#mobile-top-left-menu')) {
            toggleMobileMenu(false);
        }
        if (!event.target.closest('#search-panel')) {
            const results = byId('search-results');
            if (results) {
                results.hidden = true;
            }
        }
    });

    document.addEventListener('focusin', event => {
        if (!panel.hidden && !event.target.closest('.radius-tool')) {
            closeRadius();
        }
    });

    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeRadius(true);
        }
    });

    updateRadiusUI();
}

/*
 * [역할 및 백엔드 연결]
 * - 역할: 백엔드 `GET /api/config`(`EmergencyApiController.getConfig()`)에서 공개 네이버 지도 키·다크 스타일 ID·기본 출발 좌표를 받아 동기화함
 * - 흐름: `/api/config` 수신 ──> `DEFAULT_ORIGIN` 갱신 ──> 키·다크 스타일 변경 시 SDK 재로드 후 `mountNaverMap()` 재마운트
 * - 호출처: `app.js:init()`
 */
export async function syncFrontendConfig() {
    try {
        const response = await fetch('/api/config', {
            priority: 'low',
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
            return;
        }
        const cfg = await response.json();

        if (Number.isFinite(cfg.defaultLat) && Number.isFinite(cfg.defaultLng)) {
            DEFAULT_ORIGIN.lat = cfg.defaultLat;
            DEFAULT_ORIGIN.lng = cfg.defaultLng;
            if (cfg.defaultLabel) {
                DEFAULT_ORIGIN.label = cfg.defaultLabel;
            }
            if (!state.locationKnown) {
                state.origin = { lat: DEFAULT_ORIGIN.lat, lng: DEFAULT_ORIGIN.lng };
                state.originLabel = DEFAULT_ORIGIN.label;
                updateRadiusUI();
                updateCircle();
                updateMarkers();
            }
        }

        let needMapRemount = false;
        if (cfg.naverDarkStyleId && cfg.naverDarkStyleId !== state.naverDarkStyleId) {
            state.naverDarkStyleId = cfg.naverDarkStyleId;
            if (state.darkMode) {
                needMapRemount = true;
            }
        } else if (
            state.darkMode &&
            state.naverDarkStyleId &&
            window.naver?.maps?.glEnabled &&
            !state._glPermanentUnsupported &&
            state.map?.get?.('renderMode') !== 2
        ) {
            needMapRemount = true;
        }

        if (cfg.naverClientId && cfg.naverClientId !== state.naverClientId) {
            const loaded = await ensureNaverMapSdkLoaded(cfg.naverClientId);
            if (loaded) {
                needMapRemount = true;
            }
        } else if (!window.naver?.maps && cfg.naverClientId) {
            const loaded = await ensureNaverMapSdkLoaded(cfg.naverClientId);
            if (loaded) {
                needMapRemount = true;
            }
        }

        if (needMapRemount && window.naver?.maps) {
            mountNaverMap();
        }
    } catch (cfgErr) {
        void cfgErr;
    }
}

/*
 * [역할 및 호출처]
 * - 역할: 정상 수신된 병원 스냅샷에서 핵심 13개 필드를 추려 `localStorage`(`OFFLINE_SNAPSHOT_KEY`)에 비상 백업함
 * - 호출처: `fetchData()`
 */
function saveOfflineSnapshot(snapshot) {
    try {
        const compactBackup = {
            updatedAt: snapshot.updatedAt || new Date().toISOString(),
            sources: snapshot.sources || {},
            hospitals: (snapshot.hospitals || []).map(h => ({
                id: h.id,
                name: h.name,
                type: h.type,
                regional: h.regional,
                traumaCenter: h.traumaCenter,
                address: h.address,
                tel: h.tel,
                erTel: h.erTel,
                lat: h.lat,
                lng: h.lng,
                beds: h.beds,
                severe: h.severe,
                messages: h.messages
            }))
        };
        localStorage.setItem(OFFLINE_SNAPSHOT_KEY, JSON.stringify(compactBackup));
    } catch (quotaErr) {
        void quotaErr;
    }
}

/*
 * [역할 및 호출처]
 * - 역할: 네트워크·서비스 워커 캐시가 모두 실패했을 때 `localStorage`에서 마지막 비상 병원 스냅샷을 꺼냄
 * - 호출처: `fetchData()`의 `catch` 블록
 */
function loadOfflineSnapshot() {
    try {
        const raw = localStorage.getItem(OFFLINE_SNAPSHOT_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.hospitals) && parsed.hospitals.length > 0) {
            return parsed;
        }
    } catch (parseErr) {
        void parseErr;
    }
    return null;
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 공유 링크(`?hospital=HPID`)로 접속한 경우 첫 스냅샷 적재 직후 해당 병원 시트를 열고 지도 중심을 맞춤
 * - 호출처: `applySnapshotToState()`
 */
function handleInitialHospitalDeepLink() {
    if (state.initialDeepLinkHandled || !state.hospitals.length) {
        return;
    }
    const params = new URLSearchParams(window.location.search);
    const requestedId = (params.get('hospital') || params.get('hpid') || '').trim();
    if (!requestedId) {
        state.initialDeepLinkHandled = true;
        return;
    }

    state.initialDeepLinkHandled = true;
    const upperId = requestedId.toUpperCase();
    const matched = state.hospitals.find(item => String(item.id || '').toUpperCase() === upperId);
    if (!matched) {
        setStatus(`공유된 기관 코드(${requestedId})에 해당하는 응급의료기관을 찾지 못했습니다.`);
        return;
    }

    byId('notice-dialog')?.close();
    openHospital(matched, true);
    focusHospitalOnMap(matched, 15);
    updateMarkers();
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 수신한 병원 목록 스냅샷을 `state`에 반영하고 지도 카드·검색·열린 병원 상세 시트를 실시간으로 갱신함
 * - 흐름:
 *   검색 키·좌표 사전 준비(45ms 초과 시 `yieldToMain()`) ──> `state.hospitals`·`sources`·`lastUpdated` 교체
 *   ──> 최초 1회 `fitRadius()` ──> `updateMarkers()` ──> 딥링크 처리
 *   ──> 상세 시트가 열려 있으면(`state.selected`) 최신 병상·응급메시지로 즉시 재렌더링(`skipDirections: true`)
 * - 호출처: `fetchData()`
 */
async function applySnapshotToState(snapshot, currentController, isOfflineFallback = false) {
    const incomingHospitals = Array.isArray(snapshot.hospitals) ? snapshot.hospitals : [];
    const canPrebuildLatLng = Boolean(window.naver?.maps?.LatLng);
    let chunkStart = performance.now();

    for (let i = 0; i < incomingHospitals.length; i++) {
        const hospital = incomingHospitals[i];
        hospital._vGroup = hospital.regional ? 'regional' : hospital.type?.group;
        hospital._searchKey = `${hospital.name || ''} ${hospital.address || ''} ${hospital.id || ''}`
            .replace(/\s+/g, '')
            .toLowerCase();
        if (canPrebuildLatLng && Number.isFinite(hospital.lat) && Number.isFinite(hospital.lng)) {
            getHospitalLatLng(hospital);
        }
        if ((i & 63) === 63 && performance.now() - chunkStart >= 45) {
            await yieldToMain();
            if (currentController?.signal?.aborted) {
                return false;
            }
            chunkStart = performance.now();
        }
    }

    state.hospitals = incomingHospitals;
    state.offlineMode = Boolean(isOfflineFallback);
    if (!isOfflineFallback) {
        state.detailCache.clear();
    }
    state.sources = snapshot.sources || {
        list: true,
        basic: true,
        beds: true,
        messages: true,
        severe: true,
        traumaList: true,
        traumaBasic: true
    };
    state.lastUpdated = snapshot.updatedAt ? new Date(snapshot.updatedAt) : new Date();

    if (!state.hasFitted && state.map) {
        fitRadius();
        state.hasFitted = true;
    }

    updateMarkers();
    handleInitialHospitalDeepLink();

    if (state.selected) {
        const fresh = state.hospitals.find(item => item.id === state.selected.id);
        if (fresh) {
            openHospital(fresh, false, { skipDirections: true });
        } else {
            closeSheet();
        }
    }

    updateSearch();
    updateSummary();
    return true;
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 중복 요청을 병합(`state.inflight`)하며 병원 스냅샷 조회(`fetchData`)를 실행하는 공개 진입 함수
 * - 매개변수:
 *   · `forceRefresh`: `true`면 `?refresh=true` 수동 새로고침 요청
 *   · `options.silent`: `true`면 60초 자동 폴링 모드로 상단 토스트 깜빡임 없이 조용히 병상·공지만 갱신함
 * - 호출처: `app.js:init()`, `#refresh-button` 클릭 리스너, `startAutoRefreshLoop()`
 */
export function loadData(forceRefresh = false, options = {}) {
    if (state.inflight && (!forceRefresh || state.inflightForce)) {
        return state.inflight;
    }

    state.inflightForce = Boolean(forceRefresh);
    const requestPromise = fetchData(forceRefresh, options).finally(() => {
        if (state.inflight === requestPromise) {
            state.inflight = null;
            state.inflightForce = false;
        }
    });
    state.inflight = requestPromise;

    return requestPromise;
}

/*
 * [역할 및 실행 시점 — 실시간 병상·응급메시지 자동 동기화]
 * - 역할: 사용자가 페이지를 열어 두는 동안 60초(`AUTO_REFRESH_INTERVAL_MS`)마다 백엔드의 최신 병상·응급메시지를 자동 수신함
 * - 흐름:
 *   1) 탭이 화면에 보이는 상태(`document.visibilityState === 'visible'`)일 때 60초마다 `loadData(false, { silent: true })` 실행
 *   2) 다른 탭을 보다가 돌아왔을 때(`visibilitychange`) 마지막 갱신 후 60초 이상 지났으면 즉시 무음 동기화 실행
 * - 호출처: `app.js:init()`
 */
export function startAutoRefreshLoop() {
    if (state.autoRefreshTimerId !== null) {
        clearInterval(state.autoRefreshTimerId);
    }

    state.autoRefreshTimerId = setInterval(() => {
        if (document.visibilityState === 'visible' && !state.loading) {
            loadData(false, { silent: true });
        }
    }, AUTO_REFRESH_INTERVAL_MS);

    if (!visibilitySyncBound) {
        visibilitySyncBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || state.loading) {
                return;
            }
            const elapsedMs = state.lastUpdated
                ? Date.now() - state.lastUpdated.getTime()
                : AUTO_REFRESH_INTERVAL_MS;
            if (elapsedMs >= AUTO_REFRESH_INTERVAL_MS) {
                loadData(false, { silent: true });
            }
        });
    }
}

/*
 * [역할 및 호출처]
 * - 역할: `/api/hospitals` HTTP 상태 코드를 검증하고 JSON 본문을 파싱함
 * - 호출처: `fetchData()`
 */
async function parseSnapshotResponse(response) {
    if (!response.ok) {
        throw new Error(`백엔드 서버 응답 오류 (HTTP ${response.status})`);
    }
    return response.json();
}

/*
 * [역할 및 백엔드 API 연결]
 * - 역할: `GET /api/hospitals?compact=true`(`EmergencyApiController.getHospitalsHttp`)를 호출해 전국 병원 스냅샷을 수신함
 * - 흐름:
 *   요청 전송(`If-None-Match` ETag 포함)
 *   ├── `304 Not Modified` ──> 데이터 동일 확인 후 시각만 갱신 (네트워크 대역폭 절약)
 *   ├── `200 OK` JSON      ──> ETag·오프라인 백업 저장 후 `applySnapshotToState()` 반영
 *   └── 통신 오류(`catch`) ──> 초기 목록이 비어 있으면 `loadOfflineSnapshot()` 비상 복원
 * - 호출처: `loadData(forceRefresh, options)`
 */
async function fetchData(forceRefresh = false, options = {}) {
    const silent = Boolean(options?.silent) && !forceRefresh && state.hospitals.length > 0;
    state.loading = true;

    const refreshBtn = byId('refresh-button');
    const devSpinner = byId('developer-spinner');
    const devStatus = byId('developer-status');

    if (!silent) {
        if (refreshBtn) {
            refreshBtn.disabled = true;
        }
        document.body.classList.add('is-loading');
    }
    if (devSpinner) {
        devSpinner.hidden = false;
    }
    if (devStatus) {
        devStatus.textContent = '실시간 정보 새로 수신 중...';
    }

    state.controller?.abort();
    const currentController = new AbortController();
    state.controller = currentController;

    if (!silent) {
        setStatus('정보 확인 중…');
    }

    try {
        const endpointUrl = forceRefresh
            ? '/api/hospitals?refresh=true&compact=true'
            : '/api/hospitals?compact=true';
        const isBackgroundRefresh = !forceRefresh && state.hospitals.length > 0;
        const headers = {
            Accept: 'application/json'
        };
        if (state.lastSnapshotEtag && state.hospitals.length > 0) {
            headers['If-None-Match'] = state.lastSnapshotEtag;
        }

        const response = await fetch(endpointUrl, {
            signal: currentController.signal,
            cache: 'no-store',
            priority: isBackgroundRefresh ? 'low' : 'high',
            headers
        });

        if (response.status === 304) {
            if (currentController.signal.aborted) {
                return;
            }
            state.lastUpdated = new Date();
            updateSummary();
            if (devStatus) {
                devStatus.textContent = `변경 없음 · 최신 스냅샷 유지 (${state.hospitals.length.toLocaleString('ko-KR')}개 기관 · 304 Not Modified)`;
            }
            if (!silent) {
                setStatus('');
            }
            return;
        }

        const snapshot = await parseSnapshotResponse(response);
        const fromSwOffline = response.headers.get('X-Yonsei119-Offline-Fallback') === '1';
        if (currentController.signal.aborted) {
            return;
        }

        if (!fromSwOffline) {
            state.lastSnapshotEtag = response.headers.get('ETag') || null;
            saveOfflineSnapshot(snapshot);
        }

        const applied = await applySnapshotToState(snapshot, currentController, fromSwOffline);
        if (!applied) {
            return;
        }

        const missing = Object.entries(state.sources)
            .filter(([, ok]) => !ok)
            .map(([key]) => key);
        const totalSources = Object.keys(state.sources).length;
        const allSourcesUnavailable =
            totalSources > 0 && missing.length === totalSources && state.hospitals.length === 0;

        if (fromSwOffline) {
            if (devStatus) {
                devStatus.textContent = `오프라인 저장본 표시 중 (${state.hospitals.length.toLocaleString('ko-KR')}개 기관)`;
            }
            if (!silent) {
                setStatus('오프라인 상태 · 마지막 저장된 병원 스냅샷을 표시합니다. 방문 전 반드시 전화로 확인하세요.');
            }
        } else if (allSourcesUnavailable) {
            if (devStatus) {
                devStatus.textContent =
                    '공공데이터 수집 불가 (0개 기관) · 서버 NEMC_API_SERVICE_KEY(.env) 또는 외부 API 상태를 확인하세요.';
            }
            if (!silent) {
                setStatus(
                    '응급의료 데이터를 불러오지 못했습니다. 로컬 실행 중이라면 프로젝트 루트의 .env API 키 설정을 확인해 주세요.'
                );
            }
        } else {
            if (devStatus) {
                devStatus.textContent = missing.length
                    ? `조회 완료 · 일부 항목 지연: ${missing.join(', ')}`
                    : `전체 데이터 갱신 완료 (${state.hospitals.length.toLocaleString('ko-KR')}개 기관)`;
            }
            if (!silent) {
                setStatus(
                    missing.length
                        ? '일부 정보를 불러오지 못했습니다. 상세 정보에서 확인해 주세요.'
                        : ''
                );
            }
        }
    } catch (error) {
        if (error?.name === 'AbortError') {
            return;
        }

        if (!state.hospitals.length) {
            const backup = loadOfflineSnapshot();
            if (backup) {
                await applySnapshotToState(backup, currentController, true);
                if (devStatus) {
                    devStatus.textContent = `오프라인 비상 백업본 복원 (${state.hospitals.length.toLocaleString('ko-KR')}개 기관)`;
                }
                setStatus('네트워크 연결 실패 · 저장된 비상 백업 데이터를 표시합니다. 반드시 전화로 병상 여부를 확인하세요.');
                return;
            }
        }

        if (!silent) {
            setStatus(`조회 실패: ${error.message} · 이전 정보가 있다면 재확인하세요.`);
        }
        if (devStatus) {
            devStatus.textContent = `갱신 실패: ${error.message}`;
        }
    } finally {
        if (state.controller === currentController) {
            state.loading = false;
            if (refreshBtn) {
                refreshBtn.disabled = false;
            }
            document.body.classList.remove('is-loading');
            if (devSpinner) {
                devSpinner.hidden = true;
            }
        }
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 브라우저 `navigator.geolocation.getCurrentPosition()`으로 정밀 GPS 좌표를 수신해 출발 기준점을 내 위치로 이동함
 * - 흐름: 고정밀 측위 요청 ──> `isGenuineGpsPosition()` 검증(IP 추정치 배제) ──> `state.origin`·반경 원·마커·역지오코딩 주소·ETA·경로 일괄 갱신
 * - 호출처: `app.js:init()` (모바일 GPS 기기 접속 시), `#location-button` 클릭 리스너
 */
export function locate() {
    if (state.locating || !state.map) {
        return;
    }

    if (!navigator.geolocation) {
        setStatus('이 브라우저에서 위치 기능을 사용할 수 없습니다.');
        return;
    }

    state.locating = true;
    const locBtn = byId('location-button');
    if (locBtn) {
        locBtn.disabled = true;
    }

    const finish = () => {
        state.locating = false;
        if (locBtn) {
            locBtn.disabled = false;
        }
    };

    navigator.geolocation.getCurrentPosition(
        position => {
            if (!isGenuineGpsPosition(position)) {
                updateRadiusUI();
                updateOriginAddress();
                setStatus(
                    '정밀 GPS 위성 신호가 감지되지 않아(IP·기지국 추정 위치 제외) ' +
                    (state.locationKnown
                        ? '지정된 기준 위치를 유지합니다.'
                        : `${DEFAULT_ORIGIN.label}을(를) 기준으로 표시합니다.`)
                );
                finish();
                return;
            }

            state.origin = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            state.originLabel = '내 위치 (GPS)';
            state.originAddress = '';

            state.locationKnown = true;
            state.locationAccuracy = position.coords.accuracy;
            state.locationUpdated = new Date(position.timestamp || Date.now());

            updateRadiusUI();
            updateLocationMarker();
            updateOriginAddress();

            if (!state.selected) {
                fitRadius();
                if (byId('radius')?.value === 'all' && window.naver?.maps) {
                    state.map.panTo(new window.naver.maps.LatLng(state.origin.lat, state.origin.lng));
                }
            } else {
                updateCircle();
            }

            updateMarkers();
            if (state.etaRankOpen) {
                loadEtaRanking();
            }
            if (state.selected) {
                const isSelectedActiveRoute = Boolean(
                    state.activeRoute && state.activeRoute.hospital?.id === state.selected.id
                );
                populateWaypointSelect(state.selected);
                loadDirectionsForHospital(state.selected, isSelectedActiveRoute, { fitMap: false });
                if (state.activeRoute && !isSelectedActiveRoute) {
                    refreshActiveRoute({ fitMap: false });
                }
            } else if (state.activeRoute) {
                refreshActiveRoute({ fitMap: false });
            }
            finish();
        },
        error => {
            const reason = error.code === 1
                ? 'GPS 위치 권한이 허용되지 않았습니다.'
                : 'GPS 위성 신호를 수신하지 못했습니다.';

            updateRadiusUI();
            updateOriginAddress();
            setStatus(
                reason +
                (state.locationKnown
                    ? ' 기존 기준 위치를 유지합니다.'
                    : ` ${DEFAULT_ORIGIN.label}을(를) 기준으로 표시합니다.`)
            );
            finish();
        },
        {
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 0
        }
    );
}

/*
 * [역할 및 백엔드 API 연결]
 * - 역할: 현재 출발 좌표(`state.origin`)를 `GET /api/reverse-geocode`로 보내 한글 행정동·도로명 주소를 받아 표시함
 * - 백엔드 연결: `EmergencyApiController.reverseGeocode()` -> `NaverGeocodingService.reverseGeocode()` -> `ReverseGeocodeResponseDto`
 * - 호출처: `app.js:init()`, `locate()`, `setCustomOrigin()`, `directions-eta.js:resetOriginAndRoute()`
 */
export async function updateOriginAddress() {
    state.reverseGeocodeController?.abort();
    const controller = new AbortController();
    state.reverseGeocodeController = controller;

    try {
        const params = new URLSearchParams({
            lat: String(state.origin.lat),
            lng: String(state.origin.lng)
        });
        const response = await fetch(`/api/reverse-geocode?${params.toString()}`, {
            signal: controller.signal,
            priority: 'low',
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        const addr = data.shortAddress || data.fullAddress || data.roadAddress || data.jibunAddress;
        if (data.code === 0 && addr) {
            state.originAddress = addr;
            updateRadiusUI();
        }
    } catch (err) {
        void err;
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 지도 우클릭·롱탭 또는 주소 검색으로 지정한 좌표를 새 출발 기준점으로 설정하고 반경 원·마커·경로·순위를 재계산함
 * - 호출처: `geocodeAndMoveOrigin()`, `map-engine.js:mountNaverMap()` (`uiCallbacks.onCustomOrigin`)
 */
export function setCustomOrigin(lat, lng, customLabel = '지정 출발지') {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
    }

    state.origin = { lat, lng };
    state.locationKnown = true;
    state.originLabel = customLabel;
    state.originAddress = '';
    state.locationUpdated = new Date();

    updateRadiusUI();
    updateLocationMarker();
    updateCircle(true);
    updateMarkers();
    updateOriginAddress();
    setStatus(`출발 기준점을 선택한 위치(${lat.toFixed(4)}, ${lng.toFixed(4)})로 변경했습니다. (우클릭·롱탭으로 언제든 변경 가능)`);

    if (state.etaRankOpen) {
        loadEtaRanking();
    }

    if (state.selected) {
        const isSelectedActiveRoute = Boolean(
            state.activeRoute && state.activeRoute.hospital?.id === state.selected.id
        );
        populateWaypointSelect(state.selected);
        loadDirectionsForHospital(state.selected, isSelectedActiveRoute, { fitMap: false });
        if (state.activeRoute && !isSelectedActiveRoute) {
            refreshActiveRoute({ fitMap: false });
        }
    } else if (state.activeRoute) {
        refreshActiveRoute({ fitMap: false });
    }
}

/*
 * [역할 및 백엔드 API 연결]
 * - 역할: 검색어를 `GET /api/geocode?query=...`로 조회해 해당 주소·지역 좌표로 출발 기준점과 지도 화면을 이동함
 * - 백엔드 연결: `EmergencyApiController.geocode()` -> `NaverGeocodingService.geocode()` -> `GeocodeResponseDto`
 * - 호출처: `updateSearch()` 하단의 `'주소·지역으로 출발 기준점 이동'` 버튼 클릭 리스너
 */
async function geocodeAndMoveOrigin(rawQuery) {
    const trimmed = String(rawQuery || '').trim();
    if (!trimmed) {
        return;
    }

    setStatus(`'${trimmed}' 위치 좌표를 조회하고 있습니다…`);
    try {
        const params = new URLSearchParams({ query: trimmed });
        const response = await fetch(`/api/geocode?${params.toString()}`, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
            setStatus(`위치 조회 실패 (HTTP ${response.status})`);
            return;
        }
        const data = await response.json();
        const firstItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : data;
        const targetLat = Number(firstItem?.lat);
        const targetLng = Number(firstItem?.lng);
        if (data.code !== 0 || !Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
            setStatus(`'${trimmed}'에 해당하는 주소나 지역 좌표를 찾지 못했습니다.`);
            return;
        }

        const label = firstItem.title || firstItem.roadAddress || firstItem.jibunAddress || trimmed;
        const resultsEl = byId('search-results');
        if (resultsEl) {
            resultsEl.hidden = true;
        }
        blurKeyword();

        setCustomOrigin(targetLat, targetLng, label);

        if (state.map && window.naver?.maps) {
            state.hasFitted = true;
            if (byId('radius')?.value === 'all') {
                const targetLatLng = new window.naver.maps.LatLng(targetLat, targetLng);
                if (typeof state.map.morph === 'function') {
                    state.map.morph(targetLatLng, 13, { duration: 450, easing: 'easeOutCubic' });
                } else {
                    state.map.setCenter(targetLatLng);
                    state.map.setZoom(13);
                }
            } else {
                fitRadius();
            }
        }
        setStatus(`출발 기준점을 '${label}' 위치로 변경했습니다.`);
    } catch (err) {
        setStatus(`위치 조회 중 오류 발생: ${err.message}`);
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: `#keyword` 입력값으로 병원명·주소·코드를 실시간 매칭해 자동완성 목록(최대 25건)과 주소 출발점 이동 버튼을 `#search-results`에 그림
 * - 호출처: `app.js` (`#keyword` `input`·`focus`, `#search-form` `submit`), `applySnapshotToState()`, `initPanels()`
 */
export function updateSearch() {
    closeRadius();

    const list = byId('search-results');
    const keywordInput = byId('keyword');
    const searchContent = byId('search-content');
    if (!list || !keywordInput || !searchContent) {
        return;
    }

    const rawValue = keywordInput.value.trim();
    const query = rawValue
        .replace(/\s+/g, '')
        .toLowerCase();

    list.replaceChildren();

    const isKeywordFocused = document.activeElement === keywordInput;
    list.hidden =
        !query ||
        searchContent.hidden ||
        (state.selected !== null && !isKeywordFocused);

    if (!query) {
        return;
    }

    const matches = state.hospitals
        .filter(item => {
            if (!item._searchKey) {
                item._searchKey = `${item.name || ''} ${item.address || ''} ${item.id || ''}`
                    .replace(/\s+/g, '')
                    .toLowerCase();
            }
            return item._searchKey.includes(query);
        })
        .slice(0, 25);

    const fragment = document.createDocumentFragment();

    for (const hospital of matches) {
        const li = node('li');
        const button = node('button', 'result-button');
        button.type = 'button';

        const traffic = getBedTrafficInfo(hospital.beds?.hvec);
        const headRow = node('div', 'hospital-card-head');
        const dot = node('span', `bed-traffic-dot ${traffic.className}`);
        dot.title = traffic.label;
        dot.setAttribute('aria-hidden', 'true');
        headRow.append(node('strong', '', hospital.name), dot);

        button.append(
            headRow,
            node('small', '', `${hospital.type.label} · 응급실 ${bedValue(hospital.beds?.hvec)}`)
        );

        button.addEventListener('click', () => {
            keywordInput.value = hospital.name;
            list.hidden = true;
            keywordInput.blur();

            openHospital(hospital);
            focusHospitalOnMap(hospital, 15);
            updateMarkers();
        });

        li.append(button);
        fragment.append(li);
    }

    const geoLi = node('li', 'search-geocode-li');
    const geoBtn = node('button', 'search-geocode-btn');
    geoBtn.type = 'button';
    geoBtn.append(
        node('strong', '', `'${rawValue}' 주소·지역으로 출발 기준점 이동`),
        node('small', '', '주변 병원 탐색')
    );
    geoBtn.addEventListener('click', () => {
        geocodeAndMoveOrigin(rawValue);
    });
    geoLi.append(geoBtn);
    fragment.append(geoLi);

    list.append(fragment);
}

/*
 * [역할 및 호출처]
 * - 역할: 브라우저 `localStorage`(`NOTICE_KEY`)에 이용 안내 다시 보지 않기 설정이 저장되어 있는지 확인함
 * - 호출처: `openNotice()`, `initNotice()`
 */
function noticeHidden() {
    try {
        return localStorage.getItem(NOTICE_KEY) === '1';
    } catch (err) {
        void err;
        return false;
    }
}

/*
 * [역할 및 호출처]
 * - 역할: 최초 이용 안내 및 법적 면책 조항 모달(`#notice-dialog`)을 화면에 띄움
 * - 호출처: `initNotice()`
 */
function openNotice() {
    const skipBtn = byId('notice-skip');
    const dialog = byId('notice-dialog');
    if (!dialog) {
        return;
    }
    if (skipBtn) {
        skipBtn.textContent = noticeHidden()
            ? '접속할 때 안내 다시 보기'
            : '이 브라우저에서 다시 보지 않기';
    }
    dialog.showModal();
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 이용 안내·클러스터 다이얼로그 닫기 이벤트를 연결하고, 최초 접속 시 `#notice-dialog`를 표시함
 * - 호출처: `app.js:init()`
 */
export function initNotice() {
    const noticeDialog = byId('notice-dialog');
    const clusterDialog = byId('cluster-dialog');

    installDialogLightDismiss(noticeDialog);
    installDialogLightDismiss(clusterDialog);

    if (!noticeDialog) {
        return;
    }

    for (const id of ['notice-close', 'notice-confirm']) {
        byId(id)?.addEventListener('click', () => noticeDialog.close());
    }

    byId('notice-skip')?.addEventListener('click', () => {
        try {
            if (noticeHidden()) {
                localStorage.removeItem(NOTICE_KEY);
            } else {
                localStorage.setItem(NOTICE_KEY, '1');
            }
        } catch (err) {
            void err;
            setStatus('이 브라우저에서는 안내 숨김 설정을 저장할 수 없습니다.');
        }
        noticeDialog.close();
    });

    const searchParams = new URLSearchParams(window.location.search);
    const previewMode = searchParams.get('preview');
    const hasHospitalDeepLink = Boolean(searchParams.get('hospital') || searchParams.get('hpid'));

    if (!noticeHidden() && !hasHospitalDeepLink && (!previewMode || previewMode === 'notice')) {
        openNotice();
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 우측 하단 검색 패널 접기/펼치기(`#search-toggle`)와 패널 실제 높이(`--search-panel-height`) 측정을 관리함
 * - 호출처: `app.js:init()`
 */
export function initPanels() {
    let heightRafId = 0;
    const updateHeight = () => {
        const panelEl = byId('search-panel');
        if (!panelEl) {
            return;
        }
        const height = panelEl.offsetHeight;
        document.documentElement.style.setProperty('--search-panel-height', `${height}px`);
    };

    const scheduleUpdateHeight = () => {
        if (heightRafId) {
            return;
        }
        heightRafId = requestAnimationFrame(() => {
            heightRafId = 0;
            updateHeight();
        });
    };

    const button = byId('search-toggle');
    const content = byId('search-content');
    const panel = byId('search-panel');

    if (button && content && panel) {
        button.addEventListener('click', () => {
            const collapsed = button.getAttribute('aria-expanded') === 'true';

            content.hidden = collapsed;
            panel.classList.toggle('is-collapsed', collapsed);
            button.setAttribute('aria-expanded', String(!collapsed));
            button.setAttribute('aria-label', `검색 ${collapsed ? '펼치기' : '접기'}`);
            button.textContent = collapsed ? '펼치기' : '접기';

            document.body.classList.toggle('search-collapsed', collapsed);
            if (collapsed) {
                const results = byId('search-results');
                if (results) {
                    results.hidden = true;
                }
            } else {
                updateSearch();
            }

            updateHeight();
        });
    }

    if ('ResizeObserver' in window && panel) {
        new ResizeObserver(scheduleUpdateHeight).observe(panel);
    }

    window.addEventListener('resize', scheduleUpdateHeight, { passive: true });
    updateHeight();
}

/*
 * [역할 및 호출처]
 * - 역할: 한글 IME 조합 중 엔터 중복 제출을 막고, 검색창 외부 터치·휠 조작 시 모바일 가상 키보드를 자연스럽게 닫음
 * - 호출처: `app.js:init()`
 */
export function initSearchFocus() {
    const keyword = byId('keyword');
    if (!keyword) {
        return;
    }
    let multiTouch = false;

    const options = {
        capture: true,
        passive: true
    };

    document.addEventListener('pointerdown', event => {
        if (event.target !== keyword || (event.pointerType === 'touch' && !event.isPrimary)) {
            blurKeyword();
        }
    }, options);

    document.addEventListener('touchstart', event => {
        multiTouch = event.touches.length > 1;
        if (multiTouch || event.target !== keyword) {
            blurKeyword();
        }
    }, options);

    const updateTouches = event => {
        multiTouch = event.touches.length > 1;
    };

    document.addEventListener('touchend', updateTouches, options);
    document.addEventListener('touchcancel', updateTouches, options);

    keyword.addEventListener('focus', () => {
        if (multiTouch) {
            keyword.blur();
        }
    });

    keyword.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) {
            event.preventDefault();
        }
    });

    document.addEventListener('wheel', event => {
        if (event.ctrlKey || event.target !== keyword) {
            blurKeyword();
        }
    }, options);

    byId('search-form')?.addEventListener('submit', blurKeyword);
}

/*
 * [역할 및 호출처]
 * - 역할: 모바일 좌측 상단 도구 서랍(`#mobile-menu-drawer`)의 열림·닫힘 상태를 전환함
 * - 호출처: `app.js` (`#mobile-menu-btn` 클릭, `Escape` 키), `initRadius()`, `syncMobileMenuPlacement()`
 */
export function toggleMobileMenu(forceValue) {
    const drawer = byId('mobile-menu-drawer');
    const btn = byId('mobile-menu-btn');
    if (!drawer || !btn) {
        return;
    }
    state.mobileMenuOpen = typeof forceValue === 'boolean' ? forceValue : !state.mobileMenuOpen;
    drawer.hidden = !state.mobileMenuOpen;
    btn.setAttribute('aria-expanded', String(state.mobileMenuOpen));
    btn.setAttribute('aria-label', state.mobileMenuOpen ? '지도 도구 메뉴 닫기' : '지도 도구 메뉴 열기');
    if (!state.mobileMenuOpen) {
        closeRadius();
    }
}

/*
 * [역할 및 호출처]
 * - 역할: 최신 `Element.moveBefore` API(미지원 시 `insertBefore`/`appendChild`)로 포커스·상태 손실 없이 DOM 노드를 옮김
 * - 호출처: `syncMobileMenuPlacement()`
 */
function moveElementPreservingState(parent, child, referenceNode = null) {
    if (!parent || !child) {
        return;
    }
    if (typeof parent.moveBefore === 'function' && parent.isConnected && child.isConnected) {
        try {
            parent.moveBefore(child, referenceNode);
            return;
        } catch (moveErr) {
            void moveErr;
        }
    }
    if (referenceNode) {
        parent.insertBefore(child, referenceNode);
    } else {
        parent.appendChild(child);
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 뷰포트 폭 `640px` 이하에서는 `#map-actions` 툴바를 좌측 상단 모바일 서랍으로 옮기고, 데스크톱에서는 검색 패널 헤더로 복귀시킴
 * - 호출처: `app.js` (`init`, `window` `resize` 리스너)
 */
export function syncMobileMenuPlacement() {
    const mapActions = byId('map-actions');
    const mobileDrawer = byId('mobile-menu-drawer');
    const searchHeading = byId('search-panel-heading');
    const searchToggle = byId('search-toggle');
    if (!mapActions || !mobileDrawer || !searchHeading) {
        return;
    }

    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    if (isMobile) {
        if (mapActions.parentElement !== mobileDrawer) {
            moveElementPreservingState(mobileDrawer, mapActions, null);
        }
    } else {
        if (mapActions.parentElement !== searchHeading) {
            moveElementPreservingState(searchHeading, mapActions, searchToggle || null);
        }
        if (state.mobileMenuOpen) {
            toggleMobileMenu(false);
        }
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 다크·라이트 테마 상태에 맞춰 `<html>`·`<body>`·`<meta>`·아이콘을 일괄 전환하고 지도를 새 스타일로 재마운트함
 * - 호출처: `initThemeToggle()`
 */
function applyTheme(isDark, remountMap = true) {
    state.darkMode = Boolean(isDark);
    const themeValue = state.darkMode ? 'dark' : 'light';

    document.documentElement.dataset.theme = themeValue;
    document.documentElement.classList.toggle('dark-mode', state.darkMode);
    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) {
        colorSchemeMeta.content = themeValue;
    }
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.content = state.darkMode ? '#0f172a' : '#f6f8fc';
    }

    document.body.classList.toggle('dark-mode', state.darkMode);
    document.body.dataset.theme = themeValue;

    const toggleBtn = byId('theme-toggle');
    const moonIcon = byId('theme-icon-moon');
    const sunIcon = byId('theme-icon-sun');

    if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', String(state.darkMode));
        const label = state.darkMode
            ? '라이트 모드로 전환 (현재 다크 모드)'
            : '다크 모드로 전환 (현재 라이트 모드)';
        toggleBtn.setAttribute('aria-label', label);
        toggleBtn.title = state.darkMode ? '라이트 모드로 전환' : '다크 모드로 전환';
    }

    if (moonIcon && sunIcon) {
        moonIcon.hidden = !state.darkMode;
        sunIcon.hidden = state.darkMode;
    }

    if (remountMap && state.map) {
        state.diagnostics.themeSwitchCount += 1;
        mountNaverMap();
    }
}

/*
 * [역할 및 호출처]
 * - 역할: 저장된 테마(`yonsei119-theme`)를 읽고 `#theme-toggle` 버튼 클릭 시 다크·라이트 전환 및 저장을 수행함
 * - 호출처: `app.js:init()`
 */
export function initThemeToggle() {
    let initialDark = true;
    try {
        const saved = localStorage.getItem('yonsei119-theme');
        if (saved === 'light') {
            initialDark = false;
        } else if (saved === 'dark') {
            initialDark = true;
        }
    } catch (err) {
        void err;
    }
    applyTheme(initialDark, false);
    byId('theme-toggle')?.addEventListener('click', () => {
        const nextDark = !state.darkMode;
        try {
            localStorage.setItem('yonsei119-theme', nextDark ? 'dark' : 'light');
        } catch (err) {
            void err;
        }
        applyTheme(nextDark, true);
    });
}

/*
 * [역할 및 호출처]
 * - 역할: HTTPS 또는 로컬호스트 보안 출처에서 페이지 로드 완료 후 `/sw.js` PWA 서비스 워커를 백그라운드 등록함
 * - 호출처: `app.js:init()`
 */
export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }
    const isSecure = window.location.protocol === 'https:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
    if (!isSecure) {
        return;
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(swErr => {
            void swErr;
        });
    }, { once: true });
}

/*
 * [역할 및 호출처]
 * - 역할: 시연용 쿼리(`?preview=radius|detail|cluster`) 접속 시 해당 UI 화면을 자동으로 열어 보여 줌
 * - 호출처: `app.js:init()`
 */
export function handlePreviewMode(mode) {
    if (mode === 'notice') {
        return;
    }

    byId('notice-dialog')?.close();

    if (mode === 'radius') {
        setTimeout(() => {
            byId('radius-button')?.click();
        }, 1500);
    } else if (mode === 'detail' || mode === 'hospital') {
        const checkAndOpen = setInterval(() => {
            if (state.hospitals.length > 0) {
                clearInterval(checkAndOpen);
                const target = state.hospitals.find(h => h.regional || h.type?.group === 'tertiary') || state.hospitals[0];
                openHospital(target);
            }
        }, 300);
        setTimeout(() => clearInterval(checkAndOpen), 12000);
    } else if (mode === 'cluster') {
        const checkAndCluster = setInterval(() => {
            if (state.hospitals.length > 2) {
                clearInterval(checkAndCluster);
                openCluster(state.hospitals.slice(0, 3));
            }
        }, 300);
        setTimeout(() => clearInterval(checkAndCluster), 12000);
    }
}
