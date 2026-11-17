import {
    CARD_HEIGHT,
    CARD_WIDTH,
    SYMPTOM_PRESETS
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
    matchesSymptomPresetClient,
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
 * [JS 문법] import { ... } from './...' : 카드 규격 상수, 전역 상태, 필터·병상 신호등 유틸리티, 지도 투영·오버레이 함수를 가져옴.
 * [아키텍처 계층] `markers-cluster.js`는 $O(N)$ 2D 공간 해시 클러스터링, Key-Diffing DOM 재사용 마커 엔진, 병상 여유 신호등 표시, 클러스터 모달을 전담함.
 */

export function visualGroup(hospital) {
    return hospital._vGroup || (hospital.regional ? 'regional' : hospital.type?.group || 'other');
}
/*
 * [내가 지은 이름] visualGroup : 병원의 종별 색상 코드(`'regional'` 빨강, `'tertiary'` 주황, `'medical'` 파랑, `'other'` 초록)를 즉시 반환함.
 */

export function hospitalLabel(hospital) {
    return hospital.regional
        ? `권역응급의료센터 · ${hospital.type.label}`
        : hospital.type.label;
}
/*
 * [내가 지은 이름] hospitalLabel : 권역응급의료센터 지정 병원일 경우 기관 등급 앞에 `'권역응급의료센터 · '` 배지 설명을 덧붙여 반환함.
 */

export function matchesFilters(hospital, enabled) {
    const matchesType = Boolean(
        enabled[hospital.type.group] ||
        (hospital.regional && enabled.regional)
    );
    if (!matchesType) {
        return false;
    }

    if (state.onlyAvailableBeds) {
        const erCount = integerValue(hospital.beds?.hvec);
        if (erCount === null || erCount <= 0) {
            return false;
        }
    }

    if (state.symptomPreset && state.symptomPreset !== 'all') {
        if (!matchesSymptomPresetClient(hospital, state.symptomPreset)) {
            return false;
        }
    }

    return true;
}
/*
 * [내가 지은 이름] matchesFilters : 1) 4대 종별 체크박스 + 2) `[가용병상만]` 토글 + 3) 원터치 증상 프리셋(`state.symptomPreset`) 3단 필터를 모두 통과하는지 검사함.
 * [도메인 규칙] 상급종합병원이면서 권역응급의료센터인 기관(예: 세브란스병원, 원주세브란스기독병원)은 두 체크박스 중 하나만 켜져 있어도 누락 없이 표시됨.
 */

export function groupCards(points) {
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
 * [JS 내장 도구/함수] Math.floor(...), Math.abs(...), new Map(), grid.get(...), grid.set(...) (이름 변경 불가)
 * [내가 지은 이름] groupCards : 화면 픽셀상 서로 겹치는 병원 카드들을 하나의 클러스터 그룹으로 묶는 $O(N)$ 2D 공간 해시 격자(Spatial Hash Grid) 알고리즘임.
 * [핵심 원리 & 우편함 격자 비유]
 * - 기존 $O(N^2)$ 방식은 새 카드마다 이미 놓인 수백 장의 카드를 전부 대조했지만,
 *   이 방식은 지도 화면을 `184px × 76px` 바둑판 사물함(`grid`)으로 나눈 뒤 자기 칸과 주변 8칸(`3×3 = 9칸`)만 확인하므로 전국 보기에서도 1ms 안에 끝남.
 */

export function bindHospitalCard(card, open) {
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
 * [브라우저 내장 도구/함수] new AbortController(), Math.hypot(dx, dy) (피타고라스 직선 이동 픽셀 계산), addEventListener(..., { signal }) (이름 변경 불가)
 * [내가 지은 이름] bindHospitalCard : 병원 카드 위에서 손가락을 6px 넘게 끌었을 때는 지도 드래그로 간주해 오작동 클릭을 막고, 제자리 탭일 때만 상세 시트를 엶.
 */

export function clearMarkers() {
    for (const overlay of state.markerMap.values()) {
        try {
            overlay.setMap(null);
        } catch (err) {
            void err;
        }
    }
    state.markerMap.clear();

    for (const marker of state.markers) {
        try {
            marker.setMap(null);
        } catch (err) {
            void err;
        }
    }
    state.markers = [];
}
/*
 * [내가 지은 이름] clearMarkers : 지도 재마운트 시 모든 병원 카드 오버레이를 일괄 정리함.
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
 * [내가 지은 이름] computeClusterTraffic : 겹친 클러스터 카드 안의 병원들 중 실제 가용 병상이 1석 이상 남아 있는 병원 수(`availCount`)와 대표 신호등 색상을 계산함.
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

    const radius = byId('radius')?.value || '10';
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

        const nextStrongText = multiple ? `주변 ${group.items.length}개 병원` : hospital.name;
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

    state.markers = Array.from(state.markerMap.values());

    const activePresetObj = SYMPTOM_PRESETS.find(item => item.key === state.symptomPreset);
    const filterTags = [];
    if (state.onlyAvailableBeds) {
        filterTags.push('가용병상만');
    }
    if (activePresetObj && activePresetObj.key !== 'all') {
        filterTags.push(activePresetObj.label);
    }
    const filterSuffix = filterTags.length ? ` [${filterTags.join(' · ')}]` : '';

    const mapCountEl = byId('map-count');
    if (mapCountEl) {
        mapCountEl.textContent =
            `현재 화면 ${candidateEntries.length}개 기관${filterSuffix} · 겹치는 카드는 묶어서 표시`;
    }
}
/*
 * [내가 지은 이름] updateMarkers : 1) BBox 사전 여과 -> 2) 3단 조건 필터링 -> 3) $O(N)$ 공간 해시 클러스터링 -> 4) Key-Diffing DOM 재사용 + 병상 여유 신호등(`.bed-traffic-dot`) 갱신을 수행함.
 * [시각적 카드 구조 예시]
 *   ┌───────────────────────────────────┐
 *   │ ▌세브란스병원                   🟢 │  <-- .hospital-card-head (종별 컬러바 + 병원명 + 병상 여유 신호등 도트)
 *   │ ▌권역응급 · 응급실 6석             │  <-- <small> 요약 줄 (클러스터 시: "가용 2곳 · 목록 선택 ›")
 *   └─────────────────▼─────────────────┘
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
/*
 * [브라우저 내장 함수] dialog.showModal(), dialog.close() : 네이티브 `<dialog>` 모달을 최상위 레이어(Top Layer)에 열고 닫음 (형제 함수: 비모달 `dialog.show()`, 이름 변경 불가).
 * [내가 지은 이름] openCluster : 겹친 병원 카드 클릭 시 병원별 병상 신호등과 응급실 전화번호를 한눈에 비교해 선택할 수 있는 모달 목록을 띄움.
 */
