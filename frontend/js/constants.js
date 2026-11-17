export const CARD_WIDTH = 174;
export const CARD_HEIGHT = 62;
export const GL_ROUTE_SOURCE_ID = 'yonsei-route-source';
export const NOTICE_KEY = 'emergency-notice-hidden-v1';
export const OFFLINE_SNAPSHOT_KEY = 'yonsei119-offline-snapshot-v1';
export const DEFAULT_NAVER_CLIENT_ID = 'xfbxloc8km';
export const DEFAULT_NAVER_DARK_STYLE_ID = '4b12b380-f70c-4d42-85df-ecf7961ff041';
export const LARGE_MONITOR_MIN_WIDTH = 1200;
export const LARGE_MONITOR_MIN_HEIGHT = 680;
export const MOBILE_MAX_WIDTH = 640;
/*
 * [JS 문법]
 * - export const : 현재 모듈 파일 밖(`app.js`, `markers-cluster.js` 등)에서도 `import { ... }`로 가져다 쓸 수 있도록 공개 상수를 선언하는 ES Module 문법임.
 *   (형제 문법: 파일 안에서만 숨겨 쓰는 `const`, 모듈의 대표값 1개만 내보내는 `export default`)
 * [내가 지은 이름]
 * - 대문자 스네이크 표기법(`UPPER_SNAKE_CASE`)은 프로그램 실행 중 절대 변하지 않는 고정 기준값(상수)임을 초보자도 한눈에 알아보게 하는 관례임.
 * - CARD_WIDTH(174px) / CARD_HEIGHT(62px) : `css/map-overlays.css`의 `.hospital-card` 크기와 1:1로 맞춘 2D 공간 해시 격자 기준 픽셀임.
 * - GL_ROUTE_SOURCE_ID : 네이버 WebGL 지도 내부에 단일 자동차 경로 GeoJSON 데이터를 꽂아 넣는 고유 레이어 소스 이름임.
 * - NOTICE_KEY / OFFLINE_SNAPSHOT_KEY : 브라우저 `localStorage` 금고에 이용 안내 숨김 여부와 오프라인 비상용 병원 스냅샷을 저장하는 열쇠 이름임.
 * - DEFAULT_NAVER_CLIENT_ID / DEFAULT_NAVER_DARK_STYLE_ID : 백엔드 `/api/config` 응답 전이나 정적 미리보기에서 사용할 기본 네이버 지도 키·다크 스타일 UUID임.
 * - LARGE_MONITOR_MIN_WIDTH / LARGE_MONITOR_MIN_HEIGHT / MOBILE_MAX_WIDTH : 상세 시트(`#sheet`)를 바텀시트·우측드로어·중앙모달 3단계로 자동 변신시키는 화면 해상도 경계값임.
 */

export const CAN_USE_CSS_TRANSLATE =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('translate', '0px');
/*
 * [JS 문법] typeof : 전역 객체나 함수가 현재 브라우저에 존재하는지 안전하게 자료형 문자열(`'object'`, `'function'`, `'undefined'`)을 확인하는 연산자임.
 * [브라우저 내장 도구(API) & 내장 함수]
 * - CSS.supports('속성명', '값') : 현재 모바일/PC 브라우저 엔진이 최신 CSS 개별 `translate` 속성(GPU 합성 전용)을 지원하는지 판별하는 표준 함수임 (이름 변경 불가).
 * [내가 지은 이름] CAN_USE_CSS_TRANSLATE : 지원 시 `true`(GPU `style.translate` 사용), 구형 브라우저 시 `false`(`left`/`top` 폴백)를 담는 불리언 상수임.
 */

export const SYMPTOM_PRESETS = [
    { key: 'all', label: '전체 기관', title: '종별 체크박스에 해당하는 모든 응급의료기관 표시' },
    { key: 'pediatric', label: '소아응급', title: '소아응급 병상(hv28 등) 여유 또는 영유아 중증질환 수용 가능 병원' },
    { key: 'stroke', label: '뇌졸중·뇌출혈', title: '뇌경색 재관류(mkioskty2) 또는 뇌출혈 수술(mkioskty3·4) 수용 가능 병원' },
    { key: 'cardiac', label: '흉통·심근경색', title: '심근경색 재관류(mkioskty1) 또는 흉·복부 대동맥응급(mkioskty5·6) 수용 가능 병원' },
    { key: 'trauma', label: '중증외상·접합', title: '권역외상센터·외상소생실(hv60) 가용 또는 사지접합(mkioskty20·21) 수용 가능 병원' },
    { key: 'obstetrics', label: '산부인과·분만', title: '분만실(hv42) 가용 또는 산부인과 응급수술(mkioskty16~18) 수용 가능 병원' },
    { key: 'burn', label: '중증화상', title: '화상 중환자실·처치실(hv8·hv43) 또는 중증화상 전문치료(mkioskty19) 수용 가능 병원' },
    { key: 'dialysis', label: '응급투석', title: 'CRRT 장비 가용 또는 응급 혈액투석(mkioskty22·23) 수용 가능 병원' }
];
/*
 * [내가 지은 이름] SYMPTOM_PRESETS : 위급한 환자·보호자가 복잡한 공공데이터 영문 코드(`mkioskty1~28`)를 몰라도 원터치로 필터링할 수 있는 증상 프리셋 배열임.
 * [백엔드-프론트엔드 정합성 원리]
 * - 각 객체의 `key` 값(`'pediatric'`, `'stroke'`, `'cardiac'` 등)은 백엔드 `HospitalRecommendationScorer.java`의 `matchesSymptomPreset()` 스위치 분기값과
 *   100% 동일하게 설계되어, 지도 마커 필터링과 백엔드 `GET /api/directions/rank?symptom=...` 실도로 추천 순위가 한 치의 오차도 없이 똑같이 동작함.
 */

export const EQUIPMENT = {
    hvamyn: '구급차',
    hvangioayn: '혈관촬영기',
    hvcrrtayn: '지속적 신대체요법(CRRT)',
    hvctayn: 'CT',
    hvecmoayn: 'ECMO',
    hvhypoayn: '중심체온조절유도기(저체온치료)',
    hvincuayn: '인큐베이터',
    hvmriayn: 'MRI',
    hvoxyayn: '고압산소치료기',
    hvventiayn: '인공호흡기 일반',
    hvventisoayn: '인공호흡기 조산아'
};
/*
 * [내가 지은 이름] EQUIPMENT : 국립중앙의료원(NMC) 응급의료 OpenAPI의 11대 핵심 특수장비 가용여부 태그(`hv*ayn`)를 한글 장비명으로 번역하는 사전 객체임.
 */

export const HV_LABELS = {
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
/*
 * [내가 지은 이름] HV_LABELS : 공공데이터 XML의 실시간 가용 병상 영문 코드(`hv1`~`hv61`)를 시민과 의료진이 읽을 수 있는 한글 명칭으로 대응시킨 매핑 사전임.
 */

export const HVS_LABELS = {
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
    hvs31: '인공호흡기 조산아 기준',
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
/*
 * [내가 지은 이름] HVS_LABELS : 병상 포화율(`현재 가용 병상 / 총 기준 병상`) 계산 시 분모가 되는 기준 병상수(`hvs01`~`hvs61`) 한글 라벨 사전임.
 */

export const API_FIELD_LABELS = {
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
    hvdnm: '당직의',
    hvctayn: 'CT가용(가/부)',
    hvmriayn: 'MRI가용(가/부)',
    hvangioayn: '혈관촬영기가용(가/부)',
    hvventiayn: '인공호흡기가용(가/부)',
    hvventisoayn: '인공호흡기 조산아가용(가/부)',
    hvincuayn: '인큐베이터가용(가/부)',
    hvcrrtayn: 'CRRT가용(가/부)',
    hvecmoayn: 'ECMO가용(가/부)',
    hvoxyayn: '고압산소치료기가용(가/부)',
    hvhypoayn: '중심체온조절유도기가용(가/부)',
    hvamyn: '구급차가용여부'
};
/*
 * [JS 문법] ...객체명 (전개 구문, Spread Syntax) : 기존 사전 객체(`HV_LABELS`, `HVS_LABELS`, `EQUIPMENT`)의 모든 키-값 쌍을 새 통합 사전에 펼쳐서 합침.
 * [내가 지은 이름] API_FIELD_LABELS : 개발자 모드 원본 인스펙터에서 모든 병상·장비 XML 태그 옆에 한글 설명을 붙여 주는 통합 마스터 사전임.
 */

export const SEVERE_DISEASE_GROUPS = [
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
    },
    {
        title: '응급실 게이트키퍼',
        items: [
            { label: '응급실(Emergency gate keeper)', key: 'mkioskty28' }
        ]
    }
];
/*
 * [내가 지은 이름] SEVERE_DISEASE_GROUPS : 중앙응급의료센터 E-Gen 표준 28대 중증응급질환(`mkioskty1`~`mkioskty28`)을 16개 전문 진료군으로 묶은 스키마 배열임.
 */

export const SPECIFIC_BLOCK_TARGETS = {
    mkioskty1: { codes: ['Y0010'], names: ['심근경색', '관상동맥중재술'] },
    mkioskty2: { codes: ['Y0020'], names: ['뇌경색', '혈전용해술'] },
    mkioskty3: { codes: ['Y0031'], names: ['거미막하출혈', '지주막하출혈', '뇌동맥류 수술'] },
    mkioskty4: { codes: ['Y0032'], names: ['거미막하출혈 외', '기타 뇌출혈'] },
    mkioskty5: { codes: ['Y0041'], names: ['대동맥응급(흉부)', '흉부대동맥'] },
    mkioskty6: { codes: ['Y0042'], names: ['대동맥응급(복부)', '복부대동맥'] },
    mkioskty7: { codes: ['Y0051'], names: ['담낭질환', '담낭 수술'] },
    mkioskty8: { codes: ['Y0052'], names: ['담도포함질환', '담도질환'] },
    mkioskty9: { codes: ['Y0060'], names: ['복부응급수술(비외상)', '비외상 복부수술'] },
    mkioskty10: { codes: ['Y0070'], names: ['장중첩/폐색(유아)', '장중첩'] },
    mkioskty11: { codes: ['Y0081'], names: ['위장관 응급내시경(성인)'] },
    mkioskty12: { codes: ['Y0082'], names: ['위장관 응급내시경(영유아)'] },
    mkioskty13: { codes: ['Y0091'], names: ['기관지 응급내시경(성인)'] },
    mkioskty14: { codes: ['Y0092'], names: ['기관지 응급내시경(영유아)'] },
    mkioskty15: { codes: ['Y0100'], names: ['저출생체중아', '저체중출생아'] },
    mkioskty16: { codes: ['Y0111'], names: ['산부인과 응급(분만)', '분만', '자연분만', '제왕절개'] },
    mkioskty17: { codes: ['Y0112'], names: ['산부인과 응급(산과수술)', '산과수술'] },
    mkioskty18: { codes: ['Y0113'], names: ['산부인과 응급(부인과수술)', '부인과수술'] },
    mkioskty19: { codes: ['Y0120'], names: ['중증화상', '화상 전문치료'] },
    mkioskty20: { codes: ['Y0131'], names: ['수족지접합'] },
    mkioskty21: { codes: ['Y0132'], names: ['수족지접합 외'] },
    mkioskty22: { codes: ['Y0141'], names: ['응급투석(HD)', '응급투석 (HD)', '혈액투석', '인공신장실'] },
    mkioskty23: { codes: ['Y0142'], names: ['응급투석(CRRT)', '응급투석 (CRRT)', 'CRRT'] },
    mkioskty24: { codes: ['Y0150'], names: ['정신과적 응급입원', '폐쇄병동'] },
    mkioskty25: { codes: ['Y0160'], names: ['안과적 응급 수술', '안과 응급 수술'] },
    mkioskty26: { codes: ['Y0171'], names: ['영상의학혈관중재(성인)'] },
    mkioskty27: { codes: ['Y0172'], names: ['영상의학혈관중재(영유아)'] }
};
/*
 * [내가 지은 이름] SPECIFIC_BLOCK_TARGETS : 중증질환 API에는 `'Y'(가능)`로 남아 있더라도, 병원이 실시간 공지(`symtypcod` / `symtypcodmag`)로
 * 특정 수술·시술 불가를 올렸을 때 이를 교차 검증하여 붉은색 `'불가능'`으로 덮어쓰기 위한 코드 매핑표임.
 */

export const MKIOSKTY_METADATA = {
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
/*
 * [내가 지은 이름] MKIOSKTY_METADATA : 개발자 모드 원본 대조 표(`#all-severe`)에서 `mkioskty1~28` 및 연령 비고 필드의 공식 한글 명칭을 표시하는 사전임.
 */

export const EMERGENCY_BED_ITEMS = [
    { label: '일반', current: 'hvec', baseline: 'hvs01' },
    { label: '소아', current: 'hv28', baseline: 'hvs02' },
    { label: '외상소생실', current: 'hv60', baseline: 'hvs60' },
    { label: '외상환자진료구역', current: 'hv61', baseline: 'hvs61' },
    { label: '일반격리', current: 'hv30', baseline: 'hvs04' },
    { label: '음압격리', current: 'hv29', baseline: 'hvs03' },
    { label: '격리진료구역 일반격리', current: 'hv14', baseline: 'hvs47' },
    { label: '격리진료구역 음압격리', current: 'hv13', baseline: 'hvs46' },
    { label: '소아일반격리', current: 'hv16', baseline: 'hvs49' },
    { label: '소아음압격리', current: 'hv15', baseline: 'hvs48' },
    { label: '코호트격리', current: 'hv27', baseline: 'hvs59' }
];
/*
 * [내가 지은 이름] EMERGENCY_BED_ITEMS : 상세 시트 '응급실 병상' 전광판(`#er-beds-board`)에 그릴 11개 핵심 응급실 병상(가용 필드 `current` ↔ 기준 필드 `baseline`) 정의임.
 */

export const INPATIENT_BED_SECTIONS = [
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
        title: '감염병 전담병상',
        items: [
            { label: '중환자실', current: 'hv22', baseline: 'hvs54' },
            { label: '중환자실 음압격리', current: 'hv23', baseline: 'hvs55' },
            { label: '[감염] 중증 병상', current: 'hv24', baseline: 'hvs56' },
            { label: '[감염] 준·중증 병상', current: 'hv25', baseline: 'hvs57' },
            { label: '[감염] 중등증 병상', current: 'hv26', baseline: 'hvs58' }
        ]
    },
    {
        title: '입원실',
        items: [
            { label: '일반', current: 'hvgc', baseline: 'hvs38' },
            { label: '외과입원실(정형외과)', current: 'hv4', baseline: null },
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
/*
 * [내가 지은 이름] INPATIENT_BED_SECTIONS : 응급 처치 후 배후 진료(최종 수용) 가능 여부를 판단할 수 있는 중환자실·응급전용·외상전용·입원실 섹션 스키마임.
 */

export const EQUIPMENT_TABLE_ITEMS = [
    { label: '인공호흡기 일반', key: 'hvventiayn', baseline: 'hvs30' },
    { label: '인공호흡기 조산아', key: 'hvventisoayn', baseline: 'hvs31' },
    { label: '인큐베이터', key: 'hvincuayn', baseline: 'hvs32' },
    { label: 'CRRT', key: 'hvcrrtayn', baseline: 'hvs33' },
    { label: 'ECMO', key: 'hvecmoayn', baseline: 'hvs34' },
    { label: '중심체온조절유도기', key: 'hvhypoayn', baseline: 'hvs35' },
    { label: '고압산소치료기', key: 'hvoxyayn', baseline: 'hvs37' },
    { label: 'CT', key: 'hvctayn', baseline: 'hvs27' },
    { label: 'MRI', key: 'hvmriayn', baseline: 'hvs28' },
    { label: '혈관촬영기', key: 'hvangioayn', baseline: 'hvs29' },
    { label: '구급차 가용여부', key: 'hvamyn', baseline: null }
];
/*
 * [내가 지은 이름] EQUIPMENT_TABLE_ITEMS : 상세 시트 '가용 장비' 보드(`#equipment`)에 렌더링할 11종 특수 의료 장비와 보유 대수(`hvs*`) 매핑 목록임.
 */
