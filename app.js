/* global kakao */
'use strict';

/**
 * ==============================================================================
 * [전국 응급의료기관 실시간 정보 관제 시스템 (app.js)]
 * 
 * [시스템 핵심 아키텍처 및 모듈 구성]
 * 1. 시스템 환경설정 및 공공데이터 API 인증 키/엔드포인트 정의
 * 2. 보건복지부 지정 상급종합병원(2024~2026) 및 권역 분류 데이터 사전
 * 3. 의료 장비 및 가용/기준 병상 수동 매핑 사전 (HV_LABELS, HVS_LABELS, API_FIELD_LABELS)
 * 4. 중증응급질환 27종 분류 체계 (SEVERE_DISEASE_GROUPS)
 * 5. 데이터 정제 및 예외 처리 유틸리티 (isBlankOrNull, availability, isMissing)
 * 6. 공공데이터 비동기 수집 파이프라인 (fetchData, requestAll, readXml, groupById)
 * 7. 카카오맵 SDK GIS 연동 및 지리 연산 (distanceKm, locate, updateMarkers)
 * 8. 실시간 가용병상·중증질환·장비 렌더링 엔진 (renderErBeds, renderSevere, renderEquipment)
 * 9. 모바일 제스처 바텀시트 및 접근성 컨트롤 (initSheetDrag, openHospital, closeSheet)
 * 10. 개발자 디버그 모드 및 실시간 원본 데이터 검증기
 * ==============================================================================
 */

// 공공데이터포털(data.go.kr) 국립중앙의료원 중앙응급의료센터 OpenAPI 인증키
const API_KEY = decodeURIComponent(
    's%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8' +
    'UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D'
);

// 응급의료정보 조회 서비스 기본 REST 엔드포인트 URL
const API_ROOT =
    'https://apis.data.go.kr/B552657/ErmctInfoInqireService';

// 페이지당 요청 레코드 수 (네트워크 호출 횟수 최소화 최적화)
const PAGE_SIZE = 1000;
const CARD_WIDTH = 168;
const CARD_HEIGHT = 60;
const NOTICE_KEY = 'emergency-notice-hidden-v1';

// 기본 기준점 좌표 (사용자 위치 미수신 시 서울시청 기준 fallback)
const SEOUL = {
    lat: 37.5668,
    lng: 126.9786
};

/* --------------------------------------------------------------------------
   [1. 보건복지부 지정 제5기(2024~2026년) 상급종합병원 분류 목록]
   - 각 권역별 핵심 상급종합병원 및 약칭 매핑 사전
   -------------------------------------------------------------------------- */
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
    '서울': /^서울/,
    '인천': /^인천/,
    '경기': /^경기/,
    '강원': /^강원/,
    '충북': /^(충북|충청북도)/,
    '충남': /^(충남|충청남도)/,
    '대전': /^대전/,
    '전북': /^(전북|전라북도)/,
    '광주': /^광주/,
    '전남': /^(전남|전라남도)/,
    '대구': /^대구/,
    '경북': /^(경북|경상북도)/,
    '부산': /^부산/,
    '경남': /^(경남|경상남도)/,
    '울산': /^울산/
};

/* --------------------------------------------------------------------------
   [2. 필수 특수 의료 장비 11종 필드 매핑]
   - 각 기관의 장비 보유 및 실시간 가동 여부(Y/N) 플래그
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   [3. 실시간 가용 병상 40여 종 수동 매핑 사전 (HV_LABELS)]
   - 국립중앙의료원 OpenAPI 공식 명세서 전수 대조를 통해 구축
   - AI의 축약 필드명(hvec, hv2 등) 오분류를 방지하고 정확한 한글 레이블 매핑
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   [4. 기준 병상수(총 허가/운영 병상) 수동 매핑 사전 (HVS_LABELS)]
   - AI가 질환 번호로 오인했던 hvs 계열 코드를 '기준 병상수'로 정밀 재분류
   - 가용률(가용수 / 기준수) 계산 시 분모(기준) 데이터로 활용
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   [5. API 응답 전체 필드 통합 사전 (API_FIELD_LABELS)]
   - 가용 병상, 기준 병상, 장비 및 기타 시스템 제어 필드를 망라한 단일 매핑 테이블
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   [6. 중증응급질환 27종 목록 (DISEASES)]
   - 국립중앙의료원 중앙응급의료센터 선정 27대 중증응급질환 표준 정의
   -------------------------------------------------------------------------- */
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

function availability(raw, yes = '가능', no = '불가능') {
    if (isMissing(raw)) {
        return { text: '-', className: 'unknown' };
    }

    const text = String(raw).trim();
    const upper = text.toUpperCase();

    if (upper === 'Y' || text === '가능' || text.startsWith('가능')) {
        return { text: yes, className: 'yes' };
    }

    if (upper === 'N' || text === '불가' || text === '불가능' || text.includes('불가') || text.includes('불가능')) {
        return { text: no, className: 'no' };
    }

    if (text === '정보미제공' || text === '미정보' || text === '-') {
        return { text: '-', className: 'unknown' };
    }

    return { text: text, className: 'unknown' };
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

/**
 * 경량 DOM 엘리먼트 생성 헬퍼
 * @param {string} tag - 생성할 HTML 태그명
 * @param {string} [className=''] - 적용할 CSS 클래스명
 * @param {string|number} [content=undefined] - 삽입할 텍스트 콘텐츠
 * @returns {HTMLElement} 생성된 DOM 노드
 */
function node(tag, className = '', content = undefined) {
    const item = document.createElement(tag);

    if (className) {
        item.className = className;
    }

    if (content !== undefined) {
        item.textContent = String(content);
    }

    return item;
}

/**
 * 전광판(Ticker/Marquee) 애니메이션을 위한 래퍼 엘리먼트 생성
 * - 텍스트가 박스 너비를 초과할 경우 부드러운 좌우 스크롤 애니메이션 활성화
 * @param {string} tag - 태그명
 * @param {string} className - 클래스명
 * @param {string} text - 표시할 텍스트
 * @param {string} [title=undefined] - 툴팁 타이틀 속성
 * @returns {HTMLElement} 래핑된 DOM 노드
 */
function createMarqueeEl(tag, className = '', text = '', title = undefined) {
    const el = node(tag, className);
    if (title) el.title = title;
    const inner = node('span', 'marquee-inner', text);
    el.append(inner);
    return el;
}

/**
 * 전광판(Marquee) 오버플로우 계산 및 CSS 애니메이션 변수 동적 주입
 * [성능 최적화]:
 * - requestAnimationFrame 내에서 읽기(Read) 단계와 쓰기(Write) 단계를 분리하여
 *   대량의 병상/장비 카드 렌더링 시 발생하는 레이아웃 스래싱(Layout Thrashing)을 완벽 차단
 */
function updateMarquees() {
    requestAnimationFrame(() => {
        const containers = document.querySelectorAll('.egen-cell-param, .severe-remark-box');
        if (!containers.length) return;

        // 1. 읽기(Read) 단계: 전체 오버플로우 크기 일괄 측정
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

        // 2. 쓰기(Write) 단계: 스타일 프로퍼티 일괄 적용
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

/**
 * @param {Element} item
 * @returns {Record<string, string>}
 */
function fieldMap(item) {
    const fields = Object.create(null);

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

    if (xml.getElementsByTagName('parsererror').length) {
        throw new Error('XML 해석 실패');
    }

    const code = xml
        .getElementsByTagName('resultCode')[0]
        ?.textContent
        ?.trim();

    if (code !== '00') {
        const message = xml
            .getElementsByTagName('resultMsg')[0]
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
            xml.getElementsByTagName('totalCount')[0]?.textContent || 0
        );

        const rows = Number(
            xml.getElementsByTagName('numOfRows')[0]?.textContent || PAGE_SIZE
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

/**
 * 병원명 정규화 헬퍼 (NFKC 정규화 및 특수문자/공백 제거)
 * @param {string} value - 원본 병원명
 * @returns {string} 비교용 정규화 문자열
 */
function normalizeName(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\s·()（）-]/g, '')
        .toLowerCase();
}

/**
 * 기관 분류기 (상급종합병원, 의료원, 일반·기타)
 * - 1차: dutydivnam 명칭에 '상급종합' 포함 여부 검사
 * - 2차: 보건복지부 제5기 공식 고시 목록(TERTIARY_2024_2026)과의 지역/명칭 교차 대조
 * @param {Object} fields - 기관 기본정보 객체
 * @returns {{group: string, label: string}} 분류 그룹 및 표시 레이블
 */
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

/**
 * 권역응급의료센터 여부 판별기
 * @param {Object} fields - 기관 정보 객체
 * @returns {boolean} 권역응급의료센터 여부
 */
function isRegional(fields) {
    return /권역응급의료센터/.test(fields.dutyemclsname || '');
}

/**
 * 중복 요청 방지(In-flight Deduplication)를 적용한 데이터 로드 진입점
 * - 이미 데이터 수신 중인 경우 기존 프로미스를 재사용하여 네트워크 대역폭 낭비 차단
 * @returns {Promise<void>}
 */
function loadData() {
    if (state.inflight) {
        return state.inflight;
    }

    state.inflight = fetchData().finally(() => {
        state.inflight = null;
    });

    return state.inflight;
}

/**
 * 7대 공공데이터 API 비동기 병렬 수집 파이프라인
 * [아키텍처 설계]:
 * 1. AbortController를 통해 이전 미완료 요청 즉시 취소
 * 2. Promise.allSettled를 적용하여 특정 API의 지연/실패가 전체 시스템 장애로 번지지 않도록 격리
 * 3. 수신된 XML 데이터들을 병원 고유 식별자(HPID)를 키로 교차 병합 및 정규화
 */
async function fetchData() {
    state.loading = true;

    byId('refresh-button').disabled = true;
    document.body.classList.add('is-loading');
    byId('developer-spinner').hidden = false;
    byId('developer-status').textContent = '실시간 정보 새로 수신 중...';

    state.controller?.abort();
    state.controller = new AbortController();

    setStatus('정보 확인 중…');

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

/* --------------------------------------------------------------------------
   [7. 지리 연산 및 위치 추적 (GIS & Geolocation)]
   -------------------------------------------------------------------------- */

/**
 * 두 좌표 간의 직선 거리 계산 (Haversine Formula)
 * - 지구 구면 곡률을 반영한 대원 거리(Great-Circle Distance) 계산
 * @param {{lat: number, lng: number}} a - 시작점 위경도 좌표
 * @param {{lat: number, lng: number}} b - 도착점 위경도 좌표
 * @returns {number} 두 지점 간의 거리 (단위: km)
 */
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

/**
 * 십진수 위경도 좌표를 도·분·초(DMS) 형식으로 변환
 * @param {number} value - 위도 또는 경도 십진수 값
 * @param {string} positive - 양수 부호 기호 (N 또는 E)
 * @param {string} negative - 음수 부호 기호 (S 또는 W)
 * @returns {string} 도·분·초 포맷 문자열 (예: N 37° 34′ 0.5″)
 */
function formatDms(value, positive, negative) {
    const tenths = Math.round(Math.abs(value) * 36000);
    const degrees = Math.floor(tenths / 36000);
    const minutes = Math.floor((tenths % 36000) / 600);
    const seconds = (tenths % 600) / 10;
    const direction = value >= 0 ? positive : negative;

    return `${direction} ${degrees}° ${minutes}′ ${seconds.toFixed(1)}″`;
}

/**
 * 사용자 현재 위치 및 좌표 텍스트 UI 갱신
 * - GPS 수신 성공 시 정밀 좌표 표출, 미수신 시 서울시청 기준 안내
 */
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

/* --------------------------------------------------------------------------
   [14. 실시간 병원 검색 및 자동완성]
   -------------------------------------------------------------------------- */

/**
 * 사용자 입력 키워드 기반 실시간 병원 검색 및 드롭다운 결과 렌더링
 * - 공백 무시 및 소문자 정규화 기반 매칭
 * - [성능 최적화]: DocumentFragment를 활용한 DOM 일괄 삽입으로 대량 타이핑 시 리플로우 최소화
 */
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
        return;
    }

    const fragment = document.createDocumentFragment();

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
        fragment.append(li);
    }

    list.append(fragment);
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

    const messages = (hospital.messages || [])
        .filter(item => {
            const start = parseApiDate(item.symblksttdtm);
            const end = parseApiDate(item.symblkenddtm);

            return (
                (!start || start.timestamp <= now) &&
                (!end || end.timestamp > now)
            );
        })
        .sort((a, b) => {
            // 1. 중증 우선순위 (중증은 반드시 맨 위에 Priority로 표시)
            const isCritA = a.symblkmsgtyp === '중증' ? 0 : 1;
            const isCritB = b.symblkmsgtyp === '중증' ? 0 : 1;
            if (isCritA !== isCritB) {
                return isCritA - isCritB;
            }

            // 2. 진료과(trtPrtCodMag) 기준 오름차순(가나다순) 정렬
            const deptA = String(a.trtprtcodmag || a.symtypcodmag || '').trim();
            const deptB = String(b.trtprtcodmag || b.symtypcodmag || '').trim();
            const deptCompare = deptA.localeCompare(deptB, 'ko', { numeric: true });
            if (deptCompare !== 0) {
                return deptCompare;
            }

            // 3. 진료과가 동일할 경우 공지 메시지 내용 오름차순 보조 정렬
            const msgA = String(a.symblkmsg || '').trim();
            const msgB = String(b.symblkmsg || '').trim();
            return msgA.localeCompare(msgB, 'ko');
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
                : 'normal';

        const article = node('article', `message-card ${level}`);
        const heading = node('div', 'message-heading');

        // 5. 진료과: trtPrtCodMag 우선 및 명확한 표기
        const deptName = String(item.trtprtcodmag || '').trim() ||
            String(item.symtypcodmag || '').trim() ||
            '진료과 미지정';

        const badge = node(
            'span',
            'message-badge',
            item.symblkmsgtyp ? `[${item.symblkmsgtyp}]` : '[공지]'
        );

        const deptTitle = node('strong', 'message-dept', deptName);

        heading.append(badge, deptTitle);

        // 세부 증상 유형이 진료과와 다르고 '응급실'이 아니면 보조 배지로 표기
        if (item.symtypcodmag && item.symtypcodmag !== deptName && item.symtypcodmag !== '응급실') {
            heading.append(node('span', 'message-subtag', item.symtypcodmag));
        }

        // 진료과 아래에 메시지 표기 (<symBlkMsg>)
        article.append(
            heading,
            node('p', 'message-text', displayValue(item.symblkmsg))
        );

        const end = parseApiDate(item.symblkenddtm);
        const start = parseApiDate(item.symblksttdtm);

        const meta = node('div', 'message-meta');
        if (end) {
            meta.append(node('small', 'muted', `종료 예정 ${end.display}`));
        } else if (start) {
            meta.append(node('small', 'muted', `등록 ${start.display}`));
        }

        if (meta.childElementCount > 0) {
            article.append(meta);
        }

        target.append(article);
    }
}

/* 중증응급질환 (사진 2 컨셉 정의) */

const SEVERE_DISEASE_GROUPS = [
    {
        title: '뇌출혈수술',
        items: [
            { label: '거미막하출혈', key: 'mkioskty3' },
            { label: '거미막하출혈 외', key: 'mkioskty4' }
        ]
    },
    {
        title: '대동맥응급',
        items: [
            { label: '흉부', key: 'mkioskty5' },
            { label: '복부', key: 'mkioskty6' }
        ]
    },
    {
        title: '담낭담관질환',
        items: [
            { label: '담낭질환', key: 'mkioskty7' },
            { label: '담도포함질환', key: 'mkioskty8' }
        ]
    },
    {
        title: '복부응급수술',
        items: [
            { label: '비외상', key: 'mkioskty9' }
        ]
    },
    {
        title: '사지접합',
        items: [
            { label: '수족지접합', key: 'mkioskty20' },
            { label: '수족지접합 외', key: 'mkioskty21' }
        ]
    },
    {
        title: '산부인과응급',
        items: [
            { label: '분만', key: 'mkioskty16' },
            { label: '산과수술', key: 'mkioskty17' },
            { label: '부인과수술', key: 'mkioskty18' }
        ]
    },
    {
        title: '안과적수술',
        items: [
            { label: '응급', key: 'mkioskty25' }
        ]
    },
    {
        title: '영상의학혈관중재',
        items: [
            { label: '성인', key: 'mkioskty26' },
            { label: '영유아', key: 'mkioskty27' }
        ]
    },
    {
        title: '응급내시경',
        items: [
            { label: '성인 위장관', key: 'mkioskty11' },
            { label: '영유아 위장관', key: 'mkioskty12' },
            { label: '성인 기관지', key: 'mkioskty13' },
            { label: '영유아 기관지', key: 'mkioskty14' }
        ]
    },
    {
        title: '응급투석',
        items: [
            { label: 'HD', key: 'mkioskty22' },
            { label: 'CRRT', key: 'mkioskty23' }
        ]
    },
    {
        title: '장중첩/폐색',
        items: [
            { label: '영유아', key: 'mkioskty10' }
        ]
    },
    {
        title: '재관류중재술',
        items: [
            { label: '심근경색', key: 'mkioskty1' },
            { label: '뇌경색', key: 'mkioskty2' }
        ]
    },
    {
        title: '저체중출생아',
        items: [
            { label: '집중치료', key: 'mkioskty15' }
        ]
    },
    {
        title: '정신과적응급',
        items: [
            { label: '폐쇄병동입원', key: 'mkioskty24' }
        ]
    },
    {
        title: '중증화상',
        items: [
            { label: '전문치료', key: 'mkioskty19' }
        ]
    }
];

const SPECIFIC_BLOCK_TARGETS = {
    // 재관류중재술: 심근경색
    mkioskty1: {
        codes: ['Y0010'],
        names: ['심근경색', '관상동맥중재술']
    },
    // 재관류중재술: 뇌경색
    mkioskty2: {
        codes: ['Y0020'],
        names: ['뇌경색', '혈전용해술']
    },
    // 뇌출혈수술: 거미막하출혈
    mkioskty3: {
        codes: ['Y0031'],
        names: ['거미막하출혈', '지주막하출혈', '뇌동맥류 수술']
    },
    // 뇌출혈수술: 거미막하출혈 외
    mkioskty4: {
        codes: ['Y0032'],
        names: ['거미막하출혈 외', '기타 뇌출혈']
    },
    // 대동맥응급: 흉부
    mkioskty5: {
        codes: ['Y0041'],
        names: ['대동맥응급(흉부)', '흉부대동맥']
    },
    // 대동맥응급: 복부
    mkioskty6: {
        codes: ['Y0042'],
        names: ['대동맥응급(복부)', '복부대동맥']
    },
    // 담낭담관질환: 담낭질환
    mkioskty7: {
        codes: ['Y0051'],
        names: ['담낭질환', '담낭 수술']
    },
    // 담낭담관질환: 담도포함질환
    mkioskty8: {
        codes: ['Y0052'],
        names: ['담도포함질환', '담도질환']
    },
    // 복부응급수술: 비외상
    mkioskty9: {
        codes: ['Y0060'],
        names: ['복부응급수술(비외상)', '비외상 복부수술']
    },
    // 장중첩/폐색: 영유아
    mkioskty10: {
        codes: ['Y0070'],
        names: ['장중첩/폐색(유아)', '장중첩']
    },
    // 응급내시경: 성인 위장관
    mkioskty11: {
        codes: ['Y0081'],
        names: ['위장관 응급내시경(성인)']
    },
    // 응급내시경: 영유아 위장관
    mkioskty12: {
        codes: ['Y0082'],
        names: ['위장관 응급내시경(영유아)']
    },
    // 응급내시경: 성인 기관지
    mkioskty13: {
        codes: ['Y0091'],
        names: ['기관지 응급내시경(성인)']
    },
    // 응급내시경: 영유아 기관지
    mkioskty14: {
        codes: ['Y0092'],
        names: ['기관지 응급내시경(영유아)']
    },
    // 저체중출생아: 집중치료
    mkioskty15: {
        codes: ['Y0100'],
        names: ['저출생체중아', '저체중출생아']
    },
    // 산부인과응급: 분만
    mkioskty16: {
        codes: ['Y0111'],
        names: ['산부인과 응급(분만)', '분만', '자연분만', '제왕절개']
    },
    // 산부인과응급: 산과수술
    mkioskty17: {
        codes: ['Y0112'],
        names: ['산부인과 응급(산과수술)', '산과수술']
    },
    // 산부인과응급: 부인과수술
    mkioskty18: {
        codes: ['Y0113'],
        names: ['산부인과 응급(부인과수술)', '부인과수술']
    },
    // 중증화상: 전문치료
    mkioskty19: {
        codes: ['Y0120'],
        names: ['중증화상', '화상 전문치료']
    },
    // 사지접합: 수족지접합
    mkioskty20: {
        codes: ['Y0131'],
        names: ['수족지접합']
    },
    // 사지접합: 수족지접합 외
    mkioskty21: {
        codes: ['Y0132'],
        names: ['수족지접합 외']
    },
    // 응급투석: HD
    mkioskty22: {
        codes: ['Y0141'],
        names: ['응급투석(HD)', '응급투석 (HD)', '혈액투석', '인공신장실']
    },
    // 응급투석: CRRT
    mkioskty23: {
        codes: ['Y0142'],
        names: ['응급투석(CRRT)', '응급투석 (CRRT)', 'CRRT']
    },
    // 정신과적응급: 폐쇄병동입원
    mkioskty24: {
        codes: ['Y0150'],
        names: ['정신과적 응급입원', '폐쇄병동']
    },
    // 안과적수술: 응급
    mkioskty25: {
        codes: ['Y0160'],
        names: ['안과적 응급 수술', '안과 응급 수술']
    },
    // 영상의학혈관중재: 성인
    mkioskty26: {
        codes: ['Y0171'],
        names: ['영상의학혈관중재(성인)']
    },
    // 영상의학혈관중재: 영유아
    mkioskty27: {
        codes: ['Y0172'],
        names: ['영상의학혈관중재(영유아)']
    }
};

/* --------------------------------------------------------------------------
   [8. 실시간 진료 공지 교차 검증 및 중증질환 수용성 판별 엔진]
   -------------------------------------------------------------------------- */

/**
 * 실시간 진료 제한 공지(메시지)의 차단 여부 판별기
 * - "제한 없음/가능/원활" 등 정상 진료 문구 제외
 * - "불가, 차단, 수용불가, 진료불가, 수술불가, 부재, 중단" 등 차단 키워드 감지
 * @param {Object} msg - API 진료 메시지 객체
 * @returns {boolean} 진료 차단 여부
 */
function isNoticeBlocking(msg) {
    if (!msg) return false;
    const body = String(msg.symblkmsg || '').trim();
    const yon = String(msg.symoutdspyon || '').trim();

    if (yon === '차단') {
        return true;
    }

    if (/제한\s*없음|가능|원활/.test(body)) {
        return false;
    }

    return /(불가|불가능|차단|수용\s*불가|진료\s*불가|수술\s*불가|부재|중단)/.test(body);
}

/**
 * 특정 중증응급질환 항목이 현재 활성 긴급 공지에 의해 차단되었는지 교차 검증
 * [데이터 무결성 핵심 기능]:
 * - API 상으로는 "수용 가능"으로 보고되어도, 현장에서 "장비 고장으로 투석 불가" 등
 *   긴급 공지를 올린 경우 이를 감지하여 "불가능(빨간색)"으로 안전하게 자동 오버라이드
 * @param {Array<Object>} activeMessages - 현재 시점에 유효한 긴급 공지 목록
 * @param {string} itemKey - 질환 필드 키 (예: mkioskty22)
 * @returns {boolean} 해당 질환의 차단 여부
 */
function isDiseaseSpecificallyBlocked(activeMessages, itemKey) {
    const config = SPECIFIC_BLOCK_TARGETS[itemKey];
    if (!config || !activeMessages.length) return false;

    for (const msg of activeMessages) {
        if (!isNoticeBlocking(msg)) continue;

        const cod = String(msg.symtypcod || '').trim().toUpperCase();
        if (config.codes && config.codes.includes(cod)) {
            return true;
        }

        const symName = String(msg.symtypcodmag || '').trim();
        if (config.names && config.names.some(target => symName === target || (target.length >= 4 && symName.includes(target)))) {
            return true;
        }
    }

    return false;
}

/**
 * 27종 중증응급질환 실시간 수용성 보드 렌더링
 * - API 원본값, 활성 공지 차단 여부, 세부 비고 사항을 종합 분석하여
 *   [가능(녹색) / 불가능(적색) / 확인필요(황색) / 미제공(-)] 배지 및 파라미터 표출
 * @param {Object} hospital - 병원 종합 데이터 객체
 */
function renderSevere(hospital) {
    const target = byId('severe');
    if (!target) return;
    target.replaceChildren();

    byId('severe-time').textContent = '보고 시각 미정보';

    if (!state.sources.severe) {
        empty(target, '미정보 · 중증질환 정보 조회에 실패했습니다.');
        return;
    }

    const fields = hospital.severe || {};

    const card = node('article', 'egen-table-card');
    const header = node('div', 'egen-header-bar severe');
    header.append(
        node('span', 'egen-header-icon', '❤️'),
        node('span', '', '중증응급질환')
    );

    const scrollArea = node('div', 'egen-scroll-area');
    const matrix = node('div', 'severe-matrix-grid');

    // 현재 유효한 진료 공지 목록 필터링
    const now = Date.now();
    const activeMessages = (hospital.messages || []).filter(item => {
        const start = parseApiDate(item.symblksttdtm);
        const end = parseApiDate(item.symblkenddtm);
        return (
            (!start || start.timestamp <= now) &&
            (!end || end.timestamp > now)
        );
    });

    for (const group of SEVERE_DISEASE_GROUPS) {
        const box = node('div', 'severe-cat-box');
        box.append(node('div', 'severe-cat-header', group.title));

        for (const item of group.items) {
            const row = node('div', 'severe-sub-item');
            const topRow = node('div', 'severe-sub-top');
            const label = node('span', 'severe-sub-label', item.label);
            const valWrap = node('div', 'severe-sub-val');

            const rawVal = fields[item.key];
            const rawMsg = fields[`${item.key}msg`];
            const cleanVal = isBlankOrNull(rawVal) ? '-' : String(rawVal).trim();
            const cleanMsg = isBlankOrNull(rawMsg) || rawMsg === '정보미제공' ? '' : String(rawMsg).trim();

            // 1. API 원본 상태 확인
            // - 원본값이 '불가능'/'N' -> [불가능] (빨간색)
            // - 비고가 있는 현황 -> '확인 필요'로 통일 (노란색)
            // - 원본값이 '가능'/'Y'이고 비고가 없는 경우 -> [가능] (초록색)
            // - 정보미제공/미정보/공란 -> 정직하게 [-] (회색 대시)
            const status = availability(rawVal, '가능', '불가능');
            const isBlockedByNotice = isDiseaseSpecificallyBlocked(activeMessages, item.key);

            if (cleanMsg) {
                valWrap.append(node('span', 'egen-badge-avail-yellow', '확인 필요'));
            } else if (status.className === 'no' || isBlockedByNotice) {
                valWrap.append(node('span', 'egen-badge-avail-red', '불가능'));
            } else if (status.className === 'yes') {
                valWrap.append(node('span', 'egen-badge-avail-green', '가능'));
            } else {
                valWrap.append(node('span', 'egen-badge-dash', '-'));
            }

            topRow.append(label, valWrap);

            // 2. 호출 인자 및 수신값 표기
            const paramText = `${item.key}\u00A0\u00A0\u00A0수신값 [${cleanVal}]`;
            const paramEl = createMarqueeEl('div', 'egen-cell-param', paramText, paramText);

            row.append(topRow, paramEl);

            // 3. 비고란이 있는 경우 바로 아래에 회색 박스로 표시
            if (cleanMsg) {
                const remarkText = `비고: ${cleanMsg}`;
                const remarkEl = createMarqueeEl('div', 'severe-remark-box', remarkText, remarkText);
                row.append(remarkEl);
            }

            box.append(row);
        }

        matrix.append(box);
    }

    scrollArea.append(matrix);
    card.append(header, scrollArea);
    target.append(card);

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
        ? `초과수용 ${Math.abs(value)}석`
        : `${value}석`;
}

/* 실시간 병상 정의 */

const EMERGENCY_BED_ITEMS = [
    { label: '일반', current: 'hvec', baseline: 'hvs01' },
    { label: '소아', current: 'hv28', baseline: 'hvs02' },
    { label: '외상소생실', current: 'hv60', baseline: 'hvs60' },
    { label: '일반격리', current: 'hv30', baseline: 'hvs04' },
    { label: '음압격리', current: 'hv29', baseline: 'hvs03' },
    { label: '소아일반격리', current: 'hv16', baseline: 'hvs49' },
    { label: '소아음압격리', current: 'hv15', baseline: 'hvs48' },
    { label: '코호트격리', current: 'hv27', baseline: 'hvs59' }
];

const INPATIENT_BED_SECTIONS = [
    {
        title: '중환자실',
        items: [
            { label: '일반', current: 'hvicc', baseline: 'hvs17' },
            { label: '음압격리', current: 'hv35', baseline: 'hvs18' },
            { label: '소아', current: 'hv32', baseline: 'hvs09' },
            { label: '신생아', current: 'hvncc', baseline: 'hvs08' },
            { label: '내과', current: 'hv2', baseline: 'hvs06' },
            { label: '심장내과', current: 'hv34', baseline: 'hvs15' },
            { label: '신경과', current: 'hvcc', baseline: 'hvs11' },
            { label: '화상', current: 'hv8', baseline: 'hvs13' },
            { label: '외과', current: 'hv3', baseline: 'hvs07' },
            { label: '신경외과', current: 'hv6', baseline: 'hvs12' },
            { label: '흉부외과', current: 'hvccc', baseline: 'hvs16' }
        ]
    },
    {
        title: '응급전용',
        items: [
            { label: '입원실', current: 'hv36', baseline: 'hvs19' },
            { label: '입원실 음압격리', current: 'hv19', baseline: 'hvs52' },
            { label: '입원실 일반격리', current: 'hv21', baseline: 'hvs53' },
            { label: '중환자실', current: 'hv31', baseline: 'hvs05' },
            { label: '중환자실 음압격리', current: 'hv17', baseline: 'hvs50' },
            { label: '중환자실 일반격리', current: 'hv18', baseline: 'hvs51' },
            { label: '소아입원실', current: 'hv37', baseline: 'hvs20' },
            { label: '소아중환자실', current: 'hv33', baseline: 'hvs10' }
        ]
    },
    {
        title: '외상전용',
        items: [
            { label: '중환자실', current: 'hv9', baseline: 'hvs14' },
            { label: '입원실', current: 'hv38', baseline: 'hvs21' },
            { label: '수술실', current: 'hv39', baseline: 'hvs23' }
        ]
    },
    {
        title: '입원실',
        items: [
            { label: '일반', current: 'hvgc', baseline: 'hvs38' },
            { label: '음압격리', current: 'hv41', baseline: 'hvs25' },
            { label: '정신과 폐쇄병동', current: 'hv40', baseline: 'hvs24' }
        ]
    },
    {
        title: '기타',
        items: [
            { label: '수술실', current: 'hvoc', baseline: 'hvs22' },
            { label: '분만실', current: 'hv42', baseline: 'hvs26', type: 'delivery' },
            { label: '화상전용처치실', current: 'hv43', baseline: 'hvs36' }
        ]
    }
];

/**
 * 결측값(Null / Empty / Undefined) 검증 헬퍼
 * [기술적 난제 3 해결 핵심 로직]:
 * - 공공데이터 XML 응답에서 태그가 비어있거나 누락된 경우를 엄격히 감지
 * - 결측값을 단순 숫자 0으로 취급하여 '병상 없음(0개/포화)'으로 왜곡되는 치명적 의료 사고 방지
 * @param {*} val - 검사할 데이터 값
 * @returns {boolean} 공백 또는 null 여부
 */
function isBlankOrNull(val) {
    return val === null || val === undefined || String(val).trim() === '';
}

/**
 * API 호출 파라미터 키 레이블 포맷터
 * @param {string} currentKey - 가용 병상 필드 키 (예: hvec)
 * @param {string} baselineKey - 기준 병상 필드 키 (예: hvs01)
 * @returns {string} 화면 표출용 파라미터 안내 문자열
 */
function formatParamLabel(currentKey, baselineKey) {
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

/**
 * 병상 가용 수치 및 기준 수치 기반 실시간 상태 배지 판별기
 * - 기준수 대비 가용수 비율 또는 절대 수치에 따라 여유/보통/혼잡/초과수용/정보미제공 배지 반환
 * - 분만실 등 특수 병상의 경우 Y/N 가동 여부 기준으로 판별
 * @param {Object} fields - 병원 병상 데이터 객체
 * @param {Object} def - 병상 항목 정의 (current, baseline, type 등)
 * @returns {{className: string, text: string}} 배지 스타일 클래스 및 표시 텍스트
 */
function getBedStatusBadge(fields, def) {
    const rawVal = fields[def.current];
    const rawBase = def.baseline ? fields[def.baseline] : null;

    if (def.type === 'delivery') {
        if (isBlankOrNull(rawVal) && isBlankOrNull(rawBase)) {
            return { className: 'egen-badge-dash', text: '-' };
        }
        const valStr = String(rawVal ?? '').trim().toUpperCase();
        const baseNum = integerValue(rawBase);
        const currNum = integerValue(rawVal);
        const isY = valStr === 'Y' || (currNum !== null && currNum > 0);
        const count = baseNum !== null ? baseNum : currNum;

        if (isY) {
            return {
                className: 'egen-badge-box-green',
                text: count !== null && count >= 0 ? `Y / ${count}` : 'Y'
            };
        }
        return { className: 'egen-badge-dash', text: '-' };
    }

    // 4. 만약 API에 호출했는데 NULL이나 공란이면 -으로 표시하세요.
    if (isBlankOrNull(rawVal)) {
        return { className: 'egen-badge-dash', text: '-' };
    }

    const current = integerValue(rawVal);
    const baseline = integerValue(rawBase);

    if (current === null) {
        return { className: 'egen-badge-dash', text: '-' };
    }

    // 2. - 값은 초과수용이란 뜻입니다. 그대로 -대로 표시하지 마세요.
    if (current < 0) {
        const overflow = Math.abs(current);
        const textVal = (baseline !== null && baseline > 0)
            ? `초과수용 ${overflow}/${baseline}`
            : `초과수용 ${overflow}`;
        return {
            className: 'egen-badge-pill-red egen-badge-overflow',
            text: textVal
        };
    }

    // current >= 0
    if (baseline !== null && baseline > 0) {
        const ratio = current / baseline;
        const textVal = `${current}/${baseline}`;
        if (current === 0 || ratio <= 0.35) {
            return { className: 'egen-badge-pill-red', text: `혼잡 ${textVal}` };
        } else if (ratio < 0.70) {
            return { className: 'egen-badge-pill-orange', text: `보통 ${textVal}` };
        } else {
            return { className: 'egen-badge-pill-green', text: `원활 ${textVal}` };
        }
    }

    if (current > 0) {
        return { className: 'egen-badge-pill-green', text: `원활 ${current}` };
    } else {
        return { className: 'egen-badge-pill-red', text: '혼잡 0' };
    }
}

/**
 * 개별 병상 상태 셀 엘리먼트 생성기
 * - 병상 레이블, 실시간 가용/기준 상태 배지, API 수신값 파라미터 텍스트 포맷
 * @param {Object} fields - 병원 병상 원본 데이터
 * @param {Object} item - 병상 항목 명세 (current, baseline, label)
 * @returns {HTMLElement} .egen-cell DOM 노드
 */
function createBedCell(fields, item) {
    const cell = node('div', 'egen-cell');
    const topRow = node('div', 'egen-cell-top');
    const badge = getBedStatusBadge(fields, item);

    topRow.append(
        node('span', 'egen-cell-label', item.label),
        node('span', badge.className, badge.text)
    );

    const currRaw = isBlankOrNull(fields[item.current]) ? '-' : String(fields[item.current]).trim();
    const baseRaw = item.baseline ? (isBlankOrNull(fields[item.baseline]) ? '-' : String(fields[item.baseline]).trim()) : null;

    let paramText = formatParamLabel(item.current, item.baseline);
    if (baseRaw !== null) {
        paramText += `\u00A0\u00A0\u00A0수신값 [${currRaw} / ${baseRaw}]`;
    } else {
        paramText += `\u00A0\u00A0\u00A0수신값 [${currRaw}]`;
    }

    const paramEl = createMarqueeEl('div', 'egen-cell-param', paramText, paramText);

    cell.append(topRow, paramEl);
    return cell;
}

/**
 * 응급실 핵심 가용 병상 종합 카드 렌더링
 * - 일반, 소아, 외상소생실, 음압/일반/코호트 격리 등 응급실 전용 병상 집계
 * @param {Object} hospital - 병원 데이터 객체
 */
function renderErBeds(hospital) {
    const target = byId('er-beds-board') || byId('beds-board');
    if (!target) return;
    target.replaceChildren();

    if (!state.sources.beds) {
        empty(target, '미정보 · 병상 정보 조회에 실패했습니다.');
        return;
    }

    const fields = hospital.beds || {};

    const card = node('article', 'egen-table-card');
    const header = node('div', 'egen-header-bar emergency');
    header.append(
        node('span', 'egen-header-icon', '🚨'),
        node('span', '', '응급실병상')
    );

    const grid = node('div', 'egen-matrix-grid');

    for (const item of EMERGENCY_BED_ITEMS) {
        grid.append(createBedCell(fields, item));
    }

    card.append(header, grid);
    target.append(card);
}

/**
 * 입원 및 중환자실 병상 현황 종합 카드 렌더링
 * - 중환자실(내과, 외과, 소아, 신생아, 흉부, 심장 등), 응급전용, 외상전용, 일반 입원실 분류별 집계
 * @param {Object} hospital - 병원 데이터 객체
 */
function renderInpatientBeds(hospital) {
    const target = byId('inpatient-beds-board');
    if (!target) return;
    target.replaceChildren();

    if (!state.sources.beds) {
        empty(target, '미정보 · 병상 정보 조회에 실패했습니다.');
        return;
    }

    const fields = hospital.beds || {};

    const card = node('article', 'egen-table-card');
    const header = node('div', 'egen-header-bar inpatient');
    header.append(
        node('span', 'egen-header-icon', '🛏️'),
        node('span', '', '입원병상')
    );

    card.append(header);

    for (const section of INPATIENT_BED_SECTIONS) {
        const subHeader = node('div', 'egen-subgroup-header', section.title);
        const subGrid = node('div', 'egen-matrix-grid');

        for (const item of section.items) {
            subGrid.append(createBedCell(fields, item));
        }

        card.append(subHeader, subGrid);
    }

    target.append(card);
}

/**
 * 병상 관련 종합 렌더링 코디네이터
 * - 보고 시각 파싱, 응급실 병상 보드, 입원실/중환자실 병상 보드, 개발자 원본 뷰를 일괄 호출
 * @param {Object} hospital - 대상 병원 종합 객체
 */
function renderBeds(hospital) {
    const bedTimeEl = byId('bed-time');
    if (bedTimeEl) {
        bedTimeEl.textContent = '보고 시각 미정보';
    }

    renderRawBeds(hospital);
    renderErBeds(hospital);
    renderInpatientBeds(hospital);

    const fields = hospital.beds || {};
    const reported = parseApiDate(fields.hvidate);
    if (reported && bedTimeEl) {
        bedTimeEl.textContent = `보고 ${reported.display}`;
    }
}

/* --------------------------------------------------------------------------
   [9. 개발자 모드: API 원본 데이터(Raw Fields) 인스펙터]
   -------------------------------------------------------------------------- */

/**
 * 개발자 모드: 병상 원시 필드(Raw Fields) 검사 뷰 렌더링
 * - hv(가용 병상), hvs(기준 병상), 특수 코드 등 국립중앙의료원 원본 응답을 무가공 상태로 투명하게 대조 표출
 * - [기술적 난제 2 해결 근거]: AI 오분류 방지 및 개발자의 직접 검증 내역을 확인할 수 있는 디버깅 도구
 * @param {Object} hospital - 병원 객체
 */
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

/* 중증질환 OpenAPI 메타데이터 및 원본 렌더링 */

const MKIOSKTY_METADATA = {
    mkioskty1: '[재관류중재술] 심근경색',
    mkioskty2: '[재관류중재술] 뇌경색',
    mkioskty3: '[뇌출혈수술] 거미막하출혈',
    mkioskty4: '[뇌출혈수술] 거미막하출혈 외',
    mkioskty5: '[대동맥응급] 흉부',
    mkioskty6: '[대동맥응급] 복부',
    mkioskty7: '[담낭담관질환] 담낭질환',
    mkioskty8: '[담낭담관질환] 담도포함질환',
    mkioskty9: '[복부응급수술] 비외상',
    mkioskty10: '[장중첩/폐색] 영유아',
    mkioskty11: '[응급내시경] 성인 위장관',
    mkioskty12: '[응급내시경] 영유아 위장관',
    mkioskty13: '[응급내시경] 성인 기관지',
    mkioskty14: '[응급내시경] 영유아 기관지',
    mkioskty15: '[저체중출생아] 집중치료',
    mkioskty16: '[산부인과응급] 분만',
    mkioskty17: '[산부인과응급] 산과수술',
    mkioskty18: '[산부인과응급] 부인과수술',
    mkioskty19: '[중증화상] 전문치료',
    mkioskty20: '[사지접합] 수족지접합',
    mkioskty21: '[사지접합] 수족지접합 외',
    mkioskty22: '[응급투석] HD',
    mkioskty23: '[응급투석] CRRT',
    mkioskty24: '[정신과적응급] 폐쇄병동입원',
    mkioskty25: '[안과적수술] 응급',
    mkioskty26: '[영상의학혈관중재] 성인',
    mkioskty27: '[영상의학혈관중재] 영유아',
    mkioskty28: '응급실 (Emergency gate keeper)',
    mkioskty10msg: '장중첩/폐색(영유아) 가능연령 비고',
    mkioskty12msg: '위장관 응급내시경(영유아) 가능연령 비고',
    mkioskty14msg: '기관지 응급내시경(영유아) 가능연령 비고',
    mkioskty15msg: '저체중 출생아 가능연령 비고',
    mkioskty27msg: '영상의학 혈관 중재적 시술(영유아) 가능연령 비고',
    mkioskdate: '키오스크 정보 보고일시 (mkioskdate)',
    hvidate: '중증질환 정보 보고일시 (hvidate)'
};

/**
 * 개발자 모드: 27종 중증응급질환 API 원시 필드(Raw Fields) 인스펙터
 * - mkioskty1~28 및 연령제한 비고(msg), 보고일시 등 수신된 XML 노드 전체를 여과 없이 검사
 * - [데이터 무결성]: AI의 필드 오해석 여부를 개발자가 직접 육안 대조할 수 있도록 보장
 * @param {Object} hospital - 병원 데이터 객체
 */
function renderRawSevere(hospital) {
    const all = byId('all-severe');
    if (!all) return;
    all.replaceChildren();

    if (!state.sources.severe) {
        empty(all, '미정보 · 중증질환 원본 정보를 조회하지 못했습니다.');
        return;
    }

    const fields = hospital.severe;
    if (!fields) {
        empty(all, '미정보 · 해당 병원의 중증질환 수용정보 데이터가 없습니다.');
        return;
    }

    const section = node('section', 'raw-group');
    section.append(node('h3', '', '중증응급질환 수용가능 정보 · getSrsillDissAceptncPosblInfoInqire (원본값)'));

    const list = node('dl', 'raw-grid');

    const standardKeys = [
        ...Array.from({ length: 28 }, (_, i) => `mkioskty${i + 1}`),
        'mkioskty10msg', 'mkioskty12msg', 'mkioskty14msg', 'mkioskty15msg', 'mkioskty27msg',
        'mkioskdate', 'hvidate'
    ];

    const extraKeys = Object.keys(fields).filter(
        k => !standardKeys.includes(k) && k !== 'dutyname' && k !== 'hpid'
    );

    const allKeys = [...standardKeys, ...extraKeys];

    for (const key of allKeys) {
        const val = fields[key];
        const label = MKIOSKTY_METADATA[key] || key;
        const pair = node('div', 'raw-pair');

        pair.append(
            node('dt', 'field-code', `${label} (${key})`),
            node('dd', '', isBlankOrNull(val) ? '-' : String(val).trim())
        );

        list.append(pair);
    }

    section.append(list);
    all.append(section);
}

/**
 * 개발자 모드: 실시간 진료 제한/특이사항 공지 원시 데이터(Raw Messages) 인스펙터
 * - 공지 등록/종료일시, 구분코드, 표출 방식, 진료과, 원문 텍스트 전체 표출
 * @param {Object} hospital - 병원 데이터 객체
 */
function renderRawMessages(hospital) {
    const all = byId('all-messages');
    if (!all) return;
    all.replaceChildren();

    if (!state.sources.messages) {
        empty(all, '미정보 · 실시간 진료공지 정보를 조회하지 못했습니다.');
        return;
    }

    const msgs = hospital.messages || [];
    if (!msgs.length) {
        empty(all, '해당 병원에 등록된 실시간 진료 공지가 없습니다.');
        return;
    }

    const section = node('section', 'raw-group');
    section.append(node('h3', '', `실시간 진료 공지 목록 (총 ${msgs.length}건)`));

    for (let i = 0; i < msgs.length; i++) {
        const item = msgs[i];
        const card = node('div', 'raw-msg-card');
        const dl = node('dl', 'raw-grid');

        const fields = [
            ['순번 (rnum)', item.rnum],
            ['구분코드 (symTypCod)', item.symtypcod],
            ['구분명 (symTypCodMag)', item.symtypcodmag],
            ['진료과 (trtPrtCodMag)', item.trtprtcodmag],
            ['표출여부 (symOutDspYon)', item.symoutdspyon],
            ['표출방법 (symOutDspMth)', item.symoutdspmth],
            ['메시지구분 (symBlkMsgTyp)', item.symblkmsgtyp],
            ['시작일시 (symBlkSttDtm)', item.symblksttdtm],
            ['종료일시 (symBlkEndDtm)', item.symblkenddtm],
            ['공지내용 (symBlkMsg)', item.symblkmsg]
        ];

        for (const [dt, dd] of fields) {
            const pair = node('div', 'raw-pair');
            pair.append(
                node('dt', 'field-code', dt),
                node('dd', '', isBlankOrNull(dd) ? '-' : String(dd).trim())
            );
            dl.append(pair);
        }

        const titleText = `공지 #${i + 1} · ${item.trtprtcodmag || item.symtypcodmag || item.symtypcod || '공지'}`;
        card.append(node('h4', 'raw-msg-title', titleText), dl);
        section.append(card);
    }

    all.append(section);
}

/* --------------------------------------------------------------------------
   [10. 가용 장비 현황 (10대 핵심 응급의료 장비 보드)]
   -------------------------------------------------------------------------- */

const EQUIPMENT_TABLE_ITEMS = [
    { label: '인공호흡기 일반', key: 'hvventiayn', baseline: 'hvs30' },
    { label: '인공호흡기 조산아', key: 'hvventisoayn', baseline: 'hvs31' },
    { label: '인큐베이터', key: 'hvincuayn', baseline: 'hvs32' },
    { label: 'CRRT', key: 'hvcrrtayn', baseline: 'hvs33' },
    { label: 'ECMO', key: 'hvecmoayn', baseline: 'hvs34' },
    { label: '중심체온조절유도기', key: 'hvhypoayn', baseline: 'hvs35' },
    { label: '고압산소치료기', key: 'hvoxyayn', baseline: 'hvs37' },
    { label: 'CT', key: 'hvctayn', baseline: 'hvs27' },
    { label: 'MRI', key: 'hvmriayn', baseline: 'hvs28' },
    { label: '혈관촬영기', key: 'hvangioayn', baseline: 'hvs29' }
];

/**
 * 장비 상태 개별 셀 엘리먼트 생성기
 * - 가용 여부(Y/N/수치) 및 보유 기준 대수를 대조하여 배지 및 파라미터 표출
 * @param {Object} fields - 병상/장비 API 응답 객체
 * @param {Object} item - 장비 항목 명세 (label, key, baseline)
 * @returns {HTMLElement} DOM 셀 노드
 */
function createEquipmentCell(fields, item) {
    const cell = node('div', 'egen-cell equipment-cell');
    const topRow = node('div', 'egen-cell-top');

    const rawVal = fields[item.key];
    const rawBase = item.baseline ? fields[item.baseline] : null;

    let badgeClass = 'egen-badge-dash';
    let badgeText = '-';

    if (!isBlankOrNull(rawVal)) {
        const valStr = String(rawVal).trim().toUpperCase();
        const numVal = integerValue(rawVal);
        const isAvail = valStr === 'Y' || (numVal !== null && numVal > 0);
        const baseline = integerValue(rawBase);

        if (isAvail) {
            badgeClass = 'egen-badge-box-green';
            badgeText = (baseline !== null && baseline >= 0) ? `Y / ${baseline}` : 'Y';
        } else if (valStr === 'N' || numVal === 0) {
            badgeClass = 'egen-badge-dash';
            badgeText = '-';
        }
    }

    topRow.append(
        node('span', 'egen-cell-label', item.label),
        node('span', badgeClass, badgeText)
    );

    const currRaw = isBlankOrNull(rawVal) ? '-' : String(rawVal).trim();
    const baseRaw = item.baseline ? (isBlankOrNull(rawBase) ? '-' : String(rawBase).trim()) : null;

    let paramText = formatParamLabel(item.key, item.baseline);
    if (baseRaw !== null) {
        paramText += `\u00A0\u00A0\u00A0수신값 [${currRaw} / ${baseRaw}]`;
    } else {
        paramText += `\u00A0\u00A0\u00A0수신값 [${currRaw}]`;
    }

    const paramEl = createMarqueeEl('div', 'egen-cell-param', paramText, paramText);

    cell.append(topRow, paramEl);

    return cell;
}

/**
 * 10대 핵심 응급의료 장비 종합 가용 현황 카드 렌더링
 * - 인공호흡기, 인큐베이터, CRRT, ECMO, 고압산소치료기, CT, MRI 등
 * @param {Object} hospital - 병원 데이터 객체
 */
function renderEquipment(hospital) {
    const target = byId('equipment');
    if (!target) return;
    target.replaceChildren();

    if (!state.sources.beds) {
        empty(target, '미정보 · 장비 정보 조회에 실패했습니다.');
        return;
    }

    const fields = hospital.beds || {};

    const card = node('article', 'egen-table-card');
    const header = node('div', 'egen-header-bar equipment');
    header.append(
        node('span', 'egen-header-icon', '⚙️'),
        node('span', '', '가용 장비')
    );

    const grid = node('div', 'equipment-matrix-grid');

    for (const item of EQUIPMENT_TABLE_ITEMS) {
        grid.append(createEquipmentCell(fields, item));
    }

    card.append(header, grid);
    target.append(card);
}

/* --------------------------------------------------------------------------
   [11. 기관 기본정보 및 외상센터 정보 렌더링]
   -------------------------------------------------------------------------- */

/**
 * 기관 기본정보 및 권역외상센터 기본정보 아코디언 뷰 렌더링
 * - 주소, 인허가일자, 병원 규모, 외상 전문 세부 정보 등
 * @param {Object} hospital - 병원 종합 데이터 객체
 */
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

/* --------------------------------------------------------------------------
   [12. 긴급 연락처 연결 및 지도 내비게이션 딥링크 연동]
   -------------------------------------------------------------------------- */

/**
 * 전화 걸기 및 웹 링크 생성 헬퍼
 * @param {string} text - 링크 표시 텍스트
 * @param {string} href - 대상 URL / tel 스킴
 * @param {string} className - CSS 클래스명
 * @returns {HTMLAnchorElement} a 태그 노드
 */
function contactLink(text, href, className) {
    const link = node('a', className, text);
    link.href = href;
    return link;
}

/**
 * iOS / iPadOS 터치 디바이스 판별기
 * - iPadOS 데스크톱 모드(Macintosh + maxTouchPoints) 완벽 감지
 * @returns {boolean} Apple 터치 기기 여부
 */
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

/**
 * 모바일 내비게이션 앱 실행 및 미설치 시 웹/스토어 폴백(Fallback) 라우터
 * - Android: Chrome Intent scheme을 통한 네이티브 인텐트 호출
 * - iOS: 커스텀 URL scheme 실행 후 visibilitychange/타이머를 통한 앱스토어 전환
 * - PC: 새 탭에서 웹 길찾기 서비스 실행
 * @param {string} scheme - 앱 전용 커스텀 스킴
 * @param {string} androidPackage - 안드로이드 패키지명
 * @param {string} fallback - 웹 또는 스토어 대체 URL
 */
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

/**
 * 길찾기 제공사별 딥링크 파라미터 빌더
 * - 카카오맵, 네이버지도, 티맵(T-map) 대응
 * @param {'kakao'|'naver'|'tmap'} provider - 내비게이션 플랫폼
 * @param {Object} hospital - 대상 병원 객체
 * @returns {{scheme: string, package: string, fallback: string}} 내비게이션 실행 설정
 */
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

/**
 * 선택된 내비게이션 앱 즉시 실행
 * @param {'kakao'|'naver'|'tmap'} provider - 내비게이션 플랫폼
 * @param {Object} hospital - 대상 병원 객체
 */
function launchNavigation(provider, hospital) {
    const link = navigationLink(provider, hospital);
    openMobileApp(link.scheme, link.package, link.fallback);
}

/**
 * 응급실 직통전화, 대표전화 및 3대 내비게이션(카카오/네이버/티맵) 액션 버튼 렌더링
 * @param {Object} hospital - 병원 데이터 객체
 */
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

/* --------------------------------------------------------------------------
   [13. 병원 상세정보 바텀시트(Bottom Sheet) 인터랙션 및 접근성]
   -------------------------------------------------------------------------- */

/**
 * 특정 병원의 상세정보 바텀시트 개방 및 데이터 바인딩
 * - 배경 요소 inert 처리로 스크린 리더 및 키보드 초점 격리(Focus Trap)
 * - 전광판(Marquee) 너비 재계산 큐잉
 * @param {Object} hospital - 대상 병원 종합 데이터
 * @param {boolean} [focus=true] - 닫기 버튼으로 초점 자동 이동 여부
 */
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
    renderBeds(hospital);
    renderEquipment(hospital);
    renderSevere(hospital);
    renderBasic(hospital);
    renderRawSevere(hospital);
    renderRawMessages(hospital);

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

    setTimeout(updateMarquees, 100);
    setTimeout(updateMarquees, 350);
}

/**
 * 모달/시트 활성화 시 백그라운드 UI 비활성화(inert 제어)
 * @param {boolean} value - 비활성화 여부
 */
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

/**
 * 바텀시트 닫기 및 초점 복원
 * - 시트 애니메이션 초기화, inert 해제, 이전 포커스 위치로 안전하게 복원
 */
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
        !previous.closest('[hidden], [inert], dialog:not([open])') &&
        previous !== byId('keyword') &&
        previous.getClientRects().length > 0
    ) {
        previous.focus();
    } else {
        byId('search-toggle').focus({ preventScroll: true });
    }
}

/**
 * 모바일 터치 드래그 제스처 바텀시트 컨트롤러
 * - 스마트폰 환경에서 상단 핸들을 아래로 스와이프하면 바텀시트가 손가락을 따라 부드럽게 이동
 * - 드래그 거리가 90px 이상이면 자동으로 닫히고, 미만이면 원래 위치로 스냅 복귀
 * [성능 최적화]:
 * - GPU 하드웨어 가속이 적용되는 translate3d(0, delta, 0)를 사용하여 60fps 프레임 드랍 방지
 */
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
                // GPU 레이어 하드웨어 가속을 활용한 부드러운 터치 이동
                sheet.style.transform = `translate3d(0, ${delta}px, 0)`;
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

        // 임계값(90px) 초과 시 시트 닫기 실행, 미만 시 원위치 복원
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

/* --------------------------------------------------------------------------
   [15. 지도 뷰포트 영역 계산 및 반경 피팅 (Viewport & Bounding Box)]
   -------------------------------------------------------------------------- */

/**
 * 상하단 오버레이 패널 높이를 감안하여 지도 뷰포트 패딩을 적용하고 경계 영역 피팅
 * @param {kakao.maps.LatLngBounds} bounds - 피팅할 경위도 경계 영역
 */
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

/**
 * 기준 좌표와 탐색 반경(km)을 기준으로 구면 좌표계(Spherical Coordinates) 경계 바운딩 박스 계산
 * @param {{lat: number, lng: number}} origin - 중심점 위경도 좌표
 * @param {number} radiusKm - 탐색 반경 (단위: km)
 * @returns {{south: number, north: number, west: number, east: number}} 4방향 경계 좌표
 */
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

/**
 * 선택된 탐색 반경(전국 또는 N km)에 맞춰 지도 뷰포트 및 반경 가이드 원(Circle) 동적 피팅
 */
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

/* --------------------------------------------------------------------------
   [16. 응급의료 서비스 이용 안내 모달 (Notice Dialog & LocalStorage)]
   -------------------------------------------------------------------------- */

/**
 * 브라우저 LocalStorage에 저장된 '다시 보지 않기' 설정 여부 확인
 * @returns {boolean} 안내 팝업 숨김 설정 여부
 */
function noticeHidden() {
    try {
        return localStorage.getItem(NOTICE_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * 이용 안내 모달 다이얼로그 개방
 */
function openNotice() {
    byId('notice-skip').textContent = noticeHidden()
        ? '접속할 때 안내 다시 보기'
        : '이 브라우저에서 다시 보지 않기';

    byId('notice-dialog').showModal();
}

/**
 * 이용 안내 다이얼로그 이벤트 리스너 및 초기 표출 제어 초기화
 */
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

    const previewMode = new URLSearchParams(window.location.search).get('preview');
    if (!noticeHidden() && (!previewMode || previewMode === 'notice')) {
        openNotice();
    }
}

/* --------------------------------------------------------------------------
   [17. 상단 및 검색 패널 접기/펼치기 반응형 컨트롤러]
   -------------------------------------------------------------------------- */

/**
 * 지도 상하단 패널 토글 버튼 이벤트 및 ResizeObserver 바인딩
 * - 모바일 환경에서 검색창 높이에 맞게 지도 하단 패딩 CSS 변수(--search-panel-height) 자동 동기화
 */
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

/* --------------------------------------------------------------------------
   [18. 모바일 가상 키보드 및 멀티터치 제스처 최적화]
   -------------------------------------------------------------------------- */

/**
 * 검색 입력창 포커스 해제 (스마트폰 가상 키보드 내리기)
 */
function blurKeyword() {
    const keyword = byId('keyword');

    if (document.activeElement === keyword) {
        keyword.blur();
    }
}

/**
 * 지도 드래그/줌/스크롤 제스처 시 가상 키보드를 자동으로 닫아 화면 가림 현상 방지
 */
function initSearchFocus() {
    const keyword = byId('keyword');
    let multiTouch = false;

    const options = {
        capture: true,
        passive: true
    };

    document.addEventListener('pointerdown', event => {
        if (
            event.target !== keyword ||
            (event.pointerType === 'touch' && !event.isPrimary)
        ) {
            blurKeyword();
        }
    }, options);

    document.addEventListener('touchstart', event => {
        multiTouch = event.touches.length > 1;

        if (multiTouch || event.target !== keyword) {
            blurKeyword();
        }
    }, options);

    const updateTouches = event => {
        multiTouch = event.touches.length > 1;
    };

    document.addEventListener('touchend', updateTouches, options);
    document.addEventListener('touchcancel', updateTouches, options);

    keyword.addEventListener('focus', () => {
        if (multiTouch) {
            keyword.blur();
        }
    });

    document.addEventListener('wheel', event => {
        if (event.ctrlKey || event.target !== keyword) {
            blurKeyword();
        }
    }, options);

    byId('search-form').addEventListener('submit', blurKeyword);
}

/* --------------------------------------------------------------------------
   [19. 애플리케이션 진입점 및 초기화 (Bootstrap & Lifecycle)]
   -------------------------------------------------------------------------- */

/**
 * 전체 시스템 초기화 엔트리포인트
 * 1. 검색 포커스 관리, 반응형 패널, 탐색 반경 UI 초기화
 * 2. 터치 디바이스 감지 및 모바일 클래스 바인딩
 * 3. 키보드 접근성(Escape로 레이어 닫기, 바텀시트 Focus Trap 순환)
 * 4. 카카오 지도 SDK 비동기 로드 대기 후 지도 렌더링, 위치 추적 및 실시간 데이터 수집 시작
 */
function init() {
    initSearchFocus();
    initPanels();
    initRadius();
    updateSummary();

    // 터치 디바이스 정밀 감지 (모바일 터치 최적화 스타일 적용)
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

    // 웹 접근성(A11y): Escape 키를 통한 계층적 오버레이 닫기 및 포커스 관리
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

        // 웹 접근성(A11y): 바텀시트 활성화 상태에서 Tab 키 순환 포커스 트랩(Focus Trap)
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

    if (typeof kakao === 'undefined' || !kakao.maps) {
        setStatus('카카오 지도 SDK를 불러오지 못했습니다.');
        return;
    }

    // 카카오 지도 SDK 비동기 초기화
    kakao.maps.load(() => {
        state.map = new kakao.maps.Map(byId('map'), {
            center: new kakao.maps.LatLng(SEOUL.lat, SEOUL.lng),
            level: 6
        });

        // 지도 이동 및 줌 완료(idle) 시에만 마커 갱신 (불필요한 렌더링 최소화)
        kakao.maps.event.addListener(
            state.map,
            'idle',
            () => updateMarkers()
        );

        for (const eventName of ['dragstart', 'zoom_start']) {
            kakao.maps.event.addListener(
                state.map,
                eventName,
                blurKeyword
            );
        }

        window.addEventListener('resize', () => {
            state.map.relayout();
            updateMarquees();
        });

        byId('location-button').disabled = false;
        byId('refresh-button').disabled = false;

        // 초기 실시간 공공데이터 수집 및 사용자 위치 자동 측정
        loadData();
        locate();

        // [문서화 및 테스트 자동 스크린샷 캡처 훅]
        const previewMode = new URLSearchParams(window.location.search).get('preview');
        if (previewMode) {
            handlePreviewMode(previewMode);
        }
    });
}

/**
 * README.md 문서 및 프레젠테이션용 자동 캡처 모드 핸들러
 * @param {string} mode - 'notice' | 'map' | 'radius' | 'detail' | 'cluster'
 */
function handlePreviewMode(mode) {
    if (mode === 'notice') {
        // 이용안내 면책조항 모달 유지
        return;
    }

    // 다른 모드에서는 안내 모달 자동 닫기
    byId('notice-dialog')?.close();

    if (mode === 'radius') {
        setTimeout(() => {
            byId('radius-button')?.click();
        }, 1500);
    } else if (mode === 'detail' || mode === 'hospital') {
        const checkAndOpen = setInterval(() => {
            if (state.hospitals.length > 0) {
                clearInterval(checkAndOpen);
                const target = state.hospitals.find(h => h.regional || h.type?.group === 'tertiary') || state.hospitals[0];
                openHospital(target);
            }
        }, 300);
        setTimeout(() => clearInterval(checkAndOpen), 12000);
    } else if (mode === 'cluster') {
        const checkAndCluster = setInterval(() => {
            if (state.hospitals.length > 2) {
                clearInterval(checkAndCluster);
                openCluster(state.hospitals.slice(0, 3));
            }
        }, 300);
        setTimeout(() => clearInterval(checkAndCluster), 12000);
    }
}

// 애플리케이션 실행
init();