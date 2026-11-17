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
 * [JS 문법] import { ... } from './...' : 경로 소스 상수, 전역 상태, 거리·병상 유틸, 지도 피팅·오버레이 함수를 가져옴.
 * [아키텍처 계층] `directions-eta.js`는 네이버 Directions 5/15 실도로 경로 탐색, 단일 GeoJSON WebGL 고속 렌더링, 상단 활성 경로 배너, 다중 지표(수용최적 vs 최단시간) ETA 순위를 전담함.
 */

export function hasRenderedRoute() {
    return Boolean(state.glRouteActive || state.routePolyline || state.activeRoute);
}
/*
 * [내가 지은 이름] hasRenderedRoute : 현재 지도 위에 자동차 경로가 표시되어 있는지 불리언(`true`/`false`)으로 반환함.
 */

export function buildRouteGeoJson(data) {
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
 * [내가 지은 이름] buildRouteGeoJson : 백엔드 `/api/directions` 응답을 국제 표준 GIS 포맷인 단일 GeoJSON `FeatureCollection`으로 변환함.
 * [변환된 GeoJSON 데이터 구조 시각 예시]
 *   {
 *     "type": "FeatureCollection",
 *     "features": [
 *       { "type": "Feature", "properties": { "role": "base" }, "geometry": { "type": "LineString", "coordinates": [[127.901, 37.319], ...] } },
 *       { "type": "Feature", "properties": { "role": "section", "congestion": 3 }, "geometry": { "type": "LineString", "coordinates": [...] } },
 *       { "type": "Feature", "properties": { "role": "start" }, "geometry": { "type": "Point", "coordinates": [127.901, 37.319] } },
 *       { "type": "Feature", "properties": { "role": "end" },   "geometry": { "type": "Point", "coordinates": [127.946, 37.318] } }
 *     ]
 *   }
 */

export function renderGlRoute(mapbox, data) {
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
 * [Mapbox GL 내장 함수] existingSource.setData(featureCollection), mapbox.setPaintProperty(...) (이름 변경 불가)
 * [내가 지은 이름] renderGlRoute : 수십 개의 `Polyline` 객체를 파괴·재생성하지 않고 단 1개의 GeoJSON 소스 버퍼만 교체하여 우클릭 경로 재탐색을 1ms 내에 렌더링함.
 */

export function removeRouteOverlays() {
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
 * [내가 지은 이름] removeRouteOverlays : 지도 위에 그려진 GL 경로선·폴백 폴리라인·경유지 마커만 깨끗이 비움.
 */

export function clearRouteOnMap() {
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
 * [내가 지은 이름] clearRouteOnMap : 출발 기준점 마커는 그대로 유지하면서 자동차 경로선과 상단 배너만 숨김.
 */

export function resetOriginAndRoute() {
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
 * [내가 지은 이름] resetOriginAndRoute : 우클릭/검색으로 찍어 둔 출발 마커와 활성 경로를 한 번에 지우고 기본 기준점(`DEFAULT_ORIGIN`)으로 원상 복구함.
 */

export function getCongestionStyle(congestion) {
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
 * [내가 지은 이름] getCongestionStyle : 구간 혼잡도 코드(`1` 원활 초록, `2` 서행 주황, `3` 정체 빨강)에 대응하는 배지 클래스와 선 색상을 반환함.
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
 * [내가 지은 이름] drawRouteOnMap : 지도 위에 소통 색상별 주행 경로를 그리고 상단 활성 경로 배너(`#active-route-banner`)에
 *   소요 시간·거리뿐만 아니라 **응급실 직통 전화(`#active-route-call`)**와 **상세 시트 재열기(`#active-route-open`)**까지 즉시 연결함.
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
         * [브라우저 내장 도구/함수] new URLSearchParams({...}), fetch(url, options) (기본 HTTP GET 요청, 형제 메서드: POST/PUT/PATCH/DELETE, 이름 변경 불가)
         * [완성 요청 URL 예시]
         *   /api/directions?startLat=37.31904&startLng=127.90123&goalLat=37.31884&goalLng=127.94566&apiType=directions5&option=trafast
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
 * [내가 지은 이름] refreshActiveRoute : 지도에 경로가 켜져 있을 때 다른 지점을 우클릭(모바일 롱탭)하면 새 출발지에서 즉시 경로를 재탐색함.
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
 * [내가 지은 이름] populateWaypointSelect : 1차 응급 처치 후 상급 병원으로 전원(이송)하는 시나리오를 위해 출발점 주변 15개 병원을 경유지 드롭다운에 채워 줌.
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
 * [내가 지은 이름] loadDirectionsForHospital : 상세 시트 최상단 섹션에 4대 경로 옵션(`빠른길·최적·편한길·무료`) 비교 카드, ETA·실도로거리·요금 KPI, 혼잡 도로 칩, 회전 안내를 생성함.
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
            onlyAvailable: String(state.onlyAvailableBeds),
            symptom: String(state.symptomPreset || 'all'),
            mode,
            limit: '5',
            option: 'trafast'
        });

        const response = await fetch(`/api/directions/rank?${params.toString()}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        /*
         * [조립된 다중 지표 랭킹 요청 URL 예시]
         *   /api/directions/rank?startLat=37.319&startLng=127.901&radiusKm=10&includeRegional=true&includeTertiary=true&includeMedical=true&includeOther=false&onlyAvailable=false&symptom=stroke&mode=optimal&limit=5&option=trafast
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
 * [핵심 도메인 업그레이드 — `loadEtaRanking` 다중 지표 '수용최적(응급실 핑퐁 방지)' 추천 엔진 연동]
 * - 기존에는 `filter-other` 단 1개 체크박스만 반영하고 무조건 거리/시간순으로만 줄 세워, 만실(`0석`)·초과수용(`-5석`) 병원이 1위로 추천되는 한계가 있었음.
 * - 이제 4개 종별 체크박스 + `[가용병상만]` + 증상 프리셋을 모두 동기화하며, `'수용최적'` 모드(기본값)에서는 가용 병상 여유 병원을 최상단으로 추천하고
 *   포화·차단공지 병원은 붉은색 배지(`.is-saturated`)와 사유 문구(`recommendationReason`)로 즉시 경고함.
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
 * [모바일 UX 혁신 — `'지도에 경로 표시'` 시 바텀시트 Half-Peek 스냅 (`settleSheetAfterRouteDraw`)]
 * - 모바일(`.touch-device`)에서 경로 표시를 눌렀을 때 시트를 완전히 닫아 버리면 응급실 전화 버튼과 3사 내비 버튼이 사라져 버리는 불편이 있었음.
 * - 이제 모바일에서는 시트를 하단 268px 요약 높이(`onSnapSheetHalfPeek`)로 반만 내려, **위쪽 지도 경로를 보면서 동시에 아래쪽 전화·내비 버튼을 즉시 누를 수 있음.**
 */
