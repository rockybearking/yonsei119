import {
    API_FIELD_LABELS,
    SPECIFIC_BLOCK_TARGETS
} from './constants.js';
import {
    DEFAULT_ORIGIN,
    state
} from './state.js';
/*
 * [JS 문법]
 * - import { ... } from './파일.js' : 다른 ES 모듈에서 공개한 상수와 객체를 현재 파일로 가져옴.
 *
 * [연동 모듈]
 * - `./constants.js` : API 필드 한글 사전(`API_FIELD_LABELS`), 질환 차단 매핑(`SPECIFIC_BLOCK_TARGETS`).
 * - `./state.js` : 기본 출발 좌표(`DEFAULT_ORIGIN`), 전역 상태(`state`).
 *
 * [모듈 역할]
 * - DOM·비동기 보조 : 요소 생성·조회, 메인 스레드 양보, 상태 토스트·다이얼로그 폴백을 제공함.
 * - 의료 데이터 정제 : 결측치·날짜·병상 수치 변환, 차단 공지 판별, 증상 필터를 담당함.
 * - 거리·기기 판별 : 구면 직선거리·사각 범위 계산과 GPS 하드웨어 신뢰도 검증을 수행함.
 */

export const byId = id => document.getElementById(id);
/*
 * [JS 문법]
 * - export const / 화살표 함수 (`id => ...`) : 매개변수 1개일 때 괄호와 `return`을 생략해 간결히 작성함.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - document.getElementById(id) : HTML 문서에서 `id`가 일치하는 단일 요소를 즉시 찾는 메서드임.
 *   · 형제 메서드 : CSS 선택자 단건 조회 `querySelector()`, 다건 조회 `querySelectorAll()`.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : `byId`.
 * - 매개변수명 : `id` (찾을 HTML 요소의 `id` 속성 문자열).
 *
 * [동작 흐름]
 * - 호출 출처 : `app.js`, `map-engine.js`, `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`, `search-controls.js`.
 * - 흐름 : `byId('요소ID')` ──> `document.getElementById(id)` ──> DOM 요소(또는 `null`) 반환
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
 * [JS 문법]
 * - export function / 기본값 매개변수 (`param = 값`) / const / if / !== / return :
 *   · 생략된 인자에 기본값을 채우고, 조건에 맞을 때만 속성을 설정한 뒤 요소를 반환함.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - document.createElement(tagName) : 지정한 HTML 태그 이름의 새 요소를 만드는 메서드임.
 * - Element.prototype.className : 요소의 `class` 속성을 문자열로 설정하는 프로퍼티임.
 * - Node.prototype.textContent : 태그 해석 없이 순수 텍스트만 넣어 XSS 보안 위험을 막는 프로퍼티임.
 *   · 비교 : `innerHTML`은 외부 문자열의 HTML·스크립트가 실행될 위험이 있음.
 * - String(value) : 숫자나 다른 값을 문자열로 변환하는 내장 함수임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `node`, `tag`(태그명), `className`(CSS 클래스), `content`(텍스트 내용).
 * - 지역 변수명 : `item`(생성된 HTML 요소 객체).
 *
 * [동작 흐름]
 * - 호출 출처 : `empty()`, `createMarqueeEl()` 및 UI 렌더링 모듈 전체에서 호출함.
 * - 흐름 : `createElement(tag)` ──> `className`·`textContent` 설정 ──> 안전한 DOM 노드 반환
 */

export function empty(container, message) {
    if (!container) {
        return;
    }
    container.replaceChildren(node('p', 'empty-state', message));
}
/*
 * [JS 문법]
 * - export function / if / `!` (논리 부정) / return : 대상이 비어 있으면 일찍 반환해 오류를 막음.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - Element.prototype.replaceChildren(...nodes) : 기존 자식 노드를 모두 지우고 새 노드로 한 번에 교체함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 및 매개변수명 : `empty`, `container`(비울 부모 요소), `message`(빈 상태 안내 문구).
 *
 * [동작 흐름]
 * - 호출 출처 : `hospital-sheet.js`와 `directions-eta.js`가 표시할 데이터가 없을 때 호출함.
 * - 흐름 :
 *   ├── `container` 없음 ──> 즉시 `return`
 *   └── `container` 존재 ──> `node('p', 'empty-state', message)` 생성 ──> `replaceChildren()` 교체
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
 * [JS 문법]
 * - export function / typeof / !== / === / && / in / ?. (옵셔널 체이닝) / new Promise :
 *   · 브라우저 API 지원 여부를 안전하게 확인한 뒤 비동기 `Promise`를 돌려줌.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - window.scheduler.yield() : 긴 JS 작업 도중 메인 스레드 제어권을 브라우저에 양보하는 메서드임.
 *   · 효과 : 사용자 클릭·스크롤과 화면 페인트가 끊기지 않고 우선 처리됨.
 * - new Promise(executor) / setTimeout(resolve, 0) : 구형 환경에서 태스크 큐로 실행을 양보하는 폴백임.
 *
 * [함수명]
 * - `yieldToMain` (메인 스레드 양보 비동기 유틸리티 함수).
 *
 * [동작 흐름]
 * - 호출 출처 : `search-controls.js:applySnapshotToState()`가 병원 목록 정규화 루프 도중 호출함.
 * - 흐름 :
 *   ├── `scheduler.yield` 지원 ──> `window.scheduler.yield()` 반환
 *   └── 미지원 브라우저 ──> `setTimeout(resolve, 0)`으로 다음 프레임에 제어권 양보
 */

export function isMissing(value) {
    return value == null ||
        /^(?:\s*|null|undefined|none|n\/?a|nan|[-−–—]+)$/i.test(
            String(value).trim()
        );
}
/*
 * [JS 문법]
 * - export function / `== null` (`null`과 `undefined` 동시 검사) / || / 정규표현식 `/.../i` :
 *   · `i`는 대소문자 무시 플래그, `(?:...)`는 캡처하지 않는 묶음 그룹임.
 *
 * [JS 내장 메서드 (이름 변경 불가)]
 * - RegExp.prototype.test(str) : 문자열이 정규식 패턴에 맞는지 불리언으로 검사하는 메서드임.
 * - String(value) / String.prototype.trim() : 값을 문자열로 바꾸고 양쪽 공백을 지우는 메서드임.
 *
 * [함수명 및 매개변수명]
 * - 함수명 및 매개변수명 : `isMissing`, `value`(결측 여부를 판별할 원본 값).
 *
 * [동작 흐름]
 * - 도메인 판정 규칙 :
 *   ├── `null`, `undefined`, 빈칸, `'N/A'`, `'NaN'`, 대시(`-` 등) ──> `true` (결측치)
 *   └── 숫자 `0` 또는 `'0'` ──> `false` (결측이 아니라 '0석 만실' 데이터로 보호)
 */

export function isBlankOrNull(val) {
    return val === null || val === undefined || String(val).trim() === '';
}
/*
 * [JS 문법]
 * - export function / === / || / return : 엄격 동등 비교로 `null`, `undefined`, 빈 문자열을 검사함.
 *
 * [JS 내장 함수 및 메서드 (이름 변경 불가)]
 * - String(val) / String.prototype.trim() : 문자열 변환 후 양끝 공백을 제거하는 표준 API임.
 *
 * [함수명 및 매개변수명]
 * - 함수명 및 매개변수명 : `isBlankOrNull`, `val`(비어 있는지 검사할 원본 값).
 */

export function displayValue(value) {
    return isMissing(value) ? '미정보' : String(value).trim();
}
/*
 * [JS 문법]
 * - export function / 삼항 조건 연산자 (`조건 ? 참 : 거짓`) / return : 한 줄로 분기 값을 반환함.
 *
 * [JS 내장 함수 및 메서드 (이름 변경 불가)]
 * - String(value) / String.prototype.trim() : 유효한 문자열의 앞뒤 공백을 정리함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 및 매개변수명 : `displayValue`, `value`(화면에 보여 줄 원본 값).
 *
 * [동작 흐름]
 * - 호출 출처 : `hospital-sheet.js`의 `openHospital()`, `renderBasic()`, `renderContacts()`가 호출함.
 * - 흐름 : `isMissing(value)` 검사
 *   ├── `true` (결측) ──> `'미정보'` 반환
 *   └── `false` (유효) ──> 앞뒤 공백을 제거한 문자열 반환
 */

export function firstReported(...values) {
    return values.find(value => !isMissing(value));
}
/*
 * [JS 문법]
 * - export function / 나머지 매개변수 (`...values`) : 여러 인자를 배열 `values`로 모아 받음.
 * - 화살표 함수 (`value => ...`) / return.
 *
 * [JS 내장 메서드 (이름 변경 불가)]
 * - Array.prototype.find(predicate) : 조건이 참인 첫 번째 요소를 반환하고 없으면 `undefined`를 반환함.
 *   · 형제 메서드 : 전체 목록 추출 `.filter()`, 존재 여부 확인 `.some()`.
 *
 * [함수명 및 매개변수명]
 * - 함수명 및 매개변수명 : `firstReported`, `values`(우선순위 순서로 전달한 후보 값들).
 *
 * [동작 흐름]
 * - 호출 출처 : `hospital-sheet.js`가 병상 보고일시(`hvidate`)·중증질환 보고일시(`mkioskdate`)를 고를 때 씀.
 * - 흐름 : `values` 순회 ──> `!isMissing(value)` 첫 항목 발견 ──> 유효 값(또는 `undefined`) 반환
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
 * [JS 문법]
 * - export function / const / || / if / 템플릿 리터럴 `` `${a}(${b})` `` / 정규표현식 `/^hvs?\d+$/i` / return.
 *   · `s?`는 문자 `s`가 0번 또는 1번 나오는 선택 패턴을 뜻함.
 *
 * [JS 내장 함수 및 메서드 (이름 변경 불가)]
 * - String(val) / String.prototype.toLowerCase() : 값을 문자열로 바꾸고 소문자로 통일함.
 * - RegExp.prototype.test(str) : 문자열이 정규식 패턴과 일치하는지 불리언으로 판별함.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `fieldLabel`, `key`(API 원본 필드 키 문자열).
 * - 지역 변수명 : `label`(`constants.js:API_FIELD_LABELS`에서 찾은 한글 설명).
 *
 * [동작 흐름]
 * - 호출 출처 : `hospital-sheet.js:renderRawBeds()`가 개발자 모드 `#all-beds`를 그릴 때 호출함.
 * - 흐름 : `key` 소문자화 ──> `API_FIELD_LABELS` 조회
 *   ├── 사전에 있음 ──> `'hvec(일반(응급실 일반병상))'` 형태로 반환
 *   ├── 미등록 `hv*`·`hvs*` 코드 ──> `'코드(설명 미정보)'` 반환
 *   └── 그 외 키 ──> `key` 원문 반환
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
 * [JS 문법]
 * - export function / if / && / 템플릿 리터럴 / return : 두 인자 조합에 따라 4가지 문자열로 분기함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 및 매개변수명 : `formatParamLabel`, `currentKey`(가용 키 `'hvec'`), `baselineKey`(기준 키 `'hvs01'` 또는 `null`).
 *
 * [동작 흐름]
 * - 호출 출처 : `hospital-sheet.js`의 `createBedCell()`과 `createEquipmentCell()`이 셀 하단 출처 표기에 씀.
 * - 분기 :
 *   ├── 둘 다 있음 ──> `'hvec / hvs01 (가용 / 기준)'`
 *   ├── `currentKey`만 있음 ──> `'hvec (가용)'`
 *   ├── `baselineKey`만 있음 ──> `'hvs01 (기준)'`
 *   └── 둘 다 없음 ──> `''` 반환
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
 * [JS 문법]
 * - export function / 기본값 매개변수 (`yes = '가능'`, `no = '불가능'`) / const / if / === / || / 객체 리터럴 반환.
 *
 * [JS 내장 함수 및 메서드 (이름 변경 불가)]
 * - String(val) / .trim() / .toUpperCase() : 원본 값을 문자열로 바꾸고 공백 제거·대문자 변환함.
 * - String.prototype.startsWith(prefix) : 지정한 접두사로 시작하는지 검사하는 메서드임.
 * - String.prototype.includes(substr) : 문자열 안에 특정 단어가 들어 있는지 검사하는 메서드임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `availability`, `raw`(가용 코드 `'Y'`, `'N'`, `'N1'` 등), `yes`(긍정 라벨), `no`(부정 라벨).
 * - 지역 변수명 : `text`(공백 제거 문자열), `upper`(대문자 변환 문자열).
 *
 * [동작 흐름]
 * - 호출 출처 : `isAnySevereAccepted()` 및 `hospital-sheet.js`의 `renderSevere()`, `createEquipmentCell()`, `renderRawSevere()`.
 * - 판정 흐름 :
 *   ├── 결측 / `'정보미제공'` / `'-'` ──> `{ text: '-', className: 'unknown' }`
 *   ├── `'Y'` 또는 `'가능*'` ──> `{ text: yes, className: 'yes' }`
 *   └── `'N*'` 또는 `'불가'` 포함 ──> `{ text: no, className: 'no' }`
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
 * [JS 문법]
 * - export function / if / `!` / 정규표현식 `/^-?\d+$/` (선택적 음수 부호와 정수) / 삼항 연산자 / `null` / return.
 *
 * [JS 내장 함수 및 메서드 (이름 변경 불가)]
 * - String(val) / .trim() / RegExp.prototype.test(str) : 값이 순수 정수 문자열 형태인지 검사함.
 * - Number(str) : 문자열을 숫자 타입으로 변환하는 표준 내장 함수임.
 * - Number.isSafeInteger(num) : 정밀도 손실이 없는 안전한 정수 범위인지 판별하는 정적 메서드임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `integerValue`, `raw`(병상 수 등 원본 값).
 * - 지역 변수명 : `text`(공백 제거 문자열), `value`(변환된 숫자).
 *
 * [동작 흐름]
 * - 호출 출처 : `bedValue()`, `getBedTrafficInfo()`, `matchesSymptomPresetClient()`가 병상 숫자를 꺼낼 때 씀.
 * - 흐름 :
 *   ├── 결측치 또는 비정수 문자열 ──> `0`으로 왜곡하지 않고 `null` 반환
 *   └── 음수(`-4`, 초과수용)·`0`(만실)·양수 ──> 안전한 정수 반환 (`HospitalRecommendationScorer`와 동일)
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
 * [JS 문법]
 * - export function / const / if / === / `null` / `<` / 삼항 연산자 / 템플릿 리터럴 / return.
 *
 * [JS 내장 함수 (이름 변경 불가)]
 * - Math.abs(x) : 숫자의 절댓값(음수에서 부호를 뗀 양수)을 구하는 표준 정적 메서드임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `bedValue`, `raw`(응급실 일반병상 `hvec` 원본 값).
 * - 지역 변수명 : `value`(`integerValue(raw)`에서 얻은 정수 또는 `null`).
 *
 * [동작 흐름]
 * - 사용처 : `markers-cluster.js` 병원 카드·클러스터 목록과 `directions-eta.js` 요약 표시에 씀.
 * - 변환 흐름 :
 *   ├── `null` ──> `'미정보'` / `'0'` ──> `'0석'` / `'7'` ──> `'7석'`
 *   └── 음수(`-3`) ──> `Math.abs()` 적용 ──> `'초과수용 3석'`
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
 * [JS 문법]
 * - export function / const / if / === / >= / 템플릿 리터럴 / 객체 리터럴 `{ className, label }` / return.
 *
 * [JS 내장 함수 (이름 변경 불가)]
 * - Math.abs(x) : 음수 초과수용 병상 수의 절댓값을 구하는 표준 정적 메서드임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `getBedTrafficInfo`, `rawErBeds`(응급실 일반병상 `hvec` 원본 값).
 * - 지역 변수명 : `count`(`integerValue(rawErBeds)` 결과).
 *
 * [동작 흐름]
 * - 호출 출처 : `markers-cluster.js`·`directions-eta.js`가 카드·목록·순위 배지의 `.bed-traffic-dot` 표시에 호출함.
 * - 분류 흐름 (`HospitalRecommendationScorer.classifyBedAvailabilityStatus()`와 동일 기준) :
 *   ├── `null` ──> `.avail-unknown` ('병상 미정보')
 *   ├── `count >= 3` ──> `.avail-plenty` ('응급실 여유')
 *   ├── `1 <= count <= 2` ──> `.avail-low` ('응급실 혼잡 임박')
 *   └── `count <= 0` ──> `.avail-full` ('만실' 또는 '초과수용')
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
 * [JS 문법]
 * - export function / if / `!` / 정규표현식 `/^\d{14}$/` / || / const / 단축 속성명 / return.
 *
 * [JS 내장 API 및 메서드 (이름 변경 불가)]
 * - String.prototype.slice(start, end) : 문자열에서 지정한 인덱스 구간의 부분 문자열을 잘라냄.
 * - Number(str) : 잘라낸 숫자 문자열을 정수·실수 값으로 변환함.
 * - Date.UTC(y, mIndex, d, h, min, s) : UTC 기준 타임스탬프(밀리초)를 계산하는 정적 메서드임.
 *   · 월 인덱스는 0부터 시작(`month - 1`)하며, 한국 시간(UTC+9)은 `hour - 9`로 보정함.
 * - new Date(epochMs) / Date.prototype.getTime() : 밀리초 단위 Epoch 시각 숫자를 얻는 표준 API임.
 * - new Intl.DateTimeFormat('ko-KR', options).format(date) : 지정 타임존의 한국어 날짜 문자열을 만듦.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `parseApiDate`, `value`(14자리 `yyyyMMddHHmmss` 일시 문자열).
 * - 지역 변수명 : `year`, `month`, `day`, `hour`, `minute`, `second`, `date`, `display`.
 *
 * [동작 흐름]
 * - 호출 출처 : `getActiveMessages()`(공지 기간 비교)와 `hospital-sheet.js`의 보고일시 표기 함수들.
 * - 흐름 : 14자리 문자열 검증 ──> `Date.UTC`로 한국시 기준 Epoch 변환 ──> `{ timestamp, display }` 반환
 */

export function getActiveMessages(hospital, now = Date.now()) {
    return (hospital?.messages || []).filter(item => {
        const start = parseApiDate(item.symblksttdtm);
        const end = parseApiDate(item.symblkenddtm);
        return (!start || start.timestamp <= now) && (!end || end.timestamp > now);
    });
}
/*
 * [JS 문법]
 * - export function / 기본값 매개변수 (`now = Date.now()`) / ?. / || / 화살표 함수 / <= / > / && / return.
 *
 * [JS 내장 API 및 메서드 (이름 변경 불가)]
 * - Date.now() : 현재 UTC 기준 Epoch 밀리초 시각을 반환하는 표준 정적 메서드임.
 * - Array.prototype.filter(callback) : 조건이 참인 요소만 추려 새 배열을 만드는 메서드임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `getActiveMessages`, `hospital`(병원 객체), `now`(비교 기준 밀리초).
 * - 지역 변수명 : `item`(공지 항목), `start`(`symblksttdtm` 파싱 결과), `end`(`symblkenddtm` 파싱 결과).
 *
 * [동작 흐름]
 * - 호출 출처 : `matchesSymptomPresetClient()`와 `hospital-sheet.js`가 종료된 과거 공지를 걸러낼 때 씀.
 * - 흐름 : `hospital.messages` 순회 ──> `parseApiDate()`로 시작·종료 비교 ──> 현재 유효 공지만 반환
 * - 정합성 : 백엔드 `HospitalRecommendationScorer.isMessageCurrentlyActive()`와 동일한 기간 규칙임.
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
 * [JS 문법]
 * - export function / if / `!` / const / || / === / 정규표현식 / 부정형 후방 탐색 `(?<!불)가능` / return.
 *
 * [JS 내장 함수 및 메서드 (이름 변경 불가)]
 * - String(val) / String.prototype.trim() : 값을 문자열로 바꾸고 양쪽 공백을 제거함.
 * - RegExp.prototype.test(str) : 문자열에 정규식 패턴이 일치하는지 검사함.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `isNoticeBlocking`, `msg`(단일 진료 공지 객체).
 * - 지역 변수명 : `body`(`symblkmsg` 본문 문자열), `yon`(`symoutdspyon` 차단 구분 코드).
 *
 * [동작 흐름]
 * - 호출 출처 : `hasGeneralErBlockNotice()`, `isDiseaseSpecificallyBlocked()`, `hasBlockingKeywordInNotices()`.
 * - 오판 방지 흐름 (`HospitalRecommendationScorer.isNoticeBlocking()`과 동일) :
 *   ├── 1) `yon === '차단'` 또는 차단 키워드(`불가능|불가|중단|...`) 일치 ──> 즉시 `true` (차단)
 *   └── 2) 부정 후방 탐색 `(?<!불)가능`·`'정상 진료'` 확인 ──> '불가능' 속 '가능' 오탐 없이 `false`
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
 * [JS 문법]
 * - export function / for...of / if / `!` / continue / const / 템플릿 리터럴 / || / && / return.
 *
 * [JS 내장 메서드 (이름 변경 불가)]
 * - String.prototype.includes(substr) : 문자열 안에 지정 단어가 포함되어 있는지 확인함.
 * - RegExp.prototype.test(str) : 문자열이 정규식 패턴에 맞는지 검사함.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `hasGeneralErBlockNotice`, `activeMessages`(현재 유효한 공지 배열).
 * - 지역 변수명 : `msg`(공지 항목), `combined`(질환명·진료과명·본문을 합친 문자열).
 *
 * [동작 흐름]
 * - 호출 출처 : `matchesSymptomPresetClient()` 1단계 검사에서 호출함.
 * - 흐름 : `activeMessages` 순회 ──> `isNoticeBlocking(msg)` 통과 ──>
 *   └── `'응급실'` + `'수용불가|진료중단'` 포함 ──> `true` 반환 (전체 병원 제외, 백엔드와 동일)
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
 * [JS 문법]
 * - export function / const / if / `!` / || / && / for...of / continue / === / >= / 화살표 함수 / return.
 *
 * [JS 내장 함수 및 메서드 (이름 변경 불가)]
 * - String(val) / .trim() / .toUpperCase() : 값을 문자열로 바꾼 뒤 공백 제거·대문자 통일함.
 * - Array.prototype.includes(item) : 배열 안에 특정 문자열이 들어 있는지 검사함.
 * - Array.prototype.some(predicate) : 배열 요소 중 하나라도 조건을 만족하면 즉시 `true`를 반환함.
 * - String.prototype.includes(substr) / .length : 부분 문자열 포함 여부와 글자 수를 확인함.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `isDiseaseSpecificallyBlocked`, `activeMessages`, `itemKey`(`'mkioskty1'`~`'mkioskty27'`).
 * - 지역 변수명 : `config`(`SPECIFIC_BLOCK_TARGETS[itemKey]`), `msg`, `cod`, `symName`, `bodyText`, `target`.
 *
 * [동작 흐름]
 * - 호출 출처 : `isAnySevereAccepted()` 및 `hospital-sheet.js:renderSevere()`에서 호출함.
 * - 교차 검증 흐름 :
 *   ├── `isNoticeBlocking(msg)` 참인 공지만 대상으로 삼음
 *   ├── `cod`가 `config.codes`에 포함 ──> 즉시 `true` (차단)
 *   └── `symName`(4자 이상)·`bodyText`(3자 이상) 키워드 일치 ──> `true` (API `'Y'`여도 차단 보정)
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
 * [JS 문법]
 * - function (파일 내부 비공개 헬퍼) / for...of / const / if / === / && / `!` / return.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 : `isAnySevereAccepted`.
 * - 매개변수명 : `severeMap`(병원 `severe` 객체), `activeMessages`(유효 공지 배열), `keys`(`mkioskty*` 키 배열).
 * - 지역 변수명 : `key`, `status`(`availability(severeMap[key])` 결과).
 *
 * [동작 흐름]
 * - 호출 출처 : `matchesSymptomPresetClient()`가 증상 관련 중증질환 키 목록을 검사할 때 씀.
 * - 흐름 : `keys` 순회 ──> `status.className === 'yes'` & `!isDiseaseSpecificallyBlocked()` ──> `true` 반환
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
 * [JS 문법]
 * - function (파일 내부 비공개 헬퍼) / for...of / if / `!` / continue / const / 템플릿 리터럴 / || / return.
 *
 * [JS 내장 메서드 (이름 변경 불가)]
 * - RegExp.prototype.test(str) : 문자열이 정규표현식 패턴과 일치하는지 검사함.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 : `hasBlockingKeywordInNotices`.
 * - 매개변수명 : `activeMessages`(유효 공지 배열), `keywordRegex`(증상별 차단 키워드 정규식).
 * - 지역 변수명 : `msg`, `combined`(질환명·진료과명·본문을 합친 문자열).
 *
 * [동작 흐름]
 * - 호출 출처 : `matchesSymptomPresetClient()`가 각 증상 분기 초반에 차단 공지를 확인함.
 * - 흐름 : `activeMessages` 순회 ──> `isNoticeBlocking(msg)` 통과 ──> `keywordRegex.test(combined)` ──> `true` 반환
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
 * [JS 문법]
 * - export function / if / `!` / || / === / const / 화살표 함수 / switch...case...default / return.
 *
 * [JS 내장 함수 및 메서드 (이름 변경 불가)]
 * - String(val) / .trim() / .toUpperCase() : 플래그 값을 문자열로 정제한 뒤 대문자로 통일함.
 * - Boolean(value) : 어떤 값이든 명확한 `true`/`false` 논리형으로 변환하는 표준 함수임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `matchesSymptomPresetClient`, `hospital`(병원 객체), `presetKey`(선택 증상 키).
 * - 지역 변수명 : `beds`, `severe`, `activeMessages`, `posBed`(양수 병상 확인), `flagYes`(`'Y'`/양수 확인), `val`, `raw`, `num`.
 *
 * [동작 흐름]
 * - 호출 출처 : `markers-cluster.js:matchesFilters()` (백엔드 `HospitalRecommendationScorer.matchesSymptomPreset()`와 동일 규칙).
 * - 3단계 판별 흐름 :
 *   ├── 1단계 : `hasGeneralErBlockNotice()` 참 ──> 즉시 `false`
 *   ├── 2단계 : 프리셋별 `hasBlockingKeywordInNotices()` 차단 키워드 검출 ──> 즉시 `false`
 *   └── 3단계 : 외상센터 여부·전용 병상 양수(`posBed`)·연관 중증질환(`isAnySevereAccepted`) 중 하나 충족 ──> `true`
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
 * [JS 문법]
 * - export function / const / 화살표 함수 / 거듭제곱 연산자 (`** 2`) / 산술 연산자 / return.
 *
 * [JS 내장 API 및 함수 (이름 변경 불가)]
 * - Math.PI / Math.sin(x) / Math.cos(x) / Math.sqrt(x) / Math.atan2(y, x) :
 *   · 원주율 상수와 삼각·제곱근·역탄젠트 함수로, 구면 위 두 위경도 사이 거리 계산에 쓰임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `distanceKm`, `a`(출발 `{ lat, lng }`), `b`(도착 `{ lat, lng }`).
 * - 지역 변수명 : `radians`(각도를 라디안으로 바꾸는 함수), `dLat`, `dLng`, `arc`.
 *
 * [동작 흐름]
 * - 호출 출처 : `markers-cluster.js`, `directions-eta.js`, `hospital-sheet.js`, `search-controls.js`가 직선거리 계산에 호출함.
 * - 흐름 : 위경도 차 ──> 라디안 변환 ──> 하버사인(Haversine, 지구 반지름 `6371 km`) 계산 ──> `km` 거리 반환
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
 * [JS 문법]
 * - export function / const / 산술 연산자 / 객체 리터럴 `{ south, north, west, east }` / return.
 *
 * [JS 내장 API 및 함수 (이름 변경 불가)]
 * - Math.PI / Math.sin(x) / Math.cos(x) / Math.asin(x) : 중심점과 반경으로 위경도 사각 범위를 계산하는 함수임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `radiusExtent`, `origin`(기준 `{ lat, lng }`), `radiusKm`(탐색 반경 km).
 * - 지역 변수명 : `angle`(지구 중심각 라디안), `latDelta`(위도 편차), `lngDelta`(경도 편차).
 *
 * [동작 흐름]
 * - 호출 출처 :
 *   ├── `map-engine.js:updateCircle()` ──> 반경 원의 화면 맞춤 범위 계산
 *   └── `markers-cluster.js:updateMarkers()` ──> `distanceKm()` 계산 전 단순 부등호로 반경 밖 병원 사전 제외
 */

export function getOriginDisplayLabel() {
    const base = state.locationKnown ? (state.originLabel || '내 위치') : DEFAULT_ORIGIN.label;
    return state.originAddress ? `${base} (${state.originAddress})` : base;
}
/*
 * [JS 문법]
 * - export function / const / 삼항 조건 연산자 / || / 템플릿 리터럴 / return.
 *
 * [함수명 및 지역 변수명]
 * - 함수명 : `getOriginDisplayLabel`.
 * - 지역 변수명 : `base`(위치 확인 시 `state.originLabel`, 미확인 시 `DEFAULT_ORIGIN.label`).
 *
 * [동작 흐름]
 * - 호출 출처 : `hospital-sheet.js:openHospital()`, `directions-eta.js`, `search-controls.js:updateRadiusUI()`.
 * - 흐름 :
 *   ├── `state.originAddress` 있음 ──> `'지정 출발지 (강원 원주시...)'` 형태로 조합 반환
 *   └── `state.originAddress` 없음 ──> `'서울시청'` 또는 `'내 위치'` 기본 라벨 반환
 */

export function isAppleTouchDevice() {
    const userAgent = navigator.userAgent || '';
    return (
        /iPad|iPhone|iPod/.test(userAgent) ||
        (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)
    );
}
/*
 * [JS 문법]
 * - export function / const / || / && / 정규표현식 리터럴 / > / return.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - navigator.userAgent : 브라우저와 운영체제 식별 문자열을 반환하는 읽기 전용 속성임.
 * - navigator.maxTouchPoints : 기기가 지원하는 최대 동시 터치 접점 수를 반환하는 속성임.
 * - RegExp.prototype.test(str) : 문자열이 정규표현식 패턴에 맞는지 검사함.
 *
 * [함수명 및 지역 변수명]
 * - 함수명 : `isAppleTouchDevice`.
 * - 지역 변수명 : `userAgent`(`navigator.userAgent` 문자열).
 *
 * [동작 흐름]
 * - 호출 출처 : `hasMobileGpsHardware()`, `hospital-sheet.js:syncResponsiveSheetLayout()`.
 * - 판별 흐름 :
 *   ├── `iPad` / `iPhone` / `iPod` 문자열 일치 ──> `true`
 *   └── `Macintosh` 보고 + 멀티터치 접점 `> 1` (최신 iPadOS) ──> `true`
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
 * [JS 문법]
 * - export function / const / if / 정규표현식 `/Android/i` / || / typeof / !== / && / `!` / return.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - navigator.userAgent : 브라우저와 OS 식별 문자열을 읽는 표준 속성임.
 * - window.matchMedia(query) : CSS 미디어 쿼리(`'(pointer: coarse)'` 등) 일치 여부를 `.matches`로 반환함.
 *
 * [함수명 및 지역 변수명]
 * - 함수명 : `hasMobileGpsHardware`.
 * - 지역 변수명 : `ua`(`navigator.userAgent` 문자열).
 *
 * [동작 흐름]
 * - 호출 출처 : `app.js:init()`, `isGenuineGpsPosition()`, `search-controls.js:locate()`.
 * - 목적 : GPS 칩 없는 데스크톱이 IP 기반 부정확 좌표로 이동하지 않게 기기 특성을 걸러냄.
 * - 흐름 :
 *   ├── Android 또는 `isAppleTouchDevice()` 참 ──> `true`
 *   └── 주 포인터가 터치(`coarse`)이고 마우스(`fine`) 없음 ──> `true` / 그 외 ──> `false`
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
 * [JS 문법]
 * - export function / const / ?. / if / `!` / || / && / !== / <= / `null` / return.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - GeolocationPosition.coords : 위치 측위 API가 전달하는 위도·경도·정확도·고도 객체임.
 *   · `latitude`·`longitude` : 위도·경도 값.
 *   · `accuracy` : 미터 단위 오차 반경 / `altitude` : 위성 고도(실측 시 숫자).
 * - Number(val) / Number.isFinite(val) : 숫자로 바꾸고 `NaN`·`Infinity`가 아닌 유한 실수인지 검사함.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `isGenuineGpsPosition`, `position`(브라우저 측위 `GeolocationPosition` 객체).
 * - 지역 변수명 : `coords`, `accuracy`.
 *
 * [동작 흐름]
 * - 호출 출처 : `search-controls.js:locate()`가 위치 반영 전 좌표 신뢰도를 검증할 때 호출함.
 * - 판별 흐름 :
 *   ├── 데스크톱(`!hasMobileGpsHardware()`) ──> 위성 고도 실측(`altitude !== null`) & 오차 `50m` 이하만 허용
 *   └── 모바일 기기 ──> 오차 `100m` 이하 정밀 GPS만 허용 (IP·기지국 광역 추정 배제)
 */

export function blurKeyword() {
    const keyword = byId('keyword');
    if (keyword && document.activeElement === keyword) {
        keyword.blur();
    }
}
/*
 * [JS 문법]
 * - export function / const / if / && / === : 요소 존재와 현재 포커스 일치 여부를 확인함.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - document.activeElement : 현재 문서에서 키보드 포커스를 가진 DOM 요소를 반환하는 속성임.
 * - HTMLElement.prototype.blur() : 요소의 포커스를 해제해 모바일 가상 키보드를 닫히게 하는 메서드임.
 *
 * [함수명 및 지역 변수명]
 * - 함수명 : `blurKeyword`.
 * - 지역 변수명 : `keyword`(`#keyword` 검색 입력창 요소 참조).
 *
 * [동작 흐름]
 * - 호출 출처 : `map-engine.js`(지도 드래그 시작)와 `search-controls.js` (`#search-form` 제출)에서 호출함.
 * - 흐름 : `document.activeElement === keyword` ──> `keyword.blur()` ──> 모바일 가상 키보드 숨김
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
 * [JS 문법]
 * - export function / 기본값 매개변수 (`param = 값`) / const / if / return.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - HTMLElement.prototype.title : 마우스를 올렸을 때 표시되는 기본 툴팁 문자열 속성임.
 * - Element.prototype.append(...nodes) : 부모 요소의 끝부분에 자식 노드들을 삽입하는 메서드임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `createMarqueeEl`, `tag`(외부 태그명), `className`(CSS 클래스), `text`(문자열), `title`(선택 툴팁).
 * - 지역 변수명 : `el`(외부 래퍼 요소), `inner`(`<span class="marquee-inner">` 내부 텍스트 노드).
 *
 * [동작 흐름]
 * - 호출 출처 : `hospital-sheet.js`가 병상 파라미터 라벨(`.egen-cell-param`)·비고(`.severe-remark-box`) 생성 시 씀.
 * - 흐름 : `el` 생성 ──> `inner`(`.marquee-inner`) 추가 ──> 이후 `updateMarquees()`가 넘침 시 흐르는 효과 부여
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
 * [JS 문법]
 * - export function / 화살표 함수 / const / if / `!` / for...of / 객체 구조 분해 (`{ a, b }`) / 템플릿 리터럴 / return.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - requestAnimationFrame(callback) : 다음 화면 그리기 직전 프레임에 맞추어 콜백을 실행하는 함수임.
 * - document.querySelectorAll(selector) / Element.prototype.querySelector(selector) : DOM 요소 탐색 메서드임.
 * - Array.prototype.push(item) : 배열 끝에 새 항목을 추가하는 메서드임.
 * - Element.prototype.scrollWidth / .clientWidth : 실제 내용 전체 너비와 보이는 너비를 읽는 속성임.
 * - Element.prototype.classList.add() / .remove() : CSS 클래스를 추가·제거하는 메서드임.
 * - CSSStyleDeclaration.prototype.setProperty() / .removeProperty() : CSS 변수 값을 쓰거나 지우는 메서드임.
 * - Math.ceil() / Math.max() / Math.min() / Number.prototype.toFixed() : 올림, 범위 제한, 소수점 포맷 함수임.
 *
 * [함수명 및 지역 변수명]
 * - 함수명 : `updateMarquees`.
 * - 지역 변수명 : `containers`, `measurements`, `container`, `inner`, `overflow`, `duration`.
 *
 * [동작 흐름]
 * - 호출 출처 : `app.js`의 `resize` 리스너 및 `hospital-sheet.js` 상세 시트 렌더링 직후 호출됨.
 * - 레이아웃 스래싱(Reflow 반복) 방지 흐름 :
 *   ├── 1차 `for...of` (읽기 전용) ──> `scrollWidth - clientWidth` 측정값만 `measurements` 수집
 *   └── 2차 `for...of` (쓰기 전용) ──> `is-marquee`, `--ticker-diff`, `--ticker-duration` 일괄 반영
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
 * [JS 문법]
 * - export function / const / if / `!` / 삼항 연산자 / `delete` 연산자 / typeof / === / try...catch / void / && / return.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - clearTimeout(id) / setTimeout(fn, ms) : 예약된 타이머를 취소하고 지정 시간 뒤 콜백 인자 fn을 실행하는 타이머 API임.
 * - Node.prototype.textContent / HTMLElement.prototype.hidden / .dataset : 텍스트, 숨김, `data-*` 속성을 제어함.
 * - HTMLElement.prototype.matches(':popover-open') / .showPopover() / .hidePopover() :
 *   · HTML Popover 요소를 열림 여부 확인 뒤 브라우저 최상위 Top Layer에 표시하거나 숨김.
 * - RegExp.prototype.test(str) / String.prototype.includes(substr) : 패턴 및 단어 포함 여부를 검사함.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `setStatus`, `message`(표시할 상태 문구, 빈 문자열이면 닫힘).
 * - 지역 변수명 : `statusEl`, `toastEl`, `text`, `politeAnnouncer`, `alertAnnouncer`, `popErr`, `isError`, `isInterstitial`, `isSdkFatalError`.
 *
 * [동작 흐름]
 * - 호출 출처 : `app.js`, `search-controls.js`, `directions-eta.js`, `hospital-sheet.js`, `#status-toast-close`.
 * - 흐름 :
 *   ├── 빈 문구(`!text`) ──> `data-open="false"`·`hidePopover()`로 토스트 닫기
 *   ├── 문구 존재 ──> `showPopover()` 표시 + 확정 문구(`…` 제외)만 `#status-announcer`/`#alert-announcer` 전달
 *   └── 일반(`4200ms`)·오류(`6500ms`) 후 ──> `setTimeout` ──> `setStatus('')` 자동 닫힘
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
 * [JS 문법]
 * - export function / if / `!` / || / typeof / === / in / !== / const / <= / && / 화살표 함수 / return.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - HTMLDialogElement / HTMLDialogElement.prototype : `<dialog>` 요소의 표준 DOM 인터페이스임.
 *   · `'closedBy' in HTMLDialogElement.prototype`으로 브라우저의 `closedby` 속성 지원 여부를 탐지함.
 * - EventTarget.prototype.addEventListener('click', handler) : 클릭 이벤트 리스너를 등록하는 메서드임.
 * - event.target / event.clientX / event.clientY : 클릭된 대상 요소와 뷰포트 좌표를 제공하는 속성임.
 * - Element.prototype.getBoundingClientRect() : 요소의 화면상 사각 좌표(`top`, `bottom`, `left`, `right`)를 반환함.
 * - HTMLDialogElement.prototype.close() : 모달 다이얼로그를 닫고 배경 막(`::backdrop`)을 없애는 메서드임.
 *
 * [함수명·매개변수명 및 지역 변수명]
 * - 함수명 및 매개변수명 : `installDialogLightDismiss`, `dialog`(`#cluster-dialog`·`#notice-dialog` 요소).
 * - 지역 변수명 : `event`, `rect`, `clickedInside`.
 *
 * [동작 흐름]
 * - 호출 출처 : `search-controls.js:initNotice()`가 `#notice-dialog`·`#cluster-dialog`에 등록함.
 * - 점진적 향상 흐름 :
 *   ├── `closedBy` 네이티브 지원 최신 브라우저 ──> 즉시 `return` (`index.html`의 `closedby="any"` 동작)
 *   └── 미지원 구형 브라우저 ──> `dialog` `'click'` ──> 바깥 클릭(`event.target === dialog && !clickedInside`)이면 `dialog.close()` 호출
 */
