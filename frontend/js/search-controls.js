import {
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
/*
 * [JS 문법]
 * - import { ... } from './모듈.js' : 다른 ES 모듈의 상수·상태·함수를 가져오는 정적 구문임.
 * - 브라우저 ES 모듈에서는 상대 경로(./)와 .js 확장자를 반드시 함께 적어야 함.
 *
 * [가져오는 모듈 및 역할]
 * - constants.js : NOTICE_KEY, OFFLINE_SNAPSHOT_KEY, SYMPTOM_PRESETS 상수.
 * - state.js : DEFAULT_ORIGIN 기본 좌표, 전역 공유 state 객체.
 * - utils.js : byId, node, setStatus, bedValue, getBedTrafficInfo 등 공통 도우미.
 * - utils.js : blurKeyword, getOriginDisplayLabel, installDialogLightDismiss, yieldToMain.
 * - utils.js : isGenuineGpsPosition(GPS 정밀도 검증 함수).
 * - map-engine.js : ensureNaverMapSdkLoaded, mountNaverMap, fitRadius, focusHospitalOnMap.
 * - map-engine.js : getHospitalLatLng, updateCircle, updateLocationMarker.
 * - markers-cluster.js : openCluster, updateMarkers (클러스터 모달·마커 갱신).
 * - directions-eta.js : loadDirectionsForHospital, loadEtaRanking, populateWaypointSelect.
 * - directions-eta.js : refreshActiveRoute (활성 경로 재조회).
 * - hospital-sheet.js : openHospital, closeSheet (병원 상세 시트 열기·닫기).
 *
 * [아키텍처 계층]
 * - 상단 검색·반경·증상 필터·테마·모바일 메뉴 등 UI 컨트롤 전반을 담당함.
 * - 백엔드 설정·병원 스냅샷 조회, 오프라인 이중 폴백, GPS·지오코딩 출발점 변경을 처리함.
 *
 * [동작 흐름]
 * - app.js 초기화·이벤트 -> search-controls.js 함수 호출 -> state 갱신 -> 지도·마커·시트 반영.
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
 * [JS 문법]
 * - export function : 외부 모듈에서 import해 호출할 수 있는 공개 함수 선언임.
 * - 삼항 연산자(? :) : 갱신 시각 존재 여부에 따라 시:분 문자열 또는 '확인 중' 선택함.
 *
 * [브라우저 및 JS 표준 내장 API]
 * - Date.prototype.toLocaleTimeString(locale, options) : 날짜를 지정 시간대 문자열로 변환함.
 * - Date.prototype.toISOString() : 날짜를 UTC 기준 ISO-8601 표준 문자열로 변환함.
 * - HTMLElement.textContent : 태그 해석 없이 요소의 표시 텍스트를 안전하게 변경함.
 * - HTMLTimeElement.dateTime : <time> 요소의 기계 판독용 표준 시각 속성을 설정함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·변수 : updateSummary(), time(#updated-time 요소).
 * - 참조 함수·상태 : byId(), state.lastUpdated.
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init() -> 초기 대기 표시 / applySnapshotToState() -> 적재 직후 갱신.
 * - 실행 단계 :
 *   1) byId('updated-time') 조회 -> 요소 없으면 즉시 반환
 *   2) state.lastUpdated 있음 -> KST(Asia/Seoul) 24시간 HH:MM 텍스트 및 dateTime 설정
 *   3) state.lastUpdated 없음 -> '확인 중' 텍스트만 표시
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
 * [JS 문법]
 * - export function, const, 엄격 동등 비교(===), 삼항 연산자(? :), 템플릿 리터럴(`${...}`).
 *
 * [브라우저 및 JS 표준 내장 API]
 * - HTMLSelectElement.value : <select> 요소의 현재 선택된 옵션 문자열을 읽음.
 * - Element.setAttribute(name, value) : aria-label 등 접근성 속성을 문자열로 갱신함.
 * - HTMLElement.textContent / title / hidden : 표시 문구, 툴팁, 숨김 여부를 제어함.
 * - Number.prototype.toFixed(digits) : 실수를 지정 소수점 자리수 문자열로 반올림함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·변수 : updateRadiusUI(), radiusSelect, value, label, originDesc.
 * - DOM 요소 : #radius, #radius-value, #radius-button, #radius-help, #origin-address-text.
 * - 참조 함수·상태 : byId(), getOriginDisplayLabel(), state.origin, state.locationKnown.
 *
 * [동작 흐름]
 * - 호출 출처 : initRadius(), syncFrontendConfig(), locate(), setCustomOrigin(), app.js.
 *   └── directions-eta.js resetOriginAndRoute() (uiCallbacks.onUpdateRadiusUI 경유).
 * - 실행 단계 :
 *   1) #radius 선택값('all' 또는 km) -> 반경 버튼 라벨·도움말 문구 갱신
 *   2) getOriginDisplayLabel() + 좌표 -> #origin-address-text 문구 및 툴팁 갱신
 *   3) !state.locationKnown 여부 -> #origin-reset-btn 숨김 상태 전환
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
 * [JS 문법]
 * - 기본값 매개변수(restoreFocus = false) : 인자 생략 시 포커스 복원을 건너뜀.
 * - 논리합(||), 논리 부정(`!`)으로 두 DOM 요소가 모두 있을 때만 닫기를 수행함.
 *
 * [브라우저 표준 내장 API]
 * - HTMLElement.hidden : 요소를 화면과 접근성 트리에서 숨기는 불리언 속성임.
 * - Element.setAttribute('aria-expanded', 'false') : 팝오버가 접힌 상태임을 알림.
 * - HTMLElement.focus() : 키보드 초점을 지정한 제어 요소로 이동시킴.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수·변수 : closeRadius(restoreFocus), popover(#radius-popover), btn(#radius-button).
 * - 참조 함수 : byId().
 *
 * [동작 흐름]
 * - 호출 출처 : initRadius(), updateSearch(), toggleMobileMenu(), app.js Escape 핸들러.
 *   └── hospital-sheet.js openHospital() (uiCallbacks.onCloseRadius 경유).
 * - 실행 단계 :
 *   1) #radius-popover 숨김 처리 -> #radius-button aria-expanded='false' 설정
 *   2) restoreFocus === true -> #radius-button으로 키보드 초점 복원
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
 * [JS 문법]
 * - 화살표 함수(() => ...), 옵셔널 체이닝(?.), 논리합(||), 논리곱(&&), 엄격 비교(===).
 *
 * [브라우저 표준 내장 API]
 * - EventTarget.addEventListener(type, fn) : click·change·pointerdown·focusin·keydown 등록함.
 * - Element.closest(selector) : 이벤트 대상에서 조상 방향으로 선택자 일치 요소를 찾음.
 * - Event.preventDefault() / Event.stopPropagation() : 기본 동작과 상위 전파를 막음.
 * - KeyboardEvent.key : 눌린 키 문자열('Escape' 등)을 확인하는 이벤트 속성임.
 * - Element.setAttribute() / HTMLElement.focus() / HTMLElement.hidden : 상태·초점·표시 제어함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : initRadius(), button(#radius-button), panel(#radius-popover), results.
 * - 참조 함수·상태 : byId(), closeRadius(), updateRadiusUI(), fitRadius(), updateMarkers().
 * - 참조 함수·상태 : loadEtaRanking(), toggleMobileMenu(), state.etaRankOpen, state.mobileMenuOpen.
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init() 초기화 단계에서 1회 호출됨.
 * - 실행 단계 :
 *   ├── #radius-button 'click' -> #search-results 숨김 -> #radius-popover 토글 및 #radius 초점 이동
 *   ├── #radius-close 'click' -> closeRadius(true)로 팝오버 닫고 #radius-button 초점 복원
 *   ├── #radius 'change' -> updateRadiusUI() -> fitRadius() -> updateMarkers() -> ETA 재조회
 *   ├── document 'pointerdown' -> 외부 클릭 시 반경 팝오버·모바일 메뉴·검색 드롭다운 닫기
 *   ├── document 'focusin' -> .radius-tool 외부 초점 이동 시 closeRadius()
 *   └── panel(#radius-popover) 'keydown'(Escape) -> preventDefault()·stopPropagation() -> closeRadius(true)
 */

export async function syncFrontendConfig() {
    try {
        const response = await fetch('/api/config', {
            priority: 'low',
            headers: { Accept: 'application/json' }
        });
        /*
         * [브라우저 표준 내장 API]
         * - fetch(url, options) : 비동기 HTTP 요청을 전송해 Response Promise를 반환함.
         * - priority: 'low' : 초기 핵심 데이터 요청보다 낮은 네트워크 우선순위를 지정함.
         * - headers: { Accept: 'application/json' } : 서버에 JSON 형식 응답을 요청함.
         *
         * [연동 백엔드 API]
         * - 컨트롤러 : EmergencyApiController (@RequestMapping("/api") + @GetMapping("/config"))
         * - URL 구조도 :
         *   GET /api/config
         *     ├── 경로 접두사 : @RequestMapping("/api")
         *     ├── 메서드 매핑 : @GetMapping("/config") -> getConfig() (파라미터 없음)
         *     └── 요청 헤더   : Accept: application/json
         * - 응답 DTO : FrontendConfigDto
         *   · 필드 : { naverClientId, naverDarkStyleId, defaultLat, defaultLng, defaultLabel }
         *   · 보안 : naver.clientSecret 비밀키는 응답에서 제외됨.
         *
         * [동작 흐름]
         * - 요청 -> EmergencyApiController.getConfig() -> FrontendConfigDto JSON 반환
         *   └── response.ok && response.json() -> 기본 출발 좌표·다크 스타일·SDK 키 동기화
         */
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
 * [JS 문법]
 * - export async function, await : 비동기 fetch와 SDK 동적 로드를 순서대로 기다림.
 * - try { ... } catch (cfgErr), void cfgErr : 설정 조회 실패 시 기본 설정으로 계속 실행함.
 * - 옵셔널 체이닝(window.naver?.maps) : SDK 미로드 상태에서 속성 접근 오류를 방지함.
 *
 * [브라우저 및 JS 표준 내장 API]
 * - fetch() / Response.ok / Response.json() : HTTP GET 요청, 2xx 확인, JSON 파싱 API임.
 * - Number.isFinite(value) : 값이 NaN·Infinity가 아닌 유한 실수인지 검사함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : syncFrontendConfig(), response, cfg, needMapRemount, loaded, cfgErr.
 * - 참조 상수·상태 : DEFAULT_ORIGIN, state.locationKnown, state.origin, state.originLabel.
 * - 참조 상태·함수 : state.naverDarkStyleId, state.naverClientId, state.darkMode.
 * - 참조 함수 : updateRadiusUI(), updateCircle(), updateMarkers(), ensureNaverMapSdkLoaded().
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init()에서 지도 1차 마운트 직후 비동기로 호출됨.
 * - 실행 단계 :
 *   1) GET /api/config -> !response.ok면 즉시 반환
 *   2) defaultLat·defaultLng·defaultLabel -> DEFAULT_ORIGIN 갱신
 *      └── !state.locationKnown -> state.origin·UI·반경 원·마커까지 동기화
 *   3) naverDarkStyleId·naverClientId 변경 확인 -> 필요 시 SDK 로드 후 mountNaverMap() 재실행
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
 * [JS 문법]
 * - 비공개 function 선언, try / catch / void quotaErr(저장 용량 초과·차단 예외 무시).
 * - 화살표 함수(h => ({ ... })) : 괄호로 감싸 객체 리터럴을 즉시 반환함.
 *
 * [브라우저 및 JS 표준 내장 API]
 * - Date.prototype.toISOString() : 현재 시각을 UTC ISO-8601 문자열로 생성함.
 * - Array.prototype.map(fn) : 배열 각 원소를 변환해 같은 길이의 새 배열을 만듦.
 * - JSON.stringify(value) : JS 객체를 저장용 JSON 문자열로 직렬화함.
 * - localStorage.setItem(key, value) : 브라우저 영구 저장소에 키-값 문자열을 저장함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수·변수 : saveOfflineSnapshot(snapshot), compactBackup, h, quotaErr.
 * - 참조 상수 : OFFLINE_SNAPSHOT_KEY (constants.js에 정의된 로컬 저장소 키).
 *
 * [동작 흐름]
 * - 호출 출처 : fetchData() -> Service Worker 폴백이 아닌 정상 온라인 응답 수신 시 호출됨.
 * - 실행 단계 :
 *   1) 병원 목록에서 오프라인 조회용 핵심 13개 필드만 선별 -> compactBackup 객체 구성
 *   2) JSON.stringify() 직렬화 -> localStorage(OFFLINE_SNAPSHOT_KEY)에 비상 백업 저장
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
 * [JS 문법]
 * - try / catch / void parseErr : 저장소 접근 차단이나 손상 JSON 파싱 오류 시 null 반환함.
 *
 * [브라우저 및 JS 표준 내장 API]
 * - localStorage.getItem(key) : 브라우저 로컬 저장소에서 키에 해당하는 문자열을 읽음.
 * - JSON.parse(text) : JSON 문자열을 JS 객체로 역직렬화함.
 * - Array.isArray(value) : 대상 값이 유효한 배열인지 판별하는 정적 메서드임.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : loadOfflineSnapshot(), raw, parsed, parseErr.
 * - 참조 상수 : OFFLINE_SNAPSHOT_KEY (constants.js 정의).
 *
 * [동작 흐름]
 * - 호출 출처 : fetchData() catch 블록 -> 네트워크 실패 및 메모리 병원 목록 공백 시 호출됨.
 * - 실행 단계 :
 *   1) localStorage 조회 -> 데이터 없으면 null 반환
 *   2) JSON.parse() -> hospitals 배열 길이 > 0 확인 -> 유효하면 parsed, 아니면 null 반환
 *   3) 반환값 -> fetchData()에서 applySnapshotToState(..., true)로 화면 복원
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
 * [JS 문법]
 * - 논리합(||), 논리 부정(`!`), 옵셔널 체이닝(?.), 템플릿 리터럴, 조기 return.
 *
 * [브라우저 및 JS 표준 내장 API]
 * - URLSearchParams(window.location.search) : 현재 URL의 쿼리스트링을 파싱함.
 * - URLSearchParams.prototype.get(name) : 지정한 쿼리 파라미터 값을 조회함.
 * - String.prototype.trim() / toUpperCase() : 앞뒤 공백 제거 및 대문자 정규화를 수행함.
 * - Array.prototype.find(fn) : 조건을 만족하는 첫 번째 배열 원소를 검색함.
 * - HTMLDialogElement.prototype.close() : 열려 있는 <dialog> 모달을 닫음.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : handleInitialHospitalDeepLink(), params, requestedId, upperId, matched.
 * - 참조 상태·함수 : state.initialDeepLinkHandled, state.hospitals, byId(), setStatus().
 * - 참조 함수 : openHospital(), focusHospitalOnMap(), updateMarkers().
 *
 * [동작 흐름]
 * - 호출 출처 : applySnapshotToState() -> 병원 스냅샷 적재 직후 1회 실행됨.
 * - 실행 단계 :
 *   1) URL 쿼리 ?hospital= 또는 ?hpid= 추출 -> 미지정 시 플래그 설정 후 종료
 *   2) state.hospitals에서 대소문자 무관 검색 -> 미발견 시 setStatus() 안내 후 종료
 *   3) 일치 병원 발견 -> #notice-dialog 닫기 -> openHospital() -> focusHospitalOnMap(15) -> 마커 갱신
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
 * [JS 문법]
 * - async function, await, 기본값 매개변수(isOfflineFallback = false), 옵셔널 체이닝(?.).
 * - 비트 AND((i & 63) === 63) : 64개마다 한 번씩만 경과 시간을 확인해 성능 부담을 줄임.
 *
 * [브라우저 및 JS 표준 내장 API]
 * - Array.isArray(value) / Boolean(value) / Number.isFinite(value) : 타입·유한수 검증함.
 * - performance.now() : 고정밀 경과 시간(ms)을 측정해 45ms 초과 시 작업 분할에 사용함.
 * - Map.prototype.clear() : Map 객체에 캐시된 모든 키-값 항목을 비움.
 * - new Date() / Array.prototype.find(fn) : 시각 객체 생성 및 선택 항목 최신 객체 탐색함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수 : applySnapshotToState(snapshot, currentController, isOfflineFallback).
 * - 지역 변수 : incomingHospitals, canPrebuildLatLng, chunkStart, i, hospital, fresh.
 * - 참조 상태·함수 : state.hospitals, state.detailCache, state.sources, state.lastUpdated.
 * - 참조 함수 : getHospitalLatLng(), yieldToMain(), fitRadius(), updateMarkers().
 * - 참조 함수 : handleInitialHospitalDeepLink(), openHospital(), closeSheet(), updateSearch(), updateSummary().
 *
 * [동작 흐름]
 * - 호출 출처 : fetchData() -> 온라인 응답·SW 폴백·localStorage 복원 직후 await 호출됨.
 * - 실행 단계 :
 *   1) 병원별 _vGroup·좌표 객체 사전 생성 (45ms 초과 시 yieldToMain -> abort 시 false 반환)
 *   2) state.hospitals·sources·lastUpdated 갱신 (온라인 수신 시 state.detailCache.clear())
 *   3) 최초 1회 fitRadius() -> updateMarkers() -> 딥링크 처리 -> 열린 시트·검색·시각 동기화 -> true 반환
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
 * [JS 문법]
 * - export function, 기본값 매개변수(forceRefresh = false), 논리곱(&&), 논리 부정(`!`), 논리합(||).
 *
 * [브라우저 및 JS 표준 내장 API]
 * - Boolean(value) : 전달값을 명확한 true 또는 false 불리언 값으로 변환함.
 * - Promise.prototype.finally(fn) : Promise 성공·실패와 무관하게 완료 후 정리 콜백 실행함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수·변수 : loadData(forceRefresh), requestPromise.
 * - 참조 상태·함수 : state.inflight, state.inflightForce, fetchData().
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init()(loadData(false)) 및 #refresh-button 클릭(loadData(true)).
 * - 실행 단계 :
 *   ├── 진행 중 요청 있고 강제 갱신 업그레이드 불필요 -> 기존 state.inflight Promise 재사용
 *   └── 새 요청 필요 -> fetchData(forceRefresh) 실행 -> state.inflight 등록
 *       └── finally() -> 완료 시 현재 요청과 일치하면 state.inflight 초기화
 */

async function parseSnapshotResponse(response) {
    if (!response.ok) {
        throw new Error(`백엔드 서버 응답 오류 (HTTP ${response.status})`);
    }
    return response.json();
}
/*
 * [JS 문법]
 * - async function : search-controls.js 내부에서 HTTP 응답 검증과 JSON 파싱을 처리하는 비동기 함수 선언임.
 * - throw new Error(...) : HTTP 상태가 정상이 아닐 때 오류 객체를 던져 호출부 catch로 전달함.
 *
 * [브라우저 및 JS 표준 내장 API]
 * - Response.ok / Response.status : HTTP 응답 성공(200~299) 여부와 상태 코드를 읽음.
 * - Response.prototype.json() : 응답 본문을 JSON 객체로 비동기 파싱하는 표준 메서드임.
 *
 * [함수명·매개변수명]
 * - parseSnapshotResponse(response) : 백엔드 스냅샷 응답 상태 확인과 JSON 변환을 분리해 처리함.
 *
 * [동작 흐름]
 * - fetchData()에서 호출 -> !response.ok 시 Error throw -> 정상이면 response.json() 반환
 */

async function fetchData(forceRefresh = false) {
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
            setStatus('');
            return;
        }
        /*
         * [브라우저 표준 내장 API]
         * - AbortController.signal : 진행 중 네트워크 요청을 중간에 취소할 수 있는 신호 객체임.
         * - fetch(url, options) : HTTP 요청을 비동기로 보내고 Response Promise를 반환함.
         * - cache: 'no-store' : 브라우저 HTTP 캐시를 쓰지 않고 매번 서버·워커에서 새로 받음.
         * - priority: 'high' | 'low' : 초기 로딩은 높게, 백그라운드 재조회는 낮게 우선순위 지정함.
         *
         * [연동 백엔드 API]
         * - 컨트롤러 : EmergencyApiController (@RequestMapping("/api") + @GetMapping("/hospitals"))
         * - 서비스 위임 : EmergencyDataService.getSnapshot(refresh, compact) (15초 쿨다운·경량 요약)
         * - 쿼리 파라미터 구조도 :
         *   1) 일반·초기 조회 (forceRefresh === false)
         *      GET /api/hospitals
         *        └── ?compact=true              (refresh 생략 시 백엔드 기본값 false 적용)
         *   2) 수동 강제 새로고침 (forceRefresh === true)
         *      GET /api/hospitals
         *        ├── ?refresh=true              (15초 쿨다운 경과 시 공공데이터 재수집 트리거)
         *        └── &compact=true              (목록 화면용 경량 스냅샷 응답 요청)
         * - 응답 DTO : EmergencySnapshotDto
         *   · 필드 : updatedAt, cached, totalCount, 5대 종별 건수, sources, endpointCounts, hospitals
         * - 오프라인 헤더 : 통신 장애 시 sw.js가 X-Yonsei119-Offline-Fallback: 1 헤더를 부착함.
         *
         * [동작 흐름]
         * - fetch(endpointUrl) -> 백엔드 스냅샷 응답 또는 sw.js 오프라인 캐시 복제본 수신
         *   └── response.headers.get('X-Yonsei119-Offline-Fallback') === '1'로 오프라인 여부 판별
         */

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
            setStatus('오프라인 상태 · 마지막 저장된 병원 스냅샷을 표시합니다. 방문 전 반드시 전화로 확인하세요.');
        } else if (allSourcesUnavailable) {
            if (devStatus) {
                devStatus.textContent =
                    '공공데이터 수집 불가 (0개 기관) · 서버 NEMC_API_SERVICE_KEY(.env) 또는 외부 API 상태를 확인하세요.';
            }
            setStatus(
                '응급의료 데이터를 불러오지 못했습니다. 로컬 실행 중이라면 프로젝트 루트의 .env API 키 설정을 확인해 주세요.'
            );
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
 * [JS 문법]
 * - try { ... } catch (error) { ... } finally { ... } : 오류 복구와 로딩 UI 해제를 분리함.
 * - 배열 구조 분해([, ok], [key]) : 키-불리언 쌍에서 필요한 값만 간단히 꺼냄.
 *
 * [브라우저 및 JS 표준 내장 API]
 * - new AbortController() / controller.abort() : 이전 요청을 취소하고 새 취소 신호를 생성함.
 * - Element.classList.add() / remove() : 로딩 애니메이션용 CSS 클래스를 추가·제거함.
 * - Response.ok / status / headers.get(name) / json() : HTTP 응답 상태·헤더·JSON을 처리함.
 * - Object.entries(obj) / Array.prototype.filter() / map() / join() : 실패 소스 키를 추림.
 * - Number.prototype.toLocaleString('ko-KR') : 숫자를 천 단위 쉼표 문자열로 변환함.
 * - Error / error.name === 'AbortError' / error.message : 예외 생성 및 취소 오류 판별임.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수 : fetchData(forceRefresh).
 * - 지역 변수 : refreshBtn, devSpinner, devStatus, currentController, endpointUrl.
 * - 지역 변수 : isBackgroundRefresh, response, fromSwOffline, snapshot, applied, missing, backup.
 * - 참조 상태·함수 : state.loading, state.controller, state.hospitals, state.sources.
 * - 참조 함수 : byId(), setStatus(), saveOfflineSnapshot(), loadOfflineSnapshot(), applySnapshotToState().
 * - 오프라인 헤더 : X-Yonsei119-Offline-Fallback (sw.js가 캐시 응답 시 '1'로 설정).
 *
 * [동작 흐름]
 * - 호출 출처 : loadData(forceRefresh)에서 호출됨.
 * - 실행 단계 :
 *   1) 버튼 비활성화·로딩 표시 -> 이전 state.controller.abort() -> 새 AbortController 생성
 *   2) /api/hospitals 요청 -> !response.ok면 Error 발생 -> 오프라인 헤더 아니면 localStorage 백업
 *   3) applySnapshotToState() 반영 -> state.sources 실패 항목·오프라인 여부별 안내 문구 표시
 *   4) catch(error) -> AbortError는 무시, 목록 공백이면 loadOfflineSnapshot() 2차 복원 시도
 *   5) finally -> state.controller === currentController일 때만 로딩 상태·버튼 복구
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
 * [JS 문법]
 * - export function, 화살표 함수(finish, 성공·실패 콜백), 삼항 연산자(? :), 옵셔널 체이닝(?.).
 *
 * [브라우저 및 네이버 지도 SDK 내장 API]
 * - navigator.geolocation.getCurrentPosition(ok, err, opts) : 단발성 현재 위치를 요청함.
 * - opts = { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 } : 고정밀·8초·캐시 미사용.
 * - GeolocationPosition.coords : latitude, longitude, accuracy(m), altitude, timestamp 제공함.
 * - GeolocationPositionError.code : 1(권한 거부), 2(위치 불가), 3(시간 초과) 오류 코드임.
 * - new Date() / Date.now() / Boolean() : 시각 생성 및 불리언 변환 표준 API임.
 * - new naver.maps.LatLng(lat, lng) / map.panTo(coord) : 지도 좌표 생성 및 중심 이동 SDK 메서드임.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : locate(), locBtn(#location-button), finish, position, error, reason.
 * - 참조 상수·상태 : DEFAULT_ORIGIN(기본 서울시청), state.locating, state.origin, state.locationKnown.
 * - 참조 상태 : state.originLabel, state.originAddress, state.locationAccuracy, state.etaRankOpen.
 * - GPS 검증 함수 : hasMobileGpsHardware()(app.js·utils.js), isGenuineGpsPosition()(utils.js).
 * - 연계 함수 : updateRadiusUI(), updateLocationMarker(), updateOriginAddress(), fitRadius().
 * - 연계 함수 : updateCircle(), updateMarkers(), loadEtaRanking(), populateWaypointSelect().
 * - 연계 함수 : loadDirectionsForHospital(), refreshActiveRoute(), setStatus().
 *
 * [동작 흐름]
 * - 호출 출처 :
 *   ├── app.js init() : hasMobileGpsHardware() && geolocation && naver.maps 모두 참일 때만 자동 실행
 *   │   (일반 PC는 자동 측위를 건너뛰고 DEFAULT_ORIGIN 서울시청을 유지함)
 *   └── 사용자 : 도구 모음 #location-button 클릭 시 수동 실행
 * - GPS-only 필터링 및 실행 단계 :
 *   1) getCurrentPosition() 고정밀 요청 -> isGenuineGpsPosition(position) 위성 신호 검증
 *      ├── 데스크톱(!hasMobileGpsHardware()) : 고도 실측(altitude !== null) && 오차 <= 50m 통과
 *      ├── 모바일 기기 : 오차 반경(accuracy) <= 100m 통과
 *      └── 검증 실패(IP·기지국 추정치) -> state.origin 폐기 방지, 기존 위치 또는 DEFAULT_ORIGIN 유지
 *   2) 검증 통과 -> state.origin('내 위치 (GPS)') 갱신 -> 마커·반경원·주소·ETA·경로 연쇄 갱신
 *   3) 권한 거부·수신 실패(error) -> 기존·기본 좌표 유지 후 finish()로 버튼 활성화
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
        /*
         * [브라우저 표준 내장 API]
         * - AbortController.signal : 이전 역지오코딩 요청을 취소해 응답 역전 덮어쓰기를 막음.
         * - new URLSearchParams(obj) / toString() : 위·경도 객체를 쿼리스트링으로 직렬화함.
         * - fetch(url, options) : 낮은 우선순위(priority: 'low')로 JSON 응답을 비동기 요청함.
         *
         * [연동 백엔드 API]
         * - 컨트롤러 : EmergencyApiController (@RequestMapping("/api") + @GetMapping("/reverse-geocode"))
         * - 서비스 위임 : NaverGeocodingService.reverseGeocode(lat, lng)
         * - 쿼리 파라미터 구조도 :
         *   GET /api/reverse-geocode
         *     ├── ?lat=<state.origin.lat>      (URLSearchParams 직렬화 필수 위도)
         *     └── &lng=<state.origin.lng>      (URLSearchParams 직렬화 필수 경도)
         * - 응답 DTO : ReverseGeocodeResponseDto
         *   · 필드 : { code, message, lat, lng, shortAddress, fullAddress, roadAddress, jibunAddress }
         *
         * [동작 흐름]
         * - URLSearchParams 직렬화 -> GET /api/reverse-geocode -> ReverseGeocodeResponseDto 수신
         *   └── data.code === 0 && 주소 존재 -> state.originAddress 저장 -> updateRadiusUI() 갱신
         */
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
 * [JS 문법]
 * - export async function, await, 옵셔널 체이닝(?.), try / catch / void err(오류 무시).
 *
 * [브라우저 및 JS 표준 내장 API]
 * - String(value) : 숫자 좌표를 쿼리 문자열 생성용 문자열로 변환함.
 * - new AbortController() / new URLSearchParams() / fetch() : 취소 가능한 요청을 전송함.
 * - Response.ok / Response.json() : HTTP 2xx 여부 확인 및 JSON 응답 본문을 파싱함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : updateOriginAddress(), controller, params, response, data, addr, err.
 * - 참조 상태·함수 : state.reverseGeocodeController, state.origin, state.originAddress, updateRadiusUI().
 *
 * [동작 흐름]
 * - 호출 출처 : locate(), setCustomOrigin(), app.js init()(PC 초기 주소 조회).
 *   └── directions-eta.js resetOriginAndRoute() (uiCallbacks.onUpdateOriginAddress 경유).
 * - 실행 단계 :
 *   1) 이전 reverseGeocodeController.abort() -> 새 요청 전송
 *   2) data.code === 0 && 유효 주소 존재 -> short·full·road·jibun 우선순위로 선택
 *   3) state.originAddress 저장 -> updateRadiusUI()로 출발 기준 표시줄 갱신
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
 * [JS 문법]
 * - export function, 기본값 매개변수(customLabel = '지정 출발지'), 논리 부정(`!`), 옵셔널 체이닝(?.).
 *
 * [브라우저 및 JS 표준 내장 API]
 * - Number.isFinite(value) : 위도·경도 인자가 NaN·Infinity가 아닌 유한 실수인지 확인함.
 * - new Date() : 출발 기준점을 변경한 현재 시각 Date 객체를 생성함.
 * - Number.prototype.toFixed(4) : 좌표를 소수점 넷째 자리 문자열로 변환함.
 * - Boolean(value) : 조건식 평가 결과를 명확한 true 또는 false 불리언으로 변환함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수·변수 : setCustomOrigin(lat, lng, customLabel), isSelectedActiveRoute.
 * - 참조 상태 : state.origin, state.locationKnown, state.originLabel, state.etaRankOpen.
 * - 참조 상태 : state.selected, state.activeRoute.
 * - 참조 함수 : updateRadiusUI(), updateLocationMarker(), updateCircle(), updateMarkers().
 * - 참조 함수 : updateOriginAddress(), setStatus(), loadEtaRanking(), populateWaypointSelect().
 * - 참조 함수 : loadDirectionsForHospital(), refreshActiveRoute().
 *
 * [동작 흐름]
 * - 호출 출처 : geocodeAndMoveOrigin()(검색 이동), map-engine.js 우클릭·롱탭(uiCallbacks 경유).
 * - 실행 단계 :
 *   1) 좌표 유한성 검증 -> state.origin·locationKnown·originLabel 갱신
 *   2) 반경 UI·위치 마커·반경 원·병원 마커·역지오코딩 주소·상태 토스트 동기화
 *   3) ETA 순위(열린 경우) -> 선택 병원 경로·경유지·활성 경로를 새 출발점 기준으로 재계산
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
        /*
         * [브라우저 표준 내장 API]
         * - new URLSearchParams(obj) / toString() : 한글·공백 검색어를 UTF-8 쿼리 문자열로 인코딩함.
         * - fetch(url, options) : 지오코딩 JSON 응답을 비동기로 요청함.
         *
         * [연동 백엔드 API]
         * - 컨트롤러 : EmergencyApiController (@RequestMapping("/api") + @GetMapping("/geocode"))
         * - 서비스 위임 : NaverGeocodingService.geocode(query, snapshot.hospitals())
         *   · 3단계 하이브리드 검색 : 1단계 NCP Geocoding -> 2단계 병원 주소록 -> 3단계 Nominatim
         * - 쿼리 파라미터 구조도 :
         *   GET /api/geocode
         *     └── ?query=<인코딩된 검색어>     (예: query=%EC%9B%90%EC%A3%BC%EC%8B%9C%EC%B2%AD)
         * - 응답 DTO : GeocodeResponseDto
         *   · 필드 : { code, query, items: [{ title, roadAddress, jibunAddress, lat, lng }] }
         *   · 코드 : 0(성공), 404(미검색), -1(빈 검색어)
         *
         * [동작 흐름]
         * - URLSearchParams 인코딩 -> GET /api/geocode -> GeocodeResponseDto 수신
         *   └── data.code === 0 && 유효 좌표 -> setCustomOrigin() 및 지도 카메라 이동
         */
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
 * [JS 문법]
 * - export async function, await, try / catch, 삼항 연산자(? :), 옵셔널 체이닝(?.), typeof.
 *
 * [브라우저, JS 및 네이버 지도 SDK 내장 API]
 * - String() / trim() / new URLSearchParams() / fetch() / Response.ok / Response.json().
 * - Array.isArray() / Number() / Number.isFinite() / Error.prototype.message.
 * - new naver.maps.LatLng(lat, lng) : 위·경도 지도 좌표 객체를 생성함.
 * - map.morph(coord, zoom, options) : 부드러운 애니메이션으로 중심과 줌을 이동함.
 * - map.setCenter(coord) / map.setZoom(zoom) : morph 미지원 시 중심·줌 즉시 이동 폴백임.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수 : geocodeAndMoveOrigin(rawQuery).
 * - 지역 변수 : trimmed, params, response, data, firstItem, targetLat, targetLng, label, resultsEl.
 * - 참조 상태·함수 : state.map, state.hasFitted, byId(), setStatus(), blurKeyword().
 * - 참조 함수 : setCustomOrigin(), fitRadius().
 *
 * [동작 흐름]
 * - 호출 출처 : updateSearch()에서 생성한 '주소·지역으로 출발 기준점 이동' 버튼 클릭 시 호출됨.
 * - 실행 단계 :
 *   1) 공백 제거 -> GET /api/geocode 요청 -> code === 0 및 첫 후보 좌표 유한성 검증
 *   2) 자동완성 목록 숨김·blurKeyword() -> setCustomOrigin(targetLat, targetLng, label) 호출
 *   3) 반경 'all' -> morph(줌 13) 또는 setCenter/setZoom 이동 / 특정 반경 -> fitRadius() 실행
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
 * [JS 문법]
 * - export function, 정규표현식 /\s+/g(모든 공백 전역 제거), for ... of, 옵셔널 체이닝(?.).
 *
 * [브라우저 및 JS 표준 내장 API]
 * - String.prototype.trim() / replace() / toLowerCase() / includes() : 공백·대소문자 무시 검색함.
 * - Element.replaceChildren() : 기존 검색 결과 목록의 자식 요소를 모두 비움.
 * - document.activeElement : 현재 키보드 초점을 가진 DOM 요소를 반환함.
 * - Array.prototype.filter() / slice(0, 25) : 일치 항목을 추려 최대 25건으로 제한함.
 * - document.createDocumentFragment() : 노드를 메모리에 모아 한 번에 DOM에 추가해 리플로우를 줄임.
 * - Element.setAttribute() / Element.append() / HTMLElement.blur() / addEventListener().
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : updateSearch(), list(#search-results), keywordInput(#keyword), searchContent.
 * - 지역 변수 : rawValue, query, isKeywordFocused, matches, fragment, hospital, geoLi, geoBtn.
 * - 참조 상태·함수 : state.hospitals, state.selected, closeRadius(), byId(), node().
 * - 참조 함수 : getBedTrafficInfo(), bedValue(), openHospital(), focusHospitalOnMap().
 * - 참조 함수 : updateMarkers(), geocodeAndMoveOrigin().
 *
 * [동작 흐름]
 * - 호출 출처 : applySnapshotToState(), initPanels()(펼칠 때), app.js init()(입력·포커스·제출).
 * - 실행 단계 :
 *   1) closeRadius() -> 검색어 공백·소문자 정규화 -> 검색창 상태에 따라 드롭다운 숨김 판정
 *   2) 일치 병원 최대 25건(병상 상태 도트·남은 병상 포함) + 하단 지오코딩 이동 버튼 조립
 *   3) DocumentFragment -> list.append(fragment) 1회 일괄 삽입
 *      ├── button(.result-button) 'click' -> openHospital() -> focusHospitalOnMap(15) -> updateMarkers()
 *      └── geoBtn(.search-geocode-btn) 'click' -> geocodeAndMoveOrigin(rawValue) 실행
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
 * [JS 문법]
 * - 비공개 function, try / catch / void err(저장소 접근 차단 시 false 반환), 엄격 비교(===).
 *
 * [브라우저 표준 내장 API]
 * - localStorage.getItem(key) : 브라우저 영구 로컬 저장소에서 문자열 값을 조회함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : noticeHidden(), err.
 * - 참조 상수 : NOTICE_KEY (constants.js에 정의된 안내 모달 숨김 플래그 키).
 *
 * [동작 흐름]
 * - 호출 출처 : openNotice(), initNotice().
 * - 실행 단계 : localStorage.getItem(NOTICE_KEY) 조회 -> '1'이면 true, 미설정·예외 시 false 반환.
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
 * [JS 문법]
 * - export function, 조기 return, 삼항 연산자(? :)로 숨김 상태별 버튼 문구를 선택함.
 *
 * [브라우저 표준 내장 API]
 * - HTMLElement.textContent : 버튼 내부 표시 문자열을 안전하게 갱신함.
 * - HTMLDialogElement.prototype.showModal() : <dialog> 요소를 최상위 모달로 염.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : openNotice(), skipBtn(#notice-skip), dialog(#notice-dialog).
 * - 참조 함수 : byId(), noticeHidden().
 *
 * [동작 흐름]
 * - 호출 출처 : initNotice() -> 초기 안내 표시 조건이 충족될 때 호출됨.
 * - 실행 단계 : #notice-dialog 확인 -> noticeHidden()에 따라 #notice-skip 문구 설정 -> showModal().
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
 * [JS 문법]
 * - export function, for ... of, 옵셔널 체이닝(?.), try / catch / void err, 논리곱(&&)·논리합(||).
 *
 * [브라우저 표준 내장 API]
 * - EventTarget.addEventListener('click', fn) : 닫기·확인·다시보지않기 클릭을 처리함.
 * - HTMLDialogElement.prototype.close() : 모달 다이얼로그를 닫음.
 * - localStorage.setItem(k, v) / removeItem(k) : 로컬 저장소에 문자열 플래그를 저장·삭제함.
 * - new URLSearchParams(window.location.search) / get() / Boolean() : URL 쿼리를 확인함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : initNotice(), noticeDialog, clusterDialog, searchParams, previewMode.
 * - 지역 변수 : hasHospitalDeepLink, id, err.
 * - 참조 상수·함수 : NOTICE_KEY, byId(), installDialogLightDismiss(), noticeHidden(), openNotice(), setStatus().
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init() 초기화 단계에서 1회 호출됨.
 * - 실행 단계 :
 *   1) #notice-dialog·#cluster-dialog에 바깥 클릭 닫기(installDialogLightDismiss) 설치
 *   2) #notice-close · #notice-confirm 'click' -> noticeDialog.close()
 *   3) #notice-skip 'click' -> localStorage NOTICE_KEY 저장·삭제 토글 후 noticeDialog.close()
 *   4) !noticeHidden() && !hasHospitalDeepLink && (일반 또는 preview=notice) -> openNotice() 실행
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
 * [JS 문법]
 * - export function, let, 화살표 함수, in 연산자('ResizeObserver' in window), 삼항 연산자(? :).
 *
 * [브라우저 표준 내장 API]
 * - HTMLElement.offsetHeight : 요소의 현재 렌더링 높이(px)를 정수로 조회함.
 * - CSSStyleDeclaration.setProperty(name, value) : 루트 CSS 사용자 정의 변수를 갱신함.
 * - requestAnimationFrame(fn) : 다음 화면 그리기 직전 프레임당 1회만 작업을 실행함.
 * - Element.getAttribute() / setAttribute() / classList.toggle() : ARIA 상태·클래스 전환함.
 * - new ResizeObserver(fn).observe(el) : 대상 요소 크기 변화를 비동기로 감지함.
 * - window.addEventListener('resize', fn, { passive: true }) : 스크롤 차단 없이 창 크기 감지함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : initPanels(), heightRafId, updateHeight, scheduleUpdateHeight.
 * - 지역 변수 : button(#search-toggle), content(#search-content), panel(#search-panel), collapsed.
 * - 참조 함수·CSS 변수 : byId(), updateSearch(), --search-panel-height.
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init() 초기화 단계에서 1회 호출됨.
 * - 실행 단계 :
 *   ├── button(#search-toggle) 'click' -> 패널 접힘·펼침 전환 -> updateSearch()(펼침 시) -> updateHeight()
 *   ├── ResizeObserver(#search-panel) + window 'resize' -> scheduleUpdateHeight() (rAF 스로틀)
 *   └── updateHeight() -> --search-panel-height CSS 변수에 실제 패널 높이(px) 반영
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
 * [JS 문법]
 * - export function, let, 화살표 함수, 객체 리터럴({ capture: true, passive: true }), 논리 연산자.
 *
 * [브라우저 표준 내장 API]
 * - EventTarget.addEventListener(type, fn, { capture: true, passive: true }) : 캡처·비차단 등록함.
 * - PointerEvent (pointerType, isPrimary) / TouchEvent (touches.length) / WheelEvent (ctrlKey).
 * - KeyboardEvent (key, isComposing, keyCode) / Event.preventDefault() : IME 조합 Enter 제출 막음.
 * - HTMLElement.blur() : 입력창 초점을 해제해 모바일 가상 키보드를 닫음.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : initSearchFocus(), keyword(#keyword), multiTouch, options, updateTouches.
 * - 참조 함수·DOM : byId(), blurKeyword(), #search-form.
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init() 초기화 단계에서 1회 호출됨.
 * - 실행 단계 :
 *   ├── document 'pointerdown' · 'touchstart' -> #keyword 외부·멀티터치 시 blurKeyword()
 *   ├── document 'touchend' · 'touchcancel' -> updateTouches()로 multiTouch 갱신
 *   ├── keyword(#keyword) 'focus' -> multiTouch 참이면 keyword.blur()
 *   ├── keyword(#keyword) 'keydown' -> IME 조합 Enter(isComposing || keyCode === 229) 시 preventDefault()
 *   ├── document 'wheel' -> ctrlKey거나 #keyword 외부면 blurKeyword()
 *   └── #search-form 'submit' -> blurKeyword()로 초점 해제
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
 * [JS 문법]
 * - export function, typeof forceValue === 'boolean', 삼항 연산자(? :), 논리 부정(`!`).
 *
 * [브라우저 및 JS 표준 내장 API]
 * - HTMLElement.hidden : 요소의 화면 표시·숨김 상태를 전환하는 불리언 속성임.
 * - Element.setAttribute('aria-expanded' | 'aria-label', value) : 메뉴 열림·라벨 갱신함.
 * - String(value) : 불리언 값을 ARIA 속성용 문자열로 변환함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수·변수 : toggleMobileMenu(forceValue), drawer(#mobile-menu-drawer), btn(#mobile-menu-btn).
 * - 참조 상태·함수 : state.mobileMenuOpen, byId(), closeRadius().
 *
 * [동작 흐름]
 * - 호출 출처 : initRadius()(외부 클릭), syncMobileMenuPlacement()(PC 복귀), app.js.
 * - 실행 단계 :
 *   1) forceValue 불리언이면 그대로 적용, 미전달 시 state.mobileMenuOpen 반전
 *   2) #mobile-menu-drawer hidden 및 #mobile-menu-btn ARIA 속성 동기화
 *   3) 닫힘(!state.mobileMenuOpen) -> closeRadius()로 열린 반경 팝오버 동시 닫기
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
 * [JS 문법]
 * - 비공개 function, 기본값 매개변수(referenceNode = null), typeof === 'function', try / catch.
 *
 * [브라우저 표준 내장 API]
 * - Node.isConnected : 노드가 현재 DOM 문서 트리에 연결되어 있는지 여부를 반환함.
 * - Element.prototype.moveBefore(child, ref) : 포커스·트랜지션 상태를 유지한 채 노드를 이동함.
 * - Node.prototype.insertBefore(child, ref) / appendChild(child) : 구형 환경용 DOM 이동 폴백임.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수·변수 : moveElementPreservingState(parent, child, referenceNode), moveErr.
 *
 * [동작 흐름]
 * - 호출 출처 : syncMobileMenuPlacement() -> 화면 너비 변경 시 #map-actions 이동할 때 호출됨.
 * - 실행 단계 :
 *   ├── moveBefore 지원 && 두 노드 isConnected -> parent.moveBefore()로 상태 유지 이동
 *   └── 미지원·예외 -> referenceNode 유무에 따라 insertBefore() 또는 appendChild() 폴백
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
 * [JS 문법]
 * - export function, if / else, 엄격 불일치(!==), 논리합(||), 조기 return.
 *
 * [브라우저 표준 내장 API]
 * - window.matchMedia(query).matches : CSS 미디어 쿼리 조건 일치 여부를 불리언으로 판정함.
 * - Element.parentElement : 현재 DOM 요소의 직계 부모 노드를 조회함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : syncMobileMenuPlacement(), mapActions(#map-actions), mobileDrawer.
 * - 지역 변수 : searchHeading(#search-panel-heading), searchToggle(#search-toggle), isMobile.
 * - 참조 상태·함수 : state.mobileMenuOpen, byId(), moveElementPreservingState(), toggleMobileMenu().
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init() 초기 배치 및 window resize 이벤트(requestAnimationFrame 콜백).
 * - 실행 단계 :
 *   ├── 뷰포트 <= 640px(모바일) -> #map-actions를 #mobile-menu-drawer 안으로 이동
 *   └── 뷰포트 > 640px(데스크톱) -> #search-panel-heading으로 복귀 -> 열린 모바일 메뉴 닫기
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
 * [JS 문법]
 * - export function, 기본값 매개변수(remountMap = true), 삼항 연산자(? :), 복합 대입(+=).
 *
 * [브라우저 및 JS 표준 내장 API]
 * - Boolean(value) / String(value) : 불리언 및 문자열 명시 변환 표준 함수임.
 * - HTMLElement.dataset : 요소의 data-* 사용자 속성을 읽고 설정함.
 * - document.querySelector(selector) / HTMLMetaElement.content : 메타 태그 content를 갱신함.
 * - Element.classList.toggle(token, force) : force 값에 따라 CSS 클래스를 추가·제거함.
 * - Element.setAttribute() / HTMLElement.title / HTMLElement.hidden : 버튼 상태·툴팁·숨김 제어함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수 : applyTheme(isDark, remountMap).
 * - 지역 변수 : themeValue('dark'|'light'), colorSchemeMeta, toggleBtn, moonIcon, sunIcon, label.
 * - 참조 상태·함수 : state.darkMode, state.map, state.diagnostics.themeSwitchCount.
 * - 참조 함수 : byId(), mountNaverMap().
 *
 * [동작 흐름]
 * - 호출 출처 : initThemeToggle() 초기 실행(remountMap=false) 및 #theme-toggle 클릭(true).
 * - 실행 단계 :
 *   1) state.darkMode 확정 -> <html>·<meta color-scheme>·<body> 테마 속성·클래스 동기화
 *   2) #theme-toggle ARIA 속성·툴팁 및 달·해 아이콘 가시성 갱신
 *   3) remountMap && state.map -> themeSwitchCount += 1 -> mountNaverMap() 지도 스타일 전환
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
 * [JS 문법]
 * - export function, let, try / catch / void err, 엄격 동등 비교(===), 옵셔널 체이닝(?.).
 *
 * [브라우저 표준 내장 API]
 * - localStorage.getItem(key) / localStorage.setItem(key, value) : 로컬 저장소 읽기·쓰기 API임.
 * - EventTarget.addEventListener('click', fn) : 테마 전환 버튼 클릭 이벤트를 등록함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : initThemeToggle(), initialDark(기본 true), saved, nextDark, err.
 * - 저장소 키·상태·함수 : 'yonsei119-theme', state.darkMode, byId(), applyTheme().
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init() 최우선 초기화 단계에서 1회 호출됨.
 * - 실행 단계 :
 *   1) localStorage('yonsei119-theme') 조회 -> 초기 다크 여부 결정 -> applyTheme(initialDark, false)
 *   2) #theme-toggle 'click' -> nextDark 반전 -> localStorage 저장 -> applyTheme(nextDark, true)
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
 * [JS 문법]
 * - export function, 'serviceWorker' in navigator, 엄격 동등 비교(===), 논리합(||), void swErr.
 *
 * [브라우저 표준 내장 API]
 * - window.location.protocol / hostname : HTTPS 또는 로컬호스트 보안 출처 여부를 확인함.
 * - window.addEventListener('load', fn, { once: true }) : 페이지 로드 완료 후 1회만 실행함.
 * - navigator.serviceWorker.register(scriptUrl) : 백그라운드 서비스 워커를 등록함.
 * - Promise.prototype.catch(fn) : 등록 실패 시 예외를 흡수해 본 앱 중단을 막음.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·지역 변수 : registerServiceWorker(), isSecure, swErr.
 * - 워커 스크립트 : /sw.js (frontend/sw.js, 오프라인 스냅샷·앱 쉘 캐시 담당).
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init()에서 비동기로 호출됨.
 * - 실행 단계 :
 *   1) serviceWorker 지원 && 보안 출처(https·localhost·127.0.0.1) 확인
 *   2) window 'load' -> navigator.serviceWorker.register('/sw.js') -> 오프라인 폴백 준비
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
 * [JS 문법]
 * - export function, if / else if, 엄격 동등 비교(===), 논리합(||), 옵셔널 체이닝(?.).
 *
 * [브라우저 및 JS 표준 내장 API]
 * - HTMLDialogElement.prototype.close() : 열려 있는 모달 다이얼로그를 닫음.
 * - setTimeout(fn, ms) : 지정 밀리초 이후 콜백을 1회 실행하는 타이머 API임.
 * - setInterval(fn, ms) / clearInterval(id) : 일정 주기마다 콜백을 반복 실행·해제함.
 * - HTMLElement.click() : 대상 버튼의 클릭 이벤트를 코드로 발생시킴.
 * - Array.prototype.find(fn) / slice(start, end) : 조건 일치 원소 검색 및 부분 배열 추출함.
 *
 * [프로젝트 상수·상태·함수]
 * - 함수·매개변수·변수 : handlePreviewMode(mode), checkAndOpen, target, h, checkAndCluster.
 * - 참조 상태·함수 : state.hospitals, byId(), openHospital(), openCluster().
 *
 * [동작 흐름]
 * - 호출 출처 : app.js init() -> URL 쿼리에 ?preview=... 파라미터가 있을 때 호출됨.
 * - 실행 단계 :
 *   ├── mode === 'notice' -> 초기 안내 모달 유지 후 반환
 *   └── 그 외 모드 -> #notice-dialog 닫기
 *       ├── 'radius' -> 1.5초 후 #radius-button 클릭
 *       ├── 'detail' | 'hospital' -> 300ms 간격(최대 12초) 대기 -> openHospital(target)
 *       └── 'cluster' -> 300ms 간격(최대 12초) 대기 -> openCluster(상위 3개 병원)
 */
