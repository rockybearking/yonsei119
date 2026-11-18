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
 * - export const : 선언과 동시에 초기화한 상수를 외부 ES 모듈에 공개하는 키워드 조합임.
 *   · 비교 : 파일 내부 전용은 `const`, 기본 내보내기는 `export default`임.
 * - `UPPER_SNAKE_CASE` 명명 관례 : 실행 중 바뀌지 않는 고정 설정 상수임을 구분함.
 *
 * [프로젝트 상수명]
 * - `CARD_WIDTH` / `CARD_HEIGHT` : 지도 위 병원 카드의 픽셀 크기(`174 × 62`) 상수임.
 *   · `css/map-overlays.css` 규격과 맞추고 `markers-cluster.js` 격자 계산에 씀.
 * - `GL_ROUTE_SOURCE_ID` : WebGL 지도 내부에 GeoJSON 경로를 등록할 때 쓰는 고유 ID임.
 *   · `directions-eta.js`의 경로 렌더링·제거와 `app.js` 진단 객체에서 참조함.
 * - `NOTICE_KEY` / `OFFLINE_SNAPSHOT_KEY` : `localStorage` 저장·조회에 쓰는 키 문자열임.
 *   · 이용 안내 숨김 플래그와 오프라인 비상용 병원 스냅샷 JSON을 저장함.
 * - `DEFAULT_NAVER_CLIENT_ID` / `DEFAULT_NAVER_DARK_STYLE_ID` : 기본 네이버 지도 공개 ID와 다크 스타일 UUID임.
 *   · 서버 설정 수신 전이나 정적 미리보기 상태에서 초기값으로 사용함.
 * - `LARGE_MONITOR_MIN_WIDTH` / `LARGE_MONITOR_MIN_HEIGHT` / `MOBILE_MAX_WIDTH` : 반응형 화면 분기 픽셀 기준임.
 *   · `1200×680` 이상은 대화면 모달, `640` 이하와 터치 기기는 모바일 UI로 전환함.
 *
 * [동작 흐름]
 * - 초기화 연동 :
 *   ├── `state.js` 로딩 ──> `DEFAULT_NAVER_CLIENT_ID`·`DEFAULT_NAVER_DARK_STYLE_ID` 초기 적용
 *   └── `search-controls.js:syncFrontendConfig()` ──> `GET /api/config` 응답 수신 ──> 변경 시 재동기화
 */

export const CAN_USE_CSS_TRANSLATE =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('translate', '0px');
/*
 * [JS 문법]
 * - export const : 모듈 로드 시 기능 지원 여부를 1회만 판별해 불리언 상수로 내보냄.
 * - typeof : 피연산자의 자료형 문자열(`'undefined'`, `'function'`)을 반환하는 단항 연산자임.
 * - !== / === / && : 앞 조건이 참일 때만 뒤를 평가해 전역 객체 부재 시 오류를 막음.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - CSS : CSS 객체 모델(CSSOM) 기능 탐지 유틸리티를 제공하는 전역 네임스페이스임.
 * - CSS.supports(propertyName, value) : 브라우저가 해당 CSS 속성과 값 조합을 지원하는지 반환함.
 *
 * [프로젝트 상수명]
 * - `CAN_USE_CSS_TRANSLATE` : 개별 CSS `translate` 속성 지원 여부(`true`/`false`)를 담는 상수임.
 *
 * [동작 흐름]
 * - 호출 출처 : `map-engine.js`의 `createNaverDomOverlay()`(`onAdd()`, `draw()`)가 카드 좌표를 옮길 때 참조함.
 * - 분기 흐름 :
 *   ├── `CAN_USE_CSS_TRANSLATE === true` ──> GPU 합성 친화적인 `style.translate` 사용
 *   └── `CAN_USE_CSS_TRANSLATE === false` ──> 구형 엔진 호환용 `style.left`·`style.top` 폴백
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
 * [JS 문법]
 * - export const / 배열 리터럴 `[ ... ]` / 객체 리터럴 `{ ... }` : 8개 항목 메타데이터를 배열로 내보냄.
 *
 * [프로젝트 상수명 및 속성명]
 * - 상수명 : `SYMPTOM_PRESETS` (응급 증상 및 상황별 빠른 필터 칩 정의 배열).
 * - 객체 속성명 :
 *   · `key` : 필터 식별 코드(`'all'`, `'pediatric'`, `'stroke'`, `'cardiac'` 등).
 *   · `label` : 화면 버튼에 표시할 짧은 한글 라벨.
 *   · `title` : 마우스를 올렸을 때 보여 줄 툴팁 설명 문자열.
 *
 * [동작 흐름]
 * - UI 생성 : `SYMPTOM_PRESETS` ──> `search-controls.js:renderSymptomChips()` ──> `#symptom-chips-bar` 버튼 생성
 * - 양쪽 규칙 일치 : 각 `key` ──> `utils.js:matchesSymptomPresetClient()` & 백엔드 `HospitalRecommendationScorer` 공유
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
 * [JS 문법]
 * - export const / 객체 리터럴 `{ 키: 값 }` : 영문 필드명과 한글 명칭을 1:1 키-값 쌍으로 묶은 사전임.
 *
 * [프로젝트 상수명]
 * - `EQUIPMENT` : 국립중앙의료원 API의 11종 특수 장비 필드(`hv*ayn`)를 한글명으로 바꾸는 사전임.
 *
 * [동작 흐름]
 * - 흐름 : `EQUIPMENT` ──> `API_FIELD_LABELS`에 전개 병합 ──> `utils.js:fieldLabel()` 조회 ──> 개발자 모드 한글 병기
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
 * [JS 문법]
 * - export const / 객체 리터럴 : 실시간 가용 병상·장비 키(`hv1`~`hv61`)와 한글 설명의 매핑 사전임.
 *
 * [프로젝트 상수명]
 * - `HV_LABELS` : 국립중앙의료원 실시간 가용 병상 API의 `hv*` 필드 한글 사전 상수임.
 *
 * [동작 흐름]
 * - 흐름 : `HV_LABELS` ──> `API_FIELD_LABELS` 병합 ──> `utils.js:fieldLabel()` & `hospital-sheet.js:renderRawBeds()` ──> `#all-beds` 출력
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
 * [JS 문법]
 * - export const / 객체 리터럴 : 기준 병상·보유 장비 수 키(`hvs01`~`hvs61`)와 한글 설명의 매핑 사전임.
 *
 * [프로젝트 상수명]
 * - `HVS_LABELS` : 가용 병상 포화도를 판단할 때 기준 총수 역할을 하는 `hvs*` 필드 한글 사전 상수임.
 *
 * [동작 흐름]
 * - 흐름 : `HVS_LABELS` ──> `API_FIELD_LABELS` 병합 ──> `utils.js:fieldLabel()` & `hospital-sheet.js:renderRawBeds()` ──> `#all-beds` 기준 설명 출력
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
 * [JS 문법]
 * - export const : 통합된 필드 사전 상수를 외부 모듈에 공개함.
 * - 객체 전개 구문 (`...객체`) : 기존 객체의 열거 가능 키-값 쌍을 새 객체 안에 펼쳐 복사함.
 *   · 주의 : 뒤에 선언한 같은 이름의 키가 앞선 값을 덮어씀.
 *
 * [프로젝트 상수명]
 * - `API_FIELD_LABELS` : `HV_LABELS`·`HVS_LABELS`·`EQUIPMENT`와 기본 병상·입력일시(`hvidate`)·당직의(`hvdnm`)를 합친 마스터 사전임.
 *   · 뒤에 다시 선언한 `hv*ayn` 키는 `(가/부)` 표기를 보강하려고 앞선 `EQUIPMENT` 값을 덮어씀.
 *
 * [동작 흐름]
 * - 흐름 : `utils.js:fieldLabel(key)` ──> 소문자 변환 후 `API_FIELD_LABELS[key]` 조회 ──> `hospital-sheet.js:renderRawBeds()` ──> `#all-beds` 렌더링
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
 * [JS 문법]
 * - export const / 중첩 배열·객체 리터럴 : 그룹 제목과 하위 항목 배열을 2단 계층으로 묶은 구조임.
 *
 * [프로젝트 상수명]
 * - `SEVERE_DISEASE_GROUPS` : 28대 중증응급질환(`mkioskty1`~`mkioskty28`)을 16개 화면 그룹으로 묶은 스키마임.
 *
 * [동작 흐름]
 * - 사용처 :
 *   ├── `hospital-sheet.js:renderSevere()` ──> `#severe` 영역에 질환별 수용 여부 표시
 *   └── `app.js` 진단 `getSchemas()` ──> 스키마 목록 참조 반환
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
 * [JS 문법]
 * - export const / 중첩 객체·문자열 배열 리터럴 : 키마다 `codes`와 `names` 배열을 함께 묶어 정의함.
 *
 * [프로젝트 상수명]
 * - `SPECIFIC_BLOCK_TARGETS` : 중증질환(`mkioskty1~27`)과 실시간 진료 공지를 대조할 매핑 테이블임.
 *   · `codes` : 공지 유형 코드(`symtypcod`) 매칭 목록.
 *   · `names` : 공지 질환명(`symtypcodmag`)·본문(`symblkmsg`) 매칭 키워드 목록.
 *
 * [동작 흐름]
 * - 흐름 : `utils.js:isDiseaseSpecificallyBlocked()` ──> `SPECIFIC_BLOCK_TARGETS[itemKey]` 대조
 *   └── API가 `'Y'`여도 차단 공지가 있으면 ──> `hospital-sheet.js:renderSevere()`가 `'불가능'`으로 보정
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
 * [JS 문법]
 * - export const / 객체 리터럴 : 여러 종류의 문자열 키와 한글 설명을 하나의 사전 객체로 묶음.
 *
 * [프로젝트 상수명]
 * - `MKIOSKTY_METADATA` : 중증질환 원본 필드의 공식 한글 명칭 사전 상수임.
 *   · 구성 : 28대 중증질환 키, 영유아 가능연령 비고 5개(`mkioskty*msg`), 보고일시 2개(`mkioskdate`, `hvidate`).
 *
 * [동작 흐름]
 * - 흐름 : `MKIOSKTY_METADATA` ──> `hospital-sheet.js:renderRawSevere()` ──> 개발자 모드 `#all-severe` 대조표 출력
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
 * [JS 문법]
 * - export const / 객체 배열 리터럴 : 같은 구조의 설정 객체 여러 개를 배열에 순서대로 담음.
 *
 * [프로젝트 상수명 및 속성명]
 * - 상수명 : `EMERGENCY_BED_ITEMS` (응급실 병상 보드에 그릴 11종 핵심 병상 목록).
 * - 속성명 : `label`(표시 명칭), `current`(현재 가용 키), `baseline`(기준 총 병상 키).
 *
 * [동작 흐름]
 * - 사용처 :
 *   ├── `hospital-sheet.js:renderErBeds()` ──> `#er-beds-board`에 가용·기준 병상 짝지어 표시
 *   └── `app.js` 진단 `getSchemas()` ──> 스키마 참조용 반환
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
 * [JS 문법]
 * - export const / 중첩 섹션 배열 리터럴 / `null` 리터럴 : 대분류 제목과 세부 항목 배열을 묶음.
 *   · 참고 : 값이 아예 존재하지 않는 필드는 `null`로 명시해 누락과 구분함.
 *
 * [프로젝트 상수명 및 속성명]
 * - 상수명 : `INPATIENT_BED_SECTIONS` (입원·배후진료 수용 여부를 확인하는 6개 섹션 34개 병상 스키마).
 *   · 섹션 : 중환자실, 응급전용, 외상전용, 감염병 전담병상, 입원실, 기타.
 * - 특수 속성 : 정형외과(`hv4`)는 기준 키가 없어 `baseline: null`, 분만실(`hv42`)은 `type: 'delivery'`를 둠.
 *
 * [동작 흐름]
 * - 사용처 :
 *   ├── `hospital-sheet.js:renderInpatientBeds()` ──> `#inpatient-beds-board` 섹션별 병상 셀 생성
 *   └── `app.js` 진단 `getSchemas()` ──> 스키마 목록 반환
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
 * [JS 문법]
 * - export const / 객체 배열 리터럴 / `null` 리터럴 : 항목마다 가용 키와 기준 키를 짝지어 정의함.
 *
 * [프로젝트 상수명 및 속성명]
 * - 상수명 : `EQUIPMENT_TABLE_ITEMS` (상세 시트 가용 장비 보드에 그릴 11종 특수 의료장비 목록).
 * - 속성명 : `label`(장비 이름), `key`(가용 여부 필드), `baseline`(기준 대수 필드, 구급차 `hvamyn`은 `null`).
 *
 * [동작 흐름]
 * - 사용처 :
 *   ├── `hospital-sheet.js:renderEquipment()` ──> `#equipment`에 장비 가용 상태와 기준 대수 표시
 *   └── `app.js` 진단 `getSchemas()` ──> 스키마 목록 반환
 */
