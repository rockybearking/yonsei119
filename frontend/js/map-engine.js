/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 네이버 지도 v3 WebGL/2D 엔진 구동·오버레이 좌표 투영·탐색 반경 원·실시간 교통 레이어를 담당하는 지도 기관실
 * - 실행 시점: `app.js:init()`에서 `mountNaverMap()`으로 최초 1회 지도를 마운트하며,
 *   이후 지도 이동(`idle`), 테마 변경, 반경 조절, 교통 버튼 클릭 시 관련 함수가 호출됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   `ensureNaverMapSdkLoaded()` ──> `mountNaverMap()` (WebGL 다크 스타일 우선, 미지원 시 2D 안전 폴백)
 *   ├── `syncMapOverlays()` ──> `fitRadius()` + `updateCircle()` + `updateLocationMarker()` + `onUpdateMarkers()`
 *   ├── `createNaverDomOverlay()` ──> 병원 카드·출발점·경유지를 GPU `translate`로 지도 좌표에 고정
 *   └── `toggleTrafficLayer()` ──> `TrafficLayer` 및 WebGL 교통 벡터 타일(`#27c441`·`#ff8d00`·`#ff3b30`) 토글
 *
 * [사용처 및 IDE 추적 가이드]
 * - 호출 모듈: `app.js`, `markers-cluster.js`, `directions-eta.js`, `search-controls.js`
 * - 연결 HTML/CSS: `index.html` (`#map`, `#traffic-toggle`, `#naver-maps-sdk`), `css/map-overlays.css`
 * - IntelliJ 추적 팁: 함수명 위에서 `Ctrl + Alt + H` 또는 `Ctrl + Shift + F`로 `mountNaverMap` 검색
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

let sdkLoadPromise = null;
let loadedSdkClientId = DEFAULT_NAVER_CLIENT_ID;
let mapMountGeneration = 0;
let glWaitTimerId = null;
let glReadyTimerId = null;

/*
 * [역할 및 데이터 흐름]
 * - 역할: 네이버 지도 JS SDK(`submodules=gl`)가 지정된 `targetClientId`로 로드되었는지 확인하고, 필요 시 동적 `<script>`로 교체 로드함
 * - 흐름: 동일 키 로드 완료 시 즉시 `true` 반환 ──> 변경·미로드 시 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=...&submodules=gl` 삽입
 * - 호출처: `app.js:init()`, `search-controls.js:syncFrontendConfig()`
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
 * [역할 및 성능 원리]
 * - 역할: 병원 객체에 네이버 지도 `LatLng` 인스턴스를 캐싱(`hospital._latLng`)하여 지도 이동마다 좌표 객체를 재생성하지 않게 함
 * - 호출처: `app.js`(`#cluster-zoom`), `fitRadius()`, `focusHospitalOnMap()`, `markers-cluster.js:updateMarkers()`, `search-controls.js:applySnapshotToState()`
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
 * [역할 및 호출처]
 * - 역할: 지도가 생성되었고 WebGL 모드(`renderMode === 2`)일 경우 벡터 스타일(`isGLReady()`)까지 준비 완료되었는지 확인함
 * - 호출처: `coordToScreenPoint()`, `createNaverDomOverlay`, `updateCircle()`, `updateLocationMarker()`, `fitBounds()`, `markers-cluster.js`, `directions-eta.js`
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
 * [역할 및 데이터 흐름]
 * - 역할: 위도·경도 좌표를 현재 지도 화면의 픽셀 좌표(`{ x, y }`)로 변환함 (투영기 미준비 시 웹 메르카토르 수학 공식으로 폴백)
 * - 호출처: `markers-cluster.js:updateMarkers()` (병원 카드 격자 클러스터링 계산용)
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
 * [역할 및 동작 원리]
 * - 역할: 네이버 지도 SDK의 `OverlayView`를 상속해 HTML 요소(병원 카드·출발점·경유지)를 지도 위경도에 맞춰 따라다니게 함
 * - 성능 원리: 좌표가 실제로 바뀔 때만 CSS `style.translate`를 갱신해 불필요한 DOM 리플로우를 차단함
 * - 호출처: `updateLocationMarker()`, `markers-cluster.js:updateMarkers()`, `directions-eta.js:drawRouteOnMap()`
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
 * [역할 및 호출처]
 * - 역할: 네이버 GL 도형(`Circle`, `Polyline`)이 이미 소스를 등록한 뒤 중복 `drawGL()`을 호출해 콘솔 경고를 내는 현상을 막음
 * - 호출처: `updateCircle()`, `directions-eta.js:drawRouteOnMap()`(2D 폴백 경로선)
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
 * [역할 및 데이터 흐름]
 * - 역할: 출발 기준점(`state.origin`) 주변에 선택된 탐색 반경(기본 `50 km`, `'all'`이면 숨김) 원을 지도에 그림
 * - 성능 원리: 좌표·반경·테마 조합 키(`state.circleKey`)가 직전과 같으면 기존 원을 그대로 재사용함
 * - 호출처: `fitRadius()`, `mountNaverMap()`, `markers-cluster.js:updateMarkers()`, `search-controls.js`, `directions-eta.js`
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
 * [역할 및 호출처]
 * - 역할: GPS 측위 또는 사용자 지정 출발점이 활성(`state.locationKnown === true`)일 때 파동 애니메이션 출발 마커(`.location-marker`)를 지도에 표시함
 * - 호출처: `mountNaverMap()`, `search-controls.js` (`locate`, `setCustomOrigin`), `directions-eta.js:resetOriginAndRoute()`
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
 * [역할 및 색상 기준 — 경로 안내 색상과 1:1 통일]
 * - 역할: WebGL 커스텀 다크·라이트 스타일에서도 네이버 실시간 교통 벡터 타일(`ctt`)이 선명하게 보이도록 레이어 가시성을 동기화함
 * - 공식 소통 색상: 원활(`state=1`) `#27c441`, 서행(`state=2`) `#ff8d00`, 정체(`state=4`) `#ff3b30` (`directions-eta.js` 경로선과 동일 색상 사용)
 * - 호출처: `syncTrafficLayer()`
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
 * [역할 및 호출처]
 * - 역할: `state.trafficEnabled` 플래그에 맞춰 네이버 2D `TrafficLayer`와 WebGL 교통 레이어를 지도에 켜거나 끔
 * - 호출처: `toggleTrafficLayer()`, `mountNaverMap()`
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
 * [역할 및 호출처]
 * - 역할: 툴바 `#traffic-toggle` 버튼 클릭 시 실시간 교통정보 표시 여부를 반전하고 ARIA 상태를 갱신함
 * - 호출처: `app.js:init()` (`#traffic-toggle` 클릭 리스너)
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
 * [역할 및 데이터 흐름]
 * - 역할: 상단 경로 배너와 하단 검색 패널에 가리지 않도록 안전 여백을 계산해 `bounds`가 화면 안에 다 들어오게 카메라를 맞춤
 * - 호출처: `app.js`(`#cluster-zoom`), `fitRadius()`, `directions-eta.js:drawRouteOnMap()`
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
 * [역할 및 데이터 흐름]
 * - 역할: 선택된 탐색 반경(기본 `50 km` 또는 `'all'` 전국)에 맞춰 지도 줌·중심을 맞추고 반경 원을 갱신함
 * - 호출처: `mountNaverMap()`, `search-controls.js` (`initRadius`, `applySnapshotToState`, `locate`, `geocodeAndMoveOrigin`), `directions-eta.js:resetOriginAndRoute()`
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
 * [역할 및 호출처]
 * - 역할: 특정 병원 좌표로 지도 카메라를 부드럽게(`morph`, 450ms) 이동·확대함
 * - 호출처: `search-controls.js` (`handleInitialHospitalDeepLink`, `updateSearch`), `directions-eta.js:loadEtaRanking()`
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
 * [역할 및 데이터 흐름]
 * - 역할: `#map` 컨테이너에 네이버 지도 인스턴스를 생성(또는 테마 전환 시 기존 중심·경로를 보존해 재생성)하고 상호작용 이벤트를 바인딩함
 * - 흐름:
 *   1) 직전 중심·줌·활성 경로(`savedActiveRoute`) 백업 후 기존 오버레이·지도 정리
 *   2) GL 서브모듈 준비 시 WebGL 지도(다크모드면 `customStyleId` 적용) 생성, 미지원 환경은 2D 폴백 생성
 *   3) `glReady` / `init` 완료 시 `syncMapOverlays()` 및 활성 경로 복원
 *   4) `'idle'`(마커 갱신), `'rightclick'`·`'longtap'`(출발지 지정), `'dragstart'`·`'zoom_changed'`(키보드 닫기) 연결
 * - 호출처: `app.js:init()`, `search-controls.js` (`syncFrontendConfig`, `applyTheme`)
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
