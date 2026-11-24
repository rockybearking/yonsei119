import {
    CAN_USE_CSS_TRANSLATE,
    DEFAULT_NAVER_CLIENT_ID
} from './constants.js';
import {
    state,
    uiCallbacks
} from './state.js';
import {
    blurKeyword,
    byId,
    node,
    radiusExtent
} from './utils.js';
/*
 * [JS 문법]
 * - import { 심볼 } from './파일.js' : 동일 폴더 모듈에서 필요한 상수와 함수를 가져옴.
 *
 * [프로젝트 내부 가져오기 목록]
 * - ./constants.js : CAN_USE_CSS_TRANSLATE(CSS translate 지원 여부), DEFAULT_NAVER_CLIENT_ID(기본 키)
 * - ./state.js : state(지도·좌표·진단 전역 상태), uiCallbacks(상위 모듈 역호출 레지스트리)
 * - ./utils.js : blurKeyword(포커스 해제), byId(ID 조회), node(DOM 생성), radiusExtent(반경 경계)
 *
 * [모듈 아키텍처]
 * - map-engine.js : 네이버 지도 v3 GL SDK 동적 로드, WebGL/2D 마운트, 좌표 투영을 담당함.
 * - OverlayView DOM 오버레이, 탐색 반경 Circle, 교통 레이어, 카메라 이동을 전담함.
 */

let sdkLoadPromise = null;
let loadedSdkClientId = DEFAULT_NAVER_CLIENT_ID;
let mapMountGeneration = 0;
let glWaitTimerId = null;
let glReadyTimerId = null;
/*
 * [JS 문법]
 * - let : 모듈 실행 중 값이 다시 할당되어야 하는 변수를 모듈 스코프에 선언하는 키워드임.
 *
 * [프로젝트 내부 변수]
 * - sdkLoadPromise : 비동기 SDK <script> 로드 중 같은 Promise를 돌려줘 중복 삽입을 막음.
 * - loadedSdkClientId : 현재 로드되었거나 로드 중인 네이버 Client ID를 추적함(기본 DEFAULT_NAVER_CLIENT_ID).
 * - mapMountGeneration : 비동기 타이머·glReady 콜백과 최신 지도 마운트 세대를 대조하는 단조 증가 카운터임.
 * - glWaitTimerId / glReadyTimerId : 재마운트 시 이전 GL 대기 타이머를 취소하기 위한 핸들임.
 */

export function ensureNaverMapSdkLoaded(targetClientId = state.naverClientId) {
    const cleanClientId = String(targetClientId || DEFAULT_NAVER_CLIENT_ID).trim();
    if (
        typeof window !== 'undefined' &&
        window.naver?.maps &&
        loadedSdkClientId === cleanClientId
    ) {
        return Promise.resolve(true);
    }

    if (sdkLoadPromise && loadedSdkClientId === cleanClientId) {
        return sdkLoadPromise;
    }

    loadedSdkClientId = cleanClientId;
    state.naverClientId = cleanClientId;

    sdkLoadPromise = new Promise(resolve => {
        const existingScript = document.getElementById('naver-maps-sdk');
        if (existingScript && existingScript.dataset.clientId === cleanClientId && window.naver?.maps) {
            resolve(true);
            return;
        }

        state._glWaitFinished = false;
        state._glCallbackBound = false;
        state._glPermanentUnsupported = false;

        if (window.naver) {
            try {
                delete window.naver;
            } catch (delErr) {
                window.naver = undefined;
                void delErr;
            }
        }

        const script = document.createElement('script');
        script.id = 'naver-maps-sdk';
        script.dataset.clientId = cleanClientId;
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(cleanClientId)}&submodules=gl`;
        script.async = true;
        /*
         * [JS/DOM 내장 API]
         * - document.createElement('script') : 동적 <script> DOM 요소를 생성하는 표준 API임.
         * - encodeURIComponent(str) : URL 쿼리 값의 특수문자를 퍼센트 인코딩해 URI 깨짐을 막음.
         * - script.dataset / script.src / script.async : data-* 기록, 경로 지정, 비동기 로드 속성임.
         *
         * [SDK URL 조립 구조]
         * - 1단계 기본 URL : https://oapi.map.naver.com/openapi/v3/maps.js
         * - 2단계 인증 쿼리 : ?ncpKeyId=${encodeURIComponent(cleanClientId)} (백엔드·기본 키 전달)
         * - 3단계 GL 서브모듈 : &submodules=gl (WebGL 벡터 지도·다크 스타일 지원 모듈 포함)
         * - 시각 구조도 :
         *   https://oapi.map.naver.com/openapi/v3/maps.js    <-- 1) 기본 URL
         *     ?ncpKeyId=${encodeURIComponent(cleanClientId)} <-- 2) ? + 인코딩된 ncpKeyId 인증 쿼리
         *     &submodules=gl                                 <-- 3) & + WebGL 벡터 지도 서브모듈
         */

        script.onload = () => {
            setTimeout(() => resolve(Boolean(window.naver?.maps)), 60);
        };
        script.onerror = () => {
            sdkLoadPromise = null;
            resolve(false);
        };

        if (existingScript?.parentNode) {
            existingScript.parentNode.replaceChild(script, existingScript);
        } else {
            document.head.appendChild(script);
        }
    });

    return sdkLoadPromise;
}
/*
 * [JS 문법]
 * - export function fn(param = defaultVal) : 외부 공개 함수 선언과 기본값 매개변수 문법임.
 * - delete obj.prop / try ... catch / void err : 전역 속성 정리 및 예외 무시 패턴임.
 *
 * [JS/DOM 내장 API]
 * - Promise.resolve(val) / new Promise(executor) : 비동기 로드 결과를 불리언으로 반환함.
 * - String(val).trim() / Boolean(val) : 문자열 앞뒤 공백 제거와 불리언 형변환 표준 함수임.
 * - document.getElementById(id) : HTML 문서에서 지정 ID를 가진 요소를 조회함.
 * - parentNode.replaceChild(newEl, oldEl) / head.appendChild(el) : DOM 요소 교체·삽입 API임.
 * - setTimeout(fn, delayMs) : 지정 시간(60ms) 뒤 콜백을 실행 예약하는 타이머 함수임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : ensureNaverMapSdkLoaded(targetClientId = state.naverClientId)
 * - 지역 변수 : cleanClientId(정규화 키), existingScript(#naver-maps-sdk), delErr, script
 *
 * [동작 흐름]
 * - 호출 : app.js의 init() 또는 search-controls.js의 syncFrontendConfig()가 호출함.
 * - cleanClientId 정규화 -> 같은 키로 window.naver?.maps 로드 완료 시 Promise.resolve(true) 반환
 * - 같은 키로 이미 로딩 중이면 -> 기존 sdkLoadPromise 재사용 반환
 * - 새 키 로드 필요 시 -> 기존 window.naver 정리 후 <script id="naver-maps-sdk"> 교체·삽입
 *   ├── script.onload -> 60ms 대기 후 Boolean(window.naver?.maps)로 resolve
 *   └── script.onerror -> sdkLoadPromise = null 초기화 후 false로 resolve
 */

export function getHospitalLatLng(hospital) {
    const naverMaps = window.naver?.maps;
    if (!naverMaps?.LatLng) {
        return null;
    }
    if (
        !hospital._latLng ||
        hospital._latLngLat !== hospital.lat ||
        hospital._latLngLng !== hospital.lng
    ) {
        hospital._latLng = new naverMaps.LatLng(hospital.lat, hospital.lng);
        hospital._latLngLat = hospital.lat;
        hospital._latLngLng = hospital.lng;
    }
    return hospital._latLng;
}
/*
 * [네이버 지도 SDK 내장 API]
 * - new naver.maps.LatLng(lat, lng) : 위도·경도 숫자로 네이버 지도 좌표 객체를 생성함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : getHospitalLatLng(hospital)
 * - 지역 변수 : naverMaps(window.naver?.maps 네임스페이스)
 * - 캐시 속성 : hospital._latLng(좌표 객체), hospital._latLngLat, hospital._latLngLng
 *
 * [동작 흐름]
 * - 호출 : app.js(#cluster-zoom), fitRadius, focusHospitalOnMap, updateMarkers 등이 호출함.
 * - !naverMaps?.LatLng -> null 반환
 * - _latLng 미존재 또는 좌표 변경 -> new naverMaps.LatLng(hospital.lat, hospital.lng) 생성·캐시
 * - 좌표 동일 시 -> 기존 hospital._latLng 재사용 반환(반복 생성 및 GC 부하 절감)
 */

export function isMapReadyForOverlays() {
    if (!state.map) {
        return false;
    }
    try {
        if (state.map.get?.('renderMode') === 2 && typeof state.map.isGLReady === 'function') {
            return Boolean(state.map.isGLReady());
        }
    } catch (glCheckErr) {
        void glCheckErr;
        return false;
    }
    return true;
}
/*
 * [네이버 지도 SDK 내장 API]
 * - map.get('renderMode') : 지도의 현재 렌더링 모드를 조회함(2이면 WebGL 벡터 모드).
 * - map.isGLReady() : WebGL 컨텍스트와 벡터 스타일 시트 초기화 완료 여부를 반환함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수 : isMapReadyForOverlays() (매개변수 없음, state.map 준비 여부 검사)
 * - 지역 변수 : glCheckErr(isGLReady() 예외 발생 시 안전하게 false를 반환하기 위한 변수)
 *
 * [동작 흐름]
 * - 호출 : coordToScreenPoint, createNaverDomOverlay.draw, updateCircle, updateMarkers 등에서 호출함.
 * - !state.map -> false 즉시 반환
 * - renderMode === 2 (GL 모드) -> Boolean(state.map.isGLReady()) 반환(예외 시 false)
 * - 2D 일반 모드 -> 즉시 true 반환
 */

export function coordToScreenPoint(lat, lng, cachedLatLng = null) {
    const naverMaps = window.naver?.maps;
    const latLng = cachedLatLng || (naverMaps?.LatLng ? new naverMaps.LatLng(lat, lng) : null);
    if (latLng && isMapReadyForOverlays()) {
        try {
            const projection = state.map.getProjection?.();
            if (projection && typeof projection.fromCoordToOffset === 'function') {
                const offset = projection.fromCoordToOffset(latLng);
                if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y)) {
                    return { x: offset.x, y: offset.y };
                }
            }
        } catch (projErr) {
            void projErr;
        }
    }
    const zoom = state.map?.getZoom?.() || 12;
    const scale = 256 * (2 ** zoom);
    const x = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { x, y };
}
/*
 * [JS 내장 함수]
 * - Number.isFinite(val) : 값이 NaN이나 Infinity가 아닌 유한한 실수인지 검사함.
 * - Math.sin(rad) / Math.log(x) / Math.PI / ** : 웹 메르카토르 투영 계산용 수학 API임.
 *
 * [네이버 지도 SDK 내장 API]
 * - new naver.maps.LatLng(lat, lng) : 투영 계산에 사용할 위경도 좌표 객체를 생성함.
 * - map.getProjection() : 지도의 현재 좌표-화면 투영기 객체를 반환함.
 * - projection.fromCoordToOffset(latLng) : 위경도를 지도 기준 화면 픽셀 { x, y }로 변환함.
 * - map.getZoom() : 현재 지도의 정수 줌 레벨을 조회함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : coordToScreenPoint(lat, lng, cachedLatLng = null)
 * - 지역 변수 : naverMaps, latLng, projection, offset, projErr, zoom, scale, x, sinLat, y
 *
 * [동작 흐름]
 * - 호출 : markers-cluster.js의 updateMarkers()가 클러스터링 전에 픽셀 좌표를 구할 때 호출함.
 * - latLng 존재 & isMapReadyForOverlays() 참 -> state.map.getProjection().fromCoordToOffset(latLng)
 *   └── offset.x, offset.y가 유한 숫자 -> { x: offset.x, y: offset.y } 반환
 * - 투영기 미준비 또는 예외 발생 -> 256 * (2 ** zoom) 기반 웹 메르카토르 공식으로 폴백 좌표 계산
 */

export function createNaverDomOverlay(options) {
    const naverMaps = window.naver.maps;

    class NaverDomOverlay extends naverMaps.OverlayView {
        constructor(opts) {
            super();
            this.position = opts.position;
            this.content = opts.content;
            this.xAnchor = opts.xAnchor ?? 0.5;
            this.yAnchor = opts.yAnchor ?? 1.0;
            this.zIndex = opts.zIndex ?? 5;
            this._lastTranslate = '';
            this._lastLeft = '';
            this._lastTop = '';
            if (opts.map) {
                this.setMap(opts.map);
            }
        }

        onAdd() {
            const panes = this.getPanes();
            const targetPane = panes?.floatPane || panes?.overlayLayer || panes?.overlayImage;
            if (!targetPane) {
                return;
            }
            this.content.style.position = 'absolute';
            this.content.style.left = '0px';
            this.content.style.top = '0px';
            this.content.style.zIndex = String(this.zIndex);
            if (CAN_USE_CSS_TRANSLATE && !this._lastTranslate) {
                this.content.style.translate = '0px 0px';
            }
            this.content.style.transform = `translate(${-this.xAnchor * 100}%, ${-this.yAnchor * 100}%)`;
            targetPane.appendChild(this.content);
        }

        setPosition(nextPosition) {
            this.position = nextPosition;
            this.draw();
        }

        draw() {
            if (!this.getMap() || !isMapReadyForOverlays()) {
                return;
            }
            try {
                const projection = this.getProjection();
                if (!projection || typeof projection.fromCoordToOffset !== 'function') {
                    return;
                }
                const offset = projection.fromCoordToOffset(this.position);
                if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y)) {
                    const rx = Math.round(offset.x);
                    const ry = Math.round(offset.y);
                    if (CAN_USE_CSS_TRANSLATE) {
                        const nextTranslate = `${rx}px ${ry}px`;
                        if (this._lastTranslate !== nextTranslate) {
                            this._lastTranslate = nextTranslate;
                            this.content.style.translate = nextTranslate;
                        }
                    } else {
                        const nextLeft = `${rx}px`;
                        const nextTop = `${ry}px`;
                        if (this._lastLeft !== nextLeft) {
                            this._lastLeft = nextLeft;
                            this.content.style.left = nextLeft;
                        }
                        if (this._lastTop !== nextTop) {
                            this._lastTop = nextTop;
                            this.content.style.top = nextTop;
                        }
                    }
                }
            } catch (drawErr) {
                void drawErr;
            }
        }

        onRemove() {
            if (this.content && this.content.parentNode) {
                this.content.parentNode.removeChild(this.content);
            }
        }
    }

    return new NaverDomOverlay(options);
}
/*
 * [JS 문법]
 * - class Sub extends Base / super() : ES6 클래스 상속과 부모 생성자 선행 호출 문법임.
 * - a ?? b : 널 병합 연산자로 왼쪽이 null이나 undefined일 때만 기본값을 씀(0 보존).
 *
 * [JS/DOM 내장 API]
 * - parent.appendChild(child) / parent.removeChild(child) : DOM 노드를 추가·제거함.
 * - Math.round(n) / Number.isFinite(n) / String(v) : 정수 반올림·유한성 검증·문자열 변환임.
 * - element.style : position, left, top, zIndex, translate, transform 인라인 스타일을 제어함.
 *
 * [네이버 지도 SDK 내장 API]
 * - naver.maps.OverlayView : HTML 요소를 지도 좌표에 고정해 추적시키는 SDK 추상 클래스임.
 * - overlay.setMap(map) / getMap() / getPanes() / getProjection() : 지도 부착·페인·투영기 API임.
 * - onAdd() / draw() / onRemove() : 오버레이 추가·이동·제거 시 SDK가 자동 호출하는 메서드임.
 *
 * [프로젝트 내부 클래스·변수]
 * - 팩토리·클래스 : createNaverDomOverlay(options), 내부 클래스 NaverDomOverlay
 * - 커스텀 메서드·속성 : setPosition(nextPosition), position, content, xAnchor, yAnchor, zIndex
 * - 캐시 속성·지역 변수 : _lastTranslate, _lastLeft, _lastTop, projection, offset, rx, ry
 *
 * [동작 흐름]
 * - 호출 : markers-cluster.js(병원 카드), updateLocationMarker(출발점), drawRouteOnMap(경유지)에서 호출함.
 * - onAdd() -> left/top을 0px 고정, transform(-xAnchor*100%, -yAnchor*100%) 앵커 설정
 *   └── targetPane(floatPane || overlayLayer || overlayImage)에 content 삽입
 * - draw() -> getProjection().fromCoordToOffset(position)로 정수 픽셀 (rx, ry) 산출
 *   ├── CAN_USE_CSS_TRANSLATE 지원 -> style.translate만 직전 값과 다를 때 갱신(리플로우 방지)
 *   └── 미지원 브라우저 -> style.left, style.top을 직전 캐시와 비교해 다를 때만 갱신
 * - onRemove() -> parentNode.removeChild(content)로 지도 DOM에서 분리
 */

export function guardGlShapeRedraw(shapeOverlay) {
    if (!shapeOverlay || typeof shapeOverlay.drawGL !== 'function' || shapeOverlay._glRedrawGuarded) {
        return shapeOverlay;
    }
    const origDrawGL = shapeOverlay.drawGL.bind(shapeOverlay);
    shapeOverlay._glRedrawGuarded = true;
    shapeOverlay.drawGL = function guardedDrawGl() {
        if (this.hasSource?.() && this._glSourceLoadedOnce) {
            return;
        }
        origDrawGL();
        if (this.hasSource?.()) {
            this._glSourceLoadedOnce = true;
        }
    };
    return shapeOverlay;
}
/*
 * [JS 문법]
 * - function fn() : 호출 시점의 동적 this를 쓰기 위해 화살표 함수 대신 일반 함수로 작성함.
 *
 * [JS 내장 메서드]
 * - Function.prototype.bind(thisArg) : 함수의 this 컨텍스트를 지정 객체로 고정한 새 함수를 만듦.
 *
 * [네이버 지도 SDK GL 메서드]
 * - shape.drawGL() / shape.hasSource() : WebGL 모드에서 도형 소스를 등록하고 존재 여부를 확인함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : guardGlShapeRedraw(shapeOverlay)
 * - 지역 변수·가드 속성 : origDrawGL, guardedDrawGl, _glRedrawGuarded, _glSourceLoadedOnce
 *
 * [동작 흐름]
 * - 호출 : updateCircle() 및 directions-eta.js의 2D 폴백 Polyline 생성 시 호출함.
 * - drawGL 미존재 또는 _glRedrawGuarded 참 -> 원본 shapeOverlay 그대로 반환
 * - 래핑 적용 -> _glRedrawGuarded = true 기록 후 drawGL을 guardedDrawGl로 교체
 *   ├── this.hasSource?.() && this._glSourceLoadedOnce 참 -> 중복 drawGL 건너뜀
 *   └── 최초 실행 -> origDrawGL() 호출 후 hasSource() 참이면 _glSourceLoadedOnce = true 저장
 */

export function updateCircle(force = false) {
    if (!state.map || !isMapReadyForOverlays() || !window.naver?.maps) {
        return;
    }

    const radiusEl = byId('radius');
    const radius = radiusEl ? radiusEl.value : '10';

    if (radius === 'all') {
        if (state.circle) {
            try {
                state.circle.setMap(null);
            } catch (err) {
                void err;
            }
            state.circle = null;
        }
        state.circleKey = null;
        state.circleMap = null;
        return;
    }

    const nextKey = `${state.origin.lat.toFixed(6)},${state.origin.lng.toFixed(6)},${radius},${state.darkMode ? 'dark' : 'light'}`;

    if (!force && state.circle && state.circleMap === state.map && state.circleKey === nextKey) {
        return;
    }

    if (state.circle) {
        try {
            state.circle.setMap(null);
        } catch (err) {
            void err;
        }
        state.circle = null;
    }

    try {
        const naverMaps = window.naver.maps;
        const circle = new naverMaps.Circle({
            map: state.map,
            center: new naverMaps.LatLng(state.origin.lat, state.origin.lng),
            radius: Number(radius) * 1000,
            strokeWeight: 2,
            strokeColor: state.darkMode ? '#60a5fa' : '#2873df',
            strokeOpacity: state.darkMode ? 0.8 : 0.65,
            fillColor: state.darkMode ? '#3b82f6' : '#5e9cf0',
            fillOpacity: state.darkMode ? 0.11 : 0.07,
            clickable: false
        });
        state.circle = guardGlShapeRedraw(circle);
        state.circleKey = nextKey;
        state.circleMap = state.map;
        state.diagnostics.circleCreatedCount += 1;
    } catch (circleErr) {
        void circleErr;
        state.circle = null;
        state.circleKey = null;
        state.circleMap = null;
    }
}
/*
 * [JS 내장 함수]
 * - Number.prototype.toFixed(6) : 위경도를 소수점 6자리 문자열로 고정해 비교 오차를 없앰.
 * - Number(val) : 문자열 값을 숫자로 변환함(* 1000으로 km를 미터 단위로 환산).
 *
 * [네이버 지도 SDK 내장 API]
 * - new naver.maps.Circle(options) : 중심 좌표와 미터 반경의 원을 지도에 그리는 도형 클래스임.
 * - new naver.maps.LatLng(lat, lng) / circle.setMap(null) : 중심 좌표 생성 및 원 제거 메서드임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : updateCircle(force = false)
 * - DOM 참조·지역 변수 : radiusEl(#radius), radius, nextKey, naverMaps, circle, err, circleErr
 *
 * [동작 흐름]
 * - 호출 : fitRadius, syncMapOverlays, updateMarkers, locate, setCustomOrigin 등에서 호출함.
 * - radius === 'all' -> 기존 state.circle.setMap(null) 제거 후 circleKey·circleMap 초기화
 * - !force && circleMap === map && circleKey === nextKey -> 동일 원 재사용(생성 생략)
 * - 변경 필요 시 -> 기존 원 제거 -> state.darkMode 색상 적용해 new Circle 생성
 *   └── guardGlShapeRedraw(circle) 적용 -> state.circle·circleKey 저장 및 생성 횟수 누적
 */

export function updateLocationMarker() {
    try {
        state.locationMarker?.setMap(null);
    } catch (err) {
        void err;
    }
    state.locationMarker = null;

    if (!state.map || !state.locationKnown || !isMapReadyForOverlays() || !window.naver?.maps) {
        return;
    }

    const marker = node('div', 'location-marker');
    marker.setAttribute('role', 'img');
    marker.setAttribute('aria-label', '내 현재 위치 또는 지정 출발점');
    marker.append(node('span', 'location-dot'));

    state.locationMarker = createNaverDomOverlay({
        map: state.map,
        position: new window.naver.maps.LatLng(state.origin.lat, state.origin.lng),
        content: marker,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 1000
    });
}
/*
 * [DOM/네이버 지도 SDK 내장 API]
 * - element.setAttribute(name, val) / element.append(...nodes) : ARIA 속성 설정 및 노드 삽입 API임.
 * - overlay.setMap(null) / new naver.maps.LatLng(lat, lng) : 오버레이 제거 및 좌표 생성 SDK API임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수 : updateLocationMarker() (매개변수 없음)
 * - DOM 참조 : marker(div.location-marker 및 내부 span.location-dot)
 *
 * [동작 흐름]
 * - 호출 : syncMapOverlays, locate, setCustomOrigin, resetOriginAndRoute에서 호출함.
 * - 기존 state.locationMarker?.setMap(null) 제거 및 null 초기화
 * - !state.map || !state.locationKnown || !isMapReadyForOverlays() -> 마커 없이 종료
 * - 조건 충족 -> div.location-marker 조립 -> createNaverDomOverlay(xAnchor:0.5, yAnchor:0.5, zIndex:1000)
 */

function syncGlTrafficLayers(mapbox, visible) {
    if (!mapbox || typeof mapbox.getStyle !== 'function') {
        return;
    }

    const visibility = visible ? 'visible' : 'none';
    const style = mapbox.getStyle();
    if (!style || !Array.isArray(style.layers)) {
        return;
    }

    for (const layer of style.layers) {
        const group = layer?.metadata?.group;
        if (group === 'ctt' || group === 'dctt' || String(layer?.id || '').startsWith('CTT/')) {
            try {
                mapbox.setLayoutProperty(layer.id, 'visibility', visibility);
            } catch (err) {
                void err;
            }
        }
    }

    if (!mapbox.getSource('ctt')) {
        if (!visible) {
            return;
        }
        try {
            mapbox.addSource('ctt', {
                type: 'vector',
                url: 'https://map.pstatic.net/nvc/ctt/wmts/naver/getMetadata/v1'
            });
        } catch (err) {
            void err;
            return;
        }
    }

    const bgWidthStops = [
        [6, 1.4], [7, 2.4], [8, 2.8], [9, 3.8], [10, 3.8],
        [11, 3.8], [12, 3.8], [13, 3.8], [14, 3.8], [15, 4], [16, 4], [17, 5]
    ];
    const fgWidthStops = [
        [6, 1.1], [7, 1.6], [8, 2.0], [9, 2.2], [10, 2.2],
        [11, 2.2], [12, 2.2], [13, 2.2], [14, 2.2], [15, 2.5], [16, 2.8], [17, 3.5]
    ];
    const lineOffsetStops = [
        [6, 1], [7, 1.5], [8, 2], [9, 2], [10, 3], [11, 3],
        [12, 3], [13, 3], [14, 3], [15, 4], [16, 5], [17, 8], [18, 8], [19, 32]
    ];

    const firstSymbolLayer = style.layers.find(l => l.type === 'symbol')?.id;

    const specs = [
        { id: 'yonsei-ctt-2-bg', stateVal: 1, color: 'rgb(0, 0, 0)', widthStops: bgWidthStops },
        { id: 'yonsei-ctt-3-bg', stateVal: 2, color: 'rgb(0, 0, 0)', widthStops: bgWidthStops },
        { id: 'yonsei-ctt-4-bg', stateVal: 4, color: 'rgb(0, 0, 0)', widthStops: bgWidthStops },
        { id: 'yonsei-ctt-2', stateVal: 1, color: '#27c441', widthStops: fgWidthStops },
        { id: 'yonsei-ctt-3', stateVal: 2, color: '#ff8d00', widthStops: fgWidthStops },
        { id: 'yonsei-ctt-4', stateVal: 4, color: '#ff3b30', widthStops: fgWidthStops }
    ];

    for (const spec of specs) {
        if (!mapbox.getLayer(spec.id)) {
            try {
                mapbox.addLayer({
                    id: spec.id,
                    type: 'line',
                    source: 'ctt',
                    'source-layer': 'ctt',
                    minzoom: 4,
                    maxzoom: 22,
                    filter: ['==', 'state', spec.stateVal],
                    layout: {
                        visibility,
                        'line-cap': 'round',
                        'line-join': 'miter'
                    },
                    paint: {
                        'line-color': spec.color,
                        'line-width': { stops: spec.widthStops },
                        'line-offset': { stops: lineOffsetStops }
                    }
                }, firstSymbolLayer);
            } catch (err) {
                void err;
            }
        } else {
            try {
                mapbox.setLayoutProperty(spec.id, 'visibility', visibility);
            } catch (err) {
                void err;
            }
        }
    }
}
/*
 * [JS 내장 메서드]
 * - Array.isArray(val) : 전달된 값이 배열인지 검사하는 표준 정적 메서드임.
 * - String.prototype.startsWith(prefix) : 문자열이 특정 접두사로 시작하는지 확인함.
 * - Array.prototype.find(fn) : 조건에 맞는 첫 번째 배열 원소를 반환함.
 *
 * [Mapbox GL 내장 API]
 * - mapbox.getStyle() : 현재 로드된 벡터 스타일 시트의 layers 배열을 반환함.
 * - mapbox.setLayoutProperty(layerId, 'visibility', val) : 레이어 표시('visible'/'none')를 바꿈.
 * - mapbox.getSource(id) / mapbox.addSource(id, spec) : 벡터 타일 소스를 조회·등록함.
 * - mapbox.getLayer(id) / mapbox.addLayer(spec, beforeId) : 지정 레이어 아래에 새 레이어를 넣음.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : syncGlTrafficLayers(mapbox, visible)
 * - 지역 변수 : visibility, style, layer, group, bgWidthStops, fgWidthStops, lineOffsetStops
 * - 레이어 배치 변수 : firstSymbolLayer(첫 심볼 레이어 ID), specs(원활·서행·정체 6개 레이어 정의), spec
 *
 * [동작 흐름]
 * - 호출 : syncTrafficLayer() 내부에서 state.map.getMapbox() 인스턴스가 있을 때 호출함.
 * - 1단계 기존 레이어 -> metadata.group이 ctt/dctt거나 ID가 CTT/로 시작하면 visibility 동기화
 * - 2단계 벡터 소스 -> 'ctt' 소스가 없고 visible이 참이면 네이버 교통 WMTS 메타데이터 소스 추가
 * - 3단계 커스텀 레이어 -> specs 6개(stateVal 1 원활·2 서행·4 정체, 배경선+전경선) 순회
 *   ├── 레이어 미등록 -> firstSymbolLayer(도로 라벨) 아래에 addLayer()로 삽입
 *   └── 레이어 존재 -> setLayoutProperty()로 visibility만 전환
 */

function syncTrafficLayer() {
    const naverMaps = window.naver?.maps;
    if (!state.map || !naverMaps?.TrafficLayer) {
        return;
    }

    if (state.map.get?.('renderMode') === 2 && !isMapReadyForOverlays()) {
        naverMaps.Event.once(state.map, 'glReady', () => {
            syncTrafficLayer();
        });
        return;
    }

    if (state.trafficEnabled) {
        try {
            if (!state.trafficLayer) {
                state.trafficLayer = new naverMaps.TrafficLayer({ interval: 300000 });
            }
            state.trafficLayer.setMap(state.map);
        } catch (err) {
            void err;
        }
    } else if (state.trafficLayer) {
        try {
            state.trafficLayer.setMap(null);
        } catch (err) {
            void err;
        }
    }

    try {
        const mapbox = state.map.getMapbox?.();
        if (mapbox) {
            syncGlTrafficLayers(mapbox, state.trafficEnabled);
        }
    } catch (err) {
        void err;
    }
}
/*
 * [네이버 지도 SDK 내장 API]
 * - map.get('renderMode') / map.getMapbox() : GL 모드 확인 및 내부 Mapbox 인스턴스 접근 메서드임.
 * - naver.maps.Event.once(target, eventName, cb) : 지정 이벤트 발생 시 1회만 콜백을 실행함.
 * - new naver.maps.TrafficLayer(options) : 주기(300000ms=5분)마다 갱신되는 실시간 교통 레이어임.
 * - trafficLayer.setMap(map | null) : 교통 레이어를 지도에 연결하거나 분리함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수 : syncTrafficLayer() (매개변수 없음)
 * - 지역 변수 : naverMaps(window.naver?.maps), mapbox(getMapbox() 반환 객체), err
 *
 * [동작 흐름]
 * - 호출 : toggleTrafficLayer() 및 mountNaverMap()의 syncMapOverlays()에서 호출함.
 * - GL 모드이면서 !isMapReadyForOverlays() -> 'glReady'에 syncTrafficLayer 재호출 예약 후 종료
 * - state.trafficEnabled 참 -> state.trafficLayer 생성(최초) 후 setMap(state.map)
 * - state.trafficEnabled 거짓 -> 기존 state.trafficLayer.setMap(null) 분리
 * - state.map.getMapbox?.() 존재 시 -> syncGlTrafficLayers(mapbox, state.trafficEnabled) 함께 동기화
 */

export function toggleTrafficLayer() {
    state.trafficEnabled = !state.trafficEnabled;
    const btn = byId('traffic-toggle');
    if (btn) {
        btn.setAttribute('aria-pressed', String(state.trafficEnabled));
        btn.setAttribute(
            'aria-label',
            state.trafficEnabled ? '실시간 교통정보 끄기' : '실시간 교통정보 켜기'
        );
    }
    syncTrafficLayer();
}
/*
 * [DOM 내장 API]
 * - element.setAttribute(name, val) : 버튼의 aria-pressed와 aria-label 속성을 갱신함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수 : toggleTrafficLayer() (매개변수 없음)
 * - DOM 참조 : btn(#traffic-toggle 버튼 요소)
 *
 * [동작 흐름]
 * - 호출 : app.js의 init()에서 #traffic-toggle click 핸들러로 연결됨.
 * - state.trafficEnabled = !state.trafficEnabled 상태 반전
 *   ├── btn 존재 -> aria-pressed, aria-label 속성 갱신
 *   └── syncTrafficLayer() 호출 -> 지도 교통 레이어 즉시 켜고 끔
 */

export function fitBounds(bounds) {
    const naverMaps = window.naver?.maps;
    if (!state.map || !bounds || !naverMaps) {
        return;
    }

    if (!isMapReadyForOverlays()) {
        naverMaps.Event.once(state.map, 'glReady', () => fitBounds(bounds));
        return;
    }

    const mapEl = byId('map');
    const height = mapEl?.clientHeight || window.innerHeight;
    const searchPanel = document.querySelector('.search-panel');
    const activeBanner = byId('active-route-banner');
    const halfPeekExtra = state.sheetHalfPeek ? 276 : 0;

    const bannerBottom = (activeBanner && !activeBanner.hidden)
        ? activeBanner.getBoundingClientRect().bottom + 16
        : 0;
    const top = Math.max(32, Math.min(Math.round(bannerBottom), Math.round(height * 0.24)));
    const rawBottom = Math.max((searchPanel?.offsetHeight || 120) + 24, halfPeekExtra);
    const bottom = Math.min(rawBottom, Math.round(height * 0.42));

    try {
        state.map.fitBounds(bounds, {
            top,
            right: 32,
            bottom,
            left: 32
        });
    } catch (fitErr) {
        void fitErr;
    }
}
/*
 * [JS/DOM 내장 API]
 * - document.querySelector(selector) : CSS 선택자로 첫 일치 DOM 요소를 탐색함.
 * - element.getBoundingClientRect().bottom : 뷰포트 기준 요소 하단의 Y 픽셀 좌표를 읽음.
 * - element.clientHeight / offsetHeight / window.innerHeight : 요소·창의 픽셀 높이를 측정함.
 * - Math.max(...) / Math.min(...) / Math.round(...) : 여백 상한·하한 제한과 반올림 함수임.
 *
 * [네이버 지도 SDK 내장 API]
 * - naver.maps.Event.once(map, 'glReady', cb) : GL 스타일 준비 완료 시 1회 실행할 콜백을 등록함.
 * - map.fitBounds(bounds, margins) : 여백 안쪽 화면에 bounds가 다 들어가도록 카메라를 맞춤.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : fitBounds(bounds)
 * - DOM 참조 : mapEl(#map), searchPanel(.search-panel), activeBanner(#active-route-banner)
 * - 지역 변수 : naverMaps, height, halfPeekExtra, bannerBottom, top, rawBottom, bottom, fitErr
 *
 * [동작 흐름]
 * - 호출 : #cluster-zoom, fitRadius(), directions-eta.js의 drawRouteOnMap()에서 호출함.
 * - !isMapReadyForOverlays() -> 'glReady' 이벤트에 fitBounds(bounds) 재호출 예약 후 종료
 * - UI 패널에 가리지 않도록 안전 여백 산출 :
 *   ├── top -> 활성 경로 배너 하단 + 16px (최소 32px ~ 지도 높이 24% 제한)
 *   └── bottom -> 검색 패널 높이+24px와 halfPeekExtra(276px) 중 큰 값 (최대 지도 높이 42%)
 * - state.map.fitBounds(bounds, { top, right: 32, bottom, left: 32 }) 실행
 */

export function fitRadius() {
    const naverMaps = window.naver?.maps;
    if (!state.map || !naverMaps) {
        return;
    }

    const radiusVal = byId('radius')?.value || '10';
    let bounds;

    if (radiusVal === 'all') {
        if (!state.hospitals.length) {
            bounds = new naverMaps.LatLngBounds(
                new naverMaps.LatLng(33.1, 124.5),
                new naverMaps.LatLng(38.7, 131.9)
            );
        } else {
            const firstPos = getHospitalLatLng(state.hospitals[0]);
            bounds = new naverMaps.LatLngBounds(firstPos, firstPos);
            for (let i = 1; i < state.hospitals.length; i++) {
                const pos = getHospitalLatLng(state.hospitals[i]);
                if (pos) {
                    bounds.extend(pos);
                }
            }
        }
    } else {
        const box = radiusExtent(state.origin, Number(radiusVal));
        bounds = new naverMaps.LatLngBounds(
            new naverMaps.LatLng(box.south, box.west),
            new naverMaps.LatLng(box.north, box.east)
        );
    }

    fitBounds(bounds);
    updateCircle();
}
/*
 * [네이버 지도 SDK 내장 API]
 * - new naver.maps.LatLng(lat, lng) : 사각 경계의 남서·북동 꼭짓점 좌표를 생성함.
 * - new naver.maps.LatLngBounds(sw, ne) / bounds.extend(pos) : 좌표 경계 생성·확장 메서드임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수 : fitRadius() (매개변수 없음)
 * - 지역 변수 : naverMaps, radiusVal(#radius 값), bounds, firstPos, pos, box
 *
 * [동작 흐름]
 * - 호출 : syncMapOverlays, initRadius, applySnapshotToState, locate, geocodeAndMoveOrigin 등
 * - radiusVal === 'all' -> 전체 병원 좌표로 bounds 구성(목록 비면 한반도 기본 좌표 사용)
 * - 숫자 반경 -> radiusExtent(state.origin, Number(radiusVal))로 남서·북동 bounds 생성
 * - fitBounds(bounds) 카메라 맞춤 -> updateCircle() 반경 원 동기화
 */

export function focusHospitalOnMap(hospital, targetZoom = 15) {
    const naverMaps = window.naver?.maps;
    if (!state.map || !naverMaps || !hospital || !Number.isFinite(hospital.lat) || !Number.isFinite(hospital.lng)) {
        return;
    }

    state.hasFitted = true;
    const targetLatLng = getHospitalLatLng(hospital);
    if (!targetLatLng) {
        return;
    }

    if (state.map.get?.('renderMode') === 2 && !isMapReadyForOverlays()) {
        naverMaps.Event.once(state.map, 'glReady', () => {
            focusHospitalOnMap(hospital, targetZoom);
        });
        return;
    }

    if (typeof state.map.morph === 'function') {
        state.map.morph(targetLatLng, targetZoom, {
            duration: 450,
            easing: 'easeOutCubic'
        });
    } else if (typeof state.map.updateBy === 'function') {
        state.map.updateBy(targetLatLng, targetZoom);
    } else {
        state.map.setCenter(targetLatLng);
        state.map.setZoom(targetZoom);
    }
}
/*
 * [JS 내장 함수]
 * - Number.isFinite(val) : 위도·경도가 유효한 유한 실수인지 확인함.
 *
 * [네이버 지도 SDK 내장 API]
 * - map.get('renderMode') / naver.maps.Event.once(map, 'glReady', cb) : GL 모드 확인 및 대기임.
 * - map.morph(coord, zoom, opts) : 중심 이동과 확대·축소를 부드러운 애니메이션으로 실행함.
 * - map.updateBy(coord, zoom) / map.setCenter(coord) / map.setZoom(zoom) : 폴백 카메라 이동 API임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : focusHospitalOnMap(hospital, targetZoom = 15)
 * - 지역 변수 : naverMaps, targetLatLng(getHospitalLatLng(hospital) 반환 좌표)
 *
 * [동작 흐름]
 * - 호출 : handleInitialHospitalDeepLink, updateSearch, loadEtaRanking 추천 클릭 시 호출함.
 * - 좌표 유효성 검사 통과 -> state.hasFitted = true (후속 스냅샷 로드의 자동 피팅 덮어쓰기 방지)
 * - GL 모드 미준비 시 -> 'glReady'에 focusHospitalOnMap 재호출 예약 후 종료
 * - 준비 완료 -> morph(450ms, easeOutCubic) -> updateBy -> setCenter + setZoom 순으로 폴백 이동
 */

export function mountNaverMap(options = {}) {
    const { temporary2dFallback = false } = options;
    const naverMaps = window.naver?.maps;
    if (!naverMaps) {
        return;
    }

    const mapContainer = byId('map');
    if (!mapContainer) {
        return;
    }

    const mountGen = ++mapMountGeneration;
    if (glWaitTimerId) {
        clearTimeout(glWaitTimerId);
        glWaitTimerId = null;
    }
    if (glReadyTimerId) {
        clearTimeout(glReadyTimerId);
        glReadyTimerId = null;
    }

    let prevCenter = new naverMaps.LatLng(state.origin.lat, state.origin.lng);
    let prevZoom = 12;

    try {
        const currentCenter = state.map?.getCenter?.();
        if (currentCenter) {
            prevCenter = currentCenter;
        }
        const currentZoom = state.map?.getZoom?.();
        if (Number.isFinite(currentZoom)) {
            prevZoom = currentZoom;
        }
    } catch (err) {
        void err;
    }

    const savedActiveRoute = (
        state.activeRoute?.hospital &&
        state.activeRoute?.data?.code === 0 &&
        Array.isArray(state.activeRoute.data.path) &&
        state.activeRoute.data.path.length
    ) ? { ...state.activeRoute } : null;

    for (const overlay of state.markerMap.values()) {
        try {
            overlay.setMap(null);
        } catch (err) {
            void err;
        }
    }
    state.markerMap.clear();

    try {
        state.circle?.setMap(null);
    } catch (err) {
        void err;
    }
    state.circle = null;
    state.circleKey = null;
    state.circleMap = null;

    try {
        state.locationMarker?.setMap(null);
    } catch (err) {
        void err;
    }
    state.locationMarker = null;

    state.glRouteActive = false;
    state.glRouteMap = null;
    try {
        state.routePolyline?.setMap(null);
        state.routeOutlinePolyline?.setMap(null);
        state.waypointMarker?.setMap(null);
    } catch (err) {
        void err;
    }
    state.routePolyline = null;
    state.routeOutlinePolyline = null;
    state.waypointMarker = null;
    state.routeSectionPolylines = [];

    try {
        state.trafficLayer?.setMap(null);
    } catch (err) {
        void err;
    }
    state.trafficLayer = null;

    try {
        state.map?.destroy?.();
    } catch (err) {
        void err;
    }

    const canvasHost = document.createElement('div');
    canvasHost.className = 'naver-map-canvas';
    canvasHost.style.width = '100%';
    canvasHost.style.height = '100%';
    mapContainer.replaceChildren(canvasHost);

    const baseOptions = {
        center: prevCenter,
        zoom: prevZoom,
        zoomControl: false,
        mapDataControl: false
    };
    /*
     * [JS/DOM 내장 API]
     * - Array.isArray(val) : 값이 배열인지 확인하는 표준 정적 메서드임.
     * - Map.prototype.values() / Map.prototype.clear() : Map의 모든 값 순회 및 초기화 메서드임.
     * - document.createElement('div') / element.replaceChildren(child) : 캔버스 div 생성·교체 API임.
     *
     * [네이버 지도 SDK 내장 API]
     * - map.getCenter() / map.getZoom() / map.destroy() : 현재 중심·줌 조회 및 지도 해제 메서드임.
     * - overlay.setMap(null) : 마커·원·폴리라인·교통 레이어를 지도에서 분리하는 메서드임.
     *
     * [프로젝트 내부 변수]
     * - DOM 참조 : mapContainer(#map), canvasHost(새 div.naver-map-canvas)
     * - 지역 변수 : naverMaps, prevCenter, prevZoom, currentCenter, currentZoom, savedActiveRoute, baseOptions
     */

    if (!naverMaps.glEnabled && !state._glPermanentUnsupported && !temporary2dFallback) {
        if (!state._glCallbackBound) {
            state._glCallbackBound = true;
            const handleGlSubmoduleLoaded = () => {
                state._glWaitFinished = true;
                if (glWaitTimerId) {
                    clearTimeout(glWaitTimerId);
                    glWaitTimerId = null;
                }
                if (window.naver?.maps?.glEnabled) {
                    const glSupportedNow =
                        typeof window.naver.maps.Util?.glSupported !== 'function' ||
                        window.naver.maps.Util.glSupported();
                    if (!glSupportedNow) {
                        state._glPermanentUnsupported = true;
                        if (!state.map) {
                            mountNaverMap({ temporary2dFallback: true });
                        }
                        return;
                    }
                    if (!state.map || state.map.get?.('renderMode') !== 2) {
                        mountNaverMap();
                    }
                } else if (!state.map) {
                    mountNaverMap({ temporary2dFallback: true });
                }
            };
            const prevCallback = naverMaps.onJSContentLoaded;
            naverMaps.onJSContentLoaded = (...args) => {
                if (typeof prevCallback === 'function') {
                    prevCallback(...args);
                }
                handleGlSubmoduleLoaded();
            };
        }
        if (!state._glWaitFinished) {
            glWaitTimerId = setTimeout(() => {
                glWaitTimerId = null;
                if (mountGen !== mapMountGeneration || state._glWaitFinished) {
                    return;
                }
                state._glWaitFinished = true;
                mountNaverMap({ temporary2dFallback: !window.naver?.maps?.glEnabled });
            }, 3500);
            return;
        }
    }

    let glSupported = false;
    if (naverMaps.glEnabled) {
        glSupported = typeof naverMaps.Util?.glSupported !== 'function' || naverMaps.Util.glSupported();
        if (!glSupported) {
            state._glPermanentUnsupported = true;
        }
    }

    const glSubmoduleReady = Boolean(
        !temporary2dFallback &&
        !state._glPermanentUnsupported &&
        naverMaps.glEnabled &&
        glSupported
    );

    let usingGlEngine = false;
    if (glSubmoduleReady) {
        try {
            const glOptions = {
                ...baseOptions,
                gl: true
            };
            if (state.darkMode && state.naverDarkStyleId) {
                glOptions.customStyleId = state.naverDarkStyleId;
            }
            state.map = new naverMaps.Map(canvasHost, glOptions);
            usingGlEngine = state.map?.get?.('renderMode') === 2;
        } catch (err) {
            state.diagnostics.lastError = String(err?.message || err);
            state.map = new naverMaps.Map(canvasHost, baseOptions);
        }
    } else {
        state.map = new naverMaps.Map(canvasHost, baseOptions);
    }
    /*
     * [네이버 지도 SDK 내장 API]
     * - naver.maps.glEnabled : submodules=gl 서브모듈 스크립트 로드 완료 여부 플래그임.
     * - naver.maps.onJSContentLoaded : 비동기 서브모듈 로드 완료 시 호출되는 SDK 콜백 훅임.
     * - naver.maps.Util.glSupported() : GL 서브모듈 로드 후(naverMaps.glEnabled === true)에만 WebGL 지원 여부를 판별함(로드 전 스텁 false 오판 방지).
     * - new naver.maps.Map(container, options) : 지도 인스턴스 생성자(gl, customStyleId 지원).
     * - map.get('renderMode') : 반환값이 2이면 WebGL 벡터 엔진이 실제 가동 중임을 뜻함.
     *
     * [프로젝트 내부 변수]
     * - 상태 플래그 : state._glWaitFinished, state._glCallbackBound, state._glPermanentUnsupported
     * - 매개·지역 변수 : temporary2dFallback, mountGen, glSupported, handleGlSubmoduleLoaded, glSubmoduleReady, usingGlEngine
     *
     * [동작 흐름]
     * - !naverMaps.glEnabled && !state._glPermanentUnsupported -> 서브모듈 로드 대기 (3.5초 타임아웃)
     *   └── 임시 2D 전환 뒤에도 onJSContentLoaded가 도착하면 glSupported() 확인 후 GL 업그레이드(또는 미지정 시 2D 마운트)를 수행함.
     * - glSubmoduleReady 참 -> glOptions(gl: true, 다크 모드 시 customStyleId)로 GL 지도 생성
     * - 일시적 지연 폴백 시 temporary2dFallback만 사용하고 영구 잠금을 걸지 않아 콜드스타트 라이트 고착을 방지함.
     */

    const syncMapOverlays = () => {
        if (!state.hasFitted && state.hospitals.length > 0) {
            state.hasFitted = true;
            fitRadius();
        }
        updateCircle();
        updateLocationMarker();
        uiCallbacks.onUpdateMarkers?.();
        if (state.trafficEnabled) {
            syncTrafficLayer();
        }
    };

    if (usingGlEngine) {
        const currentGlMap = state.map;
        let glSettled = false;
        const finishGlReady = () => {
            if (glSettled || mountGen !== mapMountGeneration || state.map !== currentGlMap) {
                return;
            }
            glSettled = true;
            if (glReadyTimerId) {
                clearTimeout(glReadyTimerId);
                glReadyTimerId = null;
            }
            syncMapOverlays();
            if (savedActiveRoute) {
                uiCallbacks.onDrawRouteOnMap?.(savedActiveRoute.hospital, savedActiveRoute.data, {
                    fitMap: false,
                    apiType: savedActiveRoute.apiType,
                    option: savedActiveRoute.option,
                    rawWaypoint: savedActiveRoute.rawWaypoint
                });
            }
        };

        naverMaps.Event.addListener(currentGlMap, 'glReady', finishGlReady);

        if (currentGlMap.isGLReady?.()) {
            finishGlReady();
        } else {
            glReadyTimerId = setTimeout(() => {
                glReadyTimerId = null;
                if (
                    !glSettled &&
                    mountGen === mapMountGeneration &&
                    state.map === currentGlMap &&
                    !currentGlMap.isGLReady?.()
                ) {
                    mountNaverMap({ temporary2dFallback: true });
                }
            }, 10000);
        }
    } else {
        naverMaps.Event.addListener(state.map, 'init', syncMapOverlays);
        syncMapOverlays();
        if (savedActiveRoute) {
            uiCallbacks.onDrawRouteOnMap?.(savedActiveRoute.hospital, savedActiveRoute.data, {
                fitMap: false,
                apiType: savedActiveRoute.apiType,
                option: savedActiveRoute.option,
                rawWaypoint: savedActiveRoute.rawWaypoint
            });
        }
    }

    naverMaps.Event.addListener(state.map, 'idle', () => {
        state.diagnostics.idleEventCount += 1;
        uiCallbacks.onUpdateMarkers?.();
    });

    naverMaps.Event.addListener(state.map, 'rightclick', event => {
        const coord = event?.coord || event?.latlng;
        if (coord && typeof coord.lat === 'function' && typeof coord.lng === 'function') {
            uiCallbacks.onCustomOrigin?.(coord.lat(), coord.lng(), '우클릭 지정 출발지');
        }
    });

    naverMaps.Event.addListener(state.map, 'longtap', event => {
        const coord = event?.coord || event?.latlng;
        if (coord && typeof coord.lat === 'function' && typeof coord.lng === 'function') {
            uiCallbacks.onCustomOrigin?.(coord.lat(), coord.lng(), '길게 눌러 지정한 출발지');
        }
    });

    for (const eventName of ['dragstart', 'zoom_changed']) {
        naverMaps.Event.addListener(state.map, eventName, blurKeyword);
    }
}
/*
 * [네이버 지도 SDK 내장 API]
 * - naver.maps.Event.addListener(map, eventName, fn) : 지도에 이벤트 리스너를 등록함.
 *   · 'glReady' : WebGL 스타일 초기화가 끝나 isGLReady()가 참이 될 때 발생함.
 *   · 'init' : 2D 일반 지도 초기화가 완료될 때 발생함.
 *   · 'idle' : 지도 이동·확대·축소 애니메이션이 완전히 멈출 때 발생함.
 *   · 'rightclick' / 'longtap' : 마우스 우클릭 또는 모바일 길게 누르기 시 좌표와 함께 발생함.
 *   · 'dragstart' / 'zoom_changed' : 지도 드래그 시작 또는 줌 변경 시 발생함.
 * - coord.lat() / coord.lng() : 이벤트 좌표 객체에서 위도와 경도 실수를 꺼내는 메서드임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·내부 콜백 : mountNaverMap(options), syncMapOverlays(), finishGlReady()
 * - 지역 변수 : currentGlMap, glSettled, event, coord, eventName
 *
 * [동작 흐름]
 * - 호출 : init(), syncFrontendConfig(), applyTheme(), GL 대기·임시 폴백 타임아웃에서 호출함.
 * - 1단계 백업·정리 -> 중심·줌·savedActiveRoute 백업 -> 이전 대기 타이머·오버레이·지도 해제 -> canvasHost 교체
 * - 2단계 엔진 마운트 -> GL 준비 시 glReady(또는 동기 isGLReady()), 2D 모드 시 init + 즉시 syncMapOverlays() 실행
 *   ├── syncMapOverlays() -> fitRadius -> updateCircle -> updateLocationMarker -> onUpdateMarkers
 *   ├── savedActiveRoute 존재 시 -> uiCallbacks.onDrawRouteOnMap?.(..., { fitMap: false }) 복원
 *   └── GL 10000ms 내 미준비 -> 영구 차단 없이 일시 mountNaverMap({ temporary2dFallback: true }) 폴백 실행
 * - 3단계 이벤트 연결 -> 지도 생성 뒤 상시 상호작용 리스너를 등록함
 *   ├── 'idle' -> uiCallbacks.onUpdateMarkers?.()로 화면 마커 갱신
 *   ├── 'rightclick' / 'longtap' -> uiCallbacks.onCustomOrigin?.(lat, lng, 라벨)로 출발지 이동
 *   └── 'dragstart' / 'zoom_changed' -> blurKeyword()로 검색창 포커스 해제
 */