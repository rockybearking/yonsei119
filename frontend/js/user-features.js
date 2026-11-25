/*
 * ============================================================================
 * [1. 역할 및 실행 시점]
 * - 역할 : 전국 대학교병원(의료원 제외)의 소속 대학교 엠블럼 워터마크 매칭 및
 *          구버전 미사용 로컬 저장소 키 정리를 담당하는 모듈
 * - 실행 시점 : 앱 부팅 시 `loadPersistedUserPrefs()`가 1회 실행되며,
 *              병원 상세 시트를 열 때마다 `resolveUniversityHospitalLogo()`가 호출됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [hospital-sheet.js]               [user-features.js]           [UNIVERSITY_LOGOS]
 *                |                                 |                            |
 *                |-- 1. resolveUniversityLogo() -->|                            |  병원 선택 시 로고 조회
 *           +----+---------------------------------+----------------------------+----------+
 *           | [alt : medical center ('medical')]                                           |  지방의료원 여부 검사
 *           |    |<-- 2a. null (excluded) ---------|                            |          |  의료원은 배경 로고 제외
 *           +----+---------------------------------+----------------------------+----------+
 *           | [else : university hospital]                                                 |  전국 대학교병원 매칭
 *           |    |                                 |-- 2b. match name / hpid -->|          |  병원명 규칙 · 기관코드 대조
 *           |    |<-- 3. assetPath (.svg/.png) ----|                            |          |  시트 정적 워터마크 표시
 *           +----+---------------------------------+----------------------------+----------+
 *                v                                 v                            v
 *
 * [3. 사용된 요소 구분 (표준 내장)]
 * - JS / 브라우저 표준 내장
 *   ㄴ Object.freeze()          : 대학 로고·기관코드 사전을 변경 불가능하게 잠그는 내장 메서드
 *   ㄴ String.prototype.replace : 공백·괄호·특수문자를 제거해 병원명을 정규화하는 메서드
 *   ㄴ localStorage.removeItem  : 구버전 잔여 설정 키를 삭제하는 브라우저 저장소 메서드
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 프론트엔드 사용처
 *   ㄴ frontend/js/app.js            : `init()`에서 `loadPersistedUserPrefs()` 호출
 *   ㄴ frontend/js/hospital-sheet.js : `syncSheetUniversityWatermark()`에서 로고 매칭 호출
 * - 연결 HTML / CSS / 정적 자산
 *   ㄴ frontend/index.html            : `#sheet-univ-watermark`, `#sheet-univ-logo`
 *   ㄴ frontend/css/sheet-egen.css    : 정적 고정 워터마크 투명도 및 반투명 카드 스타일
 *   ㄴ frontend/Assets/universities/* : 41개 대학교 공식 SVG/PNG 로고 파일
 * ============================================================================
 */

// [상수] 이전 버전에서 제거된 기능들의 잔여 localStorage 키 목록
const LEGACY_REMOVED_KEYS = [
    'yonsei119-favorites-v1',
    'yonsei119-bed-alert-v1',
    'yonsei119-lang-v1',
    'yonsei119-recent-v1'
];

// [상수] 전국 41개 의과대학·대학교병원 엠블럼 자산 사전 (`Object.freeze`로 런타임 변조 방지)
const UNIVERSITY_LOGOS = Object.freeze({
    ajou: { name: '아주대학교', file: 'ajou.png' },
    catholic: { name: '가톨릭대학교', file: 'catholic.svg' },
    cau: { name: '중앙대학교', file: 'cau.png' },
    cbnu: { name: '충북대학교', file: 'cbnu.png' },
    cha: { name: '차의과학대학교', file: 'cha.svg' },
    choonhae: { name: '춘해보건대학교', file: 'choonhae.png' },
    chosun: { name: '조선대학교', file: 'chosun.png' },
    cku: { name: '가톨릭관동대학교', file: 'cku.svg' },
    cnu: { name: '충남대학교', file: 'cnu.svg' },
    cu: { name: '대구가톨릭대학교', file: 'cu.png' },
    dankook: { name: '단국대학교', file: 'dankook.svg' },
    deu: { name: '동의대학교', file: 'deu.png' },
    donga: { name: '동아대학교', file: 'donga.png' },
    dongguk: { name: '동국대학교', file: 'dongguk.svg' },
    eulji: { name: '을지대학교', file: 'eulji.svg' },
    ewha: { name: '이화여자대학교', file: 'ewha.svg' },
    gachon: { name: '가천대학교', file: 'gachon.svg' },
    gnu: { name: '경상국립대학교', file: 'gnu.png' },
    hallym: { name: '한림대학교', file: 'hallym.svg' },
    hanyang: { name: '한양대학교', file: 'hanyang.svg' },
    inha: { name: '인하대학교', file: 'inha.svg' },
    inje: { name: '인제대학교', file: 'inje.png' },
    jbnu: { name: '전북대학교', file: 'jbnu.svg' },
    jejunu: { name: '제주대학교', file: 'jejunu.png' },
    jnu: { name: '전남대학교', file: 'jnu.svg' },
    kangwon: { name: '강원대학교', file: 'kangwon.svg' },
    khu: { name: '경희대학교', file: 'khu.png' },
    kmu: { name: '계명대학교', file: 'kmu.png' },
    knu: { name: '경북대학교', file: 'knu.png' },
    konkuk: { name: '건국대학교', file: 'konkuk.svg' },
    konyang: { name: '건양대학교', file: 'konyang.svg' },
    korea: { name: '고려대학교', file: 'korea.svg' },
    kosin: { name: '고신대학교', file: 'kosin.png' },
    pusan: { name: '부산대학교', file: 'pusan.svg' },
    sch: { name: '순천향대학교', file: 'sch.png' },
    skku: { name: '성균관대학교', file: 'skku.svg' },
    snu: { name: '서울대학교', file: 'snu.svg' },
    ulsan: { name: '울산대학교', file: 'ulsan.png' },
    wonkwang: { name: '원광대학교', file: 'wonkwang.svg' },
    yonsei: { name: '연세대학교', file: 'yonsei.svg' },
    yu: { name: '영남대학교', file: 'yu.svg' }
});

// [상수] 국립중앙의료원 기관코드(HPID) 기준 대학교병원·상급종합병원 확정 매핑 테이블
const UNIVERSITY_BY_HPID = Object.freeze({
    A1400001: 'gachon',    // 의료법인 길의료재단 길병원 (가천대길병원)
    A1400015: 'cku',       // 가톨릭관동대학교국제성모병원
    A1100011: 'catholic',  // 가톨릭대학교 여의도성모병원
    A1100012: 'catholic',  // 학교법인가톨릭학원가톨릭대학교서울성모병원
    A1121013: 'catholic',  // 가톨릭대학교은평성모병원
    A1400012: 'catholic',  // 가톨릭대학교 인천성모병원
    A1600005: 'catholic',  // 학교법인가톨릭학원가톨릭대학교대전성모병원
    A2100012: 'catholic',  // 가톨릭대학교성빈센트병원
    A2100040: 'catholic',  // 가톨릭대학교의정부성모병원
    A2100052: 'catholic',  // 가톨릭대학교부천성모병원
    A2200009: 'kangwon',   // 강원대학교병원
    A1100002: 'konkuk',    // 건국대학교병원
    A2300010: 'konkuk',    // 건국대학교충주병원
    A1600006: 'konyang',   // 학교법인건양교육재단건양대학교병원
    A2400038: 'konyang',   // 학교법인건양교육재단건양대학교부여병원
    A1300002: 'knu',       // 경북대학교병원
    A1300010: 'knu',       // 칠곡경북대학교병원
    A2800001: 'gnu',       // 경상국립대학교병원
    A2803505: 'gnu',       // 창원경상국립대학교병원
    A1100001: 'khu',       // 경희대학교병원
    A1100043: 'khu',       // 강동경희대학교병원
    A1300003: 'kmu',       // 계명대학교동산병원
    A1303386: 'kmu',       // 계명대학교대구동산병원
    A2700097: 'kmu',       // 계명대학교경주동산병원
    A1100008: 'korea',     // 고려대학교의과대학부속병원(안암병원)
    A1100014: 'korea',     // 고려대학교의과대학부속구로병원
    A2100003: 'korea',     // 고려대학교의과대학부속안산병원
    A1200004: 'kosin',     // 고신대학교복음병원
    A2400002: 'dankook',   // 단국대학교의과대학부속병원
    A1300004: 'cu',        // 대구가톨릭대학교병원
    A1300005: 'cu',        // 대구가톨릭대학교칠곡가톨릭병원
    A2100047: 'dongguk',   // 동국대학교일산불교병원
    A2700003: 'dongguk',   // 동국대학교의과대학경주병원
    A1200003: 'donga',     // 동아대학교병원
    A1200019: 'deu',       // 학교법인)동의병원 (동의대학교)
    A1200002: 'pusan',     // 부산대학교병원
    A2800011: 'pusan',     // 양산부산대학교병원
    A1100017: 'snu',       // 서울대학교병원
    A1107402: 'snu',       // 서울대학교치과병원
    A2100001: 'snu',       // 분당서울대학교병원
    A1100006: 'skku',      // 강북삼성병원 (성균관대학교 의과대학)
    A1100010: 'skku',      // 삼성서울병원 (성균관대학교 의과대학)
    A2800020: 'skku',      // 학교법인성균관대학삼성창원병원
    A1100004: 'sch',       // 순천향대학교부속서울병원
    A2100005: 'sch',       // 순천향대학교부속부천병원
    A2400001: 'sch',       // 학교법인동은학원순천향대학교부속천안병원
    A2700013: 'sch',       // 순천향대학교부속구미병원
    A2100002: 'ajou',      // 아주대학교병원
    A1100007: 'yonsei',    // 연세대학교의과대학세브란스병원
    A1100015: 'yonsei',    // 연세대학교의과대학강남세브란스병원
    A2100020: 'yonsei',    // 연세대학교의과대학용인세브란스병원
    A2200001: 'yonsei',    // 연세대학교원주세브란스기독병원
    A1300001: 'yu',        // 영남대학교병원
    A2700017: 'yu',        // 영남대학교의과대학부속영천병원
    A1100009: 'ulsan',     // 서울아산병원 (울산대학교 의과대학)
    A1700004: 'ulsan',     // 학교법인울산공업학원울산대학교병원
    A2200008: 'ulsan',     // 강릉아산병원 (울산대학교 의과대학)
    A2100048: 'wonkwang',  // 원광대학교산본병원
    A2500001: 'wonkwang',  // 원광대학교병원
    A1100048: 'eulji',     // 노원을지대학교병원
    A1600002: 'eulji',     // 학교법인을지학원대전을지대학교병원
    A2117994: 'eulji',     // 학교법인을지학원의정부을지대학교병원
    A1100005: 'ewha',      // 이화여자대학교의과대학부속목동병원
    A1120796: 'ewha',      // 이화여자대학교의과대학부속서울병원
    A1100016: 'inje',      // 인제대학교상계백병원
    A1200001: 'inje',      // 인제대학교부산백병원
    A1200022: 'inje',      // 인제대학교 해운대백병원
    A2100038: 'inje',      // 인제대학교일산백병원
    A1400002: 'inha',      // 인하대학교의과대학부속병원
    A1500002: 'jnu',       // 전남대학교병원
    A2600001: 'jnu',       // 화순전남대학교병원
    A2500002: 'jbnu',      // 전북대학교병원
    A2900007: 'jejunu',    // 제주대학교병원
    A1500001: 'chosun',    // 조선대학교병원
    A1100003: 'cau',       // 중앙대학교병원
    A2118788: 'cau',       // 중앙대학교광명병원
    A1100057: 'cha',       // 차의과학대학교강남차병원
    A2100030: 'cha',       // 차의과학대학교분당차병원
    A2116972: 'cha',       // 의료법인성광의료재단일산차병원
    A2700007: 'cha',       // 차의과학대학교부속구미차병원
    A1200025: 'choonhae',  // 춘해보건대학교병원
    A1600001: 'cnu',       // 충남대학교병원
    A1800441: 'cnu',       // 세종충남대학교병원
    A2300001: 'cbnu',      // 충북대학교병원
    A1100028: 'hallym',    // 성심의료재단강동성심병원
    A1100038: 'hallym',    // 한림대학교한강성심병원
    A1100055: 'hallym',    // 한림대학교 강남성심병원
    A2100004: 'hallym',    // 한림대학교성심병원
    A2100046: 'hallym',    // 한림대학교동탄성심병원
    A2200013: 'hallym',    // 한림대학교춘천성심병원
    A1100013: 'hanyang',   // 한양대학교병원
    A2100039: 'hanyang'    // 한양대학교구리병원
});

// [상수] 신규 분원·별칭·테스트 데이터 대응용 병원명 키워드 우선순위 규칙 (구체적인 복합 명칭을 앞에 배치)
const UNIVERSITY_NAME_RULES = [
    ['cku', ['가톨릭관동대', '국제성모병원']],
    ['cu', ['대구가톨릭대']],
    ['catholic', [
        '가톨릭대', '서울성모병원', '여의도성모병원', '은평성모병원',
        '의정부성모병원', '부천성모병원', '인천성모병원', '대전성모병원', '성빈센트병원'
    ]],
    ['yonsei', ['연세대', '세브란스']],
    ['korea', ['고려대', '고대안암', '고대구로', '고대안산', '고대부속']],
    ['snu', ['서울대']],
    ['skku', ['성균관대', '삼성서울병원', '강북삼성병원', '삼성창원병원']],
    ['ulsan', ['울산대', '서울아산병원', '강릉아산병원']],
    ['gachon', ['가천대', '길의료재단길병원']],
    ['ewha', ['이화여대', '이화여자대', '이화의대', '이대목동', '이대서울']],
    ['inje', ['인제대', '부산백병원', '해운대백병원', '상계백병원', '일산백병원']],
    ['hallym', ['한림대', '성심의료재단강동성심병원']],
    ['cha', ['차의과학대', '차의과대', '분당차병원', '강남차병원', '구미차병원', '일산차병원']],
    ['hanyang', ['한양대']],
    ['khu', ['경희대']],
    ['cau', ['중앙대']],
    ['konkuk', ['건국대']],
    ['dongguk', ['동국대']],
    ['dankook', ['단국대']],
    ['sch', ['순천향대']],
    ['ajou', ['아주대']],
    ['inha', ['인하대', '인하대학']],
    ['eulji', ['을지대']],
    ['konyang', ['건양대']],
    ['wonkwang', ['원광대']],
    ['knu', ['경북대']],
    ['kmu', ['계명대']],
    ['yu', ['영남대']],
    ['pusan', ['부산대']],
    ['gnu', ['경상국립대', '창원경상대', '경상대학교병원']],
    ['donga', ['동아대']],
    ['kosin', ['고신대']],
    ['deu', ['동의대', '학교법인동의병원']],
    ['choonhae', ['춘해보건대']],
    ['jnu', ['전남대']],
    ['jbnu', ['전북대']],
    ['chosun', ['조선대']],
    ['cnu', ['충남대']],
    ['cbnu', ['충북대']],
    ['kangwon', ['강원대']],
    ['jejunu', ['제주대']]
];

/*
 * [역할 및 데이터 흐름]
 * - 역할: 병원 이름에서 공백·괄호·가운데점을 제거하고 유니코드(NFKC)·소문자로 통일해 비교하기 쉽게 다듬음
 * - 호출처: `resolveUniversityHospitalLogo(hospital)` 내부 전용 보조 함수
 */
function normalizeHospitalName(value) {
    if (!value) {
        return '';
    }
    return String(value)
        .normalize('NFKC')
        .replace(/[\s·()（）[\]-]/g, '')
        .toLowerCase();
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 선택된 병원이 대학교병원 이상(지방의료원·국립의료원 등 의료원 제외)일 때 소속 대학교 로고 경로를 반환함
 * - 흐름:
 *   `hospital` 입력 -> 의료원(`type.group === 'medical'` 또는 `'의료원'` 포함) 제외
 *   -> `UNIVERSITY_NAME_RULES` 이름 규칙 대조 -> 미일치 시 `UNIVERSITY_BY_HPID[hospital.id]` 기관코드 대조
 *   -> `{ code, universityName, assetPath }` 반환 (일반 병원은 `null`)
 * - 호출처: `frontend/js/hospital-sheet.js` -> `syncSheetUniversityWatermark()`
 */
export function resolveUniversityHospitalLogo(hospital) {
    if (!hospital) {
        return null;
    }

    const rawName = String(hospital.name || '').trim();
    if (!rawName || hospital.type?.group === 'medical' || rawName.includes('의료원')) {
        return null;
    }

    const norm = normalizeHospitalName(rawName);
    let code = null;

    if (norm === '길병원') {
        code = 'gachon';
    } else {
        for (const [candidateCode, tokens] of UNIVERSITY_NAME_RULES) {
            if (tokens.some(token => norm.includes(token))) {
                code = candidateCode;
                break;
            }
        }
    }

    if (!code && hospital.id) {
        code = UNIVERSITY_BY_HPID[hospital.id] || null;
    }

    const meta = code ? UNIVERSITY_LOGOS[code] : null;
    if (!meta) {
        return null;
    }

    return {
        code,
        universityName: meta.name,
        assetPath: `./Assets/universities/${meta.file}`
    };
}

/*
 * [역할 및 실행 시점]
 * - 역할: 문서 기본 언어를 한국어(`ko`)로 고정하고 더 이상 쓰지 않는 예전 `localStorage` 키들을 깔끔히 삭제함
 * - 호출처: `frontend/js/app.js` -> `init()` 최상단에서 1회 호출됨
 */
export function loadPersistedUserPrefs() {
    document.documentElement.lang = 'ko';

    try {
        for (const legacyKey of LEGACY_REMOVED_KEYS) {
            localStorage.removeItem(legacyKey);
        }
    } catch (err) {
        void err;
    }
}
