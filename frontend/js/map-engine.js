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
 * [JS 문법] import { ... } from './...' : 지도 렌더링 상수(`constants.js`), 런타임 상태(`state.js`), DOM·기하 유틸(`utils.js`)을 가져옴.
 * [아키텍처 계층] `map-engine.js`는 네이버 지도 JS v3 WebGL 엔진 마운트, SDK 동적 로드, 커스텀 GPU 오버레이, 반경 원, 실시간 교통 레이어, 카메라 피팅을 전담함.
 */

let sdkLoadPromise = null;
let loadedSdkClientId = DEFAULT_NAVER_CLIENT_ID;
/*
 * [JS 문법] let : SDK 비동기 로딩 Promise와 현재 로드된 네이버 Client ID를 모듈 내부에서 추적하는 변수임.
 * [내가 지은 이름] sdkLoadPromise, loadedSdkClientId
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
 * [브라우저 내장 함수] encodeURIComponent(...), document.createElement('script'), replaceChild(...) (이름 변경 불가)
 * [내가 지은 이름] ensureNaverMapSdkLoaded : 프론트엔드와 백엔드(`application.yml` -> `GET /api/config`)의 네이버 Client ID(`ncpKeyId`)를 단일 진실 공급원으로 통합함.
 * [작동 원리 및 조립 URL 예시]
 * - 평상시(`cleanClientId === 'xfbxloc8km'`)에는 `index.html`이 이미 로드한 `window.naver.maps`를 0ms로 즉시 재사용함.
 * - 만약 서버 환경변수(`NAVER_MAP_CLIENT_ID`)가 새 키로 교체되었거나 초기 네트워크 순단으로 SDK 로드가 누락된 경우, 자동으로 아래 스크립트 URL을 재주입함:
 *   https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=발급받은클라이언트ID&submodules=gl
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
 * [네이버 지도 SDK 내장 타입] new window.naver.maps.LatLng(위도, 경도) : 지도 좌표 객체를 생성함 (이름 변경 불가).
 * [내가 지은 이름] getHospitalLatLng : 병원마다 `LatLng` 인스턴스를 최초 1번만 만들어 `hospital._latLng`에 캐싱해 두어, 지도 이동 때마다 수백 개 객체가 반복 할당되는 GC 부하를 제거함.
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
 * [네이버 지도 SDK 내장 함수] state.map.get('renderMode'), state.map.isGLReady() (이름 변경 불가)
 * [내가 지은 이름] isMapReadyForOverlays : WebGL 벡터 모드(`renderMode === 2`)에서 비동기 스타일 시트(`style.json`) 초기화가 완전히 끝났는지 안전하게 검증함.
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
 * [네이버 지도 SDK 내장 함수] projection.fromCoordToOffset(latLng) : 위경도 좌표를 화면 픽셀 좌표 `{ x, y }`로 투영함 (이름 변경 불가).
 * [내가 지은 이름] coordToScreenPoint : GL 투영기가 준비되기 직전이라도 웹 메르카토르(Web Mercator) 수학 공식으로 폴백 좌표를 계산해 클러스터링 오류를 원천 방지함.
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
 * - class 클래스명 extends 부모클래스 : 객체지향 상속 문법임.
 * - super() : 부모(`naver.maps.OverlayView`) 생성자를 먼저 호출하는 필수 예약어임.
 * - ?? (널 병합 연산자, Nullish Coalescing) : 왼쪽 값이 `null` 또는 `undefined`일 때만 오른쪽 기본값을 채택함 (`0`은 유효값으로 보존).
 * [네이버 지도 SDK 내장 메서드] onAdd(), draw(), onRemove(), getPanes(), getProjection(), setMap() : 네이버 지도 SDK가 생명주기에 맞춰 자동 호출하는 약속된 메서드이므로 이름을 바꾸면 안 됨.
 * [내가 지은 이름] createNaverDomOverlay(팩토리 함수), NaverDomOverlay(파스칼 표기 커스텀 클래스), setPosition(좌표 갱신 메서드)
 * [GPU 60fps 합성 핵심 원리]
 * - `left`/`top`을 매 프레임 바꾸면 메인 스레드에서 Layout(리플로우)이 반복 발생해 모바일 스크롤·드래그가 버벅임.
 * - `left: 0px; top: 0px`로 고정한 뒤 개별 `style.translate = "240px 180px"`만 갱신하면 **100% GPU 컴포지터 스레드**에서 부드럽게 이동함.
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
 * [JS 내장 함수] Function.prototype.bind(...) : 원본 메서드의 `this` 문맥을 고정한 새 함수를 반환함 (이름 변경 불가).
 * [내가 지은 이름] guardGlShapeRedraw : 네이버 GL 도형(`Circle`, 2D 폴백 `Polyline`)이 지도 팬(Pan) 도중 동일 도형을 WebWorker에 중복 재전송하며 깜빡이는 현상을 차단함.
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
 * [네이버 지도 SDK 내장 타입] new window.naver.maps.Circle({...}) : 반경(`km * 1000` 미터) 원을 지도 위에 그리는 도형 클래스임 (이름 변경 불가).
 * [내가 지은 이름] updateCircle : `nextKey`(위경도+반경+테마)가 이전과 같으면 원을 다시 만들지 않고 즉시 반환(Memoization)해 불필요한 GL 재구축을 막음.
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
 * [내가 지은 이름] updateLocationMarker : GPS 측정 위치나 우클릭 지정 출발점에 파란색 맥동 마커(`.location-marker`)를 표시하며, 초기화 상태(`!state.locationKnown`)이면 깨끗이 지움.
 */

export function syncGlTrafficLayers(mapbox, visible) {
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
 * [Mapbox GL 내장 함수] mapbox.getStyle(), mapbox.getSource(), mapbox.addSource(), mapbox.addLayer(), mapbox.setLayoutProperty() (이름 변경 불가)
 * [내가 지은 이름] syncGlTrafficLayers : 다크 모드 Custom Style(`customStyleId`)에 기본 소통 레이어가 빠져 있어도 실시간 교통 벡터 타일(`ctt`: 원활 초록·서행 주황·정체 빨강)을 도로 기호 아래에 직접 주입해 줌.
 */

export function syncTrafficLayer() {
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
 * [네이버 지도 SDK 내장 타입/함수] new naver.maps.TrafficLayer({ interval: 300000 }), naver.maps.Event.once(...) (이름 변경 불가)
 * [내가 지은 이름] syncTrafficLayer : 5분(`300000ms`) 주기로 갱신되는 실시간 도로 교통소통 레이어를 라이트·다크 양쪽 테마에서 일관되게 동기화함.
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
 * [내가 지은 이름] toggleTrafficLayer : 도구 모음의 `'교통'` 버튼(`#traffic-toggle`) 클릭 시 상태와 접근성 `aria-pressed` 속성을 함께 토글함.
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
 * [네이버 지도 SDK 내장 함수] state.map.fitBounds(bounds, { top, right, bottom, left }) (이름 변경 불가)
 * [내가 지은 이름] fitBounds : 상단 활성 경로 배너(`#active-route-banner`), 하단 검색 패널(`.search-panel`), 모바일 반열림 바텀시트(`halfPeekExtra`) 높이를 모두 계산해
 *   자동차 경로선이나 반경 원이 UI 카드 밑에 가려지지 않도록 스마트 여백(Padding)을 확보함.
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
 * [네이버 지도 SDK 내장 타입/함수] new naver.maps.LatLngBounds(남서좌표, 북동좌표), bounds.extend(좌표) (이름 변경 불가)
 * [내가 지은 이름] fitRadius : 선택한 탐색 반경(`5 km` ~ `100 km` 또는 `전국`) 전체가 화면에 쏙 들어오도록 지도 줌과 중심을 맞춤.
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
 * [네이버 지도 SDK 내장 함수] state.map.morph(좌표, 줌, 옵션) : 중심 이동과 확대 애니메이션을 단일 궤적으로 부드럽게 이어 주는 카메라 함수임 (형제 함수: `panTo`, `setCenter`, `setZoom`).
 * [내가 지은 이름] focusHospitalOnMap : 검색·추천·공유 링크로 특정 병원을 선택했을 때 해당 병원 위치(줌 15)로 카메라를 부드럽게 비행시킴.
 */

export function mountNaverMap() {
    const naverMaps = window.naver?.maps;
    if (!naverMaps) {
        return;
    }

    const mapContainer = byId('map');
    if (!mapContainer) {
        return;
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
    state.markers = [];

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

    if (!naverMaps.glEnabled && !state._glWaitFinished) {
        if (!state._glCallbackBound) {
            state._glCallbackBound = true;
            const finishGlWait = () => {
                if (state._glWaitFinished) {
                    return;
                }
                state._glWaitFinished = true;
                mountNaverMap();
            };
            const prevCallback = naverMaps.onJSContentLoaded;
            naverMaps.onJSContentLoaded = (...args) => {
                if (typeof prevCallback === 'function') {
                    prevCallback(...args);
                }
                finishGlWait();
            };
            setTimeout(finishGlWait, 1500);
        }
        return;
    }

    const glSubmoduleReady = Boolean(
        !state._force2dFallback &&
        naverMaps.glEnabled &&
        (typeof naverMaps.Util?.glSupported !== 'function' || naverMaps.Util.glSupported())
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

        naverMaps.Event.addListener(currentGlMap, 'glReady', () => {
            glSettled = true;
            syncMapOverlays();
            if (savedActiveRoute) {
                uiCallbacks.onDrawRouteOnMap?.(savedActiveRoute.hospital, savedActiveRoute.data, {
                    fitMap: false,
                    apiType: savedActiveRoute.apiType,
                    option: savedActiveRoute.option,
                    rawWaypoint: savedActiveRoute.rawWaypoint
                });
            }
        });

        setTimeout(() => {
            if (!glSettled && state.map === currentGlMap && !currentGlMap.isGLReady?.()) {
                state._force2dFallback = true;
                mountNaverMap();
            }
        }, 2200);
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
 * [네이버 지도 SDK 내장 타입/이벤트]
 * - new naver.maps.Map(컨테이너, 옵션) : 메인 지도를 생성함 (`gl: true` + 다크모드 시 `customStyleId` 적용, 저사양 GPU 시 자동 2D 폴백).
 * - naver.maps.Event.addListener(map, 이벤트명, 콜백) :
 *   ├── `'glReady'`    : WebGL 벡터 스타일 로드 완료 직후 반경 원·마커·교통·활성 경로를 복원함.
 *   ├── `'idle'`       : 카메라 이동이 멈췄을 때 `onUpdateMarkers()`로 화면 내 병원 카드를 Key-Diffing 갱신함.
 *   ├── `'rightclick'` : PC 마우스 우클릭 지점으로 출발 기준점을 즉시 이동함.
 *   └── `'longtap'`    : 아이폰·안드로이드에서 지도를 길게 누른 지점으로 출발 기준점을 즉시 이동함.
 * [내가 지은 이름] mountNaverMap(지도 마운트·테마 재마운트 총괄 함수), savedActiveRoute(테마 전환 전 그려져 있던 경로 백업본)
 */
