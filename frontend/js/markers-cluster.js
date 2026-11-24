import {
    CARD_HEIGHT,
    CARD_WIDTH
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
 * [JS 문법]
 * - import { 심볼 } from './파일.js' : 동일 폴더 모듈에서 필요한 상수와 함수를 가져옴.
 *
 * [프로젝트 내부 가져오기 목록]
 * - ./constants.js : CARD_WIDTH(174), CARD_HEIGHT(62), SYMPTOM_PRESETS(증상 프리셋 목록)
 * - ./state.js : state(병원·마커맵·진단 전역 상태), uiCallbacks(onOpenHospital 역호출 레지스트리)
 * - ./utils.js : bedValue, byId, distanceKm, getBedTrafficInfo, integerValue
 *   · isMissing, matchesSymptomPresetClient, node, radiusExtent (정제·필터·DOM·거리 유틸)
 * - ./map-engine.js : coordToScreenPoint, createNaverDomOverlay, getHospitalLatLng
 *   · isMapReadyForOverlays, updateCircle (좌표 투영·오버레이·반경 원 유틸)
 *
 * [모듈 아키텍처]
 * - markers-cluster.js : 3단 병원 필터링과 O(N) 2차원 공간 격자 클러스터링을 담당함.
 * - 키 비교 DOM 오버레이 재사용(updateMarkers), 병상 도트, 클러스터 모달(openCluster)을 구현함.
 */

function visualGroup(hospital) {
    return hospital._vGroup || (hospital.regional ? 'regional' : hospital.type?.group || 'other');
}
/*
 * [JS 문법]
 * - export function : 외부 모듈에서도 import해 호출할 수 있는 공개 함수를 선언함.
 * - || / ? : : 캐시를 우선 반환하고 없으면 조건에 따라 기본 그룹 키로 폴백함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : visualGroup(hospital) ('regional', 'tertiary', 'medical', 'other' 반환)
 *
 * [동작 흐름]
 * - applySnapshotToState()가 미리 계산한 hospital._vGroup 존재 시 -> 즉시 반환
 * - 미캐시 시 -> hospital.regional 참이면 'regional', 아니면 type.group || 'other' 반환
 */

export function hospitalLabel(hospital) {
    return hospital.regional
        ? `권역응급의료센터 · ${hospital.type.label}`
        : hospital.type.label;
}
/*
 * [JS 문법]
 * - 템플릿 리터럴 / ? : : 조건에 따라 접두 문자열과 라벨을 하나로 조합함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : hospitalLabel(hospital) (hospital-sheet.js와 상세 배지 표시에 공용 사용)
 *
 * [동작 흐름]
 * - hospital.regional 참 -> '권역응급의료센터 · ' + hospital.type.label 반환
 * - hospital.regional 거짓 -> 기본 hospital.type.label 그대로 반환
 */

function matchesFilters(hospital, enabled) {
    return Boolean(
        enabled[hospital.type.group] ||
        (hospital.regional && enabled.regional)
    );
}
/*
 * [JS 내장 함수·문법]
 * - Boolean(val) : 피연산자를 명시적 불리언(true/false)으로 변환함.
 * - ?. : 옵셔널 체이닝으로 상위 객체가 없어도 예외 없이 undefined를 반환함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : matchesFilters(hospital, enabled)
 * - 지역 변수 : matchesType(종별 통과 여부), erCount(응급실 가용 병상 정수 또는 null)
 *
 * [동작 흐름]
 * - 1단계 종별 필터 -> enabled[type.group] || (regional && enabled.regional) 미충족 시 false
 * - 2단계 가용병상만 -> state.onlyAvailableBeds 참일 때 hvec가 null이거나 0 이하이면 false
 * - 3단계 증상 프리셋 -> symptomPreset !== 'all'일 때 matchesSymptomPresetClient()로 검증
 * - 3단 필터 모두 통과 -> true 반환
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
 * [JS 내장 API]
 * - new Map() / map.get(key) / map.set(key, val) : 격자 셀 키별 버킷을 O(1)로 조회·저장함.
 * - Array.prototype.push(item) : 배열 끝에 새 원소를 추가함.
 * - Math.floor(n) / Math.abs(n) : 소수점 버림(격자 인덱스)과 절댓값(픽셀 거리 차) 함수임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : groupCards(points) (우선순위 정렬된 { x, y, hospital } 배열 입력)
 * - 지역 변수 : groups(결과 그룹 배열), cellW(184px), cellH(76px), grid(격자 Map)
 * - 탐색 변수 : point, cx, cy, bestNear, dy, dx, bucket, candidate, created, cellKey
 *
 * [동작 흐름]
 * - 1단계 격자 변환 -> 각 point의 픽셀 (x, y)를 (cellW, cellH)로 나눠 격자 셀 (cx, cy) 산출
 * - 2단계 인접 3x3 탐색 -> 전수 비교 대신 dx, dy ∈ [-1, 1] 인접 9개 셀 버킷만 검사
 *   └── |candidate.x - point.x| < cellW && |candidate.y - point.y| < cellH 이면 겹침 판정
 * - 3단계 병합·신규 등록 -> 겹치는 그룹 유무에 따라 처리 분기
 *   ├── 겹침 있음 -> 가장 작은 _idx를 가진 bestNear.items에 병원 병합
 *   └── 겹침 없음 -> 새 그룹(_idx: groups.length) 생성 후 groups와 grid[cellKey]에 등록
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
 * [JS/Web 내장 API]
 * - new AbortController() / controller.abort() / controller.signal : 리스너를 일괄 해제함.
 * - element.draggable = false : 버튼 요소의 브라우저 기본 드래그 앤 드롭을 막음.
 * - target.addEventListener(type, fn, opts) : capture·passive·signal 옵션으로 등록함.
 * - Math.hypot(dx, dy) : 두 점 사이의 직선 유클리드 픽셀 거리를 계산하는 표준 함수임.
 * - requestAnimationFrame(callback) : 다음 화면 그리기 프레임에 콜백 실행을 예약함.
 * - event.button / pointerId / type / detail / preventDefault() : 입력·클릭 제어 API임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : bindHospitalCard(card, open)
 * - DOM 확장 속성 : card._onActivate(최신 클릭 콜백), card._hospitalCardBound(중복 방지)
 * - 지역 변수 : moved, tracker, startX, startY, pointerId, track, distance, finish, options
 *
 * [동작 흐름]
 * - 호출 : updateMarkers()에서 새 카드 생성 시 호출(이미 바인딩됐으면 _onActivate만 교체)
 * - card 'pointerdown'(좌클릭) -> state.cardPointerDown = true로 보호, window 추적 등록
 * - window 'pointermove' -> track(next): Math.hypot 거리가 6px 초과면 moved = true
 * - window 'pointerup' / 'pointercancel' -> finish(next): cardPointerDown = false, tracker.abort()
 *   └── state.pendingMarkerUpdate 참 -> requestAnimationFrame으로 updateMarkers() 보류분 실행
 * - card 'click' -> 포인터 드래그(detail !== 0 && moved)이면 preventDefault(), 아니면 card._onActivate?.()
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
 * [JS 문법]
 * - function fn(items) : 모듈 내부에서만 호출하는 비공개 집계 함수를 선언함.
 * - for (const item of items) : 클러스터에 묶인 병원 배열을 순서대로 순회함.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : computeClusterTraffic(items) (묶인 병원 배열)
 * - 지역 변수 : availCount(hvec>0), plentyCount(hvec>=3), reportedCount(보고 수), er, className
 *
 * [동작 흐름]
 * - 호출 : updateMarkers()에서 묶인 병원이 2곳 이상일 때 도트 색상·툴팁 계산에 호출함.
 * - items 순회 -> integerValue(hvec)로 reportedCount, availCount, plentyCount 집계
 *   ├── plentyCount > 0 -> 'avail-plenty' (여유)
 *   ├── availCount > 0 -> 'avail-low' (가용)
 *   ├── reportedCount > 0 -> 'avail-full' (만실)
 *   └── 보고 없음 -> 'avail-unknown' (미상)
 * - 결과 반환 -> { availCount, className, label }
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
    /*
     * [JS/네이버 지도 SDK 내장 API]
     * - Number(val) / Boolean(val) / Array.prototype.sort(cmp) : 형변환과 다중 정렬 메서드임.
     * - map.getBounds() : 현재 지도에 보이는 화면 영역의 좌표 경계(LatLngBounds)를 반환함.
     * - bounds.hasLatLng(latLng) / bounds.hasPoint(latLng) : 좌표가 경계 안에 있는지 판정함.
     *
     * [프로젝트 내부 변수]
     * - 지역 변수 : radius, numRadius, radiusBox(사각 경계), enabled(종별 체크 상태), viewport
     * - 정렬 변수 : rank(종별 우선순위), candidateEntries, hospital, isSelected, pos, inViewport, dist
     *
     * [동작 흐름]
     * - state.cardPointerDown 참 -> state.pendingMarkerUpdate = true 기록 후 즉시 반환
     * - updateCircle() 반경 원 동기화 -> !isMapReadyForOverlays()이면 종료
     * - state.hospitals 순회하며 화면 후보 필터링 (선택 중인 isSelected 병원은 항상 유지) :
     *   ├── 1) matchesFilters(hospital, enabled) 종별·가용병상·증상 필터 통과 여부
     *   ├── 2) viewport.hasLatLng(pos) 현재 지도 화면 경계 내부 여부
     *   └── 3) radiusBox ±0.005도 예비 검사 -> distanceKm <= numRadius 거리 검사
     * - candidateEntries.sort(...) -> 종별(regional>tertiary>medical>other), 같으면 거리순 정렬
     */

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
    /*
     * [JS/네이버 지도 SDK 내장 API]
     * - new Array(len) / Array.prototype.map(fn) / Array.prototype.join(',') : 배열 생성·변환임.
     * - new Map() / map.entries() / map.has(k) / map.delete(k) : 키 비교 및 삭제 메서드임.
     * - overlay.getMap() / overlay.setMap(null) : 연결된 지도 확인 및 오버레이 제거 SDK 메서드임.
     *
     * [동작 흐름]
     * - candidateEntries -> coordToScreenPoint()로 픽셀 변환 -> groupCards(points) 클러스터링
     * - 그룹별 고유 키 부여 -> 단일은 'single:id', 다수는 'cluster:id1,id2,...'로 nextGroupByKey 구성
     * - state.markerMap.entries() 순회 -> 새 맵에 없거나 지도가 바뀐 오버레이만 setMap(null) 및 delete
     */

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
 * [JS/DOM 내장 API]
 * - element.getAttribute(name) / element.setAttribute(name, val) : 접근성 속성 조회·설정 API임.
 * - element.append(...nodes) : 여러 자식 DOM 노드를 순서대로 한 번에 추가함.
 * - Array.from(iterable) / Array.prototype.find(fn) : 이터러블 배열 변환과 요소 탐색 메서드임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수 : updateMarkers() (매개변수 없음)
 * - DOM 참조 : card(button.hospital-card), headRow, strongEl, dotEl, smallEl, mapCountEl(#map-count)
 * - 지역 변수 : key, group, hospital, multiple, vGroup, nextClassName, trafficInfo, nextDotClass
 * - 텍스트·상태 변수 : nextTitle, nextAriaLabel, shortType, nextStrongText, nextSmallText, targetPos, existingOverlay
 *
 * [동작 흐름]
 * - 호출 : init, mountNaverMap('glReady'·'init'·'idle'), bindHospitalCard, search-controls 등
 * - nextGroupByKey 순회 -> state.markerMap.get(key)로 기존 오버레이 유무 확인
 *   ├── 기존 있음 -> 바뀐 클래스·제목·텍스트·도트·_onActivate·setPosition()만 갱신(DOM 재사용)
 *   └── 기존 없음 -> 새 button 생성 -> bindHospitalCard() -> createNaverDomOverlay() 지도에 부착
 * - 카드 클릭 연결 -> 단일이면 uiCallbacks.onOpenHospital?.(hospital), 다수면 openCluster(items)
 * - #map-count 갱신 -> 화면 기관 수와 활성 필터 태그([가용병상만 · 증상명]) 표시
 *
 * [마커 카드 DOM 구조]
 * - ┌───────────────────────────────────┐
 * - │ ▌세브란스병원                   🟢 │  <-- .hospital-card-head (종별 컬러 바 + strongEl + dotEl)
 * - │ ▌권역응급 · 응급실 6석             │  <-- smallEl (클러스터 시: "가용 N곳 · 목록 선택 ›")
 * - └─────────────────▼─────────────────┘
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
 * [JS/DOM 내장 API]
 * - element.replaceChildren() : 요소 내부의 기존 자식 노드를 한 번에 비우는 메서드임.
 * - element.setAttribute(name, val) / addEventListener('click', fn) / append(...nodes) : DOM 조립 API임.
 * - dialog.showModal() / dialog.close() : HTML5 <dialog> 모달을 최상위 레이어에 열고 닫는 API임.
 *
 * [프로젝트 내부 함수·변수]
 * - 함수·매개변수 : openCluster(items) (클러스터에 묶인 병원 객체 배열)
 * - DOM 참조 : titleEl(#cluster-title), list(#cluster-list), button(button.cluster-item), headRow, dot
 * - 지역 변수 : hospital, traffic(getBedTrafficInfo 결과), erPhone(응급실 전화 문자열)
 *
 * [동작 흐름]
 * - 호출 : 클러스터 카드 클릭 시 activateHandler 또는 handlePreviewMode('cluster')가 호출함.
 * - state.clusterItems = items 보관 (#cluster-zoom 클릭 시 state.clusterItems 배열로 bounds 확대 계산)
 * - #cluster-title 갱신 및 #cluster-list 초기화(replaceChildren)
 * - items 순회 -> 병원명·신호등 도트·종별(hospitalLabel)·응급실 병상·전화로 버튼 생성·추가
 * - #cluster-dialog.showModal() 모달 표시
 *   └── button(#cluster-list .cluster-item) 'click' -> #cluster-dialog.close() -> uiCallbacks.onOpenHospital?.(hospital)
 */