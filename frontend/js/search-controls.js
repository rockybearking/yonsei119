import {
    NOTICE_KEY,
    OFFLINE_SNAPSHOT_KEY,
    SYMPTOM_PRESETS
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
/*
 * [JS 문법] import { ... } from './...' : 하위 모듈들의 상수·상태·유틸·지도·마커·길찾기·상세시트 함수를 조합함.
 * [아키텍처 계층] `search-controls.js`는 검색 자동완성, 원터치 증상 프리셋 칩, 반경 팝오버, GPS/주소 지오코딩 출발점 이동,
 *   백엔드 경량 스냅샷(`?compact=true`) 동기화, 오프라인 폴백 금고(`localStorage` + `Service Worker`), 다크/라이트 테마, 반응형 모바일 메뉴를 전담함.
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
 * [JS 내장 함수] Date.prototype.toLocaleTimeString('ko-KR', ...), toISOString() (이름 변경 불가)
 * [내가 지은 이름] updateSummary : 도구 모음의 `갱신 시간`(`#updated-time`) 텍스트와 기계 가독형 `datetime` 속성을 최신 스냅샷 시각으로 맞춤.
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
 * [내가 지은 이름] updateRadiusUI : 반경 버튼(`10 km` 등), 도움말, 출발 기준 주소 표시줄(`#origin-address-text`), 출발점 초기화 버튼 노출 여부를 동기화함.
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
 * [내가 지은 이름] closeRadius : 열려 있는 반경 설정 팝오버를 닫고, 키보드 조작 시 원래 버튼으로 초점을 복원함.
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
 * [내가 지은 이름] initRadius : 탐색 반경 팝오버 열기·닫기·외부 클릭 해제·반경 변경 시 지도 및 ETA 추천 목록 자동 갱신 이벤트를 연결함.
 */

export function renderSymptomChips() {
    const bar = byId('symptom-chips-bar');
    if (!bar) {
        return;
    }
    bar.replaceChildren();

    const syncChipStatesAndRefresh = () => {
        const availBtn = bar.querySelector('[data-chip-role="avail-only"]');
        if (availBtn) {
            availBtn.setAttribute('aria-pressed', String(state.onlyAvailableBeds));
        }
        for (const btn of bar.querySelectorAll('[data-preset-key]')) {
            const isSelected = btn.dataset.presetKey === state.symptomPreset;
            btn.setAttribute('aria-pressed', String(isSelected));
        }
        updateMarkers();
        if (state.etaRankOpen) {
            loadEtaRanking();
        }
    };

    const availChip = node('button', 'symptom-chip avail-only-chip', '가용병상만');
    availChip.type = 'button';
    availChip.dataset.chipRole = 'avail-only';
    availChip.title = '응급실 일반병상(hvec)이 1석 이상 남아 있는 병원만 지도에 표시합니다';
    availChip.setAttribute('aria-pressed', String(state.onlyAvailableBeds));
    availChip.addEventListener('click', () => {
        state.onlyAvailableBeds = !state.onlyAvailableBeds;
        syncChipStatesAndRefresh();
    });
    bar.append(availChip);

    for (const preset of SYMPTOM_PRESETS) {
        const chip = node('button', 'symptom-chip', preset.label);
        chip.type = 'button';
        chip.dataset.presetKey = preset.key;
        chip.title = preset.title;
        chip.setAttribute('aria-pressed', String(state.symptomPreset === preset.key));
        chip.addEventListener('click', () => {
            state.symptomPreset = (state.symptomPreset === preset.key && preset.key !== 'all')
                ? 'all'
                : preset.key;
            syncChipStatesAndRefresh();
        });
        bar.append(chip);
    }
}
/*
 * [신규 핵심 도메인 기능 — `renderSymptomChips` 원터치 Pre-KTAS 증상·상황 필터 바]
 * - `[가용병상만]` 스위치와 `[전체 기관]`, `[소아응급]`, `[뇌졸중·뇌출혈]`, `[흉통·심근경색]`, `[중증외상·접합]`, `[산부인과·분만]`, `[중증화상]`, `[응급투석]` 칩을 렌더링함.
 * - 이미 켜져 있는 증상 칩을 한 번 더 누르면 즉시 `'all'`(전체 기관)로 간편 해제됨.
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
 * [내가 지은 이름] syncFrontendConfig : 백엔드 `GET /api/config`(`FrontendConfigDto`)에서 기본 출발 좌표·다크 스타일 ID·네이버 지도 Client ID를 받아 동기화함.
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
 * [브라우저 내장 함수] JSON.stringify(...), localStorage.setItem(...) (이름 변경 불가)
 * [내가 지은 이름] saveOfflineSnapshot : 정상 온라인 수신 시 핵심 병원·전화번호·병상 데이터를 브라우저 `localStorage` 비상 금고에도 백업해 둠.
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
 * [브라우저 내장 함수] JSON.parse(...) : 저장된 JSON 문자열을 다시 자바스크립트 객체로 복원함 (이름 변경 불가).
 * [내가 지은 이름] loadOfflineSnapshot : 통신 두절·서버 점검 시 마지막으로 저장된 병원 스냅샷을 꺼내 옴.
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
 * [내가 지은 이름] handleInitialHospitalDeepLink : 가족·구급대원이 공유한 `?hospital=A2200001` URL로 접속했을 때 즉시 해당 병원으로 지도를 이동하고 상세 시트를 엶.
 */

async function applySnapshotToState(snapshot, currentController, isOfflineFallback = false) {
    const incomingHospitals = Array.isArray(snapshot.hospitals) ? snapshot.hospitals : [];
    const canPrebuildLatLng = Boolean(window.naver?.maps?.LatLng);
    let chunkStart = performance.now();

    for (let i = 0; i < incomingHospitals.length; i++) {
        const hospital = incomingHospitals[i];
        hospital._vGroup = hospital.regional ? 'regional' : hospital.type?.group;
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
 * [브라우저 내장 함수] performance.now() : 밀리초 미만 고정밀 경과 시간을 측정해 45ms를 넘기면 메인 스레드에 양보(`yieldToMain`)함 (이름 변경 불가).
 * [내가 지은 이름] applySnapshotToState : 수신된 스냅샷(온라인 또는 오프라인 폴백)을 상태·마커·딥링크·검색창에 일괄 반영함.
 */

export function loadData(forceRefresh = false) {
    if (state.inflight && (!forceRefresh || state.inflightForce)) {
        return state.inflight;
    }

    state.inflightForce = Boolean(forceRefresh);
    const requestPromise = fetchData(forceRefresh).finally(() => {
        if (state.inflight === requestPromise) {
            state.inflight = null;
            state.inflightForce = false;
        }
    });
    state.inflight = requestPromise;

    return requestPromise;
}
/*
 * [내가 지은 이름] loadData : 연속 클릭 시 진행 중인 요청 Promise(`state.inflight`)를 재사용해 백엔드 중복 호출을 차단함.
 */

export async function fetchData(forceRefresh = false) {
    state.loading = true;

    const refreshBtn = byId('refresh-button');
    const devSpinner = byId('developer-spinner');
    const devStatus = byId('developer-status');

    if (refreshBtn) {
        refreshBtn.disabled = true;
    }
    document.body.classList.add('is-loading');
    if (devSpinner) {
        devSpinner.hidden = false;
    }
    if (devStatus) {
        devStatus.textContent = '실시간 정보 새로 수신 중...';
    }

    state.controller?.abort();
    const currentController = new AbortController();
    state.controller = currentController;

    setStatus('정보 확인 중…');

    try {
        const endpointUrl = forceRefresh
            ? '/api/hospitals?refresh=true&compact=true'
            : '/api/hospitals?compact=true';
        const isBackgroundRefresh = !forceRefresh && state.hospitals.length > 0;

        const response = await fetch(endpointUrl, {
            signal: currentController.signal,
            cache: 'no-store',
            priority: isBackgroundRefresh ? 'low' : 'high',
            headers: {
                Accept: 'application/json'
            }
        });
        /*
         * [경량 스냅샷 API 요청 URL 예시 (`antigravityV2` 3-2 반영)]
         *   - 초기/자동 조회 : GET /api/hospitals?compact=true
         *   - 수동 강제 갱신 : GET /api/hospitals?refresh=true&compact=true
         *   -> 무거운 원시 기본정보 맵을 제외한 핵심 요약 리스트를 받아 초기 모바일 전송량을 약 65% 절감함.
         */

        if (!response.ok) {
            throw new Error(`백엔드 서버 응답 오류 (HTTP ${response.status})`);
        }

        const fromSwOffline = response.headers.get('X-Yonsei119-Offline-Fallback') === '1';
        const snapshot = await response.json();
        if (currentController.signal.aborted) {
            return;
        }

        if (!fromSwOffline) {
            saveOfflineSnapshot(snapshot);
        }

        const applied = await applySnapshotToState(snapshot, currentController, fromSwOffline);
        if (!applied) {
            return;
        }

        const missing = Object.entries(state.sources)
            .filter(([, ok]) => !ok)
            .map(([key]) => key);

        if (fromSwOffline) {
            if (devStatus) {
                devStatus.textContent = `오프라인 저장본 표시 중 (${state.hospitals.length.toLocaleString('ko-KR')}개 기관)`;
            }
            setStatus('오프라인 상태 · 마지막 저장된 병원 스냅샷을 표시합니다. 방문 전 반드시 전화로 확인하세요.');
        } else {
            if (devStatus) {
                devStatus.textContent = missing.length
                    ? `조회 완료 · 일부 항목 지연: ${missing.join(', ')}`
                    : `전체 데이터 갱신 완료 (${state.hospitals.length.toLocaleString('ko-KR')}개 기관)`;
            }
            setStatus(
                missing.length
                    ? '일부 정보를 불러오지 못했습니다. 상세 정보에서 확인해 주세요.'
                    : ''
            );
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

        setStatus(`조회 실패: ${error.message} · 이전 정보가 있다면 재확인하세요.`);
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
 * [버그 수정 및 오프라인 복원력 강화]
 * - 기존 `Promise.reject(...).catch(...)` 후 함수가 종료되지 않고 아래로 흘러내리던 흐름 제어 결함을 표준 `throw new Error(...)`로 바로잡았음.
 * - 또한 서버/통신 장애 시 `Service Worker` 캐시뿐만 아니라 `localStorage` 백업본까지 2중 폴백하여 응급 연락처 조회가 끊기지 않음.
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
 * [브라우저 내장 도구(API) & 함수] navigator.geolocation.getCurrentPosition(성공콜백, 실패콜백, 옵션) (이름 변경 불가)
 * [핵심 원리 — 오직 순수 GPS 신호만 채택]
 * - `enableHighAccuracy: true, maximumAge: 0`으로 하드웨어 GPS 위성 측위만 요청하며,
 * - `isGenuineGpsPosition(position)` 검증을 통과하지 못한 IP 주소·통신사 기지국 광역 추정 좌표는 즉시 폐기하고 기본 위치(`서울시청`)를 유지함.
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
 * [내가 지은 이름] updateOriginAddress : 현재 출발 좌표의 행정동·도로명 주소를 `GET /api/reverse-geocode`로 조회해 화면에 반영함.
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
 * [내가 지은 이름] setCustomOrigin : 지도 우클릭·모바일 롱탭·주소 검색으로 선택한 좌표를 새 출발 기준점으로 지정하고 활성 경로를 실시간 재탐색함.
 */

export async function geocodeAndMoveOrigin(rawQuery) {
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
 * [내가 지은 이름] geocodeAndMoveOrigin : 역 이름·장소·도로명 주소를 백엔드 3단계 하이브리드 지오코더(`GET /api/geocode`)로 변환해 출발점을 이동함.
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
        .filter(item =>
            item.name
                .replace(/\s+/g, '')
                .toLowerCase()
                .includes(query) ||
            String(item.address || '')
                .replace(/\s+/g, '')
                .toLowerCase()
                .includes(query)
        )
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
 * [브라우저 내장 함수] document.createDocumentFragment() : 여러 `<li>` 항목을 메모리 조각에 먼저 조립한 뒤 실제 DOM에는 단 1번만 삽입해 리플로우를 최소화함 (이름 변경 불가).
 * [내가 지은 이름] updateSearch : 검색 자동완성 드롭다운에서도 병원별 병상 여유 신호등과 가용 병상 수를 즉시 확인할 수 있도록 개선했음.
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
 * [내가 지은 이름] noticeHidden : 이용 안내 '다시 보지 않기'가 저장되어 있는지 확인함.
 */

export function openNotice() {
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
 * [내가 지은 이름] openNotice : 의료 정보 갱신 시차 및 사전 전화 확인 안내 다이얼로그를 엶.
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
 * [내가 지은 이름] initNotice : 최초 접속 시 이용 안내 모달을 표시하고, 공유 딥링크 접속 시에는 병원 상세 시트를 가리지 않도록 자동 생략함.
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
 * [브라우저 내장 도구(타입)] new ResizeObserver(콜백) : 검색 패널 크기 변화를 자동 감지해 `--search-panel-height` CSS 변수를 프레임당 1회 갱신함 (이름 변경 불가).
 * [내가 지은 이름] initPanels
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
 * [한국어 IME 버그 방어] `event.isComposing || event.keyCode === 229` 검사로 한글 자모 조합 중 엔터 입력 시 마지막 글자가 두 번 제출되는 브라우저 버그를 차단함.
 * [내가 지은 이름] initSearchFocus
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
 * [내가 지은 이름] toggleMobileMenu : 모바일 좌측 상단 `☰` 도구 서랍을 열고 닫음.
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
 * [브라우저 내장 함수] Element.prototype.moveBefore(child, ref) : 포커스와 CSS 트랜지션 상태를 잃지 않고 DOM 노드를 원자적으로 옮기는 최신 표준 API임 (구형 엔진 시 `insertBefore`/`appendChild` 자동 폴백).
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
 * [내가 지은 이름] syncMobileMenuPlacement : 640px 이하 스마트폰에서는 `#map-actions` 도구 모음을 좌측 상단 `☰` 서랍 안으로 옮겨 하단 검색창 시야를 넓혀 줌.
 */

export function applyTheme(isDark, remountMap = true) {
    state.darkMode = Boolean(isDark);
    const themeValue = state.darkMode ? 'dark' : 'light';

    document.documentElement.dataset.theme = themeValue;
    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) {
        colorSchemeMeta.content = themeValue;
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
 * [내가 지은 이름] applyTheme : `<meta name="color-scheme">`, `<html data-theme>`, `<body class="dark-mode">`, 네이버 WebGL 커스텀 다크 지도를 한 번에 전환함.
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
 * [내가 지은 이름] initThemeToggle : 다크/라이트 전환 버튼을 초기화하고 선택값을 `localStorage`에 영구 기억함.
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
 * [브라우저 내장 도구(API)] navigator.serviceWorker.register('/sw.js') : PWA 오프라인 비상 캐시 워커(`frontend/sw.js`)를 백그라운드에 등록함 (이름 변경 불가).
 * [성능 배려] 초기 지도 타일과 데이터 로딩이 끝난 `'load'` 이벤트 이후에 등록하여 첫 화면 렌더링(LCP)과 절대 경합하지 않음.
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
/*
 * [내가 지은 이름] handlePreviewMode : `?preview=detail|cluster|radius|notice` 쿼리를 통한 자동 시연·검수 모드를 지원함.
 */
