import {
    API_FIELD_LABELS,
    SPECIFIC_BLOCK_TARGETS
} from './constants.js';
import {
    DEFAULT_ORIGIN,
    state
} from './state.js';
/*
 * [JS 문법] import { ... } from './...' : `constants.js`의 필드 사전과 `state.js`의 전역 런타임 상태 객체를 가져옴.
 * [아키텍처 계층] `utils.js`는 DOM 유틸리티·결측치 정제·한국어 차단공지 분석·구면기하 거리 계산을 담당하는 순수 공통 도구함임.
 */

export const byId = id => document.getElementById(id);
/*
 * [JS 문법] const 함수명 = 매개변수 => 반환식 : 간결한 화살표 함수(Arrow Function) 문법임.
 * [브라우저 내장 함수] document.getElementById(id) : HTML 문서에서 `id="..."` 속성으로 요소를 즉시 찾는 표준 함수임 (이름 변경 불가).
 *   (형제 DOM 탐색 함수 비교: CSS 선택자 단건 조회 `document.querySelector()`, 다건 조회 `document.querySelectorAll()`)
 * [내가 지은 이름] byId(단축 조회 함수명), id(찾을 요소 ID 문자열)
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
 * [JS 문법] function, 기본값 매개변수(`className = ''`, `content = undefined`), return
 * [브라우저 내장 함수/속성]
 * - document.createElement(tag) : 새 HTML 태그 노드를 메모리에서 안전하게 생성함 (이름 변경 불가).
 * - item.textContent : 모든 문자열을 순수 텍스트로만 이스케이프해 넣으므로 XSS(악성 스크립트 삽입 공격)가 원천 차단됨.
 *   (비교 주의: `innerHTML`은 외부 문자열에 `<img onerror=...>`가 섞이면 스크립트가 실행될 위험이 있어 사용하지 않음.)
 * [내가 지은 이름] node(안전 DOM 생성 팩토리 함수), tag(태그명), className(CSS 클래스), content(표시 텍스트), item(생성된 요소 상자)
 */

export function empty(container, message) {
    if (!container) {
        return;
    }
    container.replaceChildren(node('p', 'empty-state', message));
}
/*
 * [브라우저 내장 함수] container.replaceChildren(...) : 기존 자식 요소들을 모두 비우고 새 요소로 한 번에 교체하는 최신 표준 DOM 메서드임 (이름 변경 불가).
 * [내가 지은 이름] empty(빈 상태 안내 렌더링 함수), container(대상 부모 박스), message(안내 문구)
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
 * [JS 문법] ?. (옵셔널 체이닝, Optional Chaining) : 앞쪽 객체가 `null`/`undefined`여도 에러 없이 안전하게 `undefined`를 반환함.
 * [브라우저 내장 도구(API) & 함수]
 * - window.scheduler.yield() : 긴 반복문 중간에 브라우저 메인 스레드 제어권을 잠시 양보해 사용자의 지도 드래그·터치 입력을 먼저 처리하게 해 주는 최신 스케줄링 API임 (이름 변경 불가).
 * - new Promise(...) / setTimeout(..., 0) : `scheduler.yield` 미지원 브라우저(사파리 구버전 등)를 위한 안전한 비동기 양보 폴백임.
 * [내가 지은 이름] yieldToMain(메인 스레드 양보 헬퍼 함수)
 */

export function isMissing(value) {
    return value == null ||
        /^(?:\s*|null|undefined|none|n\/?a|nan|[-−–—]+)$/i.test(
            String(value).trim()
        );
}
/*
 * [JS 문법] 정규표현식 `/.../i` (`i`: 대소문자 무시) 및 `.test(...)` 매칭 함수
 * [내가 지은 이름] isMissing(공공데이터 결측치 판별 함수), value(검사할 원본값)
 * [의료 도메인 절대 원칙]
 * - 숫자 `0`이나 문자열 `'0'`은 결측치가 아니라 **'가용 병상 0석(만실)'**이라는 중대한 상태이므로 반드시 `false`(유효값)로 판정함.
 * - 반면 `null`, 빈 문자열(`""`), `'null'`, `'N/A'`, 하이픈(`'-'`)은 미보고 결측치(`true`)로 분류해 `0석`으로 왜곡되지 않게 방어함.
 */

export function isBlankOrNull(val) {
    return val === null || val === undefined || String(val).trim() === '';
}
/*
 * [내가 지은 이름] isBlankOrNull(공백·널 판별 보조 함수), val(원본값)
 */

export function displayValue(value) {
    return isMissing(value) ? '미정보' : String(value).trim();
}
/*
 * [JS 문법] 조건식 ? 참일때값 : 거짓일때값 (삼항 조건 연산자)
 * [내가 지은 이름] displayValue : 결측치이면 `'미정보'`로 표시하고, 값이 있으면 양끝 공백을 다듬어 반환함.
 */

export function firstReported(...values) {
    return values.find(value => !isMissing(value));
}
/*
 * [JS 문법] ...values (나머지 매개변수, Rest Parameters) : 개수 제한 없이 전달된 인자들을 배열 `values`로 묶어 받음.
 * [JS 내장 함수] Array.prototype.find(...) : 조건을 만족하는 첫 번째 원소를 찾아 반환함 (형제 함수: 전체 추출 `.filter()`, 존재 여부 `.some()`).
 * [내가 지은 이름] firstReported : 여러 시각 후보(`hvidate`, `mkioskdate`) 중 결측치가 아닌 첫 번째 보고 시각을 고름.
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
 * [JS 문법] 백틱 템플릿 리터럴 `` `${변수}` `` : 문자열 안에 변수 값을 직관적으로 끼워 넣는 문법임.
 * [내가 지은 이름] fieldLabel : 영문 태그 코드(`'hvec'`)를 `'hvec(일반(응급실 일반병상))'` 형태의 친절한 한글 병기 라벨로 변환함.
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
 * [내가 지은 이름] formatParamLabel : E-Gen 병상/장비 셀 하단에 표시할 API 파라미터 코드 설명 문자열을 조립함.
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
 * [JS 내장 함수] .toUpperCase(), .startsWith(...), .includes(...) (문자열 대소문자 정규화 및 접두사·포함 검사 내장 함수, 이름 변경 불가)
 * [내가 지은 이름] availability : 국립중앙의료원 중증질환 코드(`'Y'`, `'N'`, 장비·인력 미보유 코드 `'N1'` 등)를
 *   화면 표준 상태 객체 `{ text: '가능'|'불가능'|'-', className: 'yes'|'no'|'unknown' }`으로 변환함.
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
 * [JS 내장 도구/함수] Number(...), Number.isSafeInteger(...) : 부호 있는 정수(음수 초과수용 `-4`, 만실 `0`, 여유 `8` 포함)만 정확히 숫자로 변환함 (이름 변경 불가).
 * [내가 지은 이름] integerValue : 숫자가 아닌 문자열이나 빈 값은 억지로 `0`으로 만들지 않고 `null`을 반환해 데이터 왜곡을 방지함.
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
 * [JS 내장 함수] Math.abs(숫자) : 음수 병상(`-3`)의 절댓값(`3`)을 구해 `'초과수용 3석'`으로 읽기 쉽게 표현함 (이름 변경 불가).
 * [내가 지은 이름] bedValue : 지도 마커 카드·클러스터 목록·추천 배지에서 응급실 병상 수를 짧은 한글 요약 문자열로 변환함.
 * [변환 예시]
 *   raw = "7"   ──> "7석"
 *   raw = "0"   ──> "0석"
 *   raw = "-3"  ──> "초과수용 3석"
 *   raw = ""    ──> "미정보"
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
 * [내가 지은 이름] getBedTrafficInfo : 지도 마커 카드 우측 상단 '병상 여유 신호등'(`.bed-traffic-dot`)의 색상 클래스와 툴팁 문구를 판정함.
 * [시각화 매핑 요약]
 *   count >= 3   ──> .avail-plenty  (초록 신호등: 여유)
 *   count 1 ~ 2  ──> .avail-low     (주황 신호등: 잔여 1~2석 주의)
 *   count <= 0   ──> .avail-full    (빨강 신호등: 만실 또는 초과수용)
 *   count null   ──> .avail-unknown (회색 신호등: 미보고)
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
 * [JS 내장 도구(타입) & 함수]
 * - Date.UTC(...) : 접속자의 스마트폰/PC 국가 시간대가 어디든 항상 한국 표준시(UTC+9, `hour - 9`) 기준으로 정확히 타임스탬프를 계산함 (이름 변경 불가).
 * - new Intl.DateTimeFormat('ko-KR', ...).format(date) : 국제화 표준 날짜 포맷터임 (이름 변경 불가).
 * [내가 지은 이름] parseApiDate : 공공데이터 14자리 시각 문자열(`"20261117183000"`)을 `{ timestamp, display: "11월 17일 오후 06:30" }` 객체로 변환함.
 */

export function getActiveMessages(hospital, now = Date.now()) {
    return (hospital?.messages || []).filter(item => {
        const start = parseApiDate(item.symblksttdtm);
        const end = parseApiDate(item.symblkenddtm);
        return (!start || start.timestamp <= now) && (!end || end.timestamp > now);
    });
}
/*
 * [JS 내장 함수] Date.now() : 현재 시각 밀리초 타임스탬프를 반환함 (이름 변경 불가).
 * [내가 지은 이름] getActiveMessages : 병원의 공지 배열 중 시작일시(`symblksttdtm`)가 지났고 종료일시(`symblkenddtm`)가 아직 안 지난 현재 유효 공지만 추려냄.
 */

export function isNoticeBlocking(msg) {
    if (!msg) {
        return false;
    }
    const body = String(msg.symblkmsg || '').trim();
    const yon = String(msg.symoutdspyon || '').trim();

    if (yon === '차단') {
        return true;
    }
    if (/(불가능|불가|차단|수용\s*불가|진료\s*불가|수술\s*불가|시술\s*불가|부재|중단|마감)/.test(body)) {
        return true;
    }
    if (/제한\s*없음|(?<!불)가능|원활|정상\s*진료/.test(body)) {
        return false;
    }
    return false;
}
/*
 * [핵심 버그 수정 및 한국어 형태소 방어 원리]
 * - 한국어 문자열 `"수술 불가능"` 안에는 부분 문자열 `"가능"`이 포함되어 있음.
 * - 만약 `'가능'` 검사를 먼저 수행하면 `"뇌출혈 수술 불가능"` 같은 위급 차단 공지가 정상(`false`)으로 오판되는 치명적 버그가 발생함.
 * - 따라서 반드시 **차단 키워드(`불가능|불가|차단|부재|중단|마감`)를 최우선으로 먼저 검사**하고, 긍정 판정에는 부정 후방탐색(`(?<!불)가능`: 앞에 `'불'`이 없는 `'가능'`)을 적용했음.
 * [내가 지은 이름] isNoticeBlocking(차단 공지 판별 함수), msg(개별 공지 객체)
 */

export function hasGeneralErBlockNotice(activeMessages) {
    for (const msg of activeMessages) {
        if (!isNoticeBlocking(msg)) {
            continue;
        }
        const combined = `${msg.symtypcodmag || ''} ${msg.trtprtcodmag || ''} ${msg.symblkmsg || ''}`;
        if (
            combined.includes('응급실') &&
            /(수용\s*불가|진료\s*불가|진료\s*중단|전면\s*중단)/.test(combined)
        ) {
            return true;
        }
    }
    return false;
}
/*
 * [내가 지은 이름] hasGeneralErBlockNotice : 특정 단일 질환이 아니라 '응급실 전체 수용 불가/진료 중단' 공지가 떠 있는지 판별함.
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
 * [내가 지은 이름] isDiseaseSpecificallyBlocked : 28대 중증질환 개별 항목(`mkioskty1~27`)에 대해 활성 차단 공지가 올라와 있는지 교차 검증함.
 */

function isAnySevereAccepted(severeMap, activeMessages, keys) {
    for (const key of keys) {
        const status = availability(severeMap[key]);
        if (status.className === 'yes' && !isDiseaseSpecificallyBlocked(activeMessages, key)) {
            return true;
        }
    }
    return false;
}
/*
 * [내가 지은 이름] isAnySevereAccepted : 주어진 중증질환 키 목록 중 최소 1개 이상이 `'가능'(Y)`이면서 동시에 차단 공지도 없는지 확인하는 내부 보조 함수임.
 */

function hasBlockingKeywordInNotices(activeMessages, keywordRegex) {
    for (const msg of activeMessages) {
        if (!isNoticeBlocking(msg)) {
            continue;
        }
        const combined = `${msg.symtypcodmag || ''} ${msg.trtprtcodmag || ''} ${msg.symblkmsg || ''}`;
        if (keywordRegex.test(combined)) {
            return true;
        }
    }
    return false;
}
/*
 * [내가 지은 이름] hasBlockingKeywordInNotices : 활성 차단 공지 본문·진료과명에 해당 증상군 차단 키워드(예: 소아, 뇌출혈, 분만 등)가 포함되어 있는지 검사함.
 */

export function matchesSymptomPresetClient(hospital, presetKey) {
    if (!presetKey || presetKey === 'all') {
        return true;
    }
    if (!hospital) {
        return false;
    }

    const beds = hospital.beds || {};
    const severe = hospital.severe || {};
    const activeMessages = getActiveMessages(hospital);

    if (hasGeneralErBlockNotice(activeMessages)) {
        return false;
    }

    const posBed = key => {
        const val = integerValue(beds[key]);
        return val !== null && val > 0;
    };
    const flagYes = key => {
        const raw = String(beds[key] || '').trim().toUpperCase();
        const num = integerValue(beds[key]);
        return raw === 'Y' || (num !== null && num > 0);
    };

    switch (presetKey) {
        case 'pediatric':
            if (hasBlockingKeywordInNotices(activeMessages, /소아|영유아/)) {
                return false;
            }
            return (
                posBed('hv28') ||
                posBed('hv32') ||
                posBed('hv33') ||
                posBed('hv37') ||
                isAnySevereAccepted(severe, activeMessages, ['mkioskty10', 'mkioskty12', 'mkioskty14', 'mkioskty15', 'mkioskty27'])
            );

        case 'stroke':
            if (hasBlockingKeywordInNotices(activeMessages, /뇌출혈|뇌경색|뇌졸중|신경외과/)) {
                return false;
            }
            return isAnySevereAccepted(severe, activeMessages, ['mkioskty2', 'mkioskty3', 'mkioskty4']);

        case 'cardiac':
            if (hasBlockingKeywordInNotices(activeMessages, /심근경색|관상동맥|심장내과|대동맥|흉통/)) {
                return false;
            }
            return isAnySevereAccepted(severe, activeMessages, ['mkioskty1', 'mkioskty5', 'mkioskty6']);

        case 'trauma':
            if (hasBlockingKeywordInNotices(activeMessages, /외상|사지접합|수족지/)) {
                return false;
            }
            return (
                Boolean(hospital.traumaCenter) ||
                posBed('hv60') ||
                posBed('hv61') ||
                posBed('hv9') ||
                posBed('hv39') ||
                isAnySevereAccepted(severe, activeMessages, ['mkioskty20', 'mkioskty21'])
            );

        case 'obstetrics':
            if (hasBlockingKeywordInNotices(activeMessages, /분만|산부인과|산과/)) {
                return false;
            }
            return (
                flagYes('hv42') ||
                isAnySevereAccepted(severe, activeMessages, ['mkioskty16', 'mkioskty17', 'mkioskty18'])
            );

        case 'burn':
            if (hasBlockingKeywordInNotices(activeMessages, /화상/)) {
                return false;
            }
            return (
                posBed('hv8') ||
                posBed('hv43') ||
                isAnySevereAccepted(severe, activeMessages, ['mkioskty19'])
            );

        case 'dialysis':
            if (hasBlockingKeywordInNotices(activeMessages, /투석|인공신장|신장내과/)) {
                return false;
            }
            return (
                flagYes('hvcrrtayn') ||
                isAnySevereAccepted(severe, activeMessages, ['mkioskty22', 'mkioskty23'])
            );

        default:
            return true;
    }
}
/*
 * [JS 문법] switch (값) { case '...': ... default: ... } : 증상 프리셋 종류별로 3중 교차 검증 규칙을 분기함.
 * [내가 지은 이름] matchesSymptomPresetClient : 백엔드 `HospitalRecommendationScorer.matchesSymptomPreset()`과 1:1 대칭을 이루는 클라이언트 증상 필터 엔진임.
 * [3중 교차 검증 원리 — '응급실 핑퐁' 사전 예방]
 *   1단계) 응급실 전면 수용불가 공지가 있으면 즉시 제외(`false`)
 *   2단계) 해당 진료과·질환 차단 공지(예: 신경외과 수술 불가)가 있으면 즉시 제외(`false`)
 *   3단계) 전용 병상(`hv*`) 여유가 있거나 해당 중증질환 수용 코드(`mkioskty*`)가 `'Y'`인 병원만 통과(`true`)
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
 * [JS 내장 도구/함수] Math.PI, Math.sin, Math.cos, Math.sqrt, Math.atan2, 거듭제곱 연산자 `**` (이름 변경 불가)
 * [내가 지은 이름] distanceKm : 지구 구체(`반지름 6371 km`) 위 두 위경도 좌표 `a`, `b` 사이의 하버사인(Haversine) 직선 거리(`km`)를 계산함.
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
 * [내가 지은 이름] radiusExtent : 출발 기준점(`origin`)으로부터 `radiusKm` 반경을 감싸는 사각 위경도 경계 상자(`{ south, north, west, east }`)를 계산함.
 * [성능 원리] 수백 개 병원에 무거운 삼각함수(`distanceKm`)를 돌리기 전에 단순 부등호 비교만으로 반경 밖 병원을 90% 이상 즉시 걸러내는 1차 체(Bounding Box) 역할을 함.
 */

export function getOriginDisplayLabel() {
    const base = state.locationKnown ? (state.originLabel || '내 위치') : DEFAULT_ORIGIN.label;
    return state.originAddress ? `${base} (${state.originAddress})` : base;
}
/*
 * [내가 지은 이름] getOriginDisplayLabel : 현재 출발 기준점 이름과 역지오코딩된 도로명/행정동 주소를 합쳐 `'우클릭 지정 출발지 (원주시 흥업면)'` 형태로 반환함.
 */

export function isAppleTouchDevice() {
    const userAgent = navigator.userAgent || '';
    return (
        /iPad|iPhone|iPod/.test(userAgent) ||
        (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)
    );
}
/*
 * [브라우저 내장 도구(API)] navigator.userAgent, navigator.maxTouchPoints (이름 변경 불가)
 * [내가 지은 이름] isAppleTouchDevice : iPhone·iPod뿐만 아니라 User-Agent를 `Macintosh`로 보고하는 최신 iPadOS까지 멀티터치 포인트 수로 정확히 식별함.
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
 * [내가 지은 이름] hasMobileGpsHardware : 물리적 GPS(GNSS) 칩셋을 탑재한 스마트폰·태블릿 모바일 환경인지 판별함.
 * [핵심 원리] GPS 수신기가 없는 일반 데스크톱 PC에서 브라우저가 통신사 IP 주소나 공유기 기지국으로 엉뚱한 위치(예: ISP 국사 소재지)를 잡는 현상을 원천 차단함.
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
 * [브라우저 내장 속성] position.coords.accuracy(오차 반경 m), position.coords.altitude(GNSS 위성 고도 m) (이름 변경 불가)
 * [내가 지은 이름] isGenuineGpsPosition : IP 주소 추정(오차 수 km, altitude=null) 및 이동통신 기지국 삼각측량(오차 수백 m)을 배제하고 순수 GPS 위성 수신 좌표만 허용하는 검증기임.
 * [판정 기준 요약]
 *   1) 데스크톱 PC 환경 : GNSS 위성 고도(`altitude !== null`)가 실측되고 오차 반경이 `50m 이하`인 실제 GPS 수신기 신호만 허용 (IP·공유기 추정치 100% 차단)
 *   2) 모바일 기기 환경 : 오차 반경 `100m 이하` 정밀 GPS 신호만 허용 (지하·실내 기지국/IP 광역 추정치 100% 차단)
 */

export function blurKeyword() {
    const keyword = byId('keyword');
    if (keyword && document.activeElement === keyword) {
        keyword.blur();
    }
}
/*
 * [브라우저 내장 속성/함수] document.activeElement, element.blur() : 지도를 드래그할 때 검색창 포커스를 해제해 모바일 가상 키보드가 화면을 가리지 않도록 내려 줌.
 * [내가 지은 이름] blurKeyword
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
 * [내가 지은 이름] createMarqueeEl : 병상·중증질환 코드 설명이 셀 폭보다 길 때 전광판(Ticker) 스크롤이 작동하도록 `.marquee-inner` 래퍼를 감싸 생성함.
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
 * [브라우저 내장 함수] requestAnimationFrame(...), style.setProperty('--변수명', 값), style.removeProperty(...) (이름 변경 불가)
 * [성능 원리 — 읽기/쓰기 배치 분리(FastDOM 패턴)]
 * - 첫 번째 `for` 루프에서는 `scrollWidth`/`clientWidth` **읽기(Read)**만 수행하고, 두 번째 `for` 루프에서만 스타일 **쓰기(Write)**를 수행하여
 *   강제 동기 레이아웃(Layout Thrashing)을 0회로 억제했음.
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
 * [브라우저 내장 도구(API) & 함수]
 * - toastEl.showPopover() / toastEl.hidePopover() : HTML5 Popover API로 모달 다이얼로그보다도 위층(Top Layer)에 비침투형 상태 토스트를 띄움 (이름 변경 불가).
 * - clearTimeout / setTimeout : 이전 알림 타이머를 취소하고 일반 알림은 4.2초, 오류/오프라인 경고는 6.5초 뒤 자동으로 닫음.
 * [접근성 원리] 중간 로딩 문구(`…`)는 스크린 리더 라이브 영역(`#status-announcer`, `#alert-announcer`)에 보내지 않아 음성 낭독 스팸을 방지함.
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
/*
 * [Modern Web Guidance `light-dismiss-a-dialog` 표준 점진적 향상 적용]
 * - 최신 브라우저는 HTML `<dialog closedby="any">` 속성만으로 바깥 어두운 배경(`::backdrop`) 클릭 및 `ESC` 닫기를 네이티브 처리함.
 * - `'closedBy' in HTMLDialogElement.prototype`을 지원하지 않는 구형 모바일 브라우저(구버전 iOS Safari 등)에서만
 *   `getBoundingClientRect()` 좌표 비교 폴백 리스너를 등록해 모든 기기에서 동일한 라이트 디스미스(바깥 터치 시 닫힘) UX를 보장함.
 */
