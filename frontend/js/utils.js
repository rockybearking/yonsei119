/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 전 모듈이 공통으로 꺼내 쓰는 만능 조리도구 상자 (DOM 생성, 병상·결측·초과수용 판독, 실시간 공지 차단 판별, 구면 거리, 토스트 알림)
 * - 실행 시점: 페이지 시작 시 자동 실행되는 코드는 없으며, 각 화면·데이터 모듈이 함수를 호출할 때마다 즉시 실행됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 주요 데이터 정제 흐름:
 *   공공데이터 원시 문자열(`raw`)
 *   ├── `isMissing()` / `integerValue()` ──> 결측치(`null`) vs 만실(`0`) vs 초과수용(`음수`) 무손실 분리
 *   ├── `bedValue()` / `getBedTrafficInfo()` ──> 지도 카드·클러스터·ETA 배지 텍스트 및 신호등 점 색상 생성
 *   ├── `parseApiDate()` / `getActiveMessages()` ──> 종료된 과거 응급메시지 제외, 현재 유효 공지만 추출
 *   └── `isNoticeBlocking()` / `isDiseaseSpecificallyBlocked()` ──> 백엔드 `HospitalRecommendationScorer`와 1:1 동일한 차단 판정
 *
 * [사용처 및 IDE 추적 가이드]
 * - 호출 모듈: `app.js`, `map-engine.js`, `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`, `search-controls.js`
 * - 백엔드 대칭 클래스: `HospitalRecommendationScorer.java` (병상·공지 차단 기준), `GeoUtils.java` (하버사인 거리)
 * - IntelliJ 추적 팁: 각 함수명 위에서 `Ctrl + Alt + H` 또는 `Ctrl + Shift + F`로 호출 위치 검색
 * ============================================================================
 */

import {
    API_FIELD_LABELS,
    SPECIFIC_BLOCK_TARGETS
} from './constants.js';
import {
    DEFAULT_ORIGIN,
    state
} from './state.js';

/*
 * [역할 및 사용처]
 * - 역할: `document.getElementById(id)`(브라우저 표준 DOM 내장 API)의 축약 도우미
 * - 호출처: 프론트엔드 전 모듈 (`app.js`, `map-engine.js`, `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`, `search-controls.js`)
 */
export const byId = id => document.getElementById(id);

/*
 * [역할 및 보안 원리]
 * - 역할: 새 HTML 요소를 만들고 클래스와 순수 텍스트(`textContent`)를 안전하게 채워 반환함
 * - 보안 원리: `innerHTML` 대신 표준 `textContent`를 사용해 외부 API 문자열로 인한 XSS 스크립트 실행을 원천 차단함
 * - 호출처: 카드·모달·시트·길찾기 UI 렌더링 함수 전체
 */
export function node(tag, className = '', content = undefined) {
    const item = document.createElement(tag);
    if (className) {
        item.className = className;
    }
    if (content !== undefined) {
        item.textContent = String(content);
    }
    return item;
}

/*
 * [역할 및 사용처]
 * - 역할: 대상 컨테이너를 비우고 회색 안내 문단(`<p class="empty-state">`) 하나만 깔끔히 채움
 * - 호출처: `hospital-sheet.js` (공지·병상·장비·질환 비어 있음 안내), `directions-eta.js`
 */
export function empty(container, message) {
    if (!container) {
        return;
    }
    container.replaceChildren(node('p', 'empty-state', message));
}

/*
 * [역할 및 성능 원리]
 * - 역할: 530여 개 병원 데이터를 가공하는 긴 루프 중간에 브라우저 메인 스레드 제어권을 잠깐 양보해 화면 멈춤을 막음
 * - 흐름: 최신 `window.scheduler.yield()` 지원 시 우선 사용 ──> 미지원 브라우저는 `setTimeout(resolve, 0)` 폴백
 * - 호출처: `search-controls.js:applySnapshotToState()`
 */
export function yieldToMain() {
    if (typeof window !== 'undefined' && 'scheduler' in window && typeof window.scheduler?.yield === 'function') {
        return window.scheduler.yield();
    }
    return new Promise(resolve => {
        setTimeout(resolve, 0);
    });
}

/*
 * [역할 및 데이터 무결성 핵심]
 * - 역할: 값이 비어 있거나 결측 표기(`null`, `N/A`, `-` 등)인지 판별함 (숫자 `0`이나 음수 `-3`은 유효 병상 데이터이므로 `false` 반환!)
 * - 호출처: `displayValue()`, `firstReported()`, `availability()`, `integerValue()`, `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`
 */
export function isMissing(value) {
    return value == null ||
        /^(?:\s*|null|undefined|none|n\/?a|nan|[-−–—]+)$/i.test(
            String(value).trim()
        );
}

/*
 * [역할 및 사용처]
 * - 역할: 대시(`-`) 같은 실제 기호는 건드리지 않고 순수 `null`, `undefined`, 공백 문자열만 비어 있음으로 판정함
 * - 호출처: `hospital-sheet.js` (`renderSevere`, `getBedStatusBadge`, `createBedCell`, `createEquipmentCell`, 개발자 모드 원본 표)
 */
export function isBlankOrNull(val) {
    return val === null || val === undefined || String(val).trim() === '';
}

/*
 * [역할 및 사용처]
 * - 역할: 결측치면 `'미정보'`, 유효한 값이면 앞뒤 공백을 정리한 문자열을 반환함
 * - 호출처: `hospital-sheet.js` (`openHospital`, `renderMessages`, `renderRawBeds`, `renderBasic`)
 */
export function displayValue(value) {
    return isMissing(value) ? '미정보' : String(value).trim();
}

/*
 * [역할 및 사용처]
 * - 역할: 여러 후보 필드 중 결측이 아닌 첫 번째 값을 반환함 (예: `hvidate`와 `mkioskdate` 중 먼저 보고된 시각 선택)
 * - 호출처: `hospital-sheet.js:renderSevere()`
 */
export function firstReported(...values) {
    return values.find(value => !isMissing(value));
}

/*
 * [역할 및 사용처]
 * - 역할: 영문 API 태그 코드(`hvec`, `hvs01` 등)를 `'hvec(일반(응급실 일반병상))'` 형태의 한글 병기 라벨로 변환함
 * - 호출처: `hospital-sheet.js` (`renderRawBeds`, `renderBasic` 개발자 모드 인스펙터)
 */
export function fieldLabel(key) {
    const label = API_FIELD_LABELS[String(key || '').toLowerCase()];
    if (label) {
        return `${key}(${label})`;
    }
    if (/^hvs?\d+$/i.test(key)) {
        return `${key}(설명 미정보)`;
    }
    return key;
}

/*
 * [역할 및 사용처]
 * - 역할: 병상·장비 셀 하단에 표시할 API 파라미터 출처 문자열(`'hvec / hvs01 (가용 / 기준)'`)을 조립함
 * - 호출처: `hospital-sheet.js` (`createBedCell`, `createEquipmentCell`)
 */
export function formatParamLabel(currentKey, baselineKey) {
    if (currentKey && baselineKey) {
        return `${currentKey} / ${baselineKey} (가용 / 기준)`;
    }
    if (currentKey) {
        return `${currentKey} (가용)`;
    }
    if (baselineKey) {
        return `${baselineKey} (기준)`;
    }
    return '';
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 중증질환·장비 가용 코드(`'Y'`, `'N'`, `'N1'`, `'불가능'`, `'정보미제공'` 등)를 표준 상태(`yes`/`no`/`unknown`)로 분류함
 * - 흐름:
 *   원본 `raw` 입력
 *   ├── 결측·`'정보미제공'`·`'-'` ──> `{ text: '-', className: 'unknown' }`
 *   ├── `'Y'`·`'가능*'`           ──> `{ text: yes, className: 'yes' }`
 *   └── `'N*'`·`'불가'` 포함      ──> `{ text: no, className: 'no' }`
 * - 호출처: `hospital-sheet.js:renderSevere()`
 */
export function availability(raw, yes = '가능', no = '불가능') {
    if (isMissing(raw)) {
        return { text: '-', className: 'unknown' };
    }

    const text = String(raw).trim();
    const upper = text.toUpperCase();

    if (upper === 'Y' || text === '가능' || text.startsWith('가능')) {
        return { text: yes, className: 'yes' };
    }

    if (
        upper === 'N' ||
        upper.startsWith('N') ||
        text === '불가' ||
        text === '불가능' ||
        text.includes('불가') ||
        text.includes('불가능')
    ) {
        return { text: no, className: 'no' };
    }

    if (text === '정보미제공' || text === '미정보' || text === '-') {
        return { text: '-', className: 'unknown' };
    }

    return { text, className: 'unknown' };
}

/*
 * [역할 및 데이터 무결성 핵심]
 * - 역할: 문자열 병상 값을 정수로 변환하되, 결측치는 `null`로 유지하고 음수(초과수용, 예: `-4`)와 `0`(만실)은 그대로 보존함
 * - 호출처: `bedValue()`, `getBedTrafficInfo()`, `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`
 */
export function integerValue(raw) {
    if (isMissing(raw)) {
        return null;
    }
    const text = String(raw).trim();
    if (!/^-?\d+$/.test(text)) {
        return null;
    }
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : null;
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 응급실 일반병상(`hvec`) 원시값을 사람이 읽기 쉬운 한글 상태 문자열로 변환함
 * - 흐름:
 *   `integerValue(raw)`
 *   ├── `null` (결측) ──> `'미정보'`
 *   ├── `< 0`  (음수) ──> `'초과수용 N석'` (정원 초과 수용 중인 현장 상태 보존!)
 *   └── `>= 0`        ──> `'N석'`
 * - 호출처: `markers-cluster.js` (병원 카드·클러스터 목록), `directions-eta.js` (경유지·ETA 순위 배지), `hospital-sheet.js` (공유 문구)
 */
export function bedValue(raw) {
    const value = integerValue(raw);
    if (value === null) {
        return '미정보';
    }
    return value < 0
        ? `초과수용 ${Math.abs(value)}석`
        : `${value}석`;
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 응급실 병상 수를 신호등 4색 도트 클래스(`.avail-plenty` / `.avail-low` / `.avail-full` / `.avail-unknown`)로 매핑함
 * - 대칭 기준: 백엔드 `HospitalRecommendationScorer.classifyBedAvailabilityStatus()`와 100% 동일 기준(`>=3` 여유, `1~2` 혼잡 임박, `0` 만실, `<0` 초과수용)
 * - 호출처: `markers-cluster.js` (`updateMarkers`, `openCluster`), `search-controls.js` (`updateSearch`)
 */
export function getBedTrafficInfo(rawErBeds) {
    const count = integerValue(rawErBeds);
    if (count === null) {
        return { className: 'avail-unknown', label: '병상 미정보' };
    }
    if (count >= 3) {
        return { className: 'avail-plenty', label: `응급실 여유 (${count}석)` };
    }
    if (count >= 1) {
        return { className: 'avail-low', label: `응급실 혼잡 임박 (${count}석)` };
    }
    if (count === 0) {
        return { className: 'avail-full', label: '응급실 만실 (0석)' };
    }
    return { className: 'avail-full', label: `응급실 초과수용 (${Math.abs(count)}석 초과)` };
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 공공데이터의 14자리 시각 문자열(`yyyyMMddHHmmss`, KST 기준)을 타임스탬프(ms)와 한국어 표시 문자열로 파싱함
 * - 호출처: `getActiveMessages()` (공지 유효기간 비교), `hospital-sheet.js` (`renderMessages`, `renderSevere`, `renderBeds`)
 */
export function parseApiDate(value) {
    if (!/^\d{14}$/.test(value || '')) {
        return null;
    }

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(8, 10));
    const minute = Number(value.slice(10, 12));
    const second = Number(value.slice(12, 14));

    const date = new Date(Date.UTC(year, month - 1, day, hour - 9, minute, second));
    const display = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);

    return {
        timestamp: date.getTime(),
        display
    };
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 병원 응급메시지 목록 중 현재 시각(`now`) 기준으로 시작(`symblksttdtm`) 이후이고 종료(`symblkenddtm`) 이전인 유효 공지만 추려냄
 * - 대칭 기준: 백엔드 `HospitalRecommendationScorer.isMessageCurrentlyActive()`와 동일한 시간 창 판정
 * - 호출처: `hospital-sheet.js` (`renderMessages`, `renderSevere`)
 */
export function getActiveMessages(hospital, now = Date.now()) {
    return (hospital?.messages || []).filter(item => {
        const start = parseApiDate(item.symblksttdtm);
        const end = parseApiDate(item.symblkenddtm);
        return (!start || start.timestamp <= now) && (!end || end.timestamp > now);
    });
}

/*
 * [역할 및 데이터 정합성 핵심 — 공공데이터 실측 검증 반영]
 * - 역할: 개별 응급메시지(`msg`)가 실제 진료·수술·수용 제한(차단) 공지인지 판별함
 * - 왜 `symoutdspyon === '차단'`을 무조건 차단으로 보면 안 되는가?
 *   · 실제 NEMC `getEmrrmSrsillDissMsgInqire` 엔드포인트 검증 결과, 정상 안내(`"정상 진료 가능"`, `"제한 없음"`, `"정규시간에만 가능(문의바랍니다)"`)를 포함한
 *     전체 공지 100%에 기본값 `symoutdspyon="차단"`이 일괄 기재되어 내려옴
 *   · 따라서 공지 본문(`symblkmsg`)에서 `'제한 없음'`을 먼저 제거한 뒤 실제 부정·제한 키워드 포함 여부를 판정해 오탐을 차단함
 * - 대칭 기준: 백엔드 `HospitalRecommendationScorer.isNoticeBlocking()`과 1:1 동일 로직
 * - 호출처: 아래 `isDiseaseSpecificallyBlocked()`
 */
export function isNoticeBlocking(msg) {
    if (!msg) {
        return false;
    }
    const body = String(msg.symblkmsg || '').trim();
    const yon = String(msg.symoutdspyon || '').trim();

    if (!body) {
        return yon === '차단';
    }

    const normalizedBody = body.replace(/제한\s*없음/g, '');
    return /(불가능|불가|차단|수용\s*불가|진료\s*불가|수술\s*불가|시술\s*불가|부재|중단|마감|제한|어려움|어렵|고장|점검|포화|금지|휴진)/.test(
        normalizedBody
    );
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 특정 중증응급질환(`mkioskty1`~`27`)에 대해 현재 유효한 진료 제한 공지가 등록되어 있는지 교차 검증함
 * - 흐름:
 *   `activeMessages` 순회 ──> `isNoticeBlocking(msg)` 통과 공지만 검사
 *   ──> `SPECIFIC_BLOCK_TARGETS[itemKey]`의 표준 질환코드(`symtypcod`) 또는 질환명(`symtypcodmag`·`symblkmsg`) 일치 시 `true` 반환
 * - 호출처: `hospital-sheet.js:renderSevere()`
 */
export function isDiseaseSpecificallyBlocked(activeMessages, itemKey) {
    const config = SPECIFIC_BLOCK_TARGETS[itemKey];
    if (!config || !activeMessages.length) {
        return false;
    }

    for (const msg of activeMessages) {
        if (!isNoticeBlocking(msg)) {
            continue;
        }

        const cod = String(msg.symtypcod || '').trim().toUpperCase();
        if (config.codes && config.codes.includes(cod)) {
            return true;
        }

        const symName = String(msg.symtypcodmag || '').trim();
        const bodyText = String(msg.symblkmsg || '').trim();
        if (
            config.names &&
            config.names.some(target =>
                symName === target ||
                (target.length >= 4 && symName.includes(target)) ||
                (target.length >= 3 && bodyText.includes(target))
            )
        ) {
            return true;
        }
    }

    return false;
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 지구 곡률을 반영한 하버사인(Haversine, 반지름 `6371km`) 공식으로 두 위경도 좌표 사이의 직선거리(`km`)를 계산함
 * - 호출처: `markers-cluster.js:updateMarkers()`, `directions-eta.js`, `hospital-sheet.js:openHospital()`
 */
export function distanceKm(a, b) {
    const radians = degrees => degrees * Math.PI / 180;
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);

    const arc =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(radians(a.lat)) *
        Math.cos(radians(b.lat)) *
        Math.sin(dLng / 2) ** 2;

    return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

/*
 * [역할 및 사용처]
 * - 역할: 기준 좌표(`origin`)에서 반경(`radiusKm`)만큼 떨어진 남·북·서·동 사각 위경도 경계를 계산함
 * - 호출처: `map-engine.js:fitRadius()` (카메라 반경 맞춤), `markers-cluster.js:updateMarkers()` (삼각함수 연산 전 고속 사각 필터링)
 */
export function radiusExtent(origin, radiusKm) {
    const angle = radiusKm / 6371;
    const latDelta = angle * 180 / Math.PI;
    const lngDelta =
        Math.asin(
            Math.sin(angle) /
            Math.cos(origin.lat * Math.PI / 180)
        ) * 180 / Math.PI;

    return {
        south: origin.lat - latDelta,
        north: origin.lat + latDelta,
        west: origin.lng - lngDelta,
        east: origin.lng + lngDelta
    };
}

/*
 * [역할 및 사용처]
 * - 역할: 현재 출발 기준점 이름과 역지오코딩 주소를 합쳐 `'지정 출발지 (서울 중구 태평로1가)'` 형태로 반환함
 * - 호출처: `search-controls.js:updateRadiusUI()`, `hospital-sheet.js:openHospital()`, `directions-eta.js:loadDirectionsForHospital()`
 */
export function getOriginDisplayLabel() {
    const base = state.locationKnown ? (state.originLabel || '내 위치') : DEFAULT_ORIGIN.label;
    return state.originAddress ? `${base} (${state.originAddress})` : base;
}

/*
 * [역할 및 사용처]
 * - 역할: 현재 접속 기기가 iPhone·iPad·iPod 등 Apple 터치 기기(최신 iPadOS 데스크톱 UA 포함)인지 판별함
 * - 호출처: `hasMobileGpsHardware()`, `hospital-sheet.js` (`openMobileApp`, `navigationLink`, `shareHospital`, `syncResponsiveSheetLayout`)
 */
export function isAppleTouchDevice() {
    const userAgent = navigator.userAgent || '';
    return (
        /iPad|iPhone|iPod/.test(userAgent) ||
        (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)
    );
}

/*
 * [역할 및 사용처]
 * - 역할: 실제 GPS 칩셋이 탑재된 모바일·태블릿 기기인지 판별함 (데스크톱 PC가 부정확한 IP 추정 위치로 튀는 현상 방지)
 * - 호출처: `app.js:init()`, `isGenuineGpsPosition()`
 */
export function hasMobileGpsHardware() {
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua) || isAppleTouchDevice()) {
        return true;
    }
    return (
        typeof window !== 'undefined' &&
        window.matchMedia('(pointer: coarse)').matches &&
        !window.matchMedia('(any-pointer: fine)').matches
    );
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 브라우저 측위 결과(`GeolocationPosition`)가 IP·기지국 광역 추정치가 아닌 정밀 GPS 좌표인지 검증함
 * - 판정 기준:
 *   ├── 모바일 기기: 오차 반경(`accuracy`) `100m` 이하 통과
 *   └── 데스크톱 기기: 위성 고도(`altitude !== null`) 실측 및 오차 `50m` 이하만 통과
 * - 호출처: `search-controls.js:locate()`
 */
export function isGenuineGpsPosition(position) {
    const coords = position?.coords;
    if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
        return false;
    }
    const accuracy = Number(coords.accuracy);
    if (!Number.isFinite(accuracy) || accuracy <= 0) {
        return false;
    }
    if (!hasMobileGpsHardware()) {
        return coords.altitude !== null && accuracy <= 50;
    }
    return accuracy <= 100;
}

/*
 * [역할 및 사용처]
 * - 역할: 검색 입력창(`#keyword`)에 포커스가 있을 때 포커스를 해제하여 모바일 가상 키보드를 닫음
 * - 호출처: `map-engine.js:mountNaverMap()` (지도 드래그·줌 시작 시), `search-controls.js` (`initSearchFocus`, `geocodeAndMoveOrigin`)
 */
export function blurKeyword() {
    const keyword = byId('keyword');
    if (keyword && document.activeElement === keyword) {
        keyword.blur();
    }
}

/*
 * [역할 및 사용처]
 * - 역할: 전광판(Marquee) 자동 스크롤이 가능한 텍스트 래퍼(`<tag><span class="marquee-inner">...</span></tag>`)를 생성함
 * - 호출처: `hospital-sheet.js` (`renderSevere`, `createBedCell`, `createEquipmentCell`)
 */
export function createMarqueeEl(tag, className = '', text = '', title = undefined) {
    const el = node(tag, className);
    if (title) {
        el.title = title;
    }
    const inner = node('span', 'marquee-inner', text);
    el.append(inner);
    return el;
}

/*
 * [역할 및 성능 최적화 원리]
 * - 역할: 병상 파라미터·중증 비고 칸에서 텍스트가 넘치는 셀만 골라 전광판 스크롤 애니메이션(`.is-marquee`)을 켬
 * - 성능 원리: `requestAnimationFrame` 안에서 1차 읽기(폭 측정)와 2차 쓰기(클래스·CSS 변수 주입)를 분리해 강제 동기 리플로우(Layout Thrashing)를 차단함
 * - 호출처: `app.js` (`resize` 이벤트), `hospital-sheet.js:scheduleMarqueeRefresh()`
 */
export function updateMarquees() {
    requestAnimationFrame(() => {
        const containers = document.querySelectorAll('.egen-cell-param, .severe-remark-box');
        if (!containers.length) {
            return;
        }

        const measurements = [];
        for (const container of containers) {
            const inner = container.querySelector('.marquee-inner');
            if (inner) {
                measurements.push({
                    container,
                    inner,
                    overflow: inner.scrollWidth - container.clientWidth
                });
            }
        }

        for (const { container, inner, overflow } of measurements) {
            if (overflow > 2) {
                container.classList.add('is-marquee');
                inner.style.setProperty('--ticker-diff', `${Math.ceil(overflow + 14)}px`);
                const duration = Math.max(5, Math.min(22, (overflow / 25) + 3.5));
                inner.style.setProperty('--ticker-duration', `${duration.toFixed(1)}s`);
            } else {
                container.classList.remove('is-marquee');
                inner.style.removeProperty('--ticker-diff');
                inner.style.removeProperty('--ticker-duration');
            }
        }
    });
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 화면 상단 알약형 토스트(`#status-toast`, HTML5 Popover Top Layer)와 스크린 리더 음성 알림 영역을 제어함
 * - 흐름:
 *   `setStatus(message)`
 *   ├── 빈 문자열(`''`) ──> `hidePopover()`로 토스트 닫기
 *   └── 안내·오류 문자열 ──> `data-tone`(`'info'`/`'error'`) 설정 + `showPopover()` 표시 + 자동 닫힘 타이머(`4.2초`/`6.5초`) 예약
 * - 호출처: `app.js`, `search-controls.js`, `directions-eta.js`, `hospital-sheet.js`
 */
export function setStatus(message) {
    const statusEl = byId('status');
    const toastEl = byId('status-toast');
    if (!statusEl) {
        return;
    }

    if (state.statusTimer) {
        clearTimeout(state.statusTimer);
        state.statusTimer = null;
    }

    const text = message ? String(message).trim() : '';
    statusEl.textContent = text;
    statusEl.hidden = !text;

    if (!toastEl) {
        return;
    }

    const politeAnnouncer = byId('status-announcer');
    const alertAnnouncer = byId('alert-announcer');

    if (!text) {
        toastEl.dataset.open = 'false';
        delete toastEl.dataset.tone;
        if (typeof toastEl.hidePopover === 'function') {
            try {
                if (toastEl.matches(':popover-open')) {
                    toastEl.hidePopover();
                }
            } catch (popErr) {
                void popErr;
            }
        }
        return;
    }

    const isError = /(실패|오류|못했|거부|없습니다|오프라인)/.test(text);
    const isInterstitial = /(확인 중…|조회하고 있습니다…)$/.test(text);

    toastEl.dataset.tone = isError ? 'error' : 'info';
    toastEl.dataset.open = 'true';
    if (typeof toastEl.showPopover === 'function') {
        try {
            if (!toastEl.matches(':popover-open')) {
                toastEl.showPopover();
            }
        } catch (popErr) {
            void popErr;
        }
    }

    if (!isInterstitial) {
        if (isError && alertAnnouncer) {
            alertAnnouncer.textContent = text;
        } else if (politeAnnouncer) {
            politeAnnouncer.textContent = text;
        }
    }

    const isSdkFatalError = !state.map && text.includes('SDK');
    if (!isInterstitial && !isSdkFatalError) {
        state.statusTimer = setTimeout(() => {
            setStatus('');
        }, isError ? 6500 : 4200);
    }
}

/*
 * [역할 및 호환성 원리]
 * - 역할: HTML `<dialog closedby="any">`를 아직 지원하지 않는 구형 브라우저에서도 모달 바깥 배경(`::backdrop`) 클릭 시 창이 닫히게 보완함
 * - 호출처: `search-controls.js:initNotice()` (`#notice-dialog`, `#cluster-dialog`)
 */
export function installDialogLightDismiss(dialog) {
    if (!dialog || typeof HTMLDialogElement === 'undefined') {
        return;
    }
    if ('closedBy' in HTMLDialogElement.prototype) {
        return;
    }
    dialog.addEventListener('click', event => {
        if (event.target !== dialog) {
            return;
        }
        const rect = dialog.getBoundingClientRect();
        const clickedInside =
            rect.top <= event.clientY &&
            event.clientY <= rect.bottom &&
            rect.left <= event.clientX &&
            event.clientX <= rect.right;
        if (!clickedInside) {
            dialog.close();
        }
    });
}
