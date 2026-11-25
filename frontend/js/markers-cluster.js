/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 지도 화면 안의 병원들을 반경·종별 필터로 추린 뒤, 겹치는 카드를 O(N) 2차원 공간 격자로 묶고
 *   기존 카드 DOM을 키 비교로 재사용(`state.markerMap`)하는 지도 카드 배치가
 * - 실행 시점: 초기 병원 스냅샷 도착, 지도 이동 종료(`idle`), 반경·종별 체크박스 변경, 창 리사이즈 시 `updateMarkers()`가 호출됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   `updateMarkers()`
 *   ├── 1) 4종 체크박스·현재 화면(`viewport`)·반경(기본 `50 km`) 필터링 ──> 종별 우선순위·거리순 정렬
 *   ├── 2) `coordToScreenPoint()` 픽셀 변환 ──> `groupCards()` 인접 3×3 격자 충돌 검사로 클러스터 병합
 *   ├── 3) `state.markerMap` 키 비교 ──> 화면 밖 카드만 제거, 기존 카드는 텍스트·좌표만 갱신(DOM 재사용)
 *   └── 4) 카드 클릭 ──> 단일 병원은 `onOpenHospital()`, 다중 병원은 `openCluster()` 모달 표시
 *
 * [사용처 및 IDE 추적 가이드]
 * - 호출처: `app.js`, `map-engine.js:mountNaverMap()`, `search-controls.js` (`initRadius`, `syncFrontendConfig`, `applySnapshotToState`, `locate`, `setCustomOrigin`, `updateSearch`)
 * - 연결 HTML/CSS: `index.html` (`#map-count`, `#cluster-dialog`), `css/map-overlays.css`, `css/dialogs-toast.css`
 * - IntelliJ 추적 팁: 함수명 위에서 `Ctrl + Alt + H` 또는 `Ctrl + Shift + F`로 `updateMarkers` 검색
 * ============================================================================
 */

import {
    CARD_HEIGHT,
    CARD_WIDTH,
    DEFAULT_RADIUS_KM
} from './constants.js';
import {
    state,
    uiCallbacks
} from './state.js';
import {
    bedValue,
    byId,
    distanceKm,
    getBedTrafficInfo,
    integerValue,
    isMissing,
    node,
    radiusExtent
} from './utils.js';
import {
    coordToScreenPoint,
    createNaverDomOverlay,
    getHospitalLatLng,
    isMapReadyForOverlays,
    updateCircle
} from './map-engine.js';

/*
 * [역할 및 호출처]
 * - 역할: 병원의 대표 색상 그룹(`'regional'` / `'tertiary'` / `'medical'` / `'other'`)을 반환함
 * - 호출처: `updateMarkers()`, `openCluster()`
 */
function visualGroup(hospital) {
    return hospital._vGroup || (hospital.regional ? 'regional' : hospital.type?.group || 'other');
}

/*
 * [역할 및 호출처]
 * - 역할: 권역응급의료센터 여부에 따라 `'권역응급의료센터 · 상급종합병원'` 같은 복합 종별 라벨을 생성함
 * - 호출처: `updateMarkers()`, `openCluster()`, `hospital-sheet.js:openHospital()`
 */
export function hospitalLabel(hospital) {
    return hospital.regional
        ? `권역응급의료센터 · ${hospital.type.label}`
        : hospital.type.label;
}

/*
 * [역할 및 호출처]
 * - 역할: 현재 켜져 있는 4대 종별 체크박스(`enabled`)에 해당 병원이 포함되는지 판정함
 *   · 권역응급이면서 상급종합인 병원은 두 체크박스 중 하나만 켜져도 표시됨
 * - 호출처: `updateMarkers()`
 */
function matchesFilters(hospital, enabled) {
    return Boolean(
        enabled[hospital.type.group] ||
        (hospital.regional && enabled.regional)
    );
}

/*
 * [역할 및 알고리즘 원리]
 * - 역할: 화면 픽셀 좌표를 카드 크기(`184 × 76px`) 격자 버킷에 배치하고 인접 9칸(`3 × 3`)만 검사해 O(N) 시간 안에 겹치는 병원 카드를 묶음
 * - 호출처: `updateMarkers()`
 */
function groupCards(points) {
    const groups = [];
    const cellW = CARD_WIDTH + 10;
    const cellH = CARD_HEIGHT + 14;
    const grid = new Map();

    for (const point of points) {
        const cx = Math.floor(point.x / cellW);
        const cy = Math.floor(point.y / cellH);
        let bestNear = null;

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const bucket = grid.get(`${cx + dx},${cy + dy}`);
                if (!bucket) {
                    continue;
                }
                for (let i = 0; i < bucket.length; i++) {
                    const candidate = bucket[i];
                    if (
                        Math.abs(candidate.x - point.x) < cellW &&
                        Math.abs(candidate.y - point.y) < cellH &&
                        (!bestNear || candidate._idx < bestNear._idx)
                    ) {
                        bestNear = candidate;
                    }
                }
            }
        }

        if (bestNear) {
            bestNear.items.push(point.hospital);
        } else {
            const created = {
                ...point,
                items: [point.hospital],
                _idx: groups.length
            };
            groups.push(created);

            const cellKey = `${cx},${cy}`;
            let bucket = grid.get(cellKey);
            if (!bucket) {
                bucket = [];
                grid.set(cellKey, bucket);
            }
            bucket.push(created);
        }
    }
    return groups;
}

/*
 * [역할 및 동작 원리]
 * - 역할: 지도 카드 위에서 지도를 드래그(`> 6px` 이동)할 때는 실수로 시트가 열리지 않게 막고, 순수 클릭일 때만 `card._onActivate()`를 실행함
 *   · 포인터가 눌려 있는 동안(`state.cardPointerDown`) 마커 교체를 잠시 보류해 클릭 누락을 예방함
 * - 호출처: `updateMarkers()`에서 신규 카드 생성 시 1회 바인딩
 */
function bindHospitalCard(card, open) {
    card._onActivate = open;
    if (card._hospitalCardBound) {
        return;
    }
    card._hospitalCardBound = true;

    let moved = false;
    let tracker = null;

    card.draggable = false;

    card.addEventListener('pointerdown', event => {
        if (event.button !== 0) {
            return;
        }

        state.cardPointerDown = true;
        tracker?.abort();
        tracker = new AbortController();
        moved = false;

        const startX = event.clientX;
        const startY = event.clientY;
        const pointerId = event.pointerId;

        const track = next => {
            if (next.pointerId !== pointerId) {
                return;
            }
            const distance = Math.hypot(next.clientX - startX, next.clientY - startY);
            if (distance > 6) {
                moved = true;
            }
        };

        const finish = next => {
            track(next);
            if (next.pointerId !== pointerId) {
                return;
            }
            if (next.type === 'pointercancel') {
                moved = true;
            }
            state.cardPointerDown = false;
            tracker.abort();
            if (state.pendingMarkerUpdate) {
                state.pendingMarkerUpdate = false;
                requestAnimationFrame(() => updateMarkers());
            }
        };

        const options = {
            capture: true,
            passive: true,
            signal: tracker.signal
        };

        window.addEventListener('pointermove', track, options);
        window.addEventListener('pointerup', finish, options);
        window.addEventListener('pointercancel', finish, options);
    });

    card.addEventListener('click', event => {
        if (event.detail !== 0 && moved) {
            event.preventDefault();
            return;
        }
        card._onActivate?.();
    });
}

/*
 * [역할 및 호출처]
 * - 역할: 2곳 이상 묶인 클러스터 카드의 가용 병원 수(`availCount`)와 대표 신호등 색상 클래스를 집계함
 * - 호출처: `updateMarkers()`
 */
function computeClusterTraffic(items) {
    let availCount = 0;
    let plentyCount = 0;
    let reportedCount = 0;

    for (const item of items) {
        const er = integerValue(item.beds?.hvec);
        if (er !== null) {
            reportedCount += 1;
            if (er > 0) {
                availCount += 1;
            }
            if (er >= 3) {
                plentyCount += 1;
            }
        }
    }

    let className = 'avail-unknown';
    if (plentyCount > 0) {
        className = 'avail-plenty';
    } else if (availCount > 0) {
        className = 'avail-low';
    } else if (reportedCount > 0) {
        className = 'avail-full';
    }

    return {
        availCount,
        className,
        label: `주변 ${items.length}곳 중 응급실 가용 ${availCount}곳`
    };
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 현재 지도 뷰포트와 탐색 반경(기본 `50 km`)에 맞춰 병원 카드·클러스터 오버레이를 갱신하고 `#map-count`를 업데이트함
 * - 호출처: `app.js`, `map-engine.js`, `search-controls.js`, `bindHospitalCard()`
 */
export function updateMarkers() {
    if (!state.map) {
        return;
    }

    if (state.cardPointerDown) {
        state.pendingMarkerUpdate = true;
        return;
    }

    updateCircle();

    if (!isMapReadyForOverlays()) {
        return;
    }

    state.diagnostics.markersUpdatedCount += 1;

    const radius = byId('radius')?.value || DEFAULT_RADIUS_KM;
    const numRadius = radius === 'all' ? null : Number(radius);
    const radiusBox = numRadius !== null ? radiusExtent(state.origin, numRadius) : null;
    const enabled = {};

    for (const group of ['regional', 'tertiary', 'medical', 'other']) {
        enabled[group] = Boolean(byId(`filter-${group}`)?.checked);
    }

    let viewport = null;
    try {
        viewport = state.map.getBounds();
    } catch (boundsErr) {
        void boundsErr;
        viewport = null;
    }

    const rank = {
        regional: 0,
        tertiary: 1,
        medical: 2,
        other: 3
    };

    const candidateEntries = [];
    for (let i = 0; i < state.hospitals.length; i++) {
        const hospital = state.hospitals[i];
        const isSelected = Boolean(state.selected && hospital.id === state.selected.id);

        if (!isSelected && !matchesFilters(hospital, enabled)) {
            continue;
        }

        const pos = getHospitalLatLng(hospital);
        if (!pos) {
            continue;
        }

        if (viewport) {
            const inViewport = typeof viewport.hasLatLng === 'function'
                ? viewport.hasLatLng(pos)
                : viewport.hasPoint(pos);
            if (!inViewport) {
                continue;
            }
        }

        if (!isSelected && radiusBox) {
            if (
                hospital.lat < radiusBox.south - 0.005 ||
                hospital.lat > radiusBox.north + 0.005 ||
                hospital.lng < radiusBox.west - 0.005 ||
                hospital.lng > radiusBox.east + 0.005
            ) {
                continue;
            }
        }

        const dist = distanceKm(state.origin, hospital);
        if (!isSelected && numRadius !== null && dist > numRadius) {
            continue;
        }

        candidateEntries.push({
            hospital,
            pos,
            rankVal: rank[visualGroup(hospital)] ?? 3,
            dist
        });
    }

    candidateEntries.sort((a, b) => (a.rankVal - b.rankVal) || (a.dist - b.dist));

    const points = new Array(candidateEntries.length);
    for (let i = 0; i < candidateEntries.length; i++) {
        const { hospital, pos } = candidateEntries[i];
        const point = coordToScreenPoint(hospital.lat, hospital.lng, pos);
        points[i] = {
            x: point.x,
            y: point.y,
            hospital
        };
    }

    const groups = groupCards(points);
    const nextGroupByKey = new Map();

    for (const group of groups) {
        const multiple = group.items.length > 1;
        const key = multiple
            ? `cluster:${group.items.map(item => item.id).join(',')}`
            : `single:${group.items[0].id}`;
        nextGroupByKey.set(key, group);
    }

    for (const [key, existingOverlay] of state.markerMap.entries()) {
        if (!nextGroupByKey.has(key) || existingOverlay.getMap() !== state.map) {
            try {
                existingOverlay.setMap(null);
            } catch (err) {
                void err;
            }
            state.markerMap.delete(key);
            state.diagnostics.markersRemovedCount += 1;
        }
    }

    for (const [key, group] of nextGroupByKey.entries()) {
        const hospital = group.items[0];
        const multiple = group.items.length > 1;
        const vGroup = visualGroup(hospital);
        const nextClassName = `hospital-card ${vGroup}`;

        const trafficInfo = multiple
            ? computeClusterTraffic(group.items)
            : getBedTrafficInfo(hospital.beds?.hvec);
        const nextDotClass = `bed-traffic-dot ${trafficInfo.className}`;

        const nextTitle = multiple
            ? `${trafficInfo.label} · ${group.items.map(item => item.name).join(' · ')}`
            : `${hospital.name} · ${hospitalLabel(hospital)} (${trafficInfo.label})`;

        const nextAriaLabel = multiple
            ? `주변 ${group.items.length}개 병원 목록 열기, 가용 ${trafficInfo.availCount}곳`
            : `${hospital.name} 상세 정보 열기, 응급실 ${bedValue(hospital.beds?.hvec)}`;

        const shortType = hospital.regional
            ? '권역응급'
            : hospital.type.label;

        const nextStrongText = multiple
            ? `주변 ${group.items.length}개 병원`
            : hospital.name;
        const nextSmallText = multiple
            ? `가용 ${trafficInfo.availCount}곳 · 목록 선택 ›`
            : `${shortType} · 응급실 ${bedValue(hospital.beds?.hvec)}`;

        const activateHandler = () => {
            if (multiple) {
                openCluster(group.items);
            } else {
                uiCallbacks.onOpenHospital?.(hospital);
            }
        };

        const targetPos = getHospitalLatLng(hospital);
        const existingOverlay = state.markerMap.get(key);

        if (existingOverlay && existingOverlay.content) {
            const card = existingOverlay.content;
            if (card.className !== nextClassName) {
                card.className = nextClassName;
            }
            if (card.title !== nextTitle) {
                card.title = nextTitle;
            }
            if (card.getAttribute('aria-label') !== nextAriaLabel) {
                card.setAttribute('aria-label', nextAriaLabel);
            }
            if (card._strongEl && card._strongEl.textContent !== nextStrongText) {
                card._strongEl.textContent = nextStrongText;
            }
            if (card._dotEl) {
                if (card._dotEl.className !== nextDotClass) {
                    card._dotEl.className = nextDotClass;
                }
                if (card._dotEl.title !== trafficInfo.label) {
                    card._dotEl.title = trafficInfo.label;
                }
            }
            if (card._smallEl && card._smallEl.textContent !== nextSmallText) {
                card._smallEl.textContent = nextSmallText;
            }
            card._onActivate = activateHandler;
            existingOverlay.setPosition(targetPos);
            state.diagnostics.markersReusedCount += 1;
        } else {
            const card = node('button', nextClassName);
            card.type = 'button';
            card.title = nextTitle;
            card.setAttribute('aria-label', nextAriaLabel);

            const headRow = node('div', 'hospital-card-head');
            const strongEl = node('strong', '', nextStrongText);
            const dotEl = node('span', nextDotClass);
            dotEl.title = trafficInfo.label;
            dotEl.setAttribute('aria-hidden', 'true');
            headRow.append(strongEl, dotEl);

            const smallEl = node('small', '', nextSmallText);
            card._strongEl = strongEl;
            card._dotEl = dotEl;
            card._smallEl = smallEl;
            card.append(headRow, smallEl);

            bindHospitalCard(card, activateHandler);

            const overlay = createNaverDomOverlay({
                map: state.map,
                position: targetPos,
                content: card,
                xAnchor: 0.5,
                yAnchor: 1.0,
                zIndex: 5
            });

            state.markerMap.set(key, overlay);
            state.diagnostics.markersCreatedCount += 1;
        }
    }

    const mapCountEl = byId('map-count');
    if (mapCountEl) {
        mapCountEl.textContent =
            `현재 화면 ${candidateEntries.length}개 기관 · 겹치는 카드는 묶어서 표시`;
    }
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 겹친 클러스터 카드를 눌렀을 때 주변 병원 선택 모달(`#cluster-dialog`)을 열고 병원별 병상·전화를 나열함
 * - 호출처: `updateMarkers()` 내 클러스터 카드 클릭 핸들러, `search-controls.js:handlePreviewMode('cluster')`
 */
export function openCluster(items) {
    state.clusterItems = items;
    const titleEl = byId('cluster-title');
    if (titleEl) {
        titleEl.textContent = `주변 ${items.length}개 병원`;
    }

    const list = byId('cluster-list');
    if (!list) {
        return;
    }
    list.replaceChildren();

    for (const hospital of items) {
        const button = node('button', `cluster-item ${visualGroup(hospital)}`);
        button.type = 'button';

        const headRow = node('div', 'hospital-card-head');
        const traffic = getBedTrafficInfo(hospital.beds?.hvec);
        const dot = node('span', `bed-traffic-dot ${traffic.className}`);
        dot.title = traffic.label;
        dot.setAttribute('aria-hidden', 'true');
        headRow.append(node('strong', '', hospital.name), dot);

        const erPhone = !isMissing(hospital.erTel) ? ` · ${String(hospital.erTel).trim()}` : '';
        button.append(
            headRow,
            node('small', '', hospitalLabel(hospital)),
            node('small', '', `응급실 ${bedValue(hospital.beds?.hvec)}${erPhone}`)
        );

        button.addEventListener('click', () => {
            byId('cluster-dialog')?.close();
            uiCallbacks.onOpenHospital?.(hospital);
        });

        list.append(button);
    }

    byId('cluster-dialog')?.showModal();
}
