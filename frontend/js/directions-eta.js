/*
 * ============================================================================
 * [1. 역할 및 실행 시점]
 * - 역할 : 네이버 Directions 5 / 15 자동차 경로 탐색, 실시간 교통 타일(`CTT + RTS`)과
 *          1:1 일치하는 경로선 렌더링, 울릉도 페리 항로 차단, 수용최적 ETA 추천 순위 담당
 * - 실행 시점 : `app.js : init()`에서 컨트롤 이벤트가 바인딩되며,
 *              병원 시트 열기·경로 표시·지도 이동(`idle`)·추천 순위 클릭 시 실행됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [User Action]               [directions-eta.js]             [Backend /directions]      [Naver CTT / RTS]
 *             |                              |                                |                        |
 *             |-- 1. select / draw route --->|                                |                        |  병원 자동차 경로 요청
 *             |                              |-- 2. GET /api/directions ----->|                        |  경로 · 대안 옵션 조회
 *             |                              |<-- 3. path[] + code -----------|                        |  응답 코드 및 좌표열 수신
 *        +----+------------------------------+--------------------------------+------------------------+----------+
 *        | [alt : code === -304 (ferry route)]                                                                    |  울릉도 등 해상 페리 구간
 *        |    |<-- 4a. clear & block route --|                                |                        |          |  '자동차 경로 미제공' 표시
 *        +----+------------------------------+--------------------------------+------------------------+----------+
 *        | [else : code === 0 (land route)]                                                                       |  정상 육상 · 연륙교 도로
 *        |    |                              |-- 4b. query ctt + fetch rts ---|----------------------->|          |  60초 실시간 링크 상태 조회
 *        |    |                              |<-- link geom + state(1,2,4) ---|------------------------|          |  원활 · 서행 · 정체 수신
 *        |    |                              |-- 5. match dist + cos>=0.78    |                        |          |  상·하행 분리 1:1 색상 매칭
 *        +----+------------------------------+--------------------------------+------------------------+----------+
 *             v                              v                                v                        v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 외부 SDK / 프로젝트 내부)]
 * - JS / 브라우저 표준 내장
 *   ㄴ async / await   : 비동기 HTTP 통신 순서를 제어하는 표준 문법 키워드
 *   ㄴ fetch()         : 백엔드 API 및 네이버 RTS 소통 JSON을 호출하는 브라우저 내장 함수
 *   ㄴ AbortController : 이전 경로·순위 요청을 즉시 취소하는 브라우저 내장 클래스
 *   ㄴ URLSearchParams : URL 쿼리 문자열을 안전하게 조립하는 표준 내장 클래스
 *   ㄴ Map / Set       : RTS 타일 캐시 및 중복 구간 제거용 표준 내장 컬렉션 클래스
 *   ㄴ Math            : 평면 미터 투영·내적(방위각)·타일 XYZ 계산용 표준 내장 객체
 * - 외부 SDK / 라이브러리
 *   ㄴ naver.maps         : Mapbox GL(`getMapbox`) · `Polyline` · `LatLngBounds` 제공
 * - 프로젝트 내부 모듈
 *   ㄴ constants.js / state.js / utils.js / map-engine.js
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 호출하는 모듈
 *   ㄴ frontend/js/app.js             : initDirectionsControls(), scheduleActiveRouteCttSync()
 *   ㄴ frontend/js/hospital-sheet.js  : populateWaypointSelect(), loadDirectionsForHospital()
 *   ㄴ frontend/js/search-controls.js : refreshActiveRoute(), loadEtaRanking()
 *   ㄴ frontend/js/map-engine.js      : `onDrawRouteOnMap`, `onTrafficTilesUpdated` 콜백 호출
 * - 백엔드 연결처
 *   ㄴ EmergencyApiController.java : `GET /api/directions`, `GET /api/directions/rank`
 *   ㄴ NaverDirectionsService.java : 페리 항로 차단(`-304`) 및 추천 순위 산출
 * - IntelliJ 추적 단축키
 *   ㄴ 호출 계층 보기 : 함수명 위에서 `Ctrl + Alt + H`
 *   ㄴ 전체 문자열 검색 : `Ctrl + Shift + F`로 `matchRouteToCttFeatures` 또는 `/api/directions` 검색
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
    syncGlTrafficSourceVisibility,
    updateCircle,
    updateLocationMarker
} from './map-engine.js';

const FERRY_ROUTE_UNSUPPORTED_CODE = -304;
const RTS_VERSION_URL = 'https://map.pstatic.net/nvc/ctt/rts/naver/getLatestVersion/v1';
const RTS_TILE_BASE_URL = 'https://map.pstatic.net/nvc/ctt/rts/naver/getTile/v1';
const RTS_VERSION_TTL_MS = 55000;
const MAX_RTS_TILE_CACHE_ENTRIES = 160;
const MAX_RTS_TILES_PER_SYNC = 12;
const METERS_PER_DEG_LAT = 111320;
const STRICT_DIRECTION_COS = 0.78; // 약 38도 이내 (상·하행 반대 차선 및 90도 교차 도로 배제)
const TURN_CORNER_DIRECTION_COS = 0.62; // 교차로 회전 모서리 근접(16m 이내) 보조 허용치

const rtsState = {
    version: null,
    versionFetchedAt: 0,
    versionPromise: null,
    tileMapByKey: new Map(),
    inflightTiles: new Map(),
    mergedLinkStates: new Map(),
    syncTimerId: null
};

/*
 * [역할 및 사용처]
 * - 역할 : 현재 지도 위에 활성 경로선이 렌더링되어 있는지 불리언(`true`/`false`)으로 반환함
 * - 사용처
 *   ㄴ frontend/js/app.js            : 진단 객체 `hasRenderedRoute`
 *   ㄴ frontend/js/hospital-sheet.js : `initSheetDrag()` 모바일 반열림 스냅 판정
 *   ㄴ frontend/js/directions-eta.js : `initDirectionsControls()`
 */
export function hasRenderedRoute() {
    return Boolean(state.glRouteActive || state.routePolyline || state.activeRoute);
}

/*
 * [역할 및 데이터 흐름]
 * - 역할 : 네이버 `CTT/RTS` 소통 상태 코드(`1`:원활, `2`:서행, `4`:정체, `0`:미수집)를
 *          경로선 표준 혼잡도 코드(`1`, `2`, `3`, `0`)로 변환함
 */
function normalizeCttStateToCongestion(rawState) {
    const code = Number(rawState);
    if (code === 1) {
        return 1;
    }
    if (code === 2) {
        return 2;
    }
    if (code === 4 || code === 3) {
        return 3;
    }
    return 0;
}

/*
 * [역할 및 계산 원리]
 * - 역할 : 위경도(`lat`, `lng`)와 줌 레벨(`z`)로 웹 메르카토르 XYZ 타일 번호(`{ x, y }`)를 계산함
 */
function latLngToTileXY(lat, lng, z) {
    const scale = 2 ** z;
    const x = Math.max(0, Math.min(scale - 1, Math.floor(((lng + 180) / 360) * scale)));
    const latRad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
    const y = Math.max(
        0,
        Math.min(scale - 1, Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * scale))
    );
    return { x, y };
}

/*
 * [역할 및 시퀀스 흐름]
 * - 역할 : 네이버 실시간 교통(`RTS`, 60초 주기) 최신 버전과 현재 화면·경로가 지나는 타일들의
 *          링크별 소통 상태(`mapping -> state`)를 비동기로 받아 메모리 캐시에 적재함
 * - 사용처 : `drawRouteOnMap()`, `scheduleActiveRouteCttSync()`
 */
async function ensureLiveRtsStatesForRoute(validPath) {
    if (!state.map || !Array.isArray(validPath) || validPath.length < 2) {
        return false;
    }

    const now = Date.now();
    if (!rtsState.version || now - rtsState.versionFetchedAt > RTS_VERSION_TTL_MS) {
        if (!rtsState.versionPromise) {
            rtsState.versionPromise = fetch(RTS_VERSION_URL, { headers: { Accept: 'application/json' } })
                .then(res => (res.ok ? res.json() : null))
                .then(json => {
                    if (json?.version) {
                        if (rtsState.version && rtsState.version !== String(json.version)) {
                            rtsState.mergedLinkStates.clear();
                        }
                        rtsState.version = String(json.version);
                        rtsState.versionFetchedAt = Date.now();
                    }
                    return rtsState.version;
                })
                .catch(() => rtsState.version)
                .finally(() => {
                    rtsState.versionPromise = null;
                });
        }
        await rtsState.versionPromise;
    }

    const version = rtsState.version;
    if (!version) {
        return false;
    }

    const rawZoom = Number(state.map.getZoom?.() ?? 13);
    const z = Math.max(7, Math.min(17, Math.round(rawZoom)));

    let viewBounds = null;
    try {
        viewBounds = state.map.getBounds?.();
    } catch (err) {
        void err;
    }

    const wantedTileKeys = [];
    const seenCoords = new Set();
    const step = Math.max(1, Math.floor(validPath.length / 80));

    for (let i = 0; i < validPath.length; i += step) {
        const [lng, lat] = validPath[i];
        if (viewBounds && typeof viewBounds.hasLatLng === 'function' && window.naver?.maps?.LatLng) {
            if (!viewBounds.hasLatLng(new window.naver.maps.LatLng(lat, lng))) {
                continue;
            }
        }
        const { x, y } = latLngToTileXY(lat, lng, z);
        const coordId = `${z}/${x}/${y}`;
        if (!seenCoords.has(coordId)) {
            seenCoords.add(coordId);
            wantedTileKeys.push({ z, x, y, cacheKey: `${version}:${coordId}` });
            if (wantedTileKeys.length >= MAX_RTS_TILES_PER_SYNC) {
                break;
            }
        }
    }

    // 마지막 종점 타일도 화면 안에 있으면 빠짐없이 포함함
    const [endLng, endLat] = validPath[validPath.length - 1];
    const endTile = latLngToTileXY(endLat, endLng, z);
    const endCoordId = `${z}/${endTile.x}/${endTile.y}`;
    if (!seenCoords.has(endCoordId) && wantedTileKeys.length < MAX_RTS_TILES_PER_SYNC) {
        wantedTileKeys.push({ z, x: endTile.x, y: endTile.y, cacheKey: `${version}:${endCoordId}` });
    }

    let newlyLoaded = false;
    const pendingPromises = [];

    for (const tile of wantedTileKeys) {
        if (rtsState.tileMapByKey.has(tile.cacheKey)) {
            continue;
        }
        let inflight = rtsState.inflightTiles.get(tile.cacheKey);
        if (!inflight) {
            const url = `${RTS_TILE_BASE_URL}/${tile.z}/${tile.x}/${tile.y}.json?version=${encodeURIComponent(version)}&dataType=default`;
            inflight = fetch(url, { headers: { Accept: 'application/json' } })
                .then(res => (res.ok ? res.json() : null))
                .then(items => {
                    if (Array.isArray(items)) {
                        if (rtsState.tileMapByKey.size >= MAX_RTS_TILE_CACHE_ENTRIES) {
                            const oldestKey = rtsState.tileMapByKey.keys().next().value;
                            if (oldestKey) {
                                rtsState.tileMapByKey.delete(oldestKey);
                            }
                        }
                        rtsState.tileMapByKey.set(tile.cacheKey, true);
                        for (const entry of items) {
                            if (entry?.mapping) {
                                rtsState.mergedLinkStates.set(String(entry.mapping), Number(entry.state) || 0);
                            }
                        }
                        newlyLoaded = true;
                    }
                })
                .catch(() => {})
                .finally(() => {
                    rtsState.inflightTiles.delete(tile.cacheKey);
                });
            rtsState.inflightTiles.set(tile.cacheKey, inflight);
        }
        pendingPromises.push(inflight);
    }

    if (pendingPromises.length > 0) {
        await Promise.all(pendingPromises);
    }
    return newlyLoaded;
}

/*
 * [역할 및 기하 계산]
 * - 역할 : 점 `(px, py)`에서 선분 `(x1, y1)-(x2, y2)`까지의 최단 수직 거리 제곱(`m²`)을 계산함
 */
function pointToSegmentDistSq(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 1e-6) {
        const ex = px - x1;
        const ey = py - y1;
        return ex * ex + ey * ey;
    }
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const rx = px - projX;
    const ry = py - projY;
    return rx * rx + ry * ry;
}

/*
 * [역할 및 핵심 알고리즘 — 네이버 공식 `CTT` 도로 링크 공간·방향 정밀 매칭]
 * - 역할 : 현재 WebGL 지도에 로드된 `ctt` 도로 링크 피처들과 우리 경로 선분을 대조하여,
 *          `교통` 레이어와 교차로·상하행 차선 단위까지 100% 일치하는 색상 구간을 생성함
 * - 왜 반대 차선이나 교차 도로 색상이 섞이지 않는가?
 *   1) 평면 미터 격자(80m 셀)에서 도로 폭 허용치 이내 링크만 후보로 추림
 *   2) 경로 진행 방향 단위벡터와 `ctt` 링크 방향 단위벡터의 내적(`cos Δθ >= 0.78`, 약 38° 이내)을
 *      검사하여 맞은편 역주행 차선(`Δθ ≈ 180°`)과 수직 교차로(`Δθ ≈ 90°`)를 원천 배제함
 *   3) `ctt` 링크가 아예 없거나 `state === 0`인 실제 골목길·병원 구내도로만 `0`(파란색)으로 남김
 */
function buildCttMatchedSectionFeatures(validPath, mapbox, sourceId = 'ctt') {
    if (!mapbox || typeof mapbox.querySourceFeatures !== 'function') {
        return null;
    }

    let rawFeatures = [];
    try {
        rawFeatures = mapbox.querySourceFeatures(sourceId, { sourceLayer: 'ctt' }) || [];
    } catch (err) {
        void err;
        return null;
    }

    if (!rawFeatures.length) {
        return null;
    }

    const refLng = validPath[0][0];
    const refLat = validPath[0][1];
    const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
    const toXY = (lng, lat) => [
        (lng - refLng) * metersPerDegLng,
        (lat - refLat) * METERS_PER_DEG_LAT
    ];

    // 긴 직선 구간에서도 교차로별 소통 변화(예: 을지로 3가 주황 -> 4가 빨강)가 정밀히 나뉘도록 35m 단위로 세분화함
    let totalRouteMeters = 0;
    const projectedVertices = validPath.map(([lng, lat]) => toXY(lng, lat));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < projectedVertices.length; i++) {
        const [vx, vy] = projectedVertices[i];
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
        if (i > 0) {
            totalRouteMeters += Math.hypot(
                vx - projectedVertices[i - 1][0],
                vy - projectedVertices[i - 1][1]
            );
        }
    }

    const maxSubSegMeters = Math.max(35, totalRouteMeters / 700);
    const subSegments = [];

    for (let i = 0; i < validPath.length - 1; i++) {
        const c1 = validPath[i];
        const c2 = validPath[i + 1];
        const [x1, y1] = projectedVertices[i];
        const [x2, y2] = projectedVertices[i + 1];
        const segLen = Math.hypot(x2 - x1, y2 - y1);
        if (segLen < 0.3) {
            continue;
        }
        const ux = (x2 - x1) / segLen;
        const uy = (y2 - y1) / segLen;
        const parts = Math.max(1, Math.ceil(segLen / maxSubSegMeters));

        for (let p = 0; p < parts; p++) {
            const t0 = p / parts;
            const t1 = (p + 1) / parts;
            const sx1 = x1 + (x2 - x1) * t0;
            const sy1 = y1 + (y2 - y1) * t0;
            const sx2 = x1 + (x2 - x1) * t1;
            const sy2 = y1 + (y2 - y1) * t1;
            subSegments.push({
                coordStart: [c1[0] + (c2[0] - c1[0]) * t0, c1[1] + (c2[1] - c1[1]) * t0],
                coordEnd: [c1[0] + (c2[0] - c1[0]) * t1, c1[1] + (c2[1] - c1[1]) * t1],
                mx: (sx1 + sx2) * 0.5,
                my: (sy1 + sy2) * 0.5,
                ux,
                uy,
                len: segLen / parts,
                congestion: 0,
                hasNearbyCttTile: false
            });
        }
    }

    if (!subSegments.length) {
        return null;
    }

    const zoom = Number(state.map?.getZoom?.() ?? 13);
    const maxMatchDist = Math.min(85, Math.max(26, 20 * (2 ** Math.max(0, 13 - zoom))));
    const cellSize = Math.max(80, Math.ceil(maxMatchDist * 1.5));
    const bboxMargin = maxMatchDist + 40;
    const spatialGrid = new Map();
    let indexedSegmentCount = 0;

    const addLineCoordsToGrid = (coords, congestion, twoWay) => {
        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            if (!Array.isArray(p1) || !Array.isArray(p2) || p1.length < 2 || p2.length < 2) {
                continue;
            }
            const [x1, y1] = toXY(p1[0], p1[1]);
            const [x2, y2] = toXY(p2[0], p2[1]);
            const segMinX = Math.min(x1, x2);
            const segMaxX = Math.max(x1, x2);
            const segMinY = Math.min(y1, y2);
            const segMaxY = Math.max(y1, y2);

            if (
                segMaxX < minX - bboxMargin ||
                segMinX > maxX + bboxMargin ||
                segMaxY < minY - bboxMargin ||
                segMinY > maxY + bboxMargin
            ) {
                continue;
            }

            const len = Math.hypot(x2 - x1, y2 - y1);
            if (len < 0.5) {
                continue;
            }

            const cttSeg = {
                x1,
                y1,
                x2,
                y2,
                vx: (x2 - x1) / len,
                vy: (y2 - y1) / len,
                congestion,
                twoWay
            };
            indexedSegmentCount += 1;

            const gx0 = Math.floor(segMinX / cellSize);
            const gx1 = Math.floor(segMaxX / cellSize);
            const gy0 = Math.floor(segMinY / cellSize);
            const gy1 = Math.floor(segMaxY / cellSize);

            for (let gx = gx0; gx <= gx1; gx++) {
                for (let gy = gy0; gy <= gy1; gy++) {
                    const key = `${gx},${gy}`;
                    let bucket = spatialGrid.get(key);
                    if (!bucket) {
                        bucket = [];
                        spatialGrid.set(key, bucket);
                    }
                    bucket.push(cttSeg);
                }
            }
        }
    };

    for (const feature of rawFeatures) {
        const geom = feature?.geometry;
        if (!geom) {
            continue;
        }
        const props = feature.properties || {};
        const mappingKey = props.mapping ? String(props.mapping) : '';
        const rtsCode = mappingKey && rtsState.mergedLinkStates.has(mappingKey)
            ? rtsState.mergedLinkStates.get(mappingKey)
            : props.state;
        const congestion = normalizeCttStateToCongestion(rtsCode);
        const twoWay = props.two_way === true || props.two_way === 1 || props.two_way === 'true';

        if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
            addLineCoordsToGrid(geom.coordinates, congestion, twoWay);
        } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
            for (const line of geom.coordinates) {
                if (Array.isArray(line)) {
                    addLineCoordsToGrid(line, congestion, twoWay);
                }
            }
        }
    }

    if (indexedSegmentCount === 0) {
        return null;
    }

    const maxMatchDistSq = maxMatchDist * maxMatchDist;
    const cornerDistSq = 16 * 16;

    for (const sub of subSegments) {
        const cx = Math.floor(sub.mx / cellSize);
        const cy = Math.floor(sub.my / cellSize);
        let bestScore = Infinity;
        let bestCongestion = 0;
        let cornerScore = Infinity;
        let cornerCongestion = 0;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = spatialGrid.get(`${cx + dx},${cy + dy}`);
                if (!bucket) {
                    continue;
                }
                sub.hasNearbyCttTile = true;
                for (const cand of bucket) {
                    const distSq = pointToSegmentDistSq(
                        sub.mx, sub.my, cand.x1, cand.y1, cand.x2, cand.y2
                    );
                    if (distSq > maxMatchDistSq) {
                        continue;
                    }
                    const rawDot = sub.ux * cand.vx + sub.uy * cand.vy;
                    const effectiveDot = cand.twoWay ? Math.abs(rawDot) : rawDot;

                    if (effectiveDot >= STRICT_DIRECTION_COS) {
                        const dist = Math.sqrt(distSq);
                        const score = dist + (1 - effectiveDot) * 24;
                        if (score < bestScore) {
                            bestScore = score;
                            bestCongestion = cand.congestion;
                        }
                    } else if (distSq <= cornerDistSq && effectiveDot >= TURN_CORNER_DIRECTION_COS) {
                        const dist = Math.sqrt(distSq);
                        const score = dist + (1 - effectiveDot) * 30;
                        if (score < cornerScore) {
                            cornerScore = score;
                            cornerCongestion = cand.congestion;
                        }
                    }
                }
            }
        }

        sub.congestion = bestScore < Infinity ? bestCongestion : cornerCongestion;
    }

    // 교차로 정지선 사이 짧은 공백(<= 28m)이 양옆 동일 소통 구간 사이에 끼어 있으면 끊김 없이 연결함
    for (let i = 1; i < subSegments.length - 1; i++) {
        const cur = subSegments[i];
        if (cur.congestion === 0 && cur.len <= 28) {
            const prevC = subSegments[i - 1].congestion;
            const nextC = subSegments[i + 1].congestion;
            if (prevC > 0 && nextC > 0) {
                cur.congestion = prevC;
            }
        }
    }

    const sectionFeatures = [];
    let runCongestion = 0;
    let runCoords = [];

    const flushRun = () => {
        if (runCongestion > 0 && runCoords.length >= 2) {
            sectionFeatures.push({
                type: 'Feature',
                properties: {
                    role: 'section',
                    congestion: runCongestion
                },
                geometry: {
                    type: 'LineString',
                    coordinates: runCoords
                }
            });
        }
        runCongestion = 0;
        runCoords = [];
    };

    for (const sub of subSegments) {
        if (sub.congestion === 1 || sub.congestion === 2 || sub.congestion === 3) {
            if (sub.congestion === runCongestion && runCoords.length > 0) {
                runCoords.push(sub.coordEnd);
            } else {
                flushRun();
                runCongestion = sub.congestion;
                runCoords = [sub.coordStart, sub.coordEnd];
            }
        } else {
            flushRun();
        }
    }
    flushRun();

    state.diagnostics.cttMatchedRouteCount += 1;
    return sectionFeatures;
}

/*
 * [역할 및 데이터 흐름]
 * - 역할 : 경로 좌표(`path`)를 WebGL GeoJSON `FeatureCollection`으로 조립함
 *   1순위 : 현재 지도 `ctt` 실시간 교통 벡터 타일 + `rts` 60초 소통 데이터 직접 매칭 (`교통` 버튼과 100% 일치)
 *   2순위 : 초기 타일 도착 전 수십 ms 동안만 백엔드 `data.sections` 공식 구간으로 임시 표시
 */
function buildRouteGeoJson(data, mapbox = null, cttSourceId = 'ctt') {
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

    const cttMatchedFeatures = mapbox
        ? buildCttMatchedSectionFeatures(validPath, mapbox, cttSourceId || 'ctt')
        : null;

    if (cttMatchedFeatures !== null) {
        cttMatchedFeatures.sort((a, b) => a.properties.congestion - b.properties.congestion);
        features.push(...cttMatchedFeatures);
    } else if (Array.isArray(data.sections) && data.sections.length > 0) {
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
 * [역할 및 사용처]
 * - 역할 : 지도 줌·이동(`idle`) 또는 새 `ctt` 벡터 타일 도착(`sourcedata`) 시
 *          80ms 디바운스로 활성 경로선의 실시간 교통 색상을 즉시 재동기화함
 * - 사용처
 *   ㄴ frontend/js/app.js        : `onTrafficTilesUpdated` 콜백 등록
 *   ㄴ frontend/js/map-engine.js : `idle` · `sourcedata` · `syncTrafficLayer()` 발생 시 호출
 */
export function scheduleActiveRouteCttSync() {
    if (!state.glRouteActive || !state.activeRoute?.data?.path?.length) {
        return;
    }
    if (rtsState.syncTimerId) {
        clearTimeout(rtsState.syncTimerId);
    }
    rtsState.syncTimerId = setTimeout(async () => {
        rtsState.syncTimerId = null;
        const activeData = state.activeRoute?.data;
        const mapbox = state.map?.getMapbox?.();
        if (!state.glRouteActive || !activeData?.path?.length || !mapbox) {
            return;
        }
        await ensureLiveRtsStatesForRoute(activeData.path);
        if (!state.glRouteActive || state.activeRoute?.data !== activeData) {
            return;
        }
        const cttSourceId = syncGlTrafficSourceVisibility(true) || 'ctt';
        const existingSource = mapbox.getSource?.(GL_ROUTE_SOURCE_ID);
        if (existingSource && typeof existingSource.setData === 'function') {
            existingSource.setData(buildRouteGeoJson(activeData, mapbox, cttSourceId));
            state.diagnostics.glRouteUpdateCount += 1;
        }
    }, 80);
}

/*
 * [역할 및 색상 매핑]
 * - 역할 : WebGL 지도에 경로선 레이어(미수집 `#3b82f6`, 원활 `#27c441`, 서행 `#ff8d00`, 정체 `#ff3b30`)를 그림
 * - 사용처 : `drawRouteOnMap()`
 */
function renderGlRoute(mapbox, data) {
    if (!mapbox || typeof mapbox.getStyle !== 'function' || typeof mapbox.getSource !== 'function') {
        return false;
    }

    const cttSourceId = syncGlTrafficSourceVisibility(true) || 'ctt';
    const featureCollection = buildRouteGeoJson(data, mapbox, cttSourceId);
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
            scheduleActiveRouteCttSync();
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
        scheduleActiveRouteCttSync();
        return true;
    } catch (glErr) {
        void glErr;
        return false;
    }
}

/*
 * [역할 및 사용처]
 * - 역할 : 지도에 그려진 WebGL·2D 경로선과 경유지 마커를 제거하고 불필요해진 `ctt` 프로브를 정리함
 * - 사용처 : `clearRouteOnMap()`, `drawRouteOnMap()`, `refreshActiveRoute()`
 */
function removeRouteOverlays() {
    if (rtsState.syncTimerId) {
        clearTimeout(rtsState.syncTimerId);
        rtsState.syncTimerId = null;
    }

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
    syncGlTrafficSourceVisibility(Boolean(state.activeRoute));

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
 * [역할 및 사용처]
 * - 역할 : 활성 경로 상태와 지도 경로선, 상단 경로 배너(`#active-route-banner`)를 모두 닫음
 * - 사용처 : `resetOriginAndRoute()`, `loadDirectionsForHospital()`, `#directions-clear-btn`, `#active-route-clear`
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
 * [역할 및 사용처]
 * - 역할 : 지정 출발지와 경로선을 지우고 기본 출발지(`DEFAULT_ORIGIN`, 서울시청)로 복원함
 * - 사용처 : `#active-route-reset`, `#origin-reset-btn` 클릭 리스너
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
 * [역할 및 사용처]
 * - 역할 : 소통 코드(`0~3`)를 2D 폴백 선 색상 및 시트 요약 칩 스타일 객체로 매핑함
 * - 사용처 : `drawRouteOnMap()`(2D 폴백), `loadDirectionsForHospital()`(요약 칩)
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
 * [역할 및 사용처]
 * - 역할 : 상단 경로 배너를 표시하고 지도 위에 WebGL(`CTT` 실시간 매칭) 또는 2D 경로선·경유지를 그림
 * - 사용처
 *   ㄴ frontend/js/directions-eta.js : `loadDirectionsForHospital()`, `refreshActiveRoute()`, `initDirectionsControls()`
 *   ㄴ frontend/js/map-engine.js     : `mountNaverMap()` 테마 전환 후 활성 경로 복원
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
 * [역할 및 사용처]
 * - 역할 : 출발지 변경(GPS · 우클릭) 시 활성 경로를 `GET /api/directions`로 다시 계산해 갱신함
 * - 사용처
 *   ㄴ frontend/js/search-controls.js : `locate()`, `setCustomOrigin()`
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
 * [역할 및 사용처]
 * - 역할 : 출발지 기준 가까운 주변 병원 15곳을 경유지 드롭다운(`#directions-waypoint`)에 채움
 * - 사용처
 *   ㄴ frontend/js/hospital-sheet.js  : `openHospital()`
 *   ㄴ frontend/js/directions-eta.js  : `resetOriginAndRoute()`
 *   ㄴ frontend/js/search-controls.js : `locate()`, `setCustomOrigin()`
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
 * [역할 및 사용처]
 * - 역할 : 병원 상세 시트의 자동차 경로 섹션(`#directions-result`)에 4대 대안·요금·주요 도로 칩을 렌더링함
 * - 사용처
 *   ㄴ frontend/js/hospital-sheet.js  : `openHospital()`
 *   ㄴ frontend/js/directions-eta.js  : `resetOriginAndRoute()`, `loadEtaRanking()`, `initDirectionsControls()`
 *   ㄴ frontend/js/search-controls.js : `locate()`, `setCustomOrigin()`
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
                const speedText = sec.speed > 0 ? ` (평균 ${sec.speed}km/h)` : '';
                const chip = node(
                    'span',
                    `directions-section-chip ${style.badgeClass}`,
                    `${roadName}${speedText}`
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
 * [역할 및 사용처]
 * - 역할 : 반경(기본 `50 km`) 내 `GET /api/directions/rank`를 호출해 수용최적·최단시간 상위 5곳을 표시함
 * - 사용처
 *   ㄴ frontend/js/app.js             : `#eta-rank-btn` 및 종별 필터 변경 리스너
 *   ㄴ frontend/js/search-controls.js : `initRadius()`, `locate()`, `setCustomOrigin()`
 *   ㄴ frontend/js/directions-eta.js  : `resetOriginAndRoute()`
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
 * [역할 및 사용처]
 * - 역할 : 길찾기 옵션·경유지 변경, 경로 표시/지우기, 상단 배너 버튼 이벤트를 초기 바인딩함
 * - 사용처
 *   ㄴ frontend/js/app.js : `init()`에서 1회 호출
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
