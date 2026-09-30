/* global kakao */
'use strict';

const API_KEY = decodeURIComponent(
    's%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8' +
    'UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D'
);

const API_ROOT =
    'https://apis.data.go.kr/B552657/ErmctInfoInqireService';

const PAGE_SIZE = 1000;
const CARD_WIDTH = 168;
const CARD_HEIGHT = 60;
const NOTICE_KEY = 'emergency-notice-hidden-v1';

const SEOUL = {
    lat: 37.5668,
    lng: 126.9786
};

/* 기존 기관 분류 목록 */
const TERTIARY_2024_2026 = [
    ['서울', ['강북삼성병원']],
    ['서울', ['건국대학교병원']],
    ['서울', ['경희대학교병원']],
    ['서울', ['고려대학교의과대학부속구로병원', '고려대학교구로병원']],
    ['서울', ['삼성서울병원']],
    ['서울', ['서울대학교병원']],
    ['서울', ['강남세브란스병원']],
    ['서울', ['연세대학교의과대학세브란스병원', '신촌세브란스병원']],
    ['서울', [
        '이화여자대학교의과대학부속목동병원',
        '이화여자대학교목동병원',
        '이대목동병원'
    ]],
    ['서울', ['서울아산병원']],
    ['서울', ['중앙대학교병원']],
    ['서울', [
        '고려대학교의과대학부속병원',
        '고려대학교안암병원',
        '고대안암병원'
    ]],
    ['서울', ['가톨릭대학교서울성모병원', '서울성모병원']],
    ['서울', ['한양대학교병원']],
    ['인천', ['가톨릭대학교인천성모병원', '인천성모병원']],
    ['경기', ['순천향대학교부속부천병원', '순천향대학교부천병원']],
    ['인천', ['길병원']],
    ['인천', ['인하대학교의과대학부속병원', '인하대학교병원']],
    ['경기', ['가톨릭대학교성빈센트병원', '성빈센트병원']],
    ['경기', ['고려대학교의과대학부속안산병원', '고려대학교안산병원']],
    ['경기', ['분당서울대학교병원']],
    ['경기', ['아주대학교병원']],
    ['경기', ['한림대학교성심병원']],
    ['강원', ['강릉아산병원']],
    ['강원', [
        '연세대학교원주세브란스기독병원',
        '원주세브란스기독병원'
    ]],
    ['충북', ['충북대학교병원']],
    ['충남', ['단국대학교의과대학부속병원', '단국대학교병원']],
    ['대전', ['충남대학교병원']],
    ['대전', ['건양대학교병원']],
    ['전북', ['원광대학교병원']],
    ['전북', ['전북대학교병원']],
    ['광주', ['전남대학교병원']],
    ['광주', ['조선대학교병원']],
    ['전남', ['화순전남대학교병원']],
    ['대구', ['경북대학교병원']],
    ['대구', ['계명대학교동산병원']],
    ['대구', ['대구가톨릭대학교병원']],
    ['대구', ['영남대학교병원']],
    ['대구', ['칠곡경북대학교병원']],
    ['부산', ['고신대학교복음병원']],
    ['부산', ['동아대학교병원']],
    ['부산', ['부산대학교병원']],
    ['경남', ['양산부산대학교병원']],
    ['부산', ['인제대학교부산백병원', '부산백병원']],
    ['울산', ['울산대학교병원']],
    ['경남', ['경상국립대학교병원']],
    ['경남', ['삼성창원병원']]
];

const REGION_PREFIX = {
    서울: /^서울/,
    인천: /^인천/,
    경기: /^경기/,
    강원: /^강원/,
    충북: /^(충북|충청북도)/,
    충남: /^(충남|충청남도)/,
    대전: /^대전/,
    전북: /^(전북|전라북도)/,
    광주: /^광주/,
    전남: /^(전남|전라남도)/,
    대구: /^대구/,
    경북: /^(경북|경상북도)/,
    부산: /^부산/,
    경남: /^(경남|경상남도)/,
    울산: /^울산/
};

const EQUIPMENT = {
    hvamyn: '구급차',
    hvangioayn: '혈관촬영기',
    hvcrrtayn: '지속적 신대체요법(CRRT)',
    hvctayn: 'CT',
    hvecmoayn: 'ECMO',
    hvhypoayn: '저체온 치료',
    hvincuayn: '인큐베이터',
    hvmriayn: 'MRI',
    hvoxyayn: '고압산소 치료',
    hvventiayn: '인공호흡기',
    hvventisoayn: '소아 인공호흡기'
};

const HV_LABELS = {
    hv1: '예비항목2',
    hv2: '[중환자실] 내과',
    hv3: '[중환자실] 외과',
    hv4: '외과입원실(정형외과)',
    hv5: 'CT',
    hv6: '[중환자실] 신경외과',
    hv7: '혈관촬영기',
    hv8: '[중환자실] 화상',
    hv9: '[중환자실] 외상',
    hv10: 'VENTI(소아)',
    hv11: '인큐베이터(보육기)',
    hv12: '예비항목3',
    hv13: '격리진료구역 음압격리병상',
    hv14: '격리진료구역 일반격리병상',
    hv15: '소아음압격리',
    hv16: '소아일반격리',
    hv17: '[응급전용] 중환자실 음압격리',
    hv18: '[응급전용] 중환자실 일반격리',
    hv19: '[응급전용] 입원실 음압격리',
    hv21: '[응급전용] 입원실 일반격리',
    hv22: '감염병 전담병상 중환자실',
    hv23: '감염병 전담병상 중환자실 내 음압격리병상',
    hv24: '[감염] 중증 병상',
    hv25: '[감염] 준·중증 병상',
    hv26: '[감염] 중등증 병상',
    hv27: '코호트 격리',
    hv28: '소아',
    hv29: '응급실 음압 격리 병상',
    hv30: '응급실 일반 격리 병상',
    hv31: '[응급전용] 중환자실',
    hv32: '[중환자실] 소아',
    hv33: '[응급전용] 소아중환자실',
    hv34: '[중환자실] 심장내과',
    hv35: '[중환자실] 음압격리',
    hv36: '[응급전용] 입원실',
    hv37: '[응급전용] 소아입원실',
    hv38: '[입원실] 외상전용',
    hv39: '[기타] 외상전용 수술실',
    hv40: '[입원실] 정신과 폐쇄병동',
    hv41: '[입원실] 음압격리',
    hv42: '[기타] 분만실',
    hv43: '[기타] 화상전용처치실',
    hv60: '외상소생실',
    hv61: '외상환자진료구역'
};

const HVS_LABELS = {
    hvs01: '일반 기준',
    hvs02: '소아 기준',
    hvs03: '응급실 음압 격리 병상 기준',
    hvs04: '응급실 일반 격리 병상 기준',
    hvs05: '[응급전용] 중환자실 기준',
    hvs06: '[중환자실] 내과 기준',
    hvs07: '[중환자실] 외과 기준',
    hvs08: '[중환자실] 신생아 기준',
    hvs09: '[중환자실] 소아 기준',
    hvs10: '[응급전용] 소아중환자실 기준',
    hvs11: '[중환자실] 신경과 기준',
    hvs12: '[중환자실] 신경외과 기준',
    hvs13: '[중환자실] 화상 기준',
    hvs14: '[중환자실] 외상 기준',
    hvs15: '[중환자실] 심장내과 기준',
    hvs16: '[중환자실] 흉부외과 기준',
    hvs17: '[중환자실] 일반 기준',
    hvs18: '[중환자실] 음압격리 기준',
    hvs19: '[응급전용] 입원실 기준',
    hvs20: '[응급전용] 소아입원실 기준',
    hvs21: '[입원실] 외상전용 기준',
    hvs22: '[기타] 수술실 기준',
    hvs23: '[기타] 외상전용 수술실 기준',
    hvs24: '[입원실] 정신과 폐쇄병동 기준',
    hvs25: '[입원실] 음압격리 기준',
    hvs26: '[기타] 분만실 기준',
    hvs27: 'CT 기준',
    hvs28: 'MRI 기준',
    hvs29: '혈관촬영기 기준',
    hvs30: '인공호흡기 일반 기준',
    hvs31: '인공호흡기 소아 기준',
    hvs32: '인큐베이터 기준',
    hvs33: 'CRRT 기준',
    hvs34: 'ECMO 기준',
    hvs35: '중심체온조절유도기 기준',
    hvs36: '[기타] 화상전용처치실 기준',
    hvs37: '고압산소치료기 기준',
    hvs38: '[입원실] 일반 기준',
    hvs46: '격리진료구역 음압격리 기준',
    hvs47: '격리진료구역 일반격리 기준',
    hvs48: '소아음압격리 기준',
    hvs49: '소아일반격리 기준',
    hvs50: '[응급전용] 중환자실 음압격리 기준',
    hvs51: '[응급전용] 중환자실 일반격리 기준',
    hvs52: '[응급전용] 입원실 음압격리 기준',
    hvs53: '[응급전용] 입원실 일반격리 기준',
    hvs54: '감염병 전담병상 중환자실 기준',
    hvs55: '감염병 전담병상 중환자실 내 음압격리병상 기준',
    hvs56: '[감염] 중증 병상 기준',
    hvs57: '[감염] 준·중증 병상 기준',
    hvs58: '[감염] 중등증 병상 기준',
    hvs59: '코호트 격리 기준',
    hvs60: '외상소생실 기준',
    hvs61: '외상환자진료구역 기준'
};

const API_FIELD_LABELS = {
    ...HV_LABELS,
    ...HVS_LABELS,
    ...EQUIPMENT,
    hvec: '일반(응급실 일반병상)',
    hvoc: '[기타] 수술실',
    hvcc: '[중환자실] 신경과',
    hvncc: '[중환자실] 신생아',
    hvccc: '[중환자실] 흉부외과',
    hvicc: '[중환자실] 일반',
    hvgc: '[입원실] 일반',
    hvidate: '입력일시',
    hvdnm: '예비항목1'
};

const DISEASES = [
    '재관류중재술 · 심근경색',
    '재관류중재술 · 뇌경색',
    '뇌출혈수술 · 거미막하출혈',
    '뇌출혈수술 · 거미막하출혈 외',
    '대동맥응급 · 흉부',
    '대동맥응급 · 복부',
    '담낭담관질환 · 담낭질환',
    '담낭담관질환 · 담도포함질환',
    '복부응급수술 · 비외상',
    '장중첩/폐색 · 영유아',
    '응급내시경 · 성인 위장관',
    '응급내시경 · 영유아 위장관',
    '응급내시경 · 성인 기관지',
    '응급내시경 · 영유아 기관지',
    '저체중출생아 · 집중치료',
    '산부인과응급 · 분만',
    '산부인과응급 · 산과수술',
    '산부인과응급 · 부인과수술',
    '중증화상 · 전문치료',
    '사지접합 · 수족지접합',
    '사지접합 · 수족지접합 외',
    '응급투석 · HD',
    '응급투석 · CRRT',
    '정신과적응급 · 폐쇄병동입원',
    '안과적수술 · 응급',
    '영상의학혈관중재 · 성인',
    '영상의학혈관중재 · 영유아',
    '응급실(Emergency gate keeper)'
];

/* 실시간 필드와 기준 필드의 기존 매핑 */
const BED_GROUPS = [
    {
        title: '응급실·격리',
        items: [
            ['hvec', 'hvs01', '응급실 일반'],
            ['hv28', 'hvs02', '응급실 소아'],
            ['hv42', 'hvs26', '분만실', 'mixed'],
            ['hv29', 'hvs03', '응급실 음압격리'],
            ['hv30', 'hvs04', '응급실 일반격리'],
            ['hv27', 'hvs59', '코호트 격리']
        ]
    },
    {
        title: '중환자실',
        items: [
            ['hvicc', 'hvs17', '일반 중환자실'],
            ['hv2', 'hvs06', '내과 중환자실'],
            ['hv3', 'hvs07', '외과 중환자실'],
            ['hvncc', 'hvs08', '신생아 중환자실'],
            ['hv32', 'hvs09', '소아 중환자실'],
            ['hvcc', 'hvs11', '신경과 중환자실'],
            ['hv6', 'hvs12', '신경외과 중환자실'],
            ['hv8', 'hvs13', '화상 중환자실'],
            ['hv9', 'hvs14', '외상 중환자실'],
            ['hv34', 'hvs15', '심장내과 중환자실'],
            ['hvccc', 'hvs16', '흉부외과 중환자실'],
            ['hv35', 'hvs18', '음압격리 중환자실'],
            ['hv31', 'hvs05', '응급전용 중환자실'],
            ['hv33', 'hvs10', '응급전용 소아 중환자실']
        ]
    },
    {
        title: '입원실·수술실·처치실',
        items: [
            ['hvgc', 'hvs38', '일반 입원실'],
            ['hvoc', 'hvs22', '수술실'],
            ['hv4', null, '외과입원실(정형외과)'],
            ['hv36', 'hvs19', '응급전용 입원실'],
            ['hv37', 'hvs20', '응급전용 소아 입원실'],
            ['hv38', 'hvs21', '외상전용 입원실'],
            ['hv39', 'hvs23', '외상전용 수술실'],
            ['hv40', 'hvs24', '정신과 폐쇄병동'],
            ['hv41', 'hvs25', '음압격리 입원실'],
            ['hv43', 'hvs36', '화상전용 처치실'],
            ['hv60', 'hvs60', '외상소생실'],
            ['hv61', 'hvs61', '외상환자 진료구역']
        ]
    },
    {
        title: '추가 격리·감염병 병상',
        items: [
            ['hv13', 'hvs46', '격리진료구역 음압격리'],
            ['hv14', 'hvs47', '격리진료구역 일반격리'],
            ['hv15', 'hvs48', '소아 음압격리'],
            ['hv16', 'hvs49', '소아 일반격리'],
            ['hv17', 'hvs50', '응급전용 중환자실 음압격리'],
            ['hv18', 'hvs51', '응급전용 중환자실 일반격리'],
            ['hv19', 'hvs52', '응급전용 입원실 음압격리'],
            ['hv21', 'hvs53', '응급전용 입원실 일반격리'],
            ['hv22', 'hvs54', '감염병 전담 중환자실'],
            ['hv23', 'hvs55', '감염병 전담 중환자실 내 음압격리'],
            ['hv24', 'hvs56', '감염 중증 병상'],
            ['hv25', 'hvs57', '감염 준·중증 병상'],
            ['hv26', 'hvs58', '감염 중등증 병상']
        ]
    }
];

const EQUIPMENT_BASELINES = {
    hvctayn: 'hvs27',
    hvmriayn: 'hvs28',
    hvangioayn: 'hvs29',
    hvventiayn: 'hvs30',
    hvventisoayn: 'hvs31',
    hvincuayn: 'hvs32',
    hvcrrtayn: 'hvs33',
    hvecmoayn: 'hvs34',
    hvhypoayn: 'hvs35',
    hvoxyayn: 'hvs37'
};

const state = {
    map: null,
    circle: null,
    locationMarker: null,
    locating: false,
    origin: SEOUL,
    locationKnown: false,
    locationAccuracy: null,
    locationUpdated: null,
    lastUpdated: null,
    hospitals: [],
    markers: [],
    selected: null,
    sources: {},
    controller: null,
    loading: false,
    previousFocus: null,
    inflight: null,
    clusterItems: [],
    hasFitted: false
};

const byId = id => document.getElementById(id);

/* 공통 값 처리 */

function isMissing(value) {
    return value == null ||
        /^(?:\s*|null|undefined|none|n\/?a|nan|[-−–—]+)$/i.test(
            String(value).trim()
        );
}

function displayValue(value) {
    return isMissing(value) ? '미정보' : String(value).trim();
}

function firstReported(...values) {
    return values.find(value => !isMissing(value));
}

function fieldLabel(key) {
    const label = API_FIELD_LABELS[key.toLowerCase()];

    if (label) {
        return `${key}(${label})`;
    }

    if (/^hvs?\d+$/i.test(key)) {
        return `${key}(설명 미정보)`;
    }

    return key;
}

function availability(raw, yes = '가능', no = '불가') {
    const value = isMissing(raw)
        ? ''
        : String(raw).trim().toUpperCase();

    if (value === 'Y') {
        return { text: yes, className: 'yes' };
    }

    if (value === 'N') {
        return { text: no, className: 'no' };
    }

    return { text: '미정보', className: 'unknown' };
}

function integerValue(raw) {
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

function node(tag, className, content) {
    const item = document.createElement(tag);

    if (className) {
        item.className = className;
    }

    if (content !== undefined) {
        item.textContent = String(content);
    }

    return item;
}

function setStatus(message) {
    byId('status').textContent = message;
    byId('status').hidden = !message;
}

function empty(container, message) {
    container.replaceChildren(node('p', 'empty-state', message));
}

/* 상단 정보 */

function updateSummary() {
    const time = byId('updated-time');

    time.textContent = state.lastUpdated
        ? state.lastUpdated.toLocaleTimeString('ko-KR', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
        : '확인 중';

    if (state.lastUpdated) {
        time.dateTime = state.lastUpdated.toISOString();
    }

    byId('institution-count').textContent = state.lastUpdated
        ? `${state.hospitals.length.toLocaleString('ko-KR')}개 기관`
        : '기관 목록 확인 중';
}

/* 독립 반경 설정 */

function updateRadiusUI() {
    const value = byId('radius').value;
    const label = value === 'all' ? '전국' : `${value} km`;

    byId('radius-value').textContent = label;

    byId('radius-button').setAttribute(
        'aria-label',
        `탐색 반경 설정, 현재 ${label}`
    );

    byId('radius-button').title = `탐색 반경: ${label}`;

    byId('radius-help').textContent = value === 'all'
        ? '전국 기관을 표시합니다. 선택하면 바로 적용됩니다.'
        : `${state.locationKnown ? '내 위치' : '서울시청'} 기준 · 선택하면 바로 적용됩니다.`;
}

function closeRadius(restoreFocus = false) {
    byId('radius-popover').hidden = true;
    byId('radius-button').setAttribute('aria-expanded', 'false');

    if (restoreFocus) {
        byId('radius-button').focus();
    }
}

function initRadius() {
    const button = byId('radius-button');
    const panel = byId('radius-popover');

    button.addEventListener('click', () => {
        if (!panel.hidden) {
            closeRadius(true);
            return;
        }

        byId('search-results').hidden = true;
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        byId('radius').focus();
    });

    byId('radius-close').addEventListener(
        'click',
        () => closeRadius(true)
    );

    byId('radius').addEventListener('change', () => {
        updateRadiusUI();
        fitRadius();
        updateMarkers();
    });

    document.addEventListener('pointerdown', event => {
        if (!panel.hidden && !event.target.closest('.radius-tool')) {
            closeRadius();
        }

        if (!event.target.closest('#search-panel')) {
            byId('search-results').hidden = true;
        }
    });

    document.addEventListener('focusin', event => {
        if (!panel.hidden && !event.target.closest('.radius-tool')) {
            closeRadius();
        }
    });

    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeRadius(true);
        }
    });

    updateRadiusUI();
}

/* API 통신 */

function fieldMap(item) {
    const fields = {};

    for (const child of item.children) {
        fields[child.localName.toLowerCase()] = child.textContent.trim();
    }

    return fields;
}

function readXml(xmlText) {
    const xml = new DOMParser().parseFromString(
        xmlText,
        'application/xml'
    );

    if (xml.querySelector('parsererror')) {
        throw new Error('XML 해석 실패');
    }

    const code = xml.querySelector('resultCode')?.textContent?.trim();

    if (code !== '00') {
        const message = xml
            .querySelector('resultMsg')
            ?.textContent
            ?.trim();

        throw new Error(message || `API 결과 코드: ${code || '없음'}`);
    }

    return xml;
}

async function requestPage(endpoint, pageNo, signal) {
    const url = new URL(`${API_ROOT}/${endpoint}`);

    url.searchParams.set('serviceKey', API_KEY);
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set('numOfRows', String(PAGE_SIZE));

    const controller = new AbortController();
    const abort = () => controller.abort();

    signal?.addEventListener('abort', abort, { once: true });

    if (signal?.aborted) {
        abort();
    }

    const timeout = window.setTimeout(abort, 15000);

    try {
        const response = await fetch(url.toString(), {
            signal: controller.signal,
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return readXml(await response.text());
    } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) {
            throw new Error('API 응답 시간이 초과되었습니다.');
        }

        throw error;
    } finally {
        window.clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}

async function requestAll(endpoint, signal) {
    const result = [];
    let page = 1;

    while (page <= 100) {
        const xml = await requestPage(endpoint, page, signal);
        const items = [...xml.getElementsByTagName('item')].map(fieldMap);

        const total = Number(
            xml.querySelector('totalCount')?.textContent || 0
        );

        const rows = Number(
            xml.querySelector('numOfRows')?.textContent || PAGE_SIZE
        );

        if (!items.length && total > result.length) {
            throw new Error('일부 페이지의 결과가 비어 있습니다.');
        }

        result.push(...items);

        if (result.length >= total || items.length === 0) {
            break;
        }

        if (!Number.isFinite(rows) || rows < 1) {
            throw new Error('페이지 크기가 유효하지 않습니다.');
        }

        page += 1;
    }

    if (page > 100) {
        throw new Error('페이지 제한을 초과했습니다.');
    }

    return result;
}

function groupById(rows, multiple = false) {
    const grouped = new Map();

    for (const row of rows) {
        if (!row.hpid) {
            continue;
        }

        if (!multiple) {
            grouped.set(row.hpid, row);
        } else {
            if (!grouped.has(row.hpid)) {
                grouped.set(row.hpid, []);
            }

            grouped.get(row.hpid).push(row);
        }
    }

    return grouped;
}

/* 기관 분류 */

function normalizeName(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\s·()（）-]/g, '')
        .toLowerCase();
}

function classify(fields) {
    const name = normalizeName(fields.dutyname);
    const address = fields.dutyaddr || '';

    const explicitlyDesignated =
        (fields.dutydivnam || '').includes('상급종합');

    const inOfficialList = TERTIARY_2024_2026.some(
        ([region, aliases]) =>
            REGION_PREFIX[region].test(address) &&
            aliases.some(alias => name.includes(normalizeName(alias)))
    );

    if (explicitlyDesignated || inOfficialList) {
        return {
            group: 'tertiary',
            label: '상급종합병원'
        };
    }

    if (name.includes('의료원')) {
        return {
            group: 'medical',
            label: '의료원'
        };
    }

    return {
        group: 'other',
        label: '일반·기타 응급의료기관'
    };
}

function isRegional(fields) {
    return /권역응급의료센터/.test(fields.dutyemclsname || '');
}

/* 데이터 갱신 */

function loadData() {
    if (state.inflight) {
        return state.inflight;
    }

    state.inflight = fetchData().finally(() => {
        state.inflight = null;
    });

    return state.inflight;
}

async function fetchData() {
    state.loading = true;

    byId('refresh-button').disabled = true;
    document.body.classList.add('is-loading');
    byId('developer-spinner').hidden = false;
    byId('developer-status').textContent = '실시간 정보 새로 수신 중...';

    state.controller?.abort();
    state.controller = new AbortController();

    setStatus('기관·병상·공지·중증질환 정보를 확인하고 있습니다…');

    const endpoints = {
        list: 'getEgytListInfoInqire',
        location: 'getEgytLcinfoInqire',
        basic: 'getEgytBassInfoInqire',
        beds: 'getEmrrmRltmUsefulSckbdInfoInqire',
        messages: 'getEmrrmSrsillDissMsgInqire',
        severe: 'getSrsillDissAceptncPosblInfoInqire',
        traumaList: 'getStrmListInfoInqire',
        traumaLocation: 'getStrmLcinfoInqire',
        traumaBasic: 'getStrmBassInfoInqire'
    };

    try {
        const keys = Object.keys(endpoints);

        const results = await Promise.allSettled(
            keys.map(key =>
                requestAll(endpoints[key], state.controller.signal)
            )
        );

        const datasets = {};
        const sources = {};

        keys.forEach((key, index) => {
            const result = results[index];

            if (result.status === 'fulfilled') {
                datasets[key] = result.value;
                sources[key] = true;
            } else {
                datasets[key] = [];
                sources[key] = false;
                console.error(`${key} 조회 실패:`, result.reason);
            }
        });

        if (!sources.list) {
            throw new Error('기관 목록을 가져오지 못했습니다.');
        }

        state.sources = sources;

        const beds = groupById(datasets.beds);
        const messages = groupById(datasets.messages, true);
        const severe = groupById(datasets.severe);
        const locations = groupById(datasets.location);
        const basics = groupById(datasets.basic);
        const traumaLocations = groupById(datasets.traumaLocation);
        const traumaBasics = groupById(datasets.traumaBasic);
        const traumaLists = groupById(datasets.traumaList);
        const unique = groupById(datasets.list);

        for (const [id, trauma] of traumaLists) {
            if (!unique.has(id)) {
                unique.set(id, trauma);
            }
        }

        state.hospitals = [...unique.values()]
            .map(fields => {
                const id = fields.hpid;

                const location =
                    locations.get(id) ||
                    traumaLocations.get(id) ||
                    {};

                const basic = basics.get(id) || {};

                const trauma =
                    traumaBasics.get(id) ||
                    traumaLists.get(id) ||
                    null;

                const lat = Number(
                    firstReported(fields.wgs84lat, location.wgs84lat)
                );

                const lng = Number(
                    firstReported(fields.wgs84lon, location.wgs84lon)
                );

                return {
                    id,
                    name: displayValue(
                        firstReported(fields.dutyname, basic.dutyname)
                    ),
                    address: displayValue(
                        firstReported(fields.dutyaddr, basic.dutyaddr)
                    ),
                    tel: displayValue(
                        firstReported(fields.dutytel1, basic.dutytel1)
                    ),
                    erTel: displayValue(
                        firstReported(fields.dutytel3, beds.get(id)?.dutytel3)
                    ),
                    lat,
                    lng,
                    regional: isRegional({
                        ...basic,
                        ...fields
                    }),
                    type: classify({
                        ...basic,
                        ...fields,
                        dutyname: fields.dutyname || basic.dutyname,
                        dutyaddr: fields.dutyaddr || basic.dutyaddr
                    }),
                    basic,
                    trauma,
                    beds: beds.get(id) || null,
                    messages: messages.get(id) || [],
                    severe: severe.get(id) || null
                };
            })
            .filter(hospital =>
                Number.isFinite(hospital.lat) &&
                Number.isFinite(hospital.lng) &&
                hospital.lat >= 33 &&
                hospital.lat <= 39 &&
                hospital.lng >= 124 &&
                hospital.lng <= 132
            );

        state.lastUpdated = new Date();

        if (!state.hasFitted) {
            fitRadius();
            state.hasFitted = true;
        }

        updateMarkers();

        if (state.selected) {
            const fresh = state.hospitals.find(
                item => item.id === state.selected.id
            );

            if (fresh) {
                openHospital(fresh, false);
            } else {
                closeSheet();
            }
        }

        updateSearch();

        const missing = keys.filter(key => !state.sources[key]);

        byId('developer-status').textContent = missing.length
            ? `조회 완료 · 일부 항목 실패: ${missing.join(', ')}`
            : '전체 데이터 갱신을 완료했습니다.';

        updateSummary();

        setStatus(
            missing.length
                ? '일부 정보를 불러오지 못했습니다. 상세 정보에서 확인해 주세요.'
                : ''
        );
    } catch (error) {
        console.error('응급의료 데이터 갱신 실패:', error);

        setStatus(
            `조회 실패: ${error.message} · ` +
            '이전 정보가 있다면 재확인하세요.'
        );

        byId('developer-status').textContent =
            `갱신 실패: ${error.message}`;
    } finally {
        state.loading = false;
        byId('refresh-button').disabled = false;
        document.body.classList.remove('is-loading');
        byId('developer-spinner').hidden = true;
    }
}

/* 거리와 위치 */

function distanceKm(a, b) {
    const radians = degrees => degrees * Math.PI / 180;
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);

    const arc =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(radians(a.lat)) *
        Math.cos(radians(b.lat)) *
        Math.sin(dLng / 2) ** 2;

    return 6371 * 2 * Math.atan2(
        Math.sqrt(arc),
        Math.sqrt(1 - arc)
    );
}

function formatDms(value, positive, negative) {
    const tenths = Math.round(Math.abs(value) * 36000);
    const degrees = Math.floor(tenths / 36000);
    const minutes = Math.floor((tenths % 36000) / 600);
    const seconds = (tenths % 600) / 10;
    const direction = value >= 0 ? positive : negative;

    return `${direction} ${degrees}° ${minutes}′ ${seconds.toFixed(1)}″`;
}

function updateCoordinates() {
    updateRadiusUI();

    const target = byId('coordinates');
    target.replaceChildren();

    if (!state.locationKnown) {
        target.append(
            node('span', '', '내 위치 미확인'),
            node('small', '', '지도 기준점: 서울시청')
        );
        return;
    }

    target.append(
        node('span', '', formatDms(state.origin.lat, '북위', '남위')),
        node('span', '', formatDms(state.origin.lng, '동경', '서경'))
    );

    if (Number.isFinite(state.locationAccuracy)) {
        target.append(
            node(
                'small',
                '',
                `오차 반경 약 ${Math.round(state.locationAccuracy)}m`
            )
        );
    }

    if (state.locationUpdated) {
        const measured = state.locationUpdated.toLocaleTimeString(
            'ko-KR',
            {
                timeZone: 'Asia/Seoul',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }
        );

        target.append(node('small', '', `측정 ${measured}`));
    }
}

function updateCircle() {
    if (!state.map) {
        return;
    }

    state.circle?.setMap(null);
    const radius = byId('radius').value;

    if (radius === 'all') {
        return;
    }

    state.circle = new kakao.maps.Circle({
        center: new kakao.maps.LatLng(
            state.origin.lat,
            state.origin.lng
        ),
        radius: Number(radius) * 1000,
        strokeWeight: 2,
        strokeColor: '#2873df',
        strokeOpacity: 0.65,
        fillColor: '#5e9cf0',
        fillOpacity: 0.07
    });

    state.circle.setMap(state.map);
}

function updateLocationMarker() {
    state.locationMarker?.setMap(null);
    state.locationMarker = null;

    if (!state.map || !state.locationKnown) {
        return;
    }

    const marker = node('div', 'location-marker');
    marker.setAttribute('role', 'img');
    marker.setAttribute('aria-label', '내 현재 위치');
    marker.append(node('span', 'location-dot'));

    state.locationMarker = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(
            state.origin.lat,
            state.origin.lng
        ),
        content: marker,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 1000
    });

    state.locationMarker.setMap(state.map);
}

function locate() {
    if (state.locating || !state.map) {
        return;
    }

    if (!navigator.geolocation) {
        setStatus('이 브라우저에서 위치 기능을 사용할 수 없습니다.');
        return;
    }

    state.locating = true;
    byId('location-button').disabled = true;

    const finish = () => {
        state.locating = false;
        byId('location-button').disabled = false;
    };

    navigator.geolocation.getCurrentPosition(
        position => {
            state.origin = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };

            state.locationKnown = true;
            state.locationAccuracy = position.coords.accuracy;
            state.locationUpdated = new Date(
                position.timestamp || Date.now()
            );

            updateCoordinates();
            updateLocationMarker();
            fitRadius();

            if (byId('radius').value === 'all') {
                state.map.panTo(
                    new kakao.maps.LatLng(
                        state.origin.lat,
                        state.origin.lng
                    )
                );
            }

            updateMarkers();
            finish();
        },
        error => {
            const reason = error.code === 1
                ? '위치 권한이 허용되지 않았습니다.'
                : '현재 위치를 확인하지 못했습니다.';

            updateCoordinates();

            setStatus(
                reason +
                (
                    state.locationKnown
                        ? ' 마지막 측정 위치를 표시합니다.'
                        : ' 서울시청을 기준으로 표시합니다.'
                )
            );

            finish();
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

/* 병원 지도 카드 */

function visualGroup(hospital) {
    return hospital.regional ? 'regional' : hospital.type.group;
}

function hospitalLabel(hospital) {
    return hospital.regional
        ? `권역응급의료센터 · ${hospital.type.label}`
        : hospital.type.label;
}

function matchesFilters(hospital, enabled) {
    return Boolean(
        enabled[hospital.type.group] ||
        (hospital.regional && enabled.regional)
    );
}

function groupCards(points) {
    const groups = [];

    for (const point of points) {
        const near = groups.find(group =>
            Math.abs(group.x - point.x) < CARD_WIDTH + 10 &&
            Math.abs(group.y - point.y) < CARD_HEIGHT + 14
        );

        if (near) {
            near.items.push(point.hospital);
        } else {
            groups.push({
                ...point,
                items: [point.hospital]
            });
        }
    }

    return groups;
}

function bindHospitalCard(card, open) {
    let moved = false;
    let tracker = null;

    card.draggable = false;

    card.addEventListener('pointerdown', event => {
        if (event.button !== 0) {
            return;
        }

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

            const distance = Math.hypot(
                next.clientX - startX,
                next.clientY - startY
            );

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

            tracker.abort();
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

        open();
    });
}

function updateMarkers() {
    if (!state.map) {
        return;
    }

    for (const marker of state.markers) {
        marker.setMap(null);
    }

    state.markers = [];
    updateCircle();

    const radius = byId('radius').value;
    const enabled = {};

    for (const group of ['regional', 'tertiary', 'medical', 'other']) {
        enabled[group] = byId(`filter-${group}`).checked;
    }

    const viewport = state.map.getBounds();
    const projection = state.map.getProjection();

    const rank = {
        regional: 0,
        tertiary: 1,
        medical: 2,
        other: 3
    };

    const candidates = state.hospitals
        .filter(hospital => {
            if (!matchesFilters(hospital, enabled)) {
                return false;
            }

            if (
                radius !== 'all' &&
                distanceKm(state.origin, hospital) > Number(radius)
            ) {
                return false;
            }

            return viewport.contain(
                new kakao.maps.LatLng(hospital.lat, hospital.lng)
            );
        })
        .sort((a, b) =>
            rank[visualGroup(a)] - rank[visualGroup(b)] ||
            distanceKm(state.origin, a) - distanceKm(state.origin, b)
        );

    const points = candidates.map(hospital => {
        const point = projection.containerPointFromCoords(
            new kakao.maps.LatLng(hospital.lat, hospital.lng)
        );

        return {
            x: point.x,
            y: point.y,
            hospital
        };
    });

    const groups = groupCards(points);

    for (const group of groups) {
        const hospital = group.items[0];
        const multiple = group.items.length > 1;

        const card = node(
            'button',
            `hospital-card ${visualGroup(hospital)}`
        );

        card.type = 'button';

        card.title = multiple
            ? group.items.map(item => item.name).join(' · ')
            : `${hospital.name} · ${hospitalLabel(hospital)}`;

        card.setAttribute(
            'aria-label',
            multiple
                ? `주변 ${group.items.length}개 병원 목록 열기`
                : `${hospital.name} 상세 정보 열기`
        );

        const shortType = hospital.regional
            ? '권역응급'
            : hospital.type.label;

        card.append(
            node(
                'strong',
                '',
                multiple
                    ? `주변 ${group.items.length}개 병원`
                    : hospital.name
            ),
            node(
                'small',
                '',
                multiple
                    ? '목록에서 병원 선택 ›'
                    : `${shortType} · 응급실 ${bedValue(hospital.beds?.hvec)}`
            )
        );

        bindHospitalCard(card, () => {
            if (multiple) {
                openCluster(group.items);
            } else {
                openHospital(hospital);
            }
        });

        const overlay = new kakao.maps.CustomOverlay({
            map: state.map,
            position: new kakao.maps.LatLng(
                hospital.lat,
                hospital.lng
            ),
            content: card,
            xAnchor: 0.5,
            yAnchor: 1,
            clickable: false,
            zIndex: 5
        });

        state.markers.push(overlay);
    }

    byId('map-count').textContent =
        `현재 화면 ${candidates.length}개 기관 · ` +
        '겹치는 카드는 묶어서 표시';
}

function openCluster(items) {
    state.clusterItems = items;

    byId('cluster-title').textContent =
        `주변 ${items.length}개 병원`;

    const list = byId('cluster-list');
    list.replaceChildren();

    for (const hospital of items) {
        const button = node(
            'button',
            `cluster-item ${visualGroup(hospital)}`
        );

        button.type = 'button';

        button.append(
            node('strong', '', hospital.name),
            node('small', '', hospitalLabel(hospital)),
            node('small', '', `응급실 ${bedValue(hospital.beds?.hvec)}`)
        );

        button.addEventListener('click', () => {
            byId('cluster-dialog').close();
            openHospital(hospital);
        });

        list.append(button);
    }

    byId('cluster-dialog').showModal();
}

/* 검색 */

function updateSearch() {
    closeRadius();

    const list = byId('search-results');
    const query = byId('keyword')
        .value
        .replace(/\s+/g, '')
        .toLowerCase();

    list.replaceChildren();

    list.hidden =
        !query ||
        byId('search-content').hidden ||
        state.selected !== null;

    if (!query) {
        return;
    }

    const matches = state.hospitals
        .filter(item =>
            item.name
                .replace(/\s+/g, '')
                .toLowerCase()
                .includes(query)
        )
        .slice(0, 25);

    if (!matches.length) {
        list.append(
            node('li', 'empty-state', '일치하는 기관이 없습니다.')
        );
    }

    for (const hospital of matches) {
        const li = node('li');
        const button = node('button', 'result-button');

        button.type = 'button';

        button.append(
            node('strong', '', hospital.name),
            node('small', '', hospital.type.label)
        );

        button.addEventListener('click', () => {
            byId('keyword').value = hospital.name;
            list.hidden = true;

            state.map.panTo(
                new kakao.maps.LatLng(hospital.lat, hospital.lng)
            );

            state.map.setLevel(4);
            openHospital(hospital);
        });

        li.append(button);
        list.append(li);
    }
}

/* API 시각 */

function parseApiDate(value) {
    if (!/^\d{14}$/.test(value || '')) {
        return null;
    }

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(8, 10));
    const minute = Number(value.slice(10, 12));
    const second = Number(value.slice(12, 14));

    const date = new Date(
        Date.UTC(year, month - 1, day, hour - 9, minute, second)
    );

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

/* 진료 공지 */

function renderMessages(hospital) {
    const target = byId('messages');
    target.replaceChildren();

    if (!state.sources.messages) {
        empty(
            target,
            '미정보 · 공지 조회에 실패했습니다. 병원에 확인하세요.'
        );
        byId('message-count').textContent = '';
        return;
    }

    const now = Date.now();

    const messages = hospital.messages
        .filter(item => {
            const start = parseApiDate(item.symblksttdtm);
            const end = parseApiDate(item.symblkenddtm);

            return (
                (!start || start.timestamp <= now) &&
                (!end || end.timestamp > now)
            );
        })
        .sort((a, b) => {
            const priority = item =>
                item.symblkmsgtyp === '중증' ? 0 : 1;

            return priority(a) - priority(b);
        });

    byId('message-count').textContent = `${messages.length}건`;

    if (!messages.length) {
        empty(target, '현재 표시할 공지가 없습니다.');
        return;
    }

    for (const item of messages) {
        const level = item.symblkmsgtyp === '중증'
            ? 'critical'
            : item.symblkmsgtyp === '응급'
                ? 'urgent'
                : 'unknown';

        const article = node('article', `message-card ${level}`);
        const heading = node('div', 'message-heading');

        const badge = node(
            'span',
            'message-badge',
            displayValue(item.symblkmsgtyp)
        );

        const subject = displayValue(
            firstReported(item.trtprtcodmag, item.symtypcodmag)
        );

        heading.append(badge, node('strong', '', subject));

        article.append(
            heading,
            node('p', 'message-text', displayValue(item.symblkmsg))
        );

        const end = parseApiDate(item.symblkenddtm);

        if (end) {
            article.append(
                node('small', 'muted', `종료 예정 ${end.display}`)
            );
        }

        target.append(article);
    }
}

/* 중증질환 */

function renderSevere(hospital) {
    const target = byId('severe');
    target.replaceChildren();

    byId('severe-time').textContent = '보고 시각 미정보';

    if (!state.sources.severe) {
        empty(target, '미정보 · 중증질환 정보 조회에 실패했습니다.');
        return;
    }

    const fields = hospital.severe || {};

    const keys = [
        ...new Set([
            ...DISEASES.map((_, i) => `mkioskty${i + 1}`),
            ...Object.keys(fields).filter(key => /^mkioskty\d+$/.test(key))
        ])
    ].sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));

    for (const key of keys) {
        const status = availability(
            fields[key],
            '수용 가능',
            '수용 불가'
        );

        const row = node('div', 'severe-row');

        const title = node(
            'div',
            'severe-name',
            DISEASES[Number(key.slice(8)) - 1] || '항목 설명 미정보'
        );

        title.append(node('small', 'field-code', key));

        if (`${key}msg` in fields) {
            title.append(
                node(
                    'small',
                    'severe-note',
                    `참고: ${displayValue(fields[`${key}msg`])}`
                )
            );
        }

        if (status.className === 'unknown' && !isMissing(fields[key])) {
            title.append(
                node(
                    'small',
                    'severe-note',
                    `API 원본값: ${displayValue(fields[key])}`
                )
            );
        }

        row.append(
            title,
            node('span', `state-pill ${status.className}`, status.text)
        );

        target.append(row);
    }

    const reported = parseApiDate(
        firstReported(fields.hvidate, fields.mkioskdate)
    );

    if (reported) {
        byId('severe-time').textContent = `보고 ${reported.display}`;
    }
}

/* 지도 카드의 병상 원본값 */

function bedValue(raw) {
    if (isMissing(raw)) {
        return '미정보';
    }

    const text = String(raw).trim();

    if (!/^-?\d+$/.test(text)) {
        return '미정보';
    }

    const value = Number(text);

    if (!Number.isSafeInteger(value)) {
        return '미정보';
    }

    return value < 0
        ? `${value}석 (API 원본값)`
        : `${value}석`;
}

/* 상세창 병상 표시 */

function bedPresentation(fields, definition) {
    const [currentKey, baselineKey, label, kind] = definition;
    const raw = fields[currentKey];
    const current = integerValue(raw);
    const reference = integerValue(fields[baselineKey]);

    const baseline =
        reference !== null && reference >= 0
            ? reference
            : null;

    const result = {
        label,
        currentKey,
        baselineKey,
        currentText: '미정보',
        baselineText: baseline === null ? '미정보' : String(baseline),
        tone: 'unknown',
        ringText: '미정보',
        fraction: null,
        note: '가용 / 기준'
    };

    if (current !== null) {
        if (current < 0) {
            result.currentText = `초과 ${Math.abs(current)}`;
            result.tone = 'over';
            result.ringText = '초과';
            result.note = `초과 수용 · 원본 ${current}`;
            return result;
        }

        result.currentText = String(current);
        result.tone = 'number';
        result.ringText = '가용';

        if (
            baseline !== null &&
            baseline > 0 &&
            current <= baseline
        ) {
            result.fraction = current / baseline;
            result.ringText = `${Math.round(result.fraction * 100)}%`;
        } else if (baseline !== null && current > baseline) {
            result.note = '가용 수가 기준 수 초과 · 비율 미산정';
        } else if (baseline === 0) {
            result.note = '기준 수 0 · 비율 미산정';
        }

        return result;
    }

    if (kind === 'mixed') {
        const status = availability(raw);

        if (status.className !== 'unknown') {
            result.currentText = status.text;
            result.ringText = status.text;
            result.tone = status.className;
            result.note = '가능 여부 / 기준';
        }
    }

    return result;
}

function createBedCard(fields, definition) {
    const item = bedPresentation(fields, definition);
    const card = node('article', `bed-card tone-${item.tone}`);
    const ring = node('div', 'bed-ring', item.ringText);
    const info = node('div', 'bed-info');
    const values = node('p', 'bed-values');

    ring.setAttribute('aria-hidden', 'true');

    if (item.fraction !== null) {
        ring.classList.add('has-ratio');
        ring.style.setProperty('--ratio', String(item.fraction));
    }

    values.append(
        node('strong', '', item.currentText),
        node('span', 'bed-divider', '/'),
        node('span', 'bed-reference', item.baselineText)
    );

    info.append(
        node('h3', '', item.label),
        values,
        node('p', 'bed-caption', item.note)
    );

    const codes = item.baselineKey
        ? `${item.currentKey} / ${item.baselineKey}`
        : `${item.currentKey} / 기준 항목 미정보`;

    card.title = codes;

    card.setAttribute(
        'aria-label',
        `${item.label}: ${item.note}, ` +
        `${item.currentText} / ${item.baselineText}`
    );

    card.append(
        ring,
        info,
        node('small', 'bed-codes', codes)
    );

    return card;
}

function renderBeds(hospital) {
    const main = byId('key-beds');
    const additional = byId('additional-beds');

    main.replaceChildren();
    additional.replaceChildren();
    byId('bed-time').textContent = '보고 시각 미정보';

    renderRawBeds(hospital);

    if (!state.sources.beds) {
        empty(main, '미정보 · 병상 정보 조회에 실패했습니다.');
        empty(additional, '미정보 · 병상 정보 조회에 실패했습니다.');
        return;
    }

    const fields = hospital.beds || {};

    BED_GROUPS.forEach((group, index) => {
        const grid = index === 0
            ? main
            : node('div', 'bed-dashboard');

        for (const definition of group.items) {
            grid.append(createBedCard(fields, definition));
        }

        if (index > 0) {
            const section = node('section', 'bed-group');

            section.append(
                node('h3', 'bed-group-title', group.title),
                grid
            );

            additional.append(section);
        }
    });

    const reported = parseApiDate(fields.hvidate);

    if (reported) {
        byId('bed-time').textContent = `보고 ${reported.display}`;
    }
}

/* 병상 원본값 */

function renderRawBeds(hospital) {
    const all = byId('all-beds');
    all.replaceChildren();

    if (!state.sources.beds) {
        empty(all, '미정보 · 세부 항목을 표시할 수 없습니다.');
        return;
    }

    const fields = hospital.beds;

    if (!fields) {
        empty(all, '미정보 · 세부 항목이 없습니다.');
        return;
    }

    const groups = [
        {
            title: '실시간 세부 항목 · hv (원본값)',
            keys: [
                ...new Set([
                    ...Object.keys(HV_LABELS),
                    ...Object.keys(fields).filter(key => /^hv\d+$/.test(key))
                ])
            ]
        },
        {
            title: '병상·장비 기준 항목 · hvs (원본값)',
            keys: [
                ...new Set([
                    ...Object.keys(HVS_LABELS),
                    ...Object.keys(fields).filter(key => /^hvs\d+$/.test(key))
                ])
            ]
        },
        {
            title: '그 밖의 병상 관련 항목 (원본값)',
            keys: ['hvcc', 'hvccc', 'hvdnm']
        }
    ];

    for (const group of groups) {
        if (!group.keys.length) {
            continue;
        }

        const section = node('section', 'raw-group');
        section.append(node('h3', '', group.title));

        const list = node('dl', 'raw-grid');

        group.keys.sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true })
        );

        for (const key of group.keys) {
            const pair = node('div', 'raw-pair');

            pair.append(
                node('dt', 'field-code', fieldLabel(key)),
                node('dd', '', displayValue(fields[key]))
            );

            list.append(pair);
        }

        section.append(list);
        all.append(section);
    }

    if (!all.childElementCount) {
        empty(all, '미정보 · 세부 항목이 없습니다.');
    }
}

/* 장비 */

function renderEquipment(hospital) {
    const target = byId('equipment');
    target.replaceChildren();

    if (!state.sources.beds) {
        empty(target, '미정보 · 장비 정보 조회에 실패했습니다.');
        return;
    }

    const fields = hospital.beds || {};

    const keys = [
        ...new Set([
            ...Object.keys(EQUIPMENT),
            ...Object.keys(fields).filter(key => /^hv[a-z]+ayn$/.test(key))
        ])
    ].sort();

    for (const key of keys) {
        const item = node('div', 'equipment-item');

        const name = node(
            'span',
            '',
            EQUIPMENT[key] || '항목 설명 미정보'
        );

        name.append(node('small', 'field-code', key));

        const status = availability(fields[key]);
        const baselineKey = EQUIPMENT_BASELINES[key];

        if (baselineKey) {
            const baseline = integerValue(fields[baselineKey]);

            const count = baseline !== null && baseline >= 0
                ? String(baseline)
                : '미정보';

            name.append(
                node('small', 'equipment-reference', `기준 수 ${count}`)
            );
        }

        if (status.className === 'unknown' && !isMissing(fields[key])) {
            name.append(
                node(
                    'small',
                    'field-code',
                    `API 원본값: ${displayValue(fields[key])}`
                )
            );
        }

        item.append(
            name,
            node('strong', `${status.className}-text`, status.text)
        );

        target.append(item);
    }
}

/* 기본정보 */

function renderBasic(hospital) {
    const target = byId('basic-info');
    target.replaceChildren();

    const blocks = [
        ['응급의료기관 기본정보', hospital.basic, state.sources.basic],
        ['외상센터 기본정보', hospital.trauma, state.sources.traumaBasic]
    ];

    for (const [heading, fields, loaded] of blocks) {
        const section = node('details', 'raw-details');
        section.append(node('summary', '', heading));

        if (!loaded) {
            section.append(
                node('p', 'empty-state', '미정보 · 조회에 실패했습니다.')
            );
        } else if (!fields || !Object.keys(fields).length) {
            section.append(
                node('p', 'empty-state', '미정보 · 보고된 정보가 없습니다.')
            );
        } else {
            const list = node('dl', 'raw-grid');

            for (const [key, value] of Object.entries(fields)) {
                if (['hpid', 'rnum', 'phpid'].includes(key)) {
                    continue;
                }

                const pair = node('div', 'raw-pair');

                pair.append(
                    node('dt', 'field-code', fieldLabel(key)),
                    node('dd', '', displayValue(value))
                );

                list.append(pair);
            }

            section.append(list);
        }

        target.append(section);
    }
}

/* 전화와 외부 지도 */

function contactLink(text, href, className) {
    const link = node('a', className, text);
    link.href = href;
    return link;
}

function isAppleTouchDevice() {
    const userAgent = navigator.userAgent || '';

    return (
        /iPad|iPhone|iPod/.test(userAgent) ||
        (
            /Macintosh/.test(userAgent) &&
            navigator.maxTouchPoints > 1
        )
    );
}

function openMobileApp(scheme, androidPackage, fallback) {
    if (/Android/i.test(navigator.userAgent)) {
        const intent = scheme.replace(/^[a-z]+:\/\//, 'intent://');
        const protocol = scheme.split(':')[0];

        window.location.href =
            `${intent}#Intent;scheme=${protocol};` +
            'action=android.intent.action.VIEW;' +
            `package=${androidPackage};` +
            `S.browser_fallback_url=${encodeURIComponent(fallback)};end`;

        return;
    }

    if (!isAppleTouchDevice()) {
        window.open(fallback, '_blank', 'noopener,noreferrer');
        return;
    }

    const started = Date.now();
    let timer;

    const cleanup = () => {
        window.clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', cleanup);
    };

    const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
            cleanup();
        }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', cleanup);

    timer = window.setTimeout(() => {
        cleanup();

        if (
            document.visibilityState === 'visible' &&
            Date.now() - started < 3000
        ) {
            window.location.href = fallback;
        }
    }, 1800);

    window.location.href = scheme;
}

function navigationLink(provider, hospital) {
    const name = encodeURIComponent(hospital.name);
    const lat = hospital.lat;
    const lng = hospital.lng;

    const mobile =
        /Android/i.test(navigator.userAgent) ||
        isAppleTouchDevice();

    if (provider === 'kakao') {
        const start = state.locationKnown
            ? `sp=${state.origin.lat},${state.origin.lng}&`
            : '';

        return {
            scheme: `kakaomap://route?${start}ep=${lat},${lng}&by=car`,
            package: 'net.daum.android.map',
            fallback: `https://map.kakao.com/link/to/${name},${lat},${lng}`
        };
    }

    if (provider === 'naver') {
        const appname = encodeURIComponent(window.location.origin);
        let fallback;

        if (mobile) {
            fallback = isAppleTouchDevice()
                ? 'https://apps.apple.com/kr/app/id311867728'
                : 'https://play.google.com/store/apps/details?id=com.nhn.android.nmap';
        } else {
            fallback =
                'https://map.naver.com/p/directions/-/' +
                `${lng},${lat},${name},,/-/car` +
                '?c=15.00,0,0,0,dh';
        }

        return {
            scheme:
                `nmap://navigation?dlat=${lat}` +
                `&dlng=${lng}&dname=${name}` +
                `&appname=${appname}`,
            package: 'com.nhn.android.nmap',
            fallback
        };
    }

    return {
        scheme: isAppleTouchDevice()
            ? `tmap://route?rGoName=${name}&rGoX=${lng}&rGoY=${lat}`
            : `tmap://route?goalname=${name}&goalx=${lng}&goaly=${lat}`,
        package: 'com.skt.tmap.ku',
        fallback: isAppleTouchDevice()
            ? 'https://apps.apple.com/kr/app/id431589174'
            : 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku'
    };
}

function launchNavigation(provider, hospital) {
    const link = navigationLink(provider, hospital);
    openMobileApp(link.scheme, link.package, link.fallback);
}

function renderContacts(hospital) {
    const target = byId('contact-actions');
    const phones = node('div', 'phone-actions');
    const maps = node('div', 'navigation-actions');

    phones.setAttribute('aria-label', '병원 전화');
    maps.setAttribute('aria-label', '지도 길찾기');

    for (const [label, raw] of [
        ['응급실', hospital.erTel],
        ['대표전화', hospital.tel]
    ]) {
        const number = isMissing(raw) ? '' : String(raw).trim();

        if (
            /^[0-9+()\s-]+$/.test(number) &&
            /\d/.test(number)
        ) {
            phones.append(
                contactLink(
                    `${label} ${number}`,
                    `tel:${number.replace(/[^\d+]/g, '')}`,
                    'phone-button'
                )
            );
        } else {
            phones.append(
                node('span', 'phone-missing', `${label} 미정보`)
            );
        }
    }

    for (const [provider, label] of [
        ['kakao', '카카오맵'],
        ['naver', '네이버지도'],
        ['tmap', 'T맵']
    ]) {
        const button = node(
            'button',
            `map-button ${provider}`,
            label
        );

        button.type = 'button';

        button.addEventListener('click', () => {
            launchNavigation(provider, hospital);
        });

        maps.append(button);
    }

    target.replaceChildren(phones, maps);
}

/* 상세창 */

function openHospital(hospital, focus = true) {
    closeRadius();
    byId('search-results').hidden = true;

    if (focus) {
        state.previousFocus = document.activeElement;
    }

    if (state.selected?.id !== hospital.id) {
        byId('developer-mode').open = false;
    }

    state.selected = hospital;
    byId('hospital-name').textContent = hospital.name;

    if (state.lastUpdated) {
        const updated = state.lastUpdated.toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        byId('sheet-updated').textContent =
            `마지막 새로고침 · ${updated} KST`;
    } else {
        byId('sheet-updated').textContent =
            '전체 조회 시각을 확인할 수 없습니다.';
    }

    byId('hospital-type').textContent = hospitalLabel(hospital);

    byId('hospital-address').textContent =
        `주소 ${displayValue(hospital.address)}`;

    const distance = distanceKm(state.origin, hospital).toFixed(1);
    const originName = state.locationKnown ? '내 위치' : '서울시청';

    byId('hospital-distance').textContent =
        `${originName}에서 직선거리 ${distance} km`;

    renderContacts(hospital);
    renderMessages(hospital);
    renderSevere(hospital);
    renderBeds(hospital);
    renderEquipment(hospital);
    renderBasic(hospital);

    const failed = Object.entries(state.sources)
        .filter(([, loaded]) => !loaded)
        .map(([name]) => name);

    byId('data-state').textContent = failed.length
        ? `일부 데이터 조회 실패: ${failed.join(', ')}. ` +
        '재조회하거나 병원에 문의하세요.'
        : '공공데이터의 보고 시점과 현장 상황은 다를 수 있습니다.';

    byId('sheet').inert = false;
    setBackgroundInert(true);
    byId('sheet-dim').hidden = false;
    byId('sheet').classList.add('open');
    byId('sheet').setAttribute('aria-hidden', 'false');

    if (focus) {
        byId('sheet').querySelector('.sheet-scroll').scrollTop = 0;
        byId('sheet-close').focus();
    }
}

function setBackgroundInert(value) {
    for (const selector of [
        '#map',
        '#top-panel',
        '.map-actions',
        '#search-panel'
    ]) {
        document.querySelector(selector).inert = value;
    }
}

function closeSheet() {
    byId('sheet').classList.remove('open');
    byId('sheet').style.transform = '';
    byId('sheet').style.transition = '';
    byId('sheet').setAttribute('aria-hidden', 'true');
    byId('sheet-dim').hidden = true;

    state.selected = null;
    byId('sheet').inert = true;
    setBackgroundInert(false);

    const previous = state.previousFocus;

    if (
        previous?.isConnected &&
        !previous.closest('[hidden], dialog:not([open])')
    ) {
        previous.focus();
    } else {
        byId('keyword').focus();
    }
}

function initSheetDrag() {
    const handle = byId('sheet-drag-handle');
    const sheet = byId('sheet');

    let startY = null;
    let delta = 0;

    handle.addEventListener(
        'touchstart',
        event => {
            if (event.touches.length !== 1) {
                return;
            }

            startY = event.touches[0].clientY;
            delta = 0;
            sheet.style.transition = 'none';
        },
        { passive: true }
    );

    handle.addEventListener(
        'touchmove',
        event => {
            if (startY === null || event.touches.length !== 1) {
                return;
            }

            delta = Math.max(0, event.touches[0].clientY - startY);

            if (delta > 0) {
                event.preventDefault();
                sheet.style.transform = `translateY(${delta}px)`;
            }
        },
        { passive: false }
    );

    const finish = () => {
        if (startY === null) {
            return;
        }

        startY = null;
        sheet.style.transition = '';

        if (delta > 90) {
            closeSheet();
        } else {
            sheet.style.transform = '';
        }

        delta = 0;
    };

    handle.addEventListener('touchend', finish, { passive: true });
    handle.addEventListener('touchcancel', finish, { passive: true });
}

/* 지도 범위 */

function fitBounds(bounds) {
    const height = byId('map').clientHeight || window.innerHeight;

    const top = Math.min(
        document.querySelector('.top-panel').offsetHeight + 24,
        height * 0.28
    );

    const bottom = Math.min(
        document.querySelector('.search-panel').offsetHeight + 24,
        height * 0.25
    );

    state.map.setBounds(bounds, top, 32, bottom, 32);
}

function radiusExtent(origin, radiusKm) {
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

function fitRadius() {
    if (!state.map) {
        return;
    }

    const bounds = new kakao.maps.LatLngBounds();

    if (byId('radius').value === 'all') {
        if (!state.hospitals.length) {
            bounds.extend(new kakao.maps.LatLng(33.1, 124.5));
            bounds.extend(new kakao.maps.LatLng(38.7, 131.9));
        }

        for (const hospital of state.hospitals) {
            bounds.extend(
                new kakao.maps.LatLng(hospital.lat, hospital.lng)
            );
        }
    } else {
        const box = radiusExtent(
            state.origin,
            Number(byId('radius').value)
        );

        bounds.extend(new kakao.maps.LatLng(box.south, box.west));
        bounds.extend(new kakao.maps.LatLng(box.north, box.east));
    }

    fitBounds(bounds);
    updateCircle();
}

/* 이용 안내 */

function noticeHidden() {
    try {
        return localStorage.getItem(NOTICE_KEY) === '1';
    } catch {
        return false;
    }
}

function openNotice() {
    byId('notice-skip').textContent = noticeHidden()
        ? '접속할 때 안내 다시 보기'
        : '이 브라우저에서 다시 보지 않기';

    byId('notice-dialog').showModal();
}

function initNotice() {
    const dialog = byId('notice-dialog');

    for (const id of ['notice-close', 'notice-confirm']) {
        byId(id).addEventListener('click', () => {
            dialog.close();
        });
    }

    byId('notice-skip').addEventListener('click', () => {
        try {
            if (noticeHidden()) {
                localStorage.removeItem(NOTICE_KEY);
            } else {
                localStorage.setItem(NOTICE_KEY, '1');
            }
        } catch {
            setStatus(
                '이 브라우저에서는 안내 숨김 설정을 저장할 수 없습니다.'
            );
        }

        dialog.close();
    });

    byId('notice-open').addEventListener('click', openNotice);

    if (!noticeHidden()) {
        openNotice();
    }
}

/* 패널 접기·펼치기 */

function initPanels() {
    const updateHeight = () => {
        const height = byId('search-panel').offsetHeight;

        document.documentElement.style.setProperty(
            '--search-panel-height',
            `${height}px`
        );
    };

    const panels = [
        ['top', '지도 정보'],
        ['search', '검색']
    ];

    for (const [prefix, label] of panels) {
        const button = byId(`${prefix}-toggle`);
        const content = byId(`${prefix}-content`);
        const panel = byId(`${prefix}-panel`);

        button.addEventListener('click', () => {
            const collapsed =
                button.getAttribute('aria-expanded') === 'true';

            content.hidden = collapsed;
            panel.classList.toggle('is-collapsed', collapsed);

            button.setAttribute('aria-expanded', String(!collapsed));

            button.setAttribute(
                'aria-label',
                `${label} ${collapsed ? '펼치기' : '접기'}`
            );

            button.textContent = collapsed ? '펼치기' : '접기';

            if (prefix === 'search') {
                document.body.classList.toggle(
                    'search-collapsed',
                    collapsed
                );

                if (collapsed) {
                    byId('search-results').hidden = true;
                } else {
                    updateSearch();
                }
            }

            updateHeight();
        });
    }

    if ('ResizeObserver' in window) {
        new ResizeObserver(updateHeight).observe(byId('search-panel'));
    }

    window.addEventListener('resize', updateHeight);
    updateHeight();
}

/* 시작 */

function init() {
    initPanels();
    initRadius();
    updateSummary();

    if (
        navigator.maxTouchPoints > 0 ||
        matchMedia('(pointer: coarse)').matches ||
        isAppleTouchDevice()
    ) {
        document.body.classList.add('touch-device');
    }

    initSheetDrag();
    initNotice();

    byId('developer-mode').addEventListener('toggle', () => {
        if (byId('developer-mode').open && state.selected) {
            loadData();
        }
    });

    byId('cluster-close').addEventListener('click', () => {
        byId('cluster-dialog').close();
    });

    byId('cluster-zoom').addEventListener('click', () => {
        const bounds = new kakao.maps.LatLngBounds();

        for (const hospital of state.clusterItems) {
            bounds.extend(
                new kakao.maps.LatLng(hospital.lat, hospital.lng)
            );
        }

        byId('cluster-dialog').close();
        fitBounds(bounds);
    });

    updateCoordinates();

    byId('search-form').addEventListener('submit', event => {
        event.preventDefault();
        updateSearch();
        byId('search-results').querySelector('button')?.click();
    });

    byId('keyword').addEventListener('input', updateSearch);
    byId('refresh-button').addEventListener('click', loadData);
    byId('location-button').addEventListener('click', locate);

    for (const id of [
        'filter-regional',
        'filter-tertiary',
        'filter-medical',
        'filter-other'
    ]) {
        byId(id).addEventListener('change', updateMarkers);
    }

    byId('sheet-close').addEventListener('click', closeSheet);
    byId('sheet-dim').addEventListener('click', closeSheet);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            if (document.querySelector('dialog[open]')) {
                return;
            }

            if (!byId('radius-popover').hidden) {
                closeRadius(true);
                return;
            }

            if (!byId('search-results').hidden) {
                byId('search-results').hidden = true;
                byId('keyword').focus();
                return;
            }

            if (state.selected) {
                closeSheet();
            }
        }

        if (
            event.key === 'Tab' &&
            state.selected &&
            !document.querySelector('dialog[open]')
        ) {
            const items = [
                ...byId('sheet').querySelectorAll(
                    'button:not(:disabled), a[href], input, select, summary, [tabindex="0"]'
                )
            ].filter(item =>
                item.getClientRects().length &&
                getComputedStyle(item).visibility !== 'hidden'
            );

            const first = items[0];
            const last = items.at(-1);

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (
                !event.shiftKey &&
                document.activeElement === last
            ) {
                event.preventDefault();
                first?.focus();
            }
        }
    });

    byId('location-button').disabled = true;
    byId('refresh-button').disabled = true;

    if (!window.kakao?.maps) {
        setStatus('카카오 지도 SDK를 불러오지 못했습니다.');
        return;
    }

    kakao.maps.load(() => {
        state.map = new kakao.maps.Map(byId('map'), {
            center: new kakao.maps.LatLng(SEOUL.lat, SEOUL.lng),
            level: 6
        });

        kakao.maps.event.addListener(
            state.map,
            'idle',
            updateMarkers
        );

        window.addEventListener('resize', () => {
            state.map.relayout();
        });

        byId('location-button').disabled = false;
        byId('refresh-button').disabled = false;

        loadData();
        locate();
    });
}

init();