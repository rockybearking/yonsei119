/*
 * ============================================================================
 * [1. 역할 및 실행 시점]
 * - 역할 : 네이버 지도 v3 WebGL / 2D 엔진 구동, 화면 픽셀 투영, 탐색 반경 원(기본 50km),
 *          그리고 네이버 실시간 교통 벡터 타일(`ctt`) 연동을 담당하는 지도 기관실
 * - 실행 시점 : `app.js : init()`에서 `mountNaverMap()`이 최초 1회 실행되며,
 *              이후 카메라 이동(`idle`), 테마 전환, 반경 변경, 교통·경로 활성화 시 호출됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [app.js / Controls]         [map-engine.js]                   [Naver Maps GL]      [directions-eta.js]
 *                |                         |                                 |                      |
 *                |-- 1. mountNaverMap() -->|                                 |                      |  지도 초기화 요청
 *                |                         |-- 2. new Map({ gl: true }) ---->|                      |  WebGL 다크/라이트 생성
 *                |                         |<-- 3. glReady event ------------|                      |  스타일 로드 완료
 *           +----+-------------------------+---------------------------------+----------------------+-----------+
 *           | [opt : traffic ON or active route]                                                                |  교통 레이어 또는 경로 활성
 *           |    |                         |-- 4. syncGlTrafficSource() ---->|                      |           |  ctt 벡터 타일 적재 유지
 *           |    |                         |-- 5. onTrafficTilesUpdated() ---|--------------------->|           |  경로선 실시간 색상 재동기화
 *           +----+-------------------------+---------------------------------+----------------------+-----------+
 *                v                         v                                 v                      v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 외부 SDK / 프로젝트 내부)]
 * - JS / 브라우저 표준 내장
 *   ㄴ Promise                   : 스크립트 비동기 로드를 감싸는 표준 내장 클래스
 *   ㄴ class / extends           : `OverlayView`를 상속해 커스텀 오버레이를 만드는 문법 키워드
 *   ㄴ document.createElement    : `<script>` · `<div>` 요소를 동적 생성하는 브라우저 메서드
 *   ㄴ Math                      : 삼각함수·로그·반올림으로 웹 메르카토르 좌표를 계산하는 내장 객체
 *   ㄴ setTimeout / clearTimeout : GL 초기화 대기 타이머를 제어하는 브라우저 내장 함수
 * - 외부 SDK / 라이브러리
 *   ㄴ naver.maps.Map          : 네이버 지도 v3 메인 지도 클래스 (WebGL `gl: true` 지원)
 *   ㄴ naver.maps.OverlayView  : HTML DOM을 지도 위경도에 고정하는 공식 추상 클래스
 *   ㄴ naver.maps.Circle       : 탐색 반경 원을 그리는 도형 오버레이 클래스
 *   ㄴ naver.maps.TrafficLayer : 네이버 공식 실시간 교통 소통 레이어 클래스
 * - 프로젝트 내부 모듈
 *   ㄴ constants.js        : 기본 Client ID · 기본 반경(`50`) · CSS translate 지원 상수
 *   ㄴ state.js / utils.js : 전역 런타임 상태 · 콜백 슬롯 · 반경 경계 계산 유틸
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 호출하는 모듈
 *   ㄴ frontend/js/app.js             : ensureNaverMapSdkLoaded(), mountNaverMap(), toggleTrafficLayer()
 *   ㄴ frontend/js/markers-cluster.js : coordToScreenPoint(), createNaverDomOverlay(), getHospitalLatLng()
 *   ㄴ frontend/js/directions-eta.js  : syncGlTrafficSourceVisibility(), fitBounds(), updateCircle()
 *   ㄴ frontend/js/search-controls.js : fitRadius(), focusHospitalOnMap(), updateLocationMarker()
 * - 연결된 HTML / CSS
 *   ㄴ frontend/index.html           : `#map`, `#traffic-toggle`, `#naver-maps-sdk`
 *   ㄴ frontend/css/map-overlays.css : `.location-marker`, `.waypoint-marker`
 * - IntelliJ 추적 단축키
 *   ㄴ Ctrl + Alt + H   : 함수명 위에서 호출 계층(Call Hierarchy) 추적
 *   ㄴ Ctrl + Shift + F : `syncGlTrafficSourceVisibility` 전체 검색
 * ============================================================================
 */

import {
    CAN_USE_CSS_TRANSLATE,
    DEFAULT_NAVER_CLIENT_ID,
    DEFAULT_RADIUS_KM
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

const CTT_METADATA_URL = 'https://map.pstatic.net/nvc/ctt/wmts/naver/getMetadata/v1';
const CTT_PROBE_LAYER_ID = 'yonsei-ctt-probe';

let sdkLoadPromise = null;
let loadedSdkClientId = DEFAULT_NAVER_CLIENT_ID;
let mapMountGeneration = 0;
let glWaitTimerId = null;
let glReadyTimerId = null;

/*
 * [역할 및 사용처]
 * - 역할 : 네이버 지도 JS SDK(`submodules=gl`) 로드 여부를 확인하고 미로드·키 변경 시 동적 로드함
 * - 사용처
 *   ㄴ frontend/js/app.js             : `init()`
 *   ㄴ frontend/js/search-controls.js : `syncFrontendConfig()`
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
 * [역할 및 사용처]
 * - 역할 : 병원 객체마다 네이버 `LatLng` 좌표 객체를 캐싱(`hospital._latLng`)하여 재생성 비용을 없앰
 * - 사용처
 *   ㄴ frontend/js/app.js             : `#cluster-zoom` 클릭 핸들러
 *   ㄴ frontend/js/map-engine.js      : `fitRadius()`, `focusHospitalOnMap()`
 *   ㄴ frontend/js/markers-cluster.js : `updateMarkers()`
 *   ㄴ frontend/js/search-controls.js : `applySnapshotToState()`
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
 * [역할 및 사용처]
 * - 역할 : 지도가 생성되었고 WebGL 모드(`renderMode === 2`)일 때 `isGLReady()`가 완료되었는지 확인함
 * - 사용처
 *   ㄴ frontend/js/map-engine.js      : 오버레이·반경원·카메라 이동 함수 전반
 *   ㄴ frontend/js/markers-cluster.js : `updateMarkers()`
 *   ㄴ frontend/js/directions-eta.js  : `drawRouteOnMap()`
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
 * [역할 및 사용처]
 * - 역할 : 위경도 좌표를 현재 화면 픽셀 좌표(`{ x, y }`)로 투영함 (미준비 시 메르카토르 수식 폴백)
 * - 사용처
 *   ㄴ frontend/js/markers-cluster.js : `updateMarkers()` 격자 클러스터 계산
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
 * [역할 및 사용처]
 * - 역할 : 네이버 `OverlayView`를 상속해 병원 카드·출발점·경유지 HTML 요소를 지도 위경도에 고정함
 * - 사용처
 *   ㄴ frontend/js/map-engine.js      : `updateLocationMarker()`
 *   ㄴ frontend/js/markers-cluster.js : `updateMarkers()`
 *   ㄴ frontend/js/directions-eta.js  : `drawRouteOnMap()` 경유지 배지
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
 * [역할 및 사용처]
 * - 역할 : 네이버 GL 도형(`Circle`, `Polyline`)의 중복 `drawGL()` 소스 재등록 경고를 방지함
 * - 사용처
 *   ㄴ frontend/js/map-engine.js     : `updateCircle()`
 *   ㄴ frontend/js/directions-eta.js : `drawRouteOnMap()` (2D 폴백 경로선)
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
 * [역할 및 사용처]
 * - 역할 : 출발 기준점 주변에 선택 반경(기본 `50 km`, `'all'`이면 숨김) 원을 생성·갱신함
 * - 사용처
 *   ㄴ frontend/js/map-engine.js      : `fitRadius()`, `mountNaverMap()`
 *   ㄴ frontend/js/markers-cluster.js : `updateMarkers()`
 *   ㄴ frontend/js/search-controls.js : `locate()`, `setCustomOrigin()`, `applyTheme()`
 *   ㄴ frontend/js/directions-eta.js  : `resetOriginAndRoute()`
 */
export function updateCircle(force = false) {
    if (!state.map || !isMapReadyForOverlays() || !window.naver?.maps) {
        return;
    }

    const radiusEl = byId('radius');
    const radius = radiusEl ? radiusEl.value : DEFAULT_RADIUS_KM;

    if (radius === 'all') {
        if (state.circle) {
            try {
                state.circle.setMap(null);
            } catch (err) {
                void err;
            }
            state.circle = null;
            state.circleKey = null;
            state.circleMap = null;
        }
        return;
    }

    const radiusMeters = Number(radius) * 1000;
    const strokeColor = state.darkMode ? '#60a5fa' : '#0f5fd6';
    const fillColor = state.darkMode ? '#3b82f6' : '#0f5fd6';
    const fillOpacity = state.darkMode ? 0.1 : 0.06;

    const nextKey = [
        state.origin.lat.toFixed(6),
        state.origin.lng.toFixed(6),
        radiusMeters,
        state.darkMode ? 'dark' : 'light'
    ].join('|');

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

    state.circle = guardGlShapeRedraw(new window.naver.maps.Circle({
        map: state.map,
        center: new window.naver.maps.LatLng(state.origin.lat, state.origin.lng),
        radius: radiusMeters,
        strokeColor,
        strokeOpacity: 0.34,
        strokeWeight: 2,
        fillColor,
        fillOpacity,
        clickable: false
    }));
    state.circleKey = nextKey;
    state.circleMap = state.map;
    state.diagnostics.circleCreatedCount += 1;
}

/*
 * [역할 및 사용처]
 * - 역할 : 사용자 GPS 현재 위치 또는 우클릭·검색으로 지정한 출발지에 파란 점 마커를 표시함
 * - 사용처
 *   ㄴ frontend/js/map-engine.js      : `mountNaverMap()`
 *   ㄴ frontend/js/search-controls.js : `locate()`, `setCustomOrigin()`
 *   ㄴ frontend/js/directions-eta.js  : `resetOriginAndRoute()`
 */
export function updateLocationMarker() {
    if (state.locationMarker) {
        try {
            state.locationMarker.setMap(null);
        } catch (err) {
            void err;
        }
        state.locationMarker = null;
    }

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
 * [역할 및 시퀀스 흐름 — 경로선 · 교통 레이어 단일 데이터원(`ctt`) 핵심 연동]
 * - 역할 : 네이버 공식 실시간 교통 벡터 소스(`ctt`)와 투명 프로브 레이어(`yonsei-ctt-probe`)를 관리함
 * - 왜 투명 프로브 레이어가 필요한가?
 *   ㄴ 사용자가 `교통` 버튼을 끄고 `지도에 경로 표시`만 눌렀을 때도 Mapbox GL이 현재 화면의
 *      `ctt` 도로 링크 타일을 백그라운드에서 내려받게 하여, 경로선이 언제나 실제 교통정보와
 *      100% 동일한 색상으로 칠해지도록 보장함 (경로·교통 모두 꺼지면 즉시 타일 요청 중단)
 * - 사용처
 *   ㄴ frontend/js/map-engine.js     : `syncTrafficLayer()`
 *   ㄴ frontend/js/directions-eta.js : `renderGlRoute()`, `removeRouteOverlays()`
 */
export function syncGlTrafficSourceVisibility(routeNeedsCtt = Boolean(state.activeRoute)) {
    const mapbox = state.map?.getMapbox?.();
    if (!mapbox || typeof mapbox.getStyle !== 'function') {
        return null;
    }

    const style = mapbox.getStyle();
    if (!style || !Array.isArray(style.layers)) {
        return null;
    }

    const trafficVisible = Boolean(state.trafficEnabled);
    const needCttTiles = trafficVisible || Boolean(routeNeedsCtt);
    const trafficVisibility = trafficVisible ? 'visible' : 'none';
    const probeVisibility = needCttTiles ? 'visible' : 'none';

    let hasBuiltInCttLayers = false;
    let detectedCttSourceId = mapbox.getSource('ctt') ? 'ctt' : null;

    for (const layer of style.layers) {
        const group = layer?.metadata?.group;
        const layerId = String(layer?.id || '');
        if (group === 'ctt' || group === 'dctt' || layerId.startsWith('CTT/')) {
            hasBuiltInCttLayers = true;
            if (!detectedCttSourceId && layer.source) {
                detectedCttSourceId = layer.source;
            }
            try {
                mapbox.setLayoutProperty(layerId, 'visibility', trafficVisibility);
            } catch (err) {
                void err;
            }
        }
    }

    if (!detectedCttSourceId) {
        if (!needCttTiles) {
            return null;
        }
        try {
            mapbox.addSource('ctt', {
                type: 'vector',
                url: CTT_METADATA_URL
            });
            detectedCttSourceId = 'ctt';
        } catch (err) {
            void err;
            return null;
        }
    }

    if (!mapbox._yonseiCttListenerBound && typeof mapbox.on === 'function') {
        mapbox._yonseiCttListenerBound = true;
        mapbox.on('sourcedata', evt => {
            if (evt?.sourceId === detectedCttSourceId && evt?.isSourceLoaded) {
                uiCallbacks.onTrafficTilesUpdated?.();
            }
        });
    }

    const firstSymbolLayer = style.layers.find(l => l.type === 'symbol')?.id;

    // `line-opacity: 0.002`는 화면에서는 완전히 투명(0/255)하지만 GL 타일 컬링을 통과해 ctt 타일을 정상 적재함
    if (!mapbox.getLayer(CTT_PROBE_LAYER_ID)) {
        try {
            mapbox.addLayer({
                id: CTT_PROBE_LAYER_ID,
                type: 'line',
                source: detectedCttSourceId,
                'source-layer': 'ctt',
                minzoom: 4,
                maxzoom: 22,
                layout: {
                    visibility: probeVisibility,
                    'line-cap': 'butt'
                },
                paint: {
                    'line-color': '#000000',
                    'line-opacity': 0.002,
                    'line-width': 0.5
                }
            }, firstSymbolLayer);
        } catch (err) {
            void err;
        }
    } else {
        try {
            mapbox.setLayoutProperty(CTT_PROBE_LAYER_ID, 'visibility', probeVisibility);
        } catch (err) {
            void err;
        }
    }

    // 커스텀 다크 스타일 등 내장 CTT/* 레이어가 없는 스타일에만 커스텀 교통선 레이어를 추가함
    if (!hasBuiltInCttLayers) {
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
                        source: detectedCttSourceId,
                        'source-layer': 'ctt',
                        minzoom: 4,
                        maxzoom: 22,
                        filter: ['==', 'state', spec.stateVal],
                        layout: {
                            visibility: trafficVisibility,
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
                    mapbox.setLayoutProperty(spec.id, 'visibility', trafficVisibility);
                } catch (err) {
                    void err;
                }
            }
        }
    }

    return detectedCttSourceId;
}

/*
 * [역할 및 사용처]
 * - 역할 : `state.trafficEnabled`에 맞춰 네이버 `TrafficLayer` 및 WebGL `ctt` 레이어를 켜고 끔
 * - 사용처
 *   ㄴ frontend/js/map-engine.js : `toggleTrafficLayer()`, `mountNaverMap()`
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

    syncGlTrafficSourceVisibility();
    if (state.activeRoute) {
        uiCallbacks.onTrafficTilesUpdated?.();
    }
}

/*
 * [역할 및 사용처]
 * - 역할 : 툴바 `#traffic-toggle` 클릭 시 실시간 교통정보 표시 상태를 반전하고 ARIA를 갱신함
 * - 사용처
 *   ㄴ frontend/js/app.js : `#traffic-toggle` 클릭 이벤트 리스너
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
 * [역할 및 사용처]
 * - 역할 : 상단 경로 배너와 하단 검색 패널 여백을 고려해 `bounds` 영역이 화면에 다 들어오게 맞춤
 * - 사용처
 *   ㄴ frontend/js/app.js            : `#cluster-zoom` 클릭 리스너
 *   ㄴ frontend/js/map-engine.js     : `fitRadius()`
 *   ㄴ frontend/js/directions-eta.js : `drawRouteOnMap()`
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
 * [역할 및 사용처]
 * - 역할 : 선택된 탐색 반경(기본 `50 km` 또는 `'all'` 전국)에 맞춰 지도 시야와 반경 원을 맞춤
 * - 사용처
 *   ㄴ frontend/js/map-engine.js      : `mountNaverMap()`
 *   ㄴ frontend/js/search-controls.js : `initRadius()`, `applySnapshotToState()`, `locate()`
 *   ㄴ frontend/js/directions-eta.js  : `resetOriginAndRoute()`
 */
export function fitRadius() {
    const naverMaps = window.naver?.maps;
    if (!state.map || !naverMaps) {
        return;
    }

    const radiusVal = byId('radius')?.value || DEFAULT_RADIUS_KM;
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
 * [역할 및 사용처]
 * - 역할 : 특정 병원 좌표로 카메라를 부드럽게(`morph`, 450ms) 이동·확대함
 * - 사용처
 *   ㄴ frontend/js/search-controls.js : `handleInitialHospitalDeepLink()`, `updateSearch()`
 *   ㄴ frontend/js/directions-eta.js  : `loadEtaRanking()` 추천 병원 클릭
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
 * [역할 및 사용처]
 * - 역할 : `#map`에 네이버 WebGL(다크 스타일 포함) 또는 2D 지도를 생성하고 활성 경로·이벤트를 복원함
 * - 사용처
 *   ㄴ frontend/js/app.js             : `init()`
 *   ㄴ frontend/js/search-controls.js : `syncFrontendConfig()`, `applyTheme()`
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
        if (state.activeRoute) {
            uiCallbacks.onTrafficTilesUpdated?.();
        }
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
