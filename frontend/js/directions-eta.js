import {
    GL_ROUTE_SOURCE_ID
} from './constants.js';
import {
    DEFAULT_ORIGIN,
    state,
    uiCallbacks
} from './state.js';
import {
    bedValue,
    byId,
    distanceKm,
    getOriginDisplayLabel,
    integerValue,
    isMissing,
    node,
    setStatus
} from './utils.js';
import {
    createNaverDomOverlay,
    fitBounds,
    fitRadius,
    focusHospitalOnMap,
    guardGlShapeRedraw,
    isMapReadyForOverlays,
    updateCircle,
    updateLocationMarker
} from './map-engine.js';
/*
 * [JS 문법]
 * - import { ... } from './모듈.js' : 다른 JS 파일에서 내보낸 상수·함수를 가져오는 ES 모듈 문법임.
 * - 브라우저 네이티브 ES 모듈에서는 상대 경로('./...') 끝에 '.js' 확장자를 꼭 붙여야 함.
 *
 * [프로젝트 내부 모듈 의존성]
 * - constants.js : WebGL 경로 소스 ID 상수(GL_ROUTE_SOURCE_ID)를 가져옴.
 * - state.js : 기본 출발 좌표(DEFAULT_ORIGIN), 공용 상태(state), 콜백 모음(uiCallbacks)을 가져옴.
 * - utils.js (DOM·거리) : DOM 조회(byId), 요소 생성(node), 알림(setStatus), 직선거리(distanceKm)를 가져옴.
 * - utils.js (값 변환) : 병상(bedValue), 출발명(getOriginDisplayLabel), 정수(integerValue), 빈 값(isMissing)을 가져옴.
 * - map-engine.js (오버레이) : 준비 확인(isMapReadyForOverlays), 오버레이(createNaverDomOverlay), 도형 보호(guardGlShapeRedraw).
 * - map-engine.js (카메라·마커) : 화면 맞춤(fitBounds, fitRadius), 이동(focusHospitalOnMap), 원·마커(updateCircle, updateLocationMarker).
 *
 * [아키텍처 계층]
 * - directions-eta.js는 네이버 실도로 길찾기, WebGL/2D 경로 그리기, 상단 경로 배너(#active-route-banner)를 담당함.
 * - 경유지 선택(#directions-waypoint)과 수용최적·최단시간 순위(#eta-rank-box)를 화면에 그림.
 * - 백엔드 EmergencyApiController의 GET /api/directions, GET /api/directions/rank와 통신함.
 */

export function hasRenderedRoute() {
    return Boolean(state.glRouteActive || state.routePolyline || state.activeRoute);
}
/*
 * [JS 문법]
 * - export function : 외부 JS 파일에서 import해 호출할 수 있게 공개 함수를 선언함.
 * - return, || : 세 값 중 하나라도 참이면 바로 true를 돌려줌.
 *
 * [JS 표준 내장 API]
 * - Boolean(val) : 어떤 값이든 엄격한 참(true) 또는 거짓(false) 불리언 값으로 바꿈.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : hasRenderedRoute (매개변수 없음).
 *
 * [동작 흐름]
 * - 호출 출처 : app.js(진단·콜백), hospital-sheet.js의 initSheetDrag(), directions-eta.js의 initDirectionsControls()에서 호출됨.
 * - 흐름 : state.glRouteActive || state.routePolyline || state.activeRoute ──> Boolean() 변환 ──> true/false 반환.
 * - 결과 : 모바일 시트 반열림(Half-Peek) 가능 여부와 진단 상태 판별에 쓰임.
 */

function buildRouteGeoJson(data) {
    const validPath = (data.path || []).filter(
        pt => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
    );
    if (validPath.length < 2) {
        return { type: 'FeatureCollection', features: [] };
    }

    const features = [
        {
            type: 'Feature',
            properties: { role: 'base' },
            geometry: {
                type: 'LineString',
                coordinates: validPath
            }
        }
    ];

    if (Array.isArray(data.sections) && data.sections.length > 0) {
        const congestedSections = data.sections
            .filter(sec => sec.congestion === 2 || sec.congestion === 3)
            .sort((a, b) => a.congestion - b.congestion);

        for (const sec of congestedSections) {
            const startIdx = Math.max(0, Number(sec.pointIndex) || 0);
            const count = Math.max(0, Number(sec.pointCount) || 0);
            const endIdx = Math.min(validPath.length - 1, startIdx + count);
            if (endIdx <= startIdx) {
                continue;
            }
            const segmentCoords = validPath.slice(startIdx, endIdx + 1);
            if (segmentCoords.length < 2) {
                continue;
            }
            features.push({
                type: 'Feature',
                properties: {
                    role: 'section',
                    congestion: sec.congestion
                },
                geometry: {
                    type: 'LineString',
                    coordinates: segmentCoords
                }
            });
        }
    }

    features.push(
        {
            type: 'Feature',
            properties: { role: 'start' },
            geometry: {
                type: 'Point',
                coordinates: validPath[0]
            }
        },
        {
            type: 'Feature',
            properties: { role: 'end' },
            geometry: {
                type: 'Point',
                coordinates: validPath[validPath.length - 1]
            }
        }
    );

    return {
        type: 'FeatureCollection',
        features
    };
}
/*
 * [JS 문법]
 * - export function, const, 화살표 함수(=>), if, for...of, continue, return
 * - 연산자 : || (앞이 비면 기본값 사용), && (모두 참일 때 참), ===, >=, <=, <, >
 * - { type: 'FeatureCollection', features } : 키와 변수명이 같아 값을 줄여 쓴 객체 표기임.
 *
 * [JS 표준 내장 API]
 * - Array.isArray(val) : 값이 실제 배열인지 확인함.
 * - Number.isFinite(val) : 값이 NaN이나 무한대가 아닌 정상 숫자인지 확인함.
 * - Number(val) : 문자열이나 값을 숫자로 바꿈.
 * - Math.max(a, b), Math.min(a, b) : 인덱스 범위가 배열 시작·끝을 넘지 않게 막아 줌.
 * - Array.prototype.filter(), .sort(), .slice(), .push() : 배열 걸러내기, 정렬, 잘라내기, 요소 추가 메서드임.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : buildRouteGeoJson.
 * - 매개변수명 : data (백엔드 GET /api/directions 응답 JSON 객체).
 *
 * [지역 변수명]
 * - validPath : [경도, 위도] 두 값이 모두 정상 숫자인 좌표만 남긴 배열.
 * - features : GeoJSON Feature 객체를 차곡차곡 담는 배열.
 * - congestedSections : 서행(2)과 정체(3) 구간만 골라 2 -> 3 순서로 정렬한 배열.
 * - sec, startIdx, count, endIdx, segmentCoords : 순회 중인 도로 구간, 시작·끝 인덱스, 잘라낸 좌표 배열.
 *
 * [GeoJSON FeatureCollection 데이터 구조 예시]
 *   {
 *     "type": "FeatureCollection",
 *     "features": [
 *       { "type": "Feature", "properties": { "role": "base" }, "geometry": { "type": "LineString", "coordinates": [[127.901, 37.319], ...] } },
 *       { "type": "Feature", "properties": { "role": "section", "congestion": 3 }, "geometry": { "type": "LineString", "coordinates": [...] } },
 *       { "type": "Feature", "properties": { "role": "start" }, "geometry": { "type": "Point", "coordinates": [127.901, 37.319] } },
 *       { "type": "Feature", "properties": { "role": "end" },   "geometry": { "type": "Point", "coordinates": [127.946, 37.318] } }
 *     ]
 *   }
 *
 * [동작 흐름]
 * - 호출 출처 : directions-eta.js의 renderGlRoute()에서 호출됨.
 * - 흐름 :
 *   1) data.path에서 유효한 [경도, 위도] 좌표만 걸러냄 ──> 2개 미만이면 빈 FeatureCollection 반환
 *   2) 전체 기본 경로(role: 'base' LineString)를 features에 먼저 추가
 *   3) 서행(2)·정체(3) 구간만 추려 2 -> 3 순 정렬 ──> validPath 범위로 잘라 LineString 추가(정체가 위에 겹침)
 *   4) 출발점(start)과 도착점(end) Point 추가 ──> 완성된 FeatureCollection 반환
 * - 결과 : renderGlRoute()가 반환된 FeatureCollection 객체를 WebGL 지도에 넣어 GPU로 경로를 그림.
 */

function renderGlRoute(mapbox, data) {
    if (!mapbox || typeof mapbox.getStyle !== 'function' || typeof mapbox.getSource !== 'function') {
        return false;
    }

    const featureCollection = buildRouteGeoJson(data);
    if (!featureCollection.features.length) {
        return false;
    }

    const outlineColor = state.darkMode ? '#022c22' : '#064e3b';

    try {
        const existingSource = mapbox.getSource(GL_ROUTE_SOURCE_ID);
        if (existingSource && typeof existingSource.setData === 'function') {
            existingSource.setData(featureCollection);
            if (mapbox.getLayer('yonsei-route-outline')) {
                mapbox.setPaintProperty('yonsei-route-outline', 'line-color', outlineColor);
            }
            state.glRouteActive = true;
            state.glRouteMap = state.map;
            state.diagnostics.glRouteUpdateCount += 1;
            return true;
        }

        mapbox.addSource(GL_ROUTE_SOURCE_ID, {
            type: 'geojson',
            data: featureCollection
        });

        const lineLayout = {
            'line-cap': 'round',
            'line-join': 'round'
        };

        const layerSpecs = [
            {
                id: 'yonsei-route-outline',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['==', 'role', 'base'],
                layout: lineLayout,
                paint: {
                    'line-color': outlineColor,
                    'line-width': 9,
                    'line-opacity': 0.6
                }
            },
            {
                id: 'yonsei-route-base',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['==', 'role', 'base'],
                layout: lineLayout,
                paint: {
                    'line-color': '#03c75a',
                    'line-width': 5,
                    'line-opacity': 0.95
                }
            },
            {
                id: 'yonsei-route-slow-outline',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 2]],
                layout: lineLayout,
                paint: {
                    'line-color': '#78350f',
                    'line-width': 9,
                    'line-opacity': 0.65
                }
            },
            {
                id: 'yonsei-route-slow',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 2]],
                layout: lineLayout,
                paint: {
                    'line-color': '#f59e0b',
                    'line-width': 6,
                    'line-opacity': 0.98
                }
            },
            {
                id: 'yonsei-route-jam-outline',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 3]],
                layout: lineLayout,
                paint: {
                    'line-color': '#7f1d1d',
                    'line-width': 9,
                    'line-opacity': 0.65
                }
            },
            {
                id: 'yonsei-route-jam',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 3]],
                layout: lineLayout,
                paint: {
                    'line-color': '#ef4444',
                    'line-width': 6,
                    'line-opacity': 0.98
                }
            },
            {
                id: 'yonsei-route-start',
                type: 'circle',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['==', 'role', 'start'],
                paint: {
                    'circle-radius': 5.5,
                    'circle-color': '#ffffff',
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#03c75a'
                }
            },
            {
                id: 'yonsei-route-end',
                type: 'circle',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['==', 'role', 'end'],
                paint: {
                    'circle-radius': 6.5,
                    'circle-color': '#ef4444',
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#ffffff'
                }
            }
        ];

        for (const spec of layerSpecs) {
            if (!mapbox.getLayer(spec.id)) {
                mapbox.addLayer(spec);
            }
        }

        state.glRouteActive = true;
        state.glRouteMap = state.map;
        state.diagnostics.glRouteUpdateCount += 1;
        return true;
    } catch (glErr) {
        void glErr;
        return false;
    }
}
/*
 * [JS 문법]
 * - export function, const, typeof, !==, ===, !mapbox (부정), ||, &&, 삼항 연산자(? :)
 * - 반복·예외 처리 : for...of, try { ... } catch (glErr) { ... }, void, +=, return
 *
 * [Mapbox GL 내장 API]
 * - mapbox.getStyle() : 지도 스타일 객체가 준비되었는지 확인함.
 * - mapbox.getSource(id) : 등록된 GeoJSON 데이터 소스를 찾음.
 * - source.setData(geojson) : 레이어를 지우지 않고 GeoJSON 데이터만 바꿔 빠르게 다시 그림.
 * - mapbox.getLayer(id), mapbox.setPaintProperty(layerId, prop, val) : 레이어 확인 및 선 색상 변경.
 * - mapbox.addSource(id, sourceObj) : 새 GeoJSON 데이터 소스를 WebGL 지도에 등록함.
 * - mapbox.addLayer(spec) : filter·layout·paint 규칙에 맞춰 선과 점 레이어를 순서대로 추가함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderGlRoute.
 * - 매개변수명 : mapbox (state.map.getMapbox() WebGL 지도 객체), data (/api/directions 응답 객체).
 *
 * [지역 변수명]
 * - featureCollection : buildRouteGeoJson(data)로 만든 GeoJSON 묶음 객체.
 * - outlineColor : 다크 모드('#022c22') 또는 라이트 모드('#064e3b')용 외곽선 색.
 * - existingSource : 이미 지도에 등록된 GL_ROUTE_SOURCE_ID 소스(없으면 undefined).
 * - lineLayout, layerSpecs, spec : 둥근 선 끝 설정과 8개 레이어 명세 배열·개별 항목.
 * - glErr : WebGL 조작 중 발생한 예외(잡아낸 뒤 false를 돌려 2D 대체 선을 그리게 함).
 *
 * [동작 흐름]
 * - 호출 출처 : directions-eta.js의 drawRouteOnMap()에서 WebGL 지도 객체가 있을 때 호출됨.
 * - 흐름 :
 *   1) mapbox 메서드 누락 또는 좌표 없음 ──> 즉시 false 반환
 *   2) 기존 소스(GL_ROUTE_SOURCE_ID) 존재 ──> setData()로 데이터만 교체·색상 갱신 ──> true 반환
 *   3) 최초 실행 ──> addSource() + 8개 레이어 addLayer() ──> state.glRouteActive 등 갱신 ──> true 반환
 *   4) 예외 발생 ──> false 반환 ──> drawRouteOnMap()이 2D Polyline 대체 경로를 그림.
 */

function removeRouteOverlays() {
    try {
        const mapbox = state.map?.getMapbox?.();
        const glSource = mapbox?.getSource?.(GL_ROUTE_SOURCE_ID);
        if (glSource && typeof glSource.setData === 'function') {
            glSource.setData({ type: 'FeatureCollection', features: [] });
        }
    } catch (err) {
        void err;
    }
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

    if (Array.isArray(state.routeSectionPolylines)) {
        for (const poly of state.routeSectionPolylines) {
            try {
                poly?.setMap(null);
            } catch (err) {
                void err;
            }
        }
    }
    state.routeSectionPolylines = [];
}
/*
 * [JS 문법]
 * - export function, const, ?. (없어도 에러 안 나는 안전 접근), typeof, ===, &&, if, for...of, try/catch, void
 *
 * [JS 표준 및 지도 SDK 내장 API]
 * - Array.isArray(val) : 값이 배열인지 확인함.
 * - source.setData({ type: 'FeatureCollection', features: [] }) : 빈 GeoJSON을 넣어 WebGL 경로선을 지움.
 * - overlay.setMap(null) : 지도 위 선(Polyline)이나 커스텀 마커(OverlayView)를 화면에서 제거함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : removeRouteOverlays (매개변수 없음).
 *
 * [지역 변수명]
 * - mapbox : 네이버 지도의 내부 WebGL 지도 객체.
 * - glSource : GL_ROUTE_SOURCE_ID 이름으로 등록된 GeoJSON 소스.
 * - poly : state.routeSectionPolylines에 들어 있는 혼잡 구간 선 객체.
 * - err : 지도에서 도형을 떼어 낼 때 발생할 수 있는 예외.
 *
 * [동작 흐름]
 * - 호출 출처 : clearRouteOnMap(), drawRouteOnMap(), refreshActiveRoute()에서 기존 경로선을 비울 때 호출됨.
 * - 흐름 : WebGL 소스 비우기 ──> glRouteActive 초기화 ──> 2D 선·경유 마커 setMap(null) ──> state 참조 비움.
 */

function clearRouteOnMap() {
    state.activeRouteController?.abort();
    state.activeRouteController = null;
    state.activeRoute = null;

    removeRouteOverlays();

    const banner = byId('active-route-banner');
    if (banner) {
        banner.hidden = true;
    }
    const clearBtn = byId('directions-clear-btn');
    if (clearBtn) {
        clearBtn.hidden = true;
    }
}
/*
 * [JS 문법]
 * - export function, ?. (안전 접근), const, if
 *
 * [브라우저 내장 Web API]
 * - AbortController.prototype.abort() : 현재 진행 중인 fetch 네트워크 요청을 즉시 취소함.
 * - HTMLElement.prototype.hidden : true로 설정하면 HTML 요소를 화면과 스크린 리더에서 숨김.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : clearRouteOnMap (매개변수 없음).
 *
 * [DOM 요소 참조명]
 * - banner : 상단 활성 경로 요약 배너(#active-route-banner).
 * - clearBtn : 상세 시트 안의 경로 지우기 버튼(#directions-clear-btn).
 *
 * [동작 흐름]
 * - 호출 출처 : resetOriginAndRoute() 및 initDirectionsControls()의 경로 지우기 버튼 클릭에서 호출됨.
 * - 흐름 : activeRouteController.abort() ──> activeRoute 비움 ──> removeRouteOverlays() ──> 배너·버튼 숨김.
 */

function resetOriginAndRoute() {
    state.directionsController?.abort();
    state.activeRouteController?.abort();
    state.reverseGeocodeController?.abort();

    clearRouteOnMap();
    state.sheetRouteData = null;

    state.origin = {
        lat: DEFAULT_ORIGIN.lat,
        lng: DEFAULT_ORIGIN.lng
    };
    state.originLabel = DEFAULT_ORIGIN.label;
    state.originAddress = '';
    state.locationKnown = false;
    state.locationAccuracy = null;
    state.locationUpdated = null;

    updateLocationMarker();
    uiCallbacks.onUpdateRadiusUI?.();

    const radiusVal = byId('radius')?.value || '10';
    let shouldFitResetOrigin = false;
    if (state.map && radiusVal !== 'all') {
        try {
            const center = state.map.getCenter?.();
            if (center && typeof center.lat === 'function' && typeof center.lng === 'function') {
                const distFromDefault = distanceKm(
                    { lat: center.lat(), lng: center.lng() },
                    DEFAULT_ORIGIN
                );
                if (distFromDefault > Number(radiusVal) * 1.5) {
                    shouldFitResetOrigin = true;
                }
            }
        } catch (err) {
            void err;
        }
    }

    if (shouldFitResetOrigin) {
        fitRadius();
    } else {
        updateCircle(true);
    }

    uiCallbacks.onUpdateMarkers?.();
    uiCallbacks.onUpdateOriginAddress?.();

    if (state.etaRankOpen) {
        loadEtaRanking();
    }

    if (state.selected) {
        populateWaypointSelect(state.selected);
        loadDirectionsForHospital(state.selected, false);
    }

    setStatus('지정 출발 위치 점과 경로를 모두 초기화했습니다.');
}
/*
 * [JS 문법]
 * - export function, ?. (안전 접근), const, let, ||, &&, !==, typeof, >, *, if/else, try/catch, void
 *
 * [JS 표준 및 브라우저·지도 SDK 내장 API]
 * - AbortController.prototype.abort() : 진행 중인 네트워크 요청을 취소함.
 * - HTMLSelectElement.prototype.value : 드롭다운(<select>)의 현재 선택값을 읽음.
 * - Number(val) : 문자열 값을 숫자로 바꿈.
 * - map.getCenter(), LatLng.prototype.lat(), LatLng.prototype.lng() : 지도 중심 좌표와 위도·경도를 읽음.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : resetOriginAndRoute (매개변수 없음).
 *
 * [지역 변수명]
 * - radiusVal : 반경 드롭다운(#radius)의 현재 선택값(없으면 기본 '10').
 * - shouldFitResetOrigin : 지도 중심이 기본 출발지에서 너무 멀어 카메라 이동이 필요한지 여부.
 * - center, distFromDefault : 현재 지도 중심 좌표 객체와 기본 출발지까지 직선거리(km).
 * - err : 지도 중심 좌표 조회 중 발생한 예외.
 *
 * [동작 흐름]
 * - 호출 출처 : initDirectionsControls()의 출발점 초기화 버튼(#active-route-reset, #origin-reset-btn) 클릭 시 호출됨.
 * - 흐름 :
 *   1) 경로·역지오코딩 요청 3종 취소 ──> clearRouteOnMap()으로 지도에 그려진 경로선 삭제
 *   2) state.origin을 DEFAULT_ORIGIN으로 복원 ──> updateLocationMarker() ──> onUpdateRadiusUI()
 *   3) 중심이 반경 1.5배 밖이면 fitRadius()로 이동, 가까우면 updateCircle(true)로 원만 복구
 *   4) 마커·주소·열린 순위(loadEtaRanking)·열린 시트(populateWaypointSelect + loadDirections) 갱신 ──> 알림
 */

function getCongestionStyle(congestion) {
    if (congestion === 3) {
        return {
            label: '정체',
            badgeClass: 'congestion-jam',
            strokeColor: '#ef4444',
            outlineColor: '#7f1d1d',
            zIndex: 98
        };
    }
    if (congestion === 2) {
        return {
            label: '서행',
            badgeClass: 'congestion-slow',
            strokeColor: '#f59e0b',
            outlineColor: '#78350f',
            zIndex: 97
        };
    }
    return {
        label: '원활',
        badgeClass: 'congestion-smooth',
        strokeColor: '#03c75a',
        outlineColor: '#064e3b',
        zIndex: 96
    };
}
/*
 * [JS 문법]
 * - export function, if, === (값과 타입이 모두 같은지 비교), return, 객체 리터럴
 *
 * [함수명 및 매개변수명]
 * - 함수명 : getCongestionStyle.
 * - 매개변수명 : congestion (백엔드 도로 소통 상태 코드: 1=원활, 2=서행, 3=정체).
 *
 * [동작 흐름]
 * - 호출 출처 : directions-eta.js의 drawRouteOnMap()(2D 선 색상)과 loadDirectionsForHospital()(혼잡도 배지 칩)에서 호출됨.
 * - 흐름 : congestion 판별 ──> 3이면 빨강(정체) · 2면 주황(서행) · 나머지는 초록(원활) 스타일 객체 반환.
 */

export function drawRouteOnMap(hospital, data, options = {}) {
    if (!hospital || !data || !Array.isArray(data.path) || !data.path.length) {
        return;
    }

    const fitMap = options.fitMap !== false;
    const effectiveApiType = options.apiType || data.apiType || byId('directions-api')?.value || 'directions5';
    const effectiveOption = options.option || data.option || state.selectedDirectionOption || 'trafast';
    const effectiveRawWaypoint = options.rawWaypoint !== undefined
        ? options.rawWaypoint
        : (byId('directions-waypoint')?.value || '');

    state.activeRoute = {
        hospital,
        data,
        apiType: effectiveApiType,
        option: effectiveOption,
        rawWaypoint: effectiveRawWaypoint
    };

    const banner = byId('active-route-banner');
    if (banner) {
        const nameEl = byId('active-route-name');
        const apiEl = byId('active-route-api');
        const metaEl = byId('active-route-meta');
        const callEl = byId('active-route-call');

        if (apiEl) {
            apiEl.textContent = data.apiLabel || 'Directions 5';
        }
        if (nameEl) {
            nameEl.textContent = hospital.name;
            nameEl.title = `${hospital.name} 상세 정보 다시 열기`;
        }
        if (metaEl) {
            metaEl.textContent = `${data.durationText} · ${data.distanceKm} km`;
        }
        if (callEl) {
            const rawPhone = !isMissing(hospital.erTel) ? hospital.erTel : hospital.tel;
            const cleanPhone = !isMissing(rawPhone) ? String(rawPhone).replace(/[^\d+]/g, '') : '';
            if (cleanPhone && /\d/.test(cleanPhone)) {
                callEl.href = `tel:${cleanPhone}`;
                callEl.hidden = false;
                callEl.title = `${hospital.name} 응급실/대표 전화 발신 (${String(rawPhone).trim()})`;
            } else {
                callEl.removeAttribute('href');
                callEl.hidden = true;
            }
        }
        banner.hidden = false;
    }

    const clearBtn = byId('directions-clear-btn');
    if (clearBtn) {
        clearBtn.hidden = false;
    }

    const naverMaps = window.naver?.maps;
    if (!state.map || !naverMaps) {
        return;
    }

    if (!isMapReadyForOverlays()) {
        naverMaps.Event.once(state.map, 'glReady', () => drawRouteOnMap(hospital, data, options));
        return;
    }

    const mapbox = state.map.getMapbox?.();
    let renderedViaGl = false;

    if (mapbox) {
        if (state.routePolyline || state.routeOutlinePolyline || state.routeSectionPolylines.length || state.waypointMarker) {
            removeRouteOverlays();
        }
        renderedViaGl = renderGlRoute(mapbox, data);
    }

    if (!renderedViaGl) {
        removeRouteOverlays();

        const latLngPath = data.path.map(([lng, lat]) => new naverMaps.LatLng(lat, lng));

        state.routeOutlinePolyline = guardGlShapeRedraw(new naverMaps.Polyline({
            map: state.map,
            path: latLngPath,
            strokeColor: state.darkMode ? '#022c22' : '#064e3b',
            strokeWeight: 9,
            strokeOpacity: 0.55,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            zIndex: 90
        }));

        const polylineOpts = {
            map: state.map,
            path: latLngPath,
            strokeColor: '#03c75a',
            strokeWeight: 5,
            strokeOpacity: 0.95,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            zIndex: 95
        };
        if (naverMaps.PointingIcon) {
            polylineOpts.startIcon = naverMaps.PointingIcon.CIRCLE;
            polylineOpts.startIconSize = 10;
            polylineOpts.endIcon = naverMaps.PointingIcon.BLOCK_ARROW;
            polylineOpts.endIconSize = 14;
        }
        state.routePolyline = guardGlShapeRedraw(new naverMaps.Polyline(polylineOpts));

        if (Array.isArray(data.sections) && data.sections.length > 0) {
            const congestedSections = data.sections
                .filter(sec => sec.congestion === 2 || sec.congestion === 3)
                .sort((a, b) => a.congestion - b.congestion);

            for (const sec of congestedSections) {
                const startIdx = Math.max(0, Number(sec.pointIndex) || 0);
                const count = Math.max(0, Number(sec.pointCount) || 0);
                const endIdx = Math.min(latLngPath.length - 1, startIdx + count);
                if (endIdx <= startIdx) {
                    continue;
                }

                const segmentCoords = latLngPath.slice(startIdx, endIdx + 1);
                if (segmentCoords.length < 2) {
                    continue;
                }

                const style = getCongestionStyle(sec.congestion);

                const segOutline = guardGlShapeRedraw(new naverMaps.Polyline({
                    map: state.map,
                    path: segmentCoords,
                    strokeColor: style.outlineColor,
                    strokeWeight: 9,
                    strokeOpacity: 0.65,
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    zIndex: style.zIndex - 1
                }));

                const segLine = guardGlShapeRedraw(new naverMaps.Polyline({
                    map: state.map,
                    path: segmentCoords,
                    strokeColor: style.strokeColor,
                    strokeWeight: 6,
                    strokeOpacity: 0.98,
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    zIndex: style.zIndex
                }));

                state.routeSectionPolylines.push(segOutline, segLine);
            }
        }
    }

    try {
        state.waypointMarker?.setMap(null);
    } catch (err) {
        void err;
    }
    state.waypointMarker = null;

    if (effectiveRawWaypoint.includes('|')) {
        const [coordPart, wpName] = effectiveRawWaypoint.split('|');
        const [wpLngStr, wpLatStr] = coordPart.split(',');
        const wpLat = Number(wpLatStr);
        const wpLng = Number(wpLngStr);
        if (Number.isFinite(wpLat) && Number.isFinite(wpLng)) {
            const wpEl = node('div', 'waypoint-marker', `경유 · ${wpName}`);
            state.waypointMarker = createNaverDomOverlay({
                map: state.map,
                position: new naverMaps.LatLng(wpLat, wpLng),
                content: wpEl,
                xAnchor: 0.5,
                yAnchor: 1.2,
                zIndex: 120
            });
        }
    }

    if (fitMap) {
        const firstCoord = data.path[0];
        const firstLatLng = new naverMaps.LatLng(firstCoord[1], firstCoord[0]);
        const bounds = new naverMaps.LatLngBounds(firstLatLng, firstLatLng);
        for (let i = 1; i < data.path.length; i++) {
            const [lng, lat] = data.path[i];
            bounds.extend(new naverMaps.LatLng(lat, lng));
        }
        fitBounds(bounds);
    }
}
/*
 * [JS 문법]
 * - export function, 기본값 매개변수(options = {}), const, let, if, !hospital, ||, &&, !==, ===, ? :, 템플릿 리터럴
 * - 배열 구조 분해 : ([lng, lat]) => ..., [coordPart, wpName], [wpLngStr, wpLatStr], [lng, lat]
 * - 정규표현식 : /[^\d+]/g (숫자와 '+' 외 문자 제거), /\d/.test(...) (숫자 1자 이상 포함 확인)
 * - 반복·예외 처리 : for...of, for (let i = 1; ...), continue, try/catch, void
 *
 * [JS 표준 및 브라우저·지도 SDK 내장 API]
 * - Array.isArray(val), String(val), Number(val), Number.isFinite(val) : 배열·문자열·숫자 변환과 검사.
 * - String.prototype.replace(), .trim(), .includes(), .split() : 문자열 치환·공백 제거·포함 확인·분할.
 * - Array.prototype.map(), .filter(), .sort(), .slice(), .push() : 배열 변환과 조건 선별·정렬·추가.
 * - HTMLElement.prototype.textContent, .title, .hidden, .href, .removeAttribute() : DOM 텍스트·링크·표시 제어.
 * - naver.maps.Event.once(map, eventName, handler) : 지도 이벤트가 1번 발생할 때만 콜백을 실행함.
 * - new naver.maps.LatLng(lat, lng) : 위도·경도 순으로 네이버 지도 좌표를 만듦(GeoJSON은 경도·위도 순).
 * - new naver.maps.Polyline(opts), naver.maps.PointingIcon : 2D 경로선과 시점(원)·종점(화살표) 아이콘.
 * - new naver.maps.LatLngBounds(sw, ne), LatLngBounds.prototype.extend(latLng) : 전체 경로를 감싸는 사각 영역 계산.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : drawRouteOnMap.
 * - 매개변수명 : hospital(도착 병원 객체), data(/api/directions 응답), options(fitMap·apiType·option·rawWaypoint).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : banner(#active-route-banner), nameEl, apiEl, metaEl, callEl, clearBtn(#directions-clear-btn).
 * - 설정·연락 변수 : fitMap, effectiveApiType, effectiveOption, effectiveRawWaypoint, rawPhone, cleanPhone.
 * - 지도·경로 변수 : naverMaps, mapbox, renderedViaGl, latLngPath, polylineOpts, congestedSections, sec, style.
 * - 구간·경유 변수 : startIdx, count, endIdx, segmentCoords, segOutline, segLine, coordPart, wpName, wpLat, wpLng, wpEl.
 * - 경계·반복 변수 : wpLngStr, wpLatStr, firstCoord, firstLatLng, bounds, i.
 *
 * [동작 흐름]
 * - 호출 출처 : loadDirectionsForHospital(..., true), refreshActiveRoute(), map-engine.js의 onDrawRouteOnMap 콜백.
 * - 흐름 :
 *   1) 병원·경로 확인 ──> state.activeRoute 저장 ──> 상단 배너(#active-route-banner)·지우기 버튼 표시
 *   2) 지도 오버레이 준비 전이면 glReady 1회 대기 후 재호출
 *   3) WebGL(mapbox) 가능 ──> renderGlRoute()로 고속 렌더링 시도
 *      └── 실패 또는 미지원 ──> 2D Polyline(외곽선·본선·서행/정체 구간)으로 대체 렌더링
 *   4) 경유지 문자열에 '|' 포함 시 .waypoint-marker 생성 ──> fitMap 참이면 fitBounds()로 화면 맞춤
 */

export async function refreshActiveRoute(options = {}) {
    const active = state.activeRoute;
    if (!active?.hospital) {
        return;
    }

    const hospital = active.hospital;
    const fitMap = Boolean(options.fitMap);
    const apiType = active.apiType || byId('directions-api')?.value || 'directions5';
    const option = active.option || state.selectedDirectionOption || 'trafast';
    const rawWaypoint = active.rawWaypoint || '';
    const [waypointCoord] = rawWaypoint.includes('|')
        ? rawWaypoint.split('|')
        : [rawWaypoint];

    state.activeRouteController?.abort();
    const controller = new AbortController();
    state.activeRouteController = controller;

    const banner = byId('active-route-banner');
    const metaEl = byId('active-route-meta');
    if (banner && !banner.hidden && metaEl) {
        metaEl.textContent = '경로 갱신 중…';
    }

    try {
        const params = new URLSearchParams({
            startLat: String(state.origin.lat),
            startLng: String(state.origin.lng),
            goalLat: String(hospital.lat),
            goalLng: String(hospital.lng),
            apiType,
            option
        });
        if (waypointCoord) {
            params.set('waypoints', waypointCoord);
        }

        const response = await fetch(`/api/directions?${params.toString()}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        /*
         * [JS 문법]
         * - const, new, await, 단축 속성명(apiType, option), 템플릿 리터럴, if
         *
         * [브라우저 내장 Web API]
         * - new URLSearchParams(obj), .set(key, val), .toString() : URL 쿼리 문자열을 안전하게 인코딩해 조립함.
         * - fetch(url, { signal, headers }) : HTTP GET 비동기 요청을 보내고 AbortSignal로 중간 취소를 지원함.
         *
         * [쿼리 파라미터 조립 분해]
         * - 1단계 (출발·도착 좌표) : startLat, startLng, goalLat, goalLng을 문자열로 바꿔 URLSearchParams에 넣음.
         * - 2단계 (API·주행 옵션) : apiType('directions5'|'directions15')과 option('trafast' 등)을 함께 넣음.
         * - 3단계 (조건부 경유지) : '|' 앞의 좌표만 꺼낸 waypointCoord가 있을 때만 params.set('waypoints', ...)로 추가함.
         *
         * [URL 구조 및 백엔드 연결]
         *   /api/directions?startLat=37.31904&startLng=127.90123&goalLat=37.31884&goalLng=127.94566&apiType=directions5&option=trafast&waypoints=127.931,37.321
         *   ├── 경로 prefix : /api                              (EmergencyApiController @RequestMapping("/api"))
         *   ├── 매핑 경로   : /directions                       (EmergencyApiController.getDirections() @GetMapping)
         *   ├── startLat    : @RequestParam("startLat") double  (필수, 출발지 위도)
         *   ├── startLng    : @RequestParam("startLng") double  (필수, 출발지 경도)
         *   ├── goalLat     : @RequestParam("goalLat") double   (필수, 목적지 위도)
         *   ├── goalLng     : @RequestParam("goalLng") double   (필수, 목적지 경도)
         *   ├── apiType     : @RequestParam("apiType") String   (기본값 "directions5")
         *   ├── option      : @RequestParam("option") String    (기본값 "trafast")
         *   └── waypoints   : @RequestParam("waypoints") String (선택, 경유지 "경도,위도")
         *   ──> 백엔드 NaverDirectionsService.getDrivingRoute()가 처리 후 DirectionsResponseDto JSON 반환.
         */

        if (controller.signal.aborted || state.activeRoute?.hospital?.id !== hospital.id) {
            return;
        }

        if (!response.ok) {
            if (metaEl) {
                metaEl.textContent = `경로 갱신 실패 (HTTP ${response.status})`;
            }
            return;
        }

        const data = await response.json();
        if (controller.signal.aborted || state.activeRoute?.hospital?.id !== hospital.id) {
            return;
        }

        if (data.code !== 0 || !Array.isArray(data.path) || !data.path.length) {
            removeRouteOverlays();
            if (banner) {
                const nameEl = byId('active-route-name');
                if (nameEl) {
                    nameEl.textContent = hospital.name;
                }
                if (metaEl) {
                    metaEl.textContent = '해당 위치에서 도로 경로 탐색 불가';
                }
                banner.hidden = false;
            }
            return;
        }

        drawRouteOnMap(hospital, data, {
            fitMap,
            apiType,
            option,
            rawWaypoint
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            return;
        }
        if (metaEl && state.activeRoute?.hospital?.id === hospital.id) {
            metaEl.textContent = '경로 갱신 오류';
        }
    } finally {
        if (state.activeRouteController === controller) {
            state.activeRouteController = null;
        }
    }
}
/*
 * [JS 문법]
 * - export async function, 기본값 매개변수(options = {}), const, ?. (안전 접근), ||, ? :
 * - 배열 구조 분해([waypointCoord]), try/catch/finally, !==, ===, !response.ok, &&
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - Boolean(val), Array.isArray(val), String(val) : 불리언·배열 판별 및 문자열 변환.
 * - new AbortController(), controller.abort(), controller.signal.aborted : 이전 요청을 취소해 오래된 응답을 막음.
 * - response.ok, response.status, response.json() : HTTP 2xx 성공 확인, 상태 코드 읽기, 응답 JSON -> JS 객체 변환.
 * - AbortError : AbortController로 요청이 취소될 때 발생하는 예외의 name 값.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : refreshActiveRoute.
 * - 매개변수명 : options ({ fitMap } 등 지도 화면 재맞춤 설정 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : banner(#active-route-banner), metaEl(#active-route-meta), nameEl(#active-route-name).
 * - 경로·요청 변수 : active, hospital, fitMap, apiType, option, rawWaypoint, waypointCoord, controller.
 * - 통신·응답 변수 : params, response, data, error.
 *
 * [동작 흐름]
 * - 호출 출처 : search-controls.js의 locate(), setCustomOrigin()에서 출발지가 바뀔 때 호출됨.
 * - 흐름 :
 *   1) state.activeRoute.hospital 없음 ──> 종료 / 있음 ──> activeRouteController.abort() 후 새 컨트롤러 등록
 *   2) 배너에 '경로 갱신 중…' 표시 ──> GET /api/directions 요청
 *   3) 대기 중 취소되거나 활성 병원이 바뀌었으면 응답 무시
 *   4) HTTP 오류 또는 data.code !== 0 ──> removeRouteOverlays() + 배너에 실패·불가 문구 표시
 *   5) 정상 응답 ──> drawRouteOnMap()으로 경로·시간 갱신 ──> finally에서 컨트롤러 참조 정리
 */

export function populateWaypointSelect(destinationHospital) {
    const select = byId('directions-waypoint');
    if (!select || !destinationHospital) {
        return;
    }

    const prevValue = select.value;
    select.replaceChildren(
        node('option', '', '경유지 없음 (직행)')
    );
    select.firstElementChild.value = '';

    const nearby = state.hospitals
        .filter(h =>
            h.id !== destinationHospital.id &&
            Number.isFinite(h.lat) &&
            Number.isFinite(h.lng)
        )
        .map(h => ({
            hospital: h,
            dist: distanceKm(state.origin, h)
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 15);

    for (const { hospital, dist } of nearby) {
        const opt = document.createElement('option');
        opt.value = `${hospital.lng},${hospital.lat}|${hospital.name}`;
        const erRaw = hospital.beds?.hvec;
        const erNum = integerValue(erRaw);
        const shortEr = erNum !== null
            ? (erNum > 0 ? `응급실 ${erNum}석` : `응급실 ${bedValue(erRaw)}`)
            : '응급실 미정보';
        opt.textContent = `경유: ${hospital.name} (${dist.toFixed(1)}km · ${shortEr})`;
        select.append(opt);
    }

    if (prevValue && [...select.options].some(o => o.value === prevValue)) {
        select.value = prevValue;
    } else {
        select.value = '';
    }
}
/*
 * [JS 문법]
 * - export function, const, if/else, !select, ||, &&, !==, ? :, 템플릿 리터럴
 * - for...of + 객체 구조 분해({ hospital, dist }), 배열 펼치기([...select.options])
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - Number.isFinite(val) : 위도·경도가 정상 숫자인지 확인함.
 * - Array.prototype.filter(), .map(), .sort(), .slice(), .some() : 선별, 변환, 정렬, 자르기, 포함 여부 검사.
 * - Number.prototype.toFixed(1) : 숫자를 소수 첫째 자리 문자열로 바꿈.
 * - document.createElement('option'), HTMLSelectElement.prototype.options, .value : <option> 생성과 선택값 복원.
 * - Element.prototype.replaceChildren(), .firstElementChild, .append() : 자식 비우기 및 새 옵션 추가.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : populateWaypointSelect.
 * - 매개변수명 : destinationHospital (최종 도착지 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : select(#directions-waypoint).
 * - 지역 변수 : prevValue, nearby, hospital, dist, opt, erRaw, erNum, shortEr, o.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 openHospital(), directions-eta.js의 resetOriginAndRoute(), search-controls.js의 locate()·setCustomOrigin().
 * - 흐름 :
 *   1) 기본 옵션('경유지 없음 (직행)')으로 목록 초기화
 *   2) state.hospitals에서 도착 병원 제외 + 유효 좌표 선별 ──> 거리순 정렬 ──> 가까운 15곳 추출
 *   3) '경도,위도|병원명' 값과 응급실 병상 요약을 <option>으로 추가 ──> 이전 선택값이 남았으면 복원
 */

export async function loadDirectionsForHospital(hospital, autoDraw = false, drawOptions = {}) {
    const container = byId('directions-result');
    const statusBadge = byId('directions-status-badge');
    if (!container || !hospital) {
        return;
    }

    const apiType = byId('directions-api')?.value || 'directions5';
    const option = state.selectedDirectionOption || 'trafast';
    const rawWaypoint = byId('directions-waypoint')?.value || '';
    const [waypointCoord, waypointName] = rawWaypoint.includes('|')
        ? rawWaypoint.split('|')
        : [rawWaypoint, ''];

    state.sheetRouteData = null;
    state.directionsController?.abort();
    const controller = new AbortController();
    state.directionsController = controller;

    if (statusBadge) {
        statusBadge.textContent = '경로 탐색 중…';
    }
    container.replaceChildren(
        node('p', 'empty-state', '네이버 Directions API로 실시간 자동차 경로와 예상 소요 시간을 조회하고 있습니다…')
    );

    try {
        const params = new URLSearchParams({
            startLat: String(state.origin.lat),
            startLng: String(state.origin.lng),
            goalLat: String(hospital.lat),
            goalLng: String(hospital.lng),
            apiType,
            option
        });
        if (waypointCoord) {
            params.set('waypoints', waypointCoord);
        }

        const response = await fetch(`/api/directions?${params.toString()}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        /*
         * [JS 문법]
         * - const, new, await, 단축 속성명(apiType, option), 템플릿 리터럴, if
         *
         * [브라우저 내장 Web API]
         * - new URLSearchParams(obj), .set(key, val), .toString() : URL 쿼리 문자열을 안전하게 인코딩해 조립함.
         * - fetch(url, { signal, headers }) : HTTP GET 비동기 요청을 보내고 AbortSignal로 중간 취소를 지원함.
         *
         * [쿼리 파라미터 조립 분해]
         * - 1단계 (출발·도착 좌표) : startLat, startLng, goalLat, goalLng을 문자열로 바꿔 넣음.
         * - 2단계 (API·주행 옵션) : #directions-api 값(apiType)과 state.selectedDirectionOption(option)을 넣음.
         * - 3단계 (조건부 경유지) : '|' 앞의 좌표인 waypointCoord가 있을 때만 params.set('waypoints', ...)로 추가함.
         *
         * [URL 구조 및 백엔드 연결]
         *   /api/directions?startLat=37.31904&startLng=127.90123&goalLat=37.31884&goalLng=127.94566&apiType=directions15&option=traoptimal&waypoints=127.931,37.321
         *   ├── 경로 prefix : /api                              (EmergencyApiController @RequestMapping("/api"))
         *   ├── 매핑 경로   : /directions                       (EmergencyApiController.getDirections() @GetMapping)
         *   ├── startLat    : @RequestParam("startLat") double  (필수, 출발지 위도)
         *   ├── startLng    : @RequestParam("startLng") double  (필수, 출발지 경도)
         *   ├── goalLat     : @RequestParam("goalLat") double   (필수, 목적지 위도)
         *   ├── goalLng     : @RequestParam("goalLng") double   (필수, 목적지 경도)
         *   ├── apiType     : @RequestParam("apiType") String   ("directions5" 또는 "directions15")
         *   ├── option      : @RequestParam("option") String    ("trafast"|"traoptimal"|"tracomfort"|...)
         *   └── waypoints   : @RequestParam("waypoints") String (선택, 경유 병원 "경도,위도")
         *   ──> 백엔드 NaverDirectionsService.getDrivingRoute()가 4대 옵션 대안·혼잡도·회전 안내 포함 JSON 반환.
         */

        if (controller.signal.aborted) {
            return;
        }

        if (!response.ok) {
            if (statusBadge) {
                statusBadge.textContent = '오류';
            }
            container.replaceChildren(
                node('p', 'empty-state', `자동차 경로 조회 실패: HTTP ${response.status}`)
            );
            return;
        }

        const data = await response.json();
        if (controller.signal.aborted) {
            return;
        }

        if (!state.selected || state.selected.id === hospital.id) {
            state.sheetRouteData = data;
        }

        if (data.code !== 0) {
            if (statusBadge) {
                statusBadge.textContent = '탐색 불가';
            }
            container.replaceChildren(
                node('p', 'empty-state', `자동차 경로 안내 불가: ${data.message || '경로를 찾을 수 없습니다.'}`)
            );
            return;
        }

        const wpBadgeSuffix = waypointName ? ` · 경유(${waypointName})` : '';
        if (statusBadge) {
            statusBadge.textContent = `${data.apiLabel} · ${data.optionLabel}${wpBadgeSuffix}`;
        }

        const straightKm = distanceKm(state.origin, hospital).toFixed(1);
        const originName = getOriginDisplayLabel();
        const distEl = byId('hospital-distance');
        if (distEl) {
            distEl.textContent =
                `${originName}에서 직선 ${straightKm} km · 자동차 ${data.durationText} (실도로 ${data.distanceKm} km)`;
        }

        container.replaceChildren();

        if (Array.isArray(data.alternatives) && data.alternatives.length > 0) {
            const altWrap = node('div', 'directions-alternatives');
            for (const alt of data.alternatives) {
                const isCurrent = alt.option === data.option;
                const altBtn = node('button', `directions-alt-btn ${isCurrent ? 'is-active' : ''}`);
                altBtn.type = 'button';
                altBtn.dataset.option = alt.option;
                altBtn.setAttribute('aria-pressed', String(isCurrent));
                const exactAltKm = Number.isFinite(alt.distanceMeters) && alt.distanceMeters > 0
                    ? (alt.distanceMeters / 1000).toFixed(2)
                    : alt.distanceKm;
                const tollInfo = alt.tollFare > 0
                    ? `통행료\u00A0${alt.tollFare.toLocaleString('ko-KR')}원`
                    : '무료도로';
                const taxiInfo = alt.taxiFare > 0
                    ? ` · 택시\u00A0${alt.taxiFare.toLocaleString('ko-KR')}원`
                    : '';
                altBtn.append(
                    node('span', 'directions-alt-title', alt.optionLabel),
                    node('strong', 'directions-alt-eta', alt.durationText),
                    node('span', 'directions-alt-meta', `${exactAltKm}\u00A0km · ${tollInfo}${taxiInfo}`)
                );
                altBtn.addEventListener('click', () => {
                    if (state.selectedDirectionOption !== alt.option) {
                        state.selectedDirectionOption = alt.option;
                        const isSelectedActive = Boolean(
                            state.activeRoute && state.activeRoute.hospital?.id === hospital.id
                        );
                        loadDirectionsForHospital(hospital, isSelectedActive, { fitMap: false });
                    }
                });
                altWrap.append(altBtn);
            }
            container.append(altWrap);
        }

        const kpiGrid = node('div', 'directions-kpi-grid');

        const etaCard = node('div', 'directions-kpi-card');
        etaCard.append(
            node('span', 'directions-kpi-label', '예상 소요 시간 (ETA)'),
            node('strong', 'directions-kpi-value highlight', data.durationText),
            node('span', 'directions-kpi-sub', `${data.apiLabel} · ${data.optionLabel}${wpBadgeSuffix}`)
        );

        const exactMainKm = Number.isFinite(data.distanceMeters) && data.distanceMeters > 0
            ? (data.distanceMeters / 1000).toFixed(2)
            : data.distanceKm;
        const exactMetersText = Number.isFinite(data.distanceMeters) && data.distanceMeters > 0
            ? `정밀 ${data.distanceMeters.toLocaleString('ko-KR')}m · `
            : '';
        const distCard = node('div', 'directions-kpi-card');
        distCard.append(
            node('span', 'directions-kpi-label', '실도로 주행 거리'),
            node('strong', 'directions-kpi-value', `${exactMainKm} km`),
            node('span', 'directions-kpi-sub', `${exactMetersText}직선거리 ${straightKm} km`)
        );

        const fareCard = node('div', 'directions-kpi-card');
        const tollText = data.tollFare > 0
            ? `통행료 ${data.tollFare.toLocaleString('ko-KR')}원`
            : '통행료 무료';
        const taxiText = data.taxiFare > 0
            ? `택시 약 ${data.taxiFare.toLocaleString('ko-KR')}원`
            : '택시비 미산정';
        const fuelText = data.fuelPrice > 0
            ? `유류비 약 ${data.fuelPrice.toLocaleString('ko-KR')}원`
            : '';
        fareCard.append(
            node('span', 'directions-kpi-label', '통행료 · 택시 · 유류비'),
            node('strong', 'directions-kpi-value', tollText),
            node('span', 'directions-kpi-sub', [taxiText, fuelText].filter(Boolean).join(' · '))
        );

        kpiGrid.append(etaCard, distCard, fareCard);
        container.append(kpiGrid);

        const trafficBox = node('div', 'directions-traffic-summary');
        const legendRow = node('div', 'directions-traffic-legend');
        legendRow.append(
            node('span', 'traffic-legend-title', '경로 소통 색상'),
            node('span', 'traffic-legend-item smooth', '원활'),
            node('span', 'traffic-legend-item slow', '서행'),
            node('span', 'traffic-legend-item jam', '정체')
        );
        trafficBox.append(legendRow);

        if (Array.isArray(data.sections) && data.sections.length > 0) {
            const chipWrap = node('div', 'directions-section-chips');
            const seenKeys = new Set();
            const prioritized = [...data.sections]
                .filter(sec => {
                    const key = `${sec.name}|${sec.congestion}`;
                    if (seenKeys.has(key)) {
                        return false;
                    }
                    seenKeys.add(key);
                    return sec.congestion >= 2 || (sec.distance >= 1000 && sec.name !== '주행 구간');
                })
                .sort((a, b) => (b.congestion - a.congestion) || (b.distance - a.distance))
                .slice(0, 12)
                .sort((a, b) => a.pointIndex - b.pointIndex);

            const displayList = prioritized.length > 0 ? prioritized : data.sections.slice(0, 8);
            for (const sec of displayList) {
                const style = getCongestionStyle(sec.congestion);
                const roadName = sec.name || '주요 구간';
                const speedText = sec.speed > 0 ? ` ${sec.speed}km/h` : '';
                const chip = node(
                    'span',
                    `directions-section-chip ${style.badgeClass}`,
                    `${roadName} · ${style.label}${speedText}`
                );
                chipWrap.append(chip);
            }
            trafficBox.append(chipWrap);
        }
        container.append(trafficBox);

        if (Array.isArray(data.guidePrompts) && data.guidePrompts.length > 0) {
            const details = node('details', 'directions-guide-details');
            details.append(
                node('summary', '', `주요 주행 경로 안내 보기 (${data.guidePrompts.length}개 구간)`)
            );
            const ol = node('ol', 'directions-guide-list');
            for (const stepText of data.guidePrompts.slice(0, 20)) {
                ol.append(node('li', '', stepText));
            }
            details.append(ol);
            container.append(details);
        }

        if (autoDraw) {
            drawRouteOnMap(hospital, data, {
                fitMap: drawOptions.fitMap !== false,
                apiType,
                option,
                rawWaypoint
            });
        }
    } catch (error) {
        if (error?.name === 'AbortError') {
            return;
        }
        if (statusBadge) {
            statusBadge.textContent = '오류';
        }
        container.replaceChildren(
            node('p', 'empty-state', `자동차 경로 조회 실패: ${error.message}`)
        );
    }
}
/*
 * [JS 문법]
 * - export async function, 기본값 매개변수(autoDraw = false, drawOptions = {}), const, if/else, ?., ||, &&, !==, ===, >=, >, ? :
 * - 템플릿 리터럴, '\u00A0' (줄바꿈 방지 공백 문자), [waypointCoord, waypointName], [...data.sections]
 * - try/catch, for...of, return, async/await
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - new AbortController(), controller.abort(), controller.signal.aborted, AbortError : 중복 호출 시 이전 요청을 취소함.
 * - response.ok, response.status, response.json() : HTTP 성공 여부·상태 코드 확인 및 응답 JSON -> JS 객체 변환.
 * - new Set(), Set.prototype.has(), .add() : 중복 키 없이 고유 항목을 빠르게 확인하는 집합 컬렉션.
 * - Array.isArray(val), Number.isFinite(val), Number.prototype.toFixed(), .toLocaleString('ko-KR') : 숫자 검사와 콤마 포맷.
 * - Array.prototype.filter(), .sort(), .slice(), .join() : 조건 선별·정렬·잘라내기·문자열 이어붙이기.
 * - HTMLElement.prototype.replaceChildren(), .append(), .textContent, .dataset, .setAttribute(), addEventListener() : DOM 조작·이벤트 등록.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : loadDirectionsForHospital.
 * - 매개변수명 : hospital(목적지 병원), autoDraw(조회 직후 지도에 자동 표시 여부), drawOptions(fitMap 등 그리기 옵션).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소(결과) : container(#directions-result), statusBadge(#directions-status-badge), distEl(#hospital-distance).
 * - DOM 요소(선택) : #directions-api(API 선택), #directions-waypoint(경유지 선택).
 * - 요청·상태 변수 : apiType, option, rawWaypoint, waypointCoord, waypointName, controller, params, response, data, error.
 * - 요약·대안 변수 : wpBadgeSuffix, straightKm, originName, altWrap, alt, isCurrent, altBtn, exactAltKm, tollInfo, taxiInfo, isSelectedActive.
 * - KPI·안내 변수 : kpiGrid, etaCard, exactMainKm, exactMetersText, distCard, fareCard, tollText, taxiText, fuelText, details, ol, stepText.
 * - 혼잡 칩 변수 : trafficBox, legendRow, chipWrap, seenKeys, prioritized, displayList, sec, style, roadName, speedText, chip.
 *
 * [동작 흐름]
 * - 호출 출처(내부) : resetOriginAndRoute(), loadEtaRanking(), initDirectionsControls().
 * - 호출 출처(외부) : hospital-sheet.js의 openHospital(), search-controls.js의 locate()·setCustomOrigin().
 * - 흐름 :
 *   1) API·옵션·경유지 읽기 ──> directionsController.abort() ──> 안내 문구 표시 후 GET /api/directions 호출
 *   2) 성공 응답 ──> state.sheetRouteData 저장 ──> 상단 배지·#hospital-distance 직선/자동차 거리 갱신
 *   3) 4대 옵션 대안 버튼 ──> 3열 KPI(ETA·거리·요금) ──> 혼잡 구간 칩(최대 12개) ──> 접이식 안내(최대 20개) 렌더링
 *   4) altBtn(.directions-alt-btn) 'click' ──> state.selectedDirectionOption 변경 후 loadDirectionsForHospital() 재호출
 *   5) autoDraw === true ──> drawRouteOnMap()으로 지도에 즉시 경로 표시.
 */

export async function loadEtaRanking() {
    const box = byId('eta-rank-box');
    const btn = byId('eta-rank-btn');
    if (!box) {
        return;
    }

    state.etaRankOpen = true;
    box.hidden = false;
    if (btn) {
        btn.setAttribute('aria-expanded', 'true');
    }

    state.etaRankController?.abort();
    const controller = new AbortController();
    state.etaRankController = controller;

    box.replaceChildren(
        node('p', 'empty-state', '주변 응급의료기관의 실도로 소요시간과 수용 여유도를 분석하고 있습니다…')
    );

    const radiusVal = byId('radius')?.value || '10';
    const radiusKm = radiusVal === 'all' ? '30' : radiusVal;
    const includeRegional = Boolean(byId('filter-regional')?.checked ?? true);
    const includeTertiary = Boolean(byId('filter-tertiary')?.checked ?? true);
    const includeMedical = Boolean(byId('filter-medical')?.checked ?? true);
    const includeOther = Boolean(byId('filter-other')?.checked);
    const mode = state.etaRankMode || 'optimal';

    try {
        const params = new URLSearchParams({
            startLat: String(state.origin.lat),
            startLng: String(state.origin.lng),
            radiusKm: String(radiusKm),
            includeRegional: String(includeRegional),
            includeTertiary: String(includeTertiary),
            includeMedical: String(includeMedical),
            includeOther: String(includeOther),
            onlyAvailable: 'false',
            symptom: 'all',
            mode,
            limit: '5',
            option: 'trafast'
        });

        const response = await fetch(`/api/directions/rank?${params.toString()}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        /*
         * [JS 문법]
         * - const, new, await, 단축 속성명(mode), 템플릿 리터럴
         *
         * [브라우저 내장 Web API]
         * - new URLSearchParams(obj), .toString() : 필터·정렬 값을 URL 안전 쿼리 문자열로 변환함.
         * - fetch(url, { signal, headers }) : HTTP GET 비동기 요청을 보내고 AbortSignal로 중간 취소를 지원함.
         *
         * [쿼리 파라미터 조립 분해]
         * - 1단계 (출발지·반경) : startLat, startLng과 radiusKm('all' 전체 모드일 때는 '30' 전달)을 넣음.
         * - 2단계 (4대 기관 종별) : includeRegional, includeTertiary, includeMedical, includeOther를 문자열로 넣음.
         * - 3단계 (병상·증상 필터) : onlyAvailable과 symptom(state.symptomPreset || 'all')을 넣음.
         * - 4단계 (모드·개수·옵션) : mode('optimal'|'fastest'), limit('5'), option('trafast') 총 12개 값을 조립함.
         *
         * [URL 구조 및 백엔드 연결]
         *   /api/directions/rank?startLat=37.319&startLng=127.901&radiusKm=10&includeRegional=true&includeTertiary=true&includeMedical=true&includeOther=false&onlyAvailable=false&symptom=stroke&mode=optimal&limit=5&option=trafast
         *   ├── 경로 prefix     : /api                                 (EmergencyApiController @RequestMapping("/api"))
         *   ├── 매핑 경로       : /directions/rank                     (EmergencyApiController.rankDirections() @GetMapping)
         *   ├── startLat/Lng    : @RequestParam("startLat"/"startLng") (필수 double, 출발 좌표)
         *   ├── radiusKm        : @RequestParam("radiusKm") double     (기본 20, 프론트는 'all' 시 30 전달)
         *   ├── include* (4개)  : @RequestParam("include*") boolean    (권역·상급·의료원·기타 종별 필터)
         *   ├── onlyAvailable   : @RequestParam("onlyAvailable") boolean (가용 병상 보유 기관만)
         *   ├── symptom         : @RequestParam("symptom") String      (Pre-KTAS 증상 프리셋 키)
         *   ├── mode            : @RequestParam("mode") String         ("optimal" | "fastest")
         *   ├── limit           : @RequestParam("limit") int           (상위 5개)
         *   └── option          : @RequestParam("option") String       ("trafast")
         *   ──> 백엔드 NaverDirectionsService.rankHospitalsByDrivingTime()가 점수·ETA 정렬 후 JSON 배열 반환.
         */

        if (controller.signal.aborted) {
            return;
        }

        if (!response.ok) {
            box.replaceChildren(
                node('p', 'empty-state', `추천 병원 순위 조회 실패 (HTTP ${response.status})`)
            );
            return;
        }

        const ranks = await response.json();
        if (controller.signal.aborted) {
            return;
        }

        box.replaceChildren();

        const header = node('div', 'eta-rank-header');
        const titleText = mode === 'optimal'
            ? `수용최적 추천 (${radiusKm}km 내 상위 ${ranks.length}곳)`
            : `순수 최단시간 (${radiusKm}km 내 상위 ${ranks.length}곳)`;
        header.append(node('span', '', titleText));

        const rightControls = node('div', 'eta-mode-switch');

        const optimalBtn = node('button', 'eta-mode-btn', '수용최적');
        optimalBtn.type = 'button';
        optimalBtn.title = '가용 병상 여유·차단 공지·기관 등급과 실도로 시간을 종합 평가해 응급실 핑퐁 위험을 줄입니다';
        optimalBtn.setAttribute('aria-pressed', String(mode === 'optimal'));
        optimalBtn.addEventListener('click', () => {
            if (state.etaRankMode !== 'optimal') {
                state.etaRankMode = 'optimal';
                loadEtaRanking();
            }
        });

        const fastestBtn = node('button', 'eta-mode-btn', '최단시간');
        fastestBtn.type = 'button';
        fastestBtn.title = '병상 포화도와 무관하게 순수 실도로 주행 소요시간(ETA) 오름차순으로만 정렬합니다';
        fastestBtn.setAttribute('aria-pressed', String(mode === 'fastest'));
        fastestBtn.addEventListener('click', () => {
            if (state.etaRankMode !== 'fastest') {
                state.etaRankMode = 'fastest';
                loadEtaRanking();
            }
        });

        const closeBtn = node('button', 'eta-rank-close', '닫기');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', () => {
            state.etaRankOpen = false;
            box.hidden = true;
            btn?.setAttribute('aria-expanded', 'false');
        });

        rightControls.append(optimalBtn, fastestBtn, closeBtn);
        header.append(rightControls);
        box.append(header);

        if (!Array.isArray(ranks) || !ranks.length) {
            box.append(
                node('p', 'empty-state', '현재 필터·반경 조건에 맞는 추천 응급의료기관이 없습니다. 반경을 넓히거나 필터를 확인하세요.')
            );
            return;
        }

        const list = node('div', 'eta-rank-list');
        for (const item of ranks) {
            const row = node('button', `eta-rank-item ${item.rank === 1 ? 'rank-1' : ''}`);
            row.type = 'button';

            const badge = node('span', 'eta-rank-badge', `${item.rank}위`);
            const main = node('div', 'eta-rank-main');
            const drivingKm = item.drivingDistanceKm ?? item.roadDistanceKm ?? '-';
            const reasonSuffix = item.recommendationReason ? ` · ${item.recommendationReason}` : '';
            main.append(
                node('strong', '', `${item.name} · ${item.durationText}`),
                node(
                    'small',
                    '',
                    `${item.typeLabel} · 실도로 ${drivingKm}km${reasonSuffix}`
                )
            );

            const erNum = integerValue(item.erBeds);
            let erClass = 'eta-rank-er';
            if ((erNum !== null && erNum <= 0) || item.hasBlockingNotice) {
                erClass += ' is-saturated';
            } else if (erNum !== null && erNum >= 3) {
                erClass += ' is-plenty';
            }
            const erBadge = node('span', erClass, `응급실 ${bedValue(item.erBeds)}`);

            row.append(badge, main, erBadge);
            row.addEventListener('click', () => {
                const target = state.hospitals.find(h => h.id === item.id);
                if (target) {
                    uiCallbacks.onOpenHospital?.(target);
                    focusHospitalOnMap(target, 14);
                    loadDirectionsForHospital(target, true);
                }
            });

            list.append(row);
        }
        box.append(list);
    } catch (err) {
        if (err?.name === 'AbortError') {
            return;
        }
        box.replaceChildren(
            node('p', 'empty-state', `추천 순위 조회 중 오류가 발생했습니다: ${err.message}`)
        );
    }
}
/*
 * [JS 문법]
 * - export async function, const, let, ?., ?? (null/undefined 기본값), ||, &&, ===, !==, <=, >=, +=, ? :
 * - 템플릿 리터럴, for...of, try/catch, async/await
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - Boolean(val), String(val), Array.isArray(val), Array.prototype.find(fn) : 형변환, 배열 판별, 조건에 맞는 첫 원소 찾기.
 * - new AbortController(), controller.abort(), controller.signal.aborted, AbortError : 중복 호출 시 이전 순위 요청을 취소함.
 * - response.ok, response.status, response.json() : HTTP 성공 여부 확인 및 응답 JSON -> JS 객체 변환.
 * - HTMLElement.prototype.hidden, .replaceChildren(), .append(), .type, .title, .setAttribute(), addEventListener() : UI 조립·이벤트 등록.
 *
 * [프로젝트 연동 규칙 (다중 지표 추천)]
 * - 4개 종별 체크박스, 가용병상만(state.onlyAvailableBeds), 증상(state.symptomPreset)을 백엔드 요청과 그대로 맞춤.
 * - 'optimal'(수용최적) 모드는 병상 여유·차단 공지를 반영하고, 만실·차단 병원은 .is-saturated 배지로 경고함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : loadEtaRanking (매개변수 없음).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : box(#eta-rank-box), btn(#eta-rank-btn), #radius, #filter-regional, #filter-tertiary, #filter-medical, #filter-other.
 * - 요청·필터 변수 : controller, radiusVal, radiusKm, includeRegional, includeTertiary, includeMedical, includeOther, mode, params, response, ranks, err.
 * - UI·목록 변수 : header, titleText, rightControls, optimalBtn, fastestBtn, closeBtn, list, item, row, badge, main, drivingKm.
 * - 상태·결과 변수 : reasonSuffix, erNum, erClass, erBadge, target.
 *
 * [동작 흐름]
 * - 호출 출처 : app.js(#eta-rank-btn·종별 체크박스), search-controls.js(반경·증상칩·locate·setCustomOrigin), directions-eta.js의 resetOriginAndRoute().
 * - 흐름 :
 *   1) 순위 박스 표시 + etaRankController.abort() ──> 12개 파라미터로 GET /api/directions/rank 요청
 *   2) 헤더 전환 버튼('수용최적'|'최단시간'|'닫기')과 1~5위 병원 목록 렌더링
 *   ├── optimalBtn(.eta-mode-btn '수용최적') 'click' ──> state.etaRankMode = 'optimal' 설정 후 loadEtaRanking()
 *   ├── fastestBtn(.eta-mode-btn '최단시간') 'click' ──> state.etaRankMode = 'fastest' 설정 후 loadEtaRanking()
 *   ├── closeBtn(.eta-rank-close '닫기') 'click' ──> state.etaRankOpen = false, box.hidden = true, btn aria-expanded='false'
 *   └── row(.eta-rank-item) 'click' ──> onOpenHospital(target) + focusHospitalOnMap(target, 14) + loadDirectionsForHospital(target, true)
 */

export function initDirectionsControls() {
    byId('directions-api')?.addEventListener('change', () => {
        if (state.selected) {
            const isSelectedActive = Boolean(
                state.activeRoute && state.activeRoute.hospital?.id === state.selected.id
            );
            loadDirectionsForHospital(state.selected, isSelectedActive, { fitMap: false });
        }
    });

    byId('directions-waypoint')?.addEventListener('change', () => {
        if (state.selected) {
            const isSelectedActive = Boolean(
                state.activeRoute && state.activeRoute.hospital?.id === state.selected.id
            );
            loadDirectionsForHospital(state.selected, isSelectedActive, { fitMap: true });
        }
    });

    const settleSheetAfterRouteDraw = () => {
        if (document.body.classList.contains('touch-device')) {
            uiCallbacks.onSnapSheetHalfPeek?.();
        } else {
            uiCallbacks.onCloseSheet?.();
        }
    };

    byId('directions-draw-btn')?.addEventListener('click', () => {
        if (!state.selected) {
            return;
        }
        const apiType = byId('directions-api')?.value || 'directions5';
        const option = state.selectedDirectionOption || 'trafast';
        const rawWaypoint = byId('directions-waypoint')?.value || '';

        if (state.sheetRouteData && state.sheetRouteData.code === 0 && state.sheetRouteData.path?.length) {
            drawRouteOnMap(state.selected, state.sheetRouteData, {
                fitMap: true,
                apiType,
                option,
                rawWaypoint
            });
            settleSheetAfterRouteDraw();
        } else {
            loadDirectionsForHospital(state.selected, true, { fitMap: true }).then(() => {
                if (hasRenderedRoute()) {
                    settleSheetAfterRouteDraw();
                }
            });
        }
    });

    const reopenActiveRouteHospital = () => {
        const activeHosp = state.activeRoute?.hospital;
        if (!activeHosp) {
            return;
        }
        const fresh = state.hospitals.find(item => item.id === activeHosp.id) || activeHosp;
        if (state.selected?.id === fresh.id && state.sheetHalfPeek) {
            uiCallbacks.onExpandSheetFromHalfPeek?.();
        } else {
            uiCallbacks.onOpenHospital?.(fresh, true, { skipDirections: false });
        }
    };

    byId('active-route-name')?.addEventListener('click', reopenActiveRouteHospital);
    byId('active-route-open')?.addEventListener('click', reopenActiveRouteHospital);
    byId('directions-clear-btn')?.addEventListener('click', clearRouteOnMap);
    byId('active-route-clear')?.addEventListener('click', clearRouteOnMap);
    byId('active-route-reset')?.addEventListener('click', resetOriginAndRoute);
    byId('origin-reset-btn')?.addEventListener('click', resetOriginAndRoute);
}
/*
 * [JS 문법]
 * - export function, ?. (안전 접근), 화살표 함수(=>), const, ||, &&, ===, if/else, !state.selected
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - EventTarget.prototype.addEventListener('change'|'click', fn) : 값 변경·클릭 이벤트 함수를 등록함.
 * - Boolean(val) : 값을 엄격한 불리언(true/false)으로 바꿈.
 * - document.body.classList.contains(cls) : body 요소에 특정 CSS 클래스가 있는지 확인함.
 * - Promise.prototype.then(fn) : 비동기 작업이 성공적으로 끝난 뒤 실행할 함수를 연결함.
 * - Array.prototype.find(fn) : 배열에서 조건 함수가 true인 첫 번째 요소를 찾음.
 *
 * [함수명 및 매개변수명]
 * - 공개 함수명 : initDirectionsControls (매개변수 없음).
 * - 내부 보조 함수명 : settleSheetAfterRouteDraw, reopenActiveRouteHospital.
 *
 * [DOM 요소 및 지역 변수]
 * - 시트·지도 버튼 ID : #directions-api, #directions-waypoint, #directions-draw-btn, #directions-clear-btn.
 * - 배너·초기화 버튼 ID : #active-route-name, #active-route-open, #active-route-clear, #active-route-reset, #origin-reset-btn.
 * - 지역 변수 : isSelectedActive, apiType, option, rawWaypoint, activeHosp, fresh.
 *
 * [동작 흐름]
 * - 호출 출처 : app.js의 init()에서 앱 시작 시 1회 호출되어 길찾기·배너 버튼 이벤트를 연결함.
 * - 이벤트 바인딩 :
 *   ├── #directions-api 'change' ──> 활성 경로 병원이면 loadDirectionsForHospital(..., { fitMap: false }) 갱신
 *   ├── #directions-waypoint 'change' ──> 활성 경로 병원이면 loadDirectionsForHospital(..., { fitMap: true }) 갱신
 *   ├── #directions-draw-btn 'click' ──> drawRouteOnMap() 또는 loadDirectionsForHospital(..., true) 후 settleSheetAfterRouteDraw()
 *   │   └── .touch-device이면 onSnapSheetHalfPeek(), 데스크톱이면 onCloseSheet()
 *   ├── #active-route-name · #active-route-open 'click' ──> reopenActiveRouteHospital() (Half-Peek 확장 또는 onOpenHospital)
 *   ├── #directions-clear-btn · #active-route-clear 'click' ──> clearRouteOnMap()
 *   └── #active-route-reset · #origin-reset-btn 'click' ──> resetOriginAndRoute()
 */
