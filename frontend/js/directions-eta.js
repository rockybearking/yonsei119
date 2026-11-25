/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 네이버 Directions 5 / 15 실도로 자동차 경로 탐색, 실시간 교통 레이어와 1:1 일치하는 경로선 렌더링,
 *   울릉도 등 해상 여객선(페리) 구간 안내 차단, 그리고 수용최적·최단시간 추천 순위(`#eta-rank-box`)를 담당하는 내비게이터
 * - 실행 시점: 앱 시작 시 `initDirectionsControls()`가 1회 바인딩되며,
 *   병원 시트를 열거나(`loadDirectionsForHospital`), 경로 표시·추천 순위 버튼을 누를 때마다 동작함
 *
 * [전체 호출 및 데이터 흐름]
 * - 경로 탐색·렌더링 흐름:
 *   `loadDirectionsForHospital()` ──> `GET /api/directions` (`NaverDirectionsService`)
 *   ├── `code === -304` (울릉도 등 해상 여객선 구간 포함) ──> 실제 네이버 지도와 동일하게 경로선 차단 + `'경로 미제공'` 안내 표시
 *   └── `code === 0` (정상 육상·연륙교 도로 경로)
 *       ├── 4대 옵션 대안(`trafast`·`traoptimal`·`tracomfort`·`traavoidtoll`) + 요금·소통 구간 칩 렌더링
 *       └── `drawRouteOnMap()` ──> 기본선(미계측 `#3b82f6`) 위에 원활(`#27c441`)·서행(`#ff8d00`)·정체(`#ff3b30`) 구간을 정확히 덧칠함
 *
 * [사용처 및 IDE 추적 가이드]
 * - 호출 모듈: `app.js`, `hospital-sheet.js`, `search-controls.js`, `map-engine.js`(`uiCallbacks.onDrawRouteOnMap`)
 * - 백엔드 연동: `EmergencyApiController.java` (`/api/directions`, `/api/directions/rank`), `NaverDirectionsService.java`, `RouteCongestionAnalyzer.java`
 * - IntelliJ 추적 팁: `Ctrl + Alt + H` (함수 호출 계층) 또는 `Ctrl + Shift + F`로 `/api/directions` 검색
 * ============================================================================
 */

import {
    DEFAULT_RADIUS_KM,
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

const FERRY_ROUTE_UNSUPPORTED_CODE = -304;

/*
 * [역할 및 호출처]
 * - 역할: 현재 지도에 활성화된 경로선이 그려져 있는지 불리언(`true`/`false`)으로 반환함
 * - 호출처: `app.js` 진단 객체, `hospital-sheet.js:initSheetDrag()`, `initDirectionsControls()`
 */
export function hasRenderedRoute() {
    return Boolean(state.glRouteActive || state.routePolyline || state.activeRoute);
}

/*
 * [역할 및 데이터 흐름 — 교통 레이어 색상 및 정점 인덱스 정합성 핵심]
 * - 역할: 백엔드 `/api/directions` 응답의 경로(`path`)와 공식 소통 구간(`sections`)을 WebGL GeoJSON `FeatureCollection`으로 변환함
 * - 왜 기존에 네이버 교통정보와 색상이 어긋났는가?
 *   1) 기본 경로(`base`)를 초록색으로 칠해 교통정보가 없는 도로(`congestion === 0`, 울릉도·이면도로 등)까지 초록 소통 구간처럼 보였음
 *      ──> 기본선은 중립 파랑(`#3b82f6`)으로 두고, 실제 소통 코드 `1`(원활)·`2`(서행)·`3`(정체) 구간만 그 위에 정확히 덮어 그림
 *   2) `endIdx = startIdx + count`로 자르면서 다음 도로 구간의 첫 선분까지 1칸 침범하던 오프셋을 `startIdx + Math.max(1, count - 1)`로 교정함
 * - 호출처: `renderGlRoute(mapbox, data)`
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
        const trafficSections = data.sections
            .filter(sec => sec.congestion === 1 || sec.congestion === 2 || sec.congestion === 3)
            .sort((a, b) => a.congestion - b.congestion);

        for (const sec of trafficSections) {
            const startIdx = Math.max(0, Number(sec.pointIndex) || 0);
            const count = Math.max(0, Number(sec.pointCount) || 0);
            if (count <= 0 || startIdx >= validPath.length - 1) {
                continue;
            }
            const endIdx = Math.min(validPath.length - 1, startIdx + Math.max(1, count - 1));
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
 * [역할 및 색상 매핑 — `map-engine.js:syncGlTrafficLayers()`와 100% 동일 색상]
 * - 역할: WebGL 지도(`mapbox`)에 GeoJSON 경로와 소통 구간 레이어(미계측 `#3b82f6`, 원활 `#27c441`, 서행 `#ff8d00`, 정체 `#ff3b30`)를 그림
 * - 호출처: `drawRouteOnMap(hospital, data, options)`
 */
function renderGlRoute(mapbox, data) {
    if (!mapbox || typeof mapbox.getStyle !== 'function' || typeof mapbox.getSource !== 'function') {
        return false;
    }

    const featureCollection = buildRouteGeoJson(data);
    if (!featureCollection.features.length) {
        return false;
    }

    const baseOutlineColor = state.darkMode ? '#1e3a8a' : '#1d4ed8';

    try {
        const existingSource = mapbox.getSource(GL_ROUTE_SOURCE_ID);
        if (existingSource && typeof existingSource.setData === 'function') {
            existingSource.setData(featureCollection);
            if (mapbox.getLayer('yonsei-route-outline')) {
                mapbox.setPaintProperty('yonsei-route-outline', 'line-color', baseOutlineColor);
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
                    'line-color': baseOutlineColor,
                    'line-width': 9,
                    'line-opacity': 0.65
                }
            },
            {
                id: 'yonsei-route-base',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['==', 'role', 'base'],
                layout: lineLayout,
                paint: {
                    'line-color': '#3b82f6',
                    'line-width': 5,
                    'line-opacity': 0.95
                }
            },
            {
                id: 'yonsei-route-smooth-outline',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 1]],
                layout: lineLayout,
                paint: {
                    'line-color': '#14532d',
                    'line-width': 9,
                    'line-opacity': 0.65
                }
            },
            {
                id: 'yonsei-route-smooth',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 1]],
                layout: lineLayout,
                paint: {
                    'line-color': '#27c441',
                    'line-width': 5.5,
                    'line-opacity': 0.98
                }
            },
            {
                id: 'yonsei-route-slow-outline',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 2]],
                layout: lineLayout,
                paint: {
                    'line-color': '#7c2d12',
                    'line-width': 9,
                    'line-opacity': 0.68
                }
            },
            {
                id: 'yonsei-route-slow',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 2]],
                layout: lineLayout,
                paint: {
                    'line-color': '#ff8d00',
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
                    'line-opacity': 0.7
                }
            },
            {
                id: 'yonsei-route-jam',
                type: 'line',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['all', ['==', 'role', 'section'], ['==', 'congestion', 3]],
                layout: lineLayout,
                paint: {
                    'line-color': '#ff3b30',
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
                    'circle-stroke-color': '#27c441'
                }
            },
            {
                id: 'yonsei-route-end',
                type: 'circle',
                source: GL_ROUTE_SOURCE_ID,
                filter: ['==', 'role', 'end'],
                paint: {
                    'circle-radius': 6.5,
                    'circle-color': '#ff3b30',
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
 * [역할 및 호출처]
 * - 역할: WebGL 경로 소스와 2D 폴백 `Polyline`·경유지 마커를 지도에서 모두 지움
 * - 호출처: `clearRouteOnMap()`, `drawRouteOnMap()`, `refreshActiveRoute()`
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
 * [역할 및 호출처]
 * - 역할: 활성 경로 요청을 취소하고 지도 경로선과 상단 경로 배너(`#active-route-banner`)를 함께 숨김
 * - 호출처: `resetOriginAndRoute()`, `loadDirectionsForHospital()`, `initDirectionsControls()`(`#directions-clear-btn`, `#active-route-clear`)
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
 * [역할 및 데이터 흐름]
 * - 역할: 지정한 출발 위치 점과 지도 경로를 모두 지우고 기본 출발지(`DEFAULT_ORIGIN`, 서울시청) 상태로 되돌림
 * - 호출처: `initDirectionsControls()` (`#active-route-reset`, `#origin-reset-btn` 클릭 리스너)
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

    const radiusVal = byId('radius')?.value || DEFAULT_RADIUS_KM;
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
 * [역할 및 색상 코드 매핑]
 * - 역할: 네이버 공식 도로 소통 코드(`0`: 정보없음, `1`: 원활, `2`: 서행, `3`: 정체)를 2D 경로선 색상 및 구간 배지 클래스로 변환함
 * - 호출처: `drawRouteOnMap()`(2D 폴백 경로선), `loadDirectionsForHospital()`(구간 소통 칩)
 */
function getCongestionStyle(congestion) {
    if (congestion === 3) {
        return {
            label: '정체',
            badgeClass: 'congestion-jam',
            strokeColor: '#ff3b30',
            outlineColor: '#7f1d1d',
            zIndex: 98
        };
    }
    if (congestion === 2) {
        return {
            label: '서행',
            badgeClass: 'congestion-slow',
            strokeColor: '#ff8d00',
            outlineColor: '#7c2d12',
            zIndex: 97
        };
    }
    if (congestion === 1) {
        return {
            label: '원활',
            badgeClass: 'congestion-smooth',
            strokeColor: '#27c441',
            outlineColor: '#14532d',
            zIndex: 96
        };
    }
    return {
        label: '정보없음',
        badgeClass: 'congestion-neutral',
        strokeColor: '#3b82f6',
        outlineColor: '#1e3a8a',
        zIndex: 95
    };
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 상단 활성 경로 배너(`#active-route-banner`)를 띄우고, 지도 위에 WebGL(미지원 시 2D `Polyline`) 경로선과 경유지 마커를 그림
 * - 호출처: `loadDirectionsForHospital()`, `refreshActiveRoute()`, `initDirectionsControls()`, `map-engine.js:mountNaverMap()`
 */
export function drawRouteOnMap(hospital, data, options = {}) {
    if (!hospital || !data || data.code !== 0 || !Array.isArray(data.path) || !data.path.length) {
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
            strokeColor: state.darkMode ? '#1e3a8a' : '#1d4ed8',
            strokeWeight: 9,
            strokeOpacity: 0.6,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            zIndex: 90
        }));

        const polylineOpts = {
            map: state.map,
            path: latLngPath,
            strokeColor: '#3b82f6',
            strokeWeight: 5,
            strokeOpacity: 0.95,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            zIndex: 94
        };
        if (naverMaps.PointingIcon) {
            polylineOpts.startIcon = naverMaps.PointingIcon.CIRCLE;
            polylineOpts.startIconSize = 10;
            polylineOpts.endIcon = naverMaps.PointingIcon.BLOCK_ARROW;
            polylineOpts.endIconSize = 14;
        }
        state.routePolyline = guardGlShapeRedraw(new naverMaps.Polyline(polylineOpts));

        if (Array.isArray(data.sections) && data.sections.length > 0) {
            const trafficSections = data.sections
                .filter(sec => sec.congestion === 1 || sec.congestion === 2 || sec.congestion === 3)
                .sort((a, b) => a.congestion - b.congestion);

            for (const sec of trafficSections) {
                const startIdx = Math.max(0, Number(sec.pointIndex) || 0);
                const count = Math.max(0, Number(sec.pointCount) || 0);
                if (count <= 0 || startIdx >= latLngPath.length - 1) {
                    continue;
                }
                const endIdx = Math.min(latLngPath.length - 1, startIdx + Math.max(1, count - 1));
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
                    strokeOpacity: 0.68,
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
 * [역할 및 백엔드 API 연결]
 * - 역할: 지도에 경로가 표시된 상태에서 출발지가 변경(GPS·우클릭)되었을 때 `GET /api/directions`로 활성 경로를 다시 조회함
 * - 호출처: `search-controls.js` (`locate`, `setCustomOrigin`)
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
                    metaEl.textContent = data.code === FERRY_ROUTE_UNSUPPORTED_CODE
                        ? '도서·해상 구간 자동차 경로 미제공'
                        : '해당 위치에서 도로 경로 탐색 불가';
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
 * [역할 및 호출처]
 * - 역할: 출발 기준점에서 가까운 주변 병원 15곳을 경유지 드롭다운(`#directions-waypoint`)에 채움
 * - 호출처: `hospital-sheet.js:openHospital()`, `resetOriginAndRoute()`, `search-controls.js` (`locate`, `setCustomOrigin`)
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
 * [역할 및 백엔드 API 연결]
 * - 역할: 병원 상세 시트의 자동차 경로 섹션(`#directions-result`)에 `GET /api/directions` 결과를 받아 4대 대안·KPI·소통 구간·회전 안내를 그림
 * - 도서·해상 여객선 구간 차단:
 *   · 울릉군보건의료원 등 해상 페리 구간이 포함되어 백엔드가 `code === -304`를 반환하면,
 *     지도 경로선을 즉시 비우고 실제 네이버 지도 서비스와 동일하게 `'경로 미제공'` 안내 문구를 표시함
 * - 호출처: `hospital-sheet.js:openHospital()`, `resetOriginAndRoute()`, `loadEtaRanking()`, `initDirectionsControls()`, `search-controls.js`
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

        const straightKm = distanceKm(state.origin, hospital).toFixed(1);
        const originName = getOriginDisplayLabel();
        const distEl = byId('hospital-distance');

        if (data.code !== 0) {
            if (state.activeRoute?.hospital?.id === hospital.id) {
                clearRouteOnMap();
            }
            if (statusBadge) {
                statusBadge.textContent = data.code === FERRY_ROUTE_UNSUPPORTED_CODE
                    ? '경로 미제공'
                    : '탐색 불가';
            }
            if (distEl && data.code === FERRY_ROUTE_UNSUPPORTED_CODE) {
                distEl.textContent = `${originName}에서 직선 ${straightKm} km · 자동차 경로 미제공 (도서·해상 구간)`;
            }
            const unavailablePrefix = data.code === FERRY_ROUTE_UNSUPPORTED_CODE
                ? '자동차 경로 미제공'
                : '자동차 경로 안내 불가';
            container.replaceChildren(
                node('p', 'empty-state', `${unavailablePrefix}: ${data.message || '경로를 찾을 수 없습니다.'}`)
            );
            return;
        }

        const wpBadgeSuffix = waypointName ? ` · 경유(${waypointName})` : '';
        if (statusBadge) {
            statusBadge.textContent = `${data.apiLabel} · ${data.optionLabel}${wpBadgeSuffix}`;
        }

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
            node('span', 'traffic-legend-item jam', '정체'),
            node('span', 'traffic-legend-item neutral', '교통정보 없음')
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
 * [역할 및 백엔드 API 연결]
 * - 역할: 현재 반경(기본 `50 km`)과 종별 필터 조건으로 `GET /api/directions/rank`를 호출해 수용최적·최단시간 상위 5개 병원을 `#eta-rank-box`에 그림
 * - 호출처: `app.js` (`#eta-rank-btn`·체크박스 변경), `search-controls.js` (`initRadius`, `locate`, `setCustomOrigin`), `resetOriginAndRoute()`
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

    const radiusVal = byId('radius')?.value || DEFAULT_RADIUS_KM;
    const radiusKm = radiusVal === 'all' ? DEFAULT_RADIUS_KM : radiusVal;
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
 * [역할 및 데이터 흐름]
 * - 역할: 길찾기 API·경유지 드롭다운, 지도에 경로 표시/지우기 버튼, 상단 활성 경로 배너 버튼을 한 번에 이벤트 바인딩함
 * - 호출처: `app.js:init()`에서 앱 시작 시 1회 호출
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
