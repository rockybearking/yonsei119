/* global kakao */
'use strict';

const API_KEY = decodeURIComponent(
    's%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D'
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

// 보건복지부 제5기 지정 명단.
// 적용 기간: 2024.1.1.~2026.12.31.
// 지역과 기관명을 함께 비교하여 다른 분원을 구별합니다.
const TERTIARY_2024_2026 = [
    ['서울', ['강북삼성병원']],
    ['서울', ['건국대학교병원']],
    ['서울', ['경희대학교병원']],
    ['서울', [
        '고려대학교의과대학부속구로병원',
        '고려대학교구로병원'
    ]],
    ['서울', ['삼성서울병원']],
    ['서울', ['서울대학교병원']],
    ['서울', ['강남세브란스병원']],
    ['서울', [
        '연세대학교의과대학세브란스병원',
        '신촌세브란스병원'
    ]],
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
    ['서울', [
        '가톨릭대학교서울성모병원',
        '서울성모병원'
    ]],
    ['서울', ['한양대학교병원']],
    ['인천', [
        '가톨릭대학교인천성모병원',
        '인천성모병원'
    ]],
    ['경기', [
        '순천향대학교부속부천병원',
        '순천향대학교부천병원'
    ]],
    ['인천', ['길병원']],
    ['인천', [
        '인하대학교의과대학부속병원',
        '인하대학교병원'
    ]],
    ['경기', [
        '가톨릭대학교성빈센트병원',
        '성빈센트병원'
    ]],
    ['경기', [
        '고려대학교의과대학부속안산병원',
        '고려대학교안산병원'
    ]],
    ['경기', ['분당서울대학교병원']],
    ['경기', ['아주대학교병원']],
    ['경기', ['한림대학교성심병원']],
    ['강원', ['강릉아산병원']],
    ['강원', [
        '연세대학교원주세브란스기독병원',
        '원주세브란스기독병원'
    ]],
    ['충북', ['충북대학교병원']],
    ['충남', [
        '단국대학교의과대학부속병원',
        '단국대학교병원'
    ]],
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
    ['부산', [
        '인제대학교부산백병원',
        '부산백병원'
    ]],
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

const KNOWN_BEDS = [
    ['hvec', '응급실 가용병상'],
    ['hvgc', '입원실 가용병상'],
    ['hvoc', '수술실 가용병상'],
    ['hvicc', '일반 중환자실 가용병상'],
    ['hvncc', '신생아 중환자실 가용병상']
];

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
    hvventisoayn: '격리 인공호흡기'
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
    '응급실 운영 항목'
];

const state = {
    map: null,
    circle: null,
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

const byId = (id) =>
    document.getElementById(id);

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
}

function fieldMap(item) {
    const fields = {};

    for (const child of item.children) {
        fields[child.localName.toLowerCase()] =
            child.textContent.trim();
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

    const code = xml
        .querySelector('resultCode')
        ?.textContent
        ?.trim();

    if (code !== '00') {
        const message = xml
            .querySelector('resultMsg')
            ?.textContent
            ?.trim();

        throw new Error(
            message ||
            `API 결과 코드: ${code || '없음'}`
        );
    }

    return xml;
}

async function requestPage(
    endpoint,
    pageNo,
    signal
) {
    const url = new URL(
        `${API_ROOT}/${endpoint}`
    );

    url.searchParams.set('serviceKey', API_KEY);
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set(
        'numOfRows',
        String(PAGE_SIZE)
    );

    const controller = new AbortController();
    const abort = () => controller.abort();

    signal?.addEventListener(
        'abort',
        abort,
        { once: true }
    );

    if (signal?.aborted) {
        abort();
    }

    const timeout = window.setTimeout(
        abort,
        15000
    );

    try {
        const response = await fetch(
            url.toString(),
            {
                signal: controller.signal,
                cache: 'no-store'
            }
        );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        return readXml(
            await response.text()
        );
    } catch (error) {
        if (
            controller.signal.aborted &&
            !signal?.aborted
        ) {
            throw new Error(
                'API 응답 시간이 초과되었습니다.'
            );
        }

        throw error;
    } finally {
        window.clearTimeout(timeout);

        signal?.removeEventListener(
            'abort',
            abort
        );
    }
}

async function requestAll(
    endpoint,
    signal
) {
    const result = [];
    let page = 1;

    while (page <= 100) {
        const xml = await requestPage(
            endpoint,
            page,
            signal
        );

        const items = [
            ...xml.getElementsByTagName('item')
        ].map(fieldMap);

        const total = Number(
            xml.querySelector('totalCount')
                ?.textContent || 0
        );

        const rows = Number(
            xml.querySelector('numOfRows')
                ?.textContent || PAGE_SIZE
        );

        if (
            !items.length &&
            total > result.length
        ) {
            throw new Error(
                '일부 페이지의 결과가 비어 있습니다.'
            );
        }

        result.push(...items);

        if (
            result.length >= total ||
            items.length === 0
        ) {
            break;
        }

        if (
            !Number.isFinite(rows) ||
            rows < 1
        ) {
            throw new Error(
                '페이지 크기가 유효하지 않습니다.'
            );
        }

        page += 1;
    }

    if (page > 100) {
        throw new Error(
            '페이지 제한을 초과했습니다.'
        );
    }

    return result;
}

function groupById(
    rows,
    multiple = false
) {
    const grouped = new Map();

    for (const row of rows) {
        if (!row.hpid) continue;

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

function normalizeName(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\s·()（）-]/g, '')
        .toLowerCase();
}

function classify(fields) {
    const name = normalizeName(
        fields.dutyname
    );

    const address =
        fields.dutyaddr || '';

    const explicitlyDesignated =
        (fields.dutydivnam || '')
            .includes('상급종합');

    const inOfficialList =
        TERTIARY_2024_2026.some(
            ([region, aliases]) =>
                REGION_PREFIX[region].test(address) &&
                aliases.some((alias) =>
                    name.includes(
                        normalizeName(alias)
                    )
                )
        );

    if (
        explicitlyDesignated ||
        inOfficialList
    ) {
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
    // 응급의료기관 등급과 병원 종별은 별개의 분류입니다.
    return /권역응급의료센터/.test(
        fields.dutyemclsname || ''
    );
}

function loadData() {
    // 갱신 중 다시 누르면 진행 중인 요청을 함께 기다립니다.
    if (state.inflight) {
        return state.inflight;
    }

    state.inflight = fetchData()
        .finally(() => {
            state.inflight = null;
        });

    return state.inflight;
}

async function fetchData() {
    state.loading = true;

    byId('refresh-button').disabled = true;
    document.body.classList.add('is-loading');

    byId('developer-spinner').hidden = false;
    byId('developer-status').textContent =
        '실시간 정보 새로 수신 중...';

    state.controller?.abort();
    state.controller = new AbortController();

    setStatus(
        '기관·병상·공지·중증질환 정보를 확인하고 있습니다…'
    );

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
            keys.map((key) =>
                requestAll(
                    endpoints[key],
                    state.controller.signal
                )
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

                console.error(
                    `${key} 조회 실패:`,
                    result.reason
                );
            }
        });

        if (!sources.list) {
            throw new Error(
                '기관 목록을 가져오지 못했습니다.'
            );
        }

        state.sources = sources;

        const beds = groupById(
            datasets.beds
        );

        const messages = groupById(
            datasets.messages,
            true
        );

        const severe = groupById(
            datasets.severe
        );

        const locations = groupById(
            datasets.location
        );

        const basics = groupById(
            datasets.basic
        );

        const traumaLocations = groupById(
            datasets.traumaLocation
        );

        const traumaBasics = groupById(
            datasets.traumaBasic
        );

        const traumaLists = groupById(
            datasets.traumaList
        );

        const unique = groupById(
            datasets.list
        );

        for (const [id, trauma] of traumaLists) {
            if (!unique.has(id)) {
                unique.set(id, trauma);
            }
        }

        state.hospitals = [...unique.values()]
            .map((fields) => {
                const id = fields.hpid;

                const location =
                    locations.get(id) ||
                    traumaLocations.get(id) ||
                    {};

                const basic =
                    basics.get(id) || {};

                const trauma =
                    traumaBasics.get(id) ||
                    traumaLists.get(id) ||
                    null;

                const lat = Number(
                    fields.wgs84lat ||
                    location.wgs84lat
                );

                const lng = Number(
                    fields.wgs84lon ||
                    location.wgs84lon
                );

                return {
                    id,
                    name:
                        fields.dutyname ||
                        basic.dutyname ||
                        '기관명 미보고',
                    address:
                        fields.dutyaddr ||
                        basic.dutyaddr ||
                        '',
                    tel:
                        fields.dutytel1 ||
                        basic.dutytel1 ||
                        '',
                    erTel:
                        fields.dutytel3 ||
                        beds.get(id)?.dutytel3 ||
                        '',
                    lat,
                    lng,
                    regional: isRegional({
                        ...basic,
                        ...fields
                    }),
                    type: classify({
                        ...basic,
                        ...fields,
                        dutyname:
                            fields.dutyname ||
                            basic.dutyname,
                        dutyaddr:
                            fields.dutyaddr ||
                            basic.dutyaddr
                    }),
                    basic,
                    trauma,
                    beds: beds.get(id) || null,
                    messages: messages.get(id) || [],
                    severe: severe.get(id) || null
                };
            })
            .filter((hospital) =>
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
                (item) =>
                    item.id === state.selected.id
            );

            if (fresh) {
                openHospital(fresh, false);
            } else {
                closeSheet();
            }
        }

        updateSearch();

        const missing = keys.filter(
            (key) => !state.sources[key]
        );

        byId('developer-status').textContent =
            missing.length
                ? `조회 완료 · 일부 항목 실패: ${missing.join(', ')}`
                : '전체 데이터 갱신을 완료했습니다.';

        const clock = new Date()
            .toLocaleTimeString('ko-KR', {
                timeZone: 'Asia/Seoul',
                hour: '2-digit',
                minute: '2-digit'
            });

        setStatus(
            `${clock} 기준 · ${state.hospitals.length}개 기관` +
            (
                missing.length
                    ? ` · 일부 항목 조회 실패: ${missing.join(', ')}`
                    : ''
            )
        );
    } catch (error) {
        console.error(
            '응급의료 데이터 갱신 실패:',
            error
        );

        setStatus(
            `조회 실패: ${error.message} · 이전 정보가 있다면 재확인하세요.`
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

function distanceKm(a, b) {
    const radians = (degrees) =>
        degrees * Math.PI / 180;

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

function formatDms(
    value,
    positive,
    negative
) {
    const tenths = Math.round(
        Math.abs(value) * 36000
    );

    const degrees = Math.floor(
        tenths / 36000
    );

    const minutes = Math.floor(
        (tenths % 36000) / 600
    );

    const seconds =
        (tenths % 600) / 10;

    const direction =
        value >= 0 ? positive : negative;

    return (
        `${direction} ${degrees}° ` +
        `${minutes}′ ${seconds.toFixed(1)}″`
    );
}

function updateCoordinates() {
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
        node(
            'span',
            '',
            formatDms(
                state.origin.lat,
                '북위',
                '남위'
            )
        ),
        node(
            'span',
            '',
            formatDms(
                state.origin.lng,
                '동경',
                '서경'
            )
        )
    );

    if (
        Number.isFinite(
            state.locationAccuracy
        )
    ) {
        target.append(
            node(
                'small',
                '',
                `오차 반경 약 ${
                    Math.round(state.locationAccuracy)
                }m`
            )
        );
    }

    if (state.locationUpdated) {
        const measured =
            state.locationUpdated
                .toLocaleTimeString('ko-KR', {
                    timeZone: 'Asia/Seoul',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });

        target.append(
            node(
                'small',
                '',
                `측정 ${measured}`
            )
        );
    }
}

function updateCircle() {
    if (!state.map) return;

    state.circle?.setMap(null);

    const radius =
        byId('radius').value;

    if (radius === 'all') return;

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

function visualGroup(hospital) {
    return hospital.regional
        ? 'regional'
        : hospital.type.group;
}

function hospitalLabel(hospital) {
    return hospital.regional
        ? `권역응급의료센터 · ${hospital.type.label}`
        : hospital.type.label;
}

function matchesFilters(
    hospital,
    enabled
) {
    // 권역응급이면서 상급종합인 경우 양쪽 필터에 포함합니다.
    return Boolean(
        enabled[hospital.type.group] ||
        (
            hospital.regional &&
            enabled.regional
        )
    );
}

function groupCards(points) {
    const groups = [];

    for (const point of points) {
        const near = groups.find((group) =>
            Math.abs(group.x - point.x) <
            CARD_WIDTH + 10 &&
            Math.abs(group.y - point.y) <
            CARD_HEIGHT + 14
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

function updateMarkers() {
    if (!state.map) return;

    for (const marker of state.markers) {
        marker.setMap(null);
    }

    state.markers = [];
    updateCircle();

    const radius =
        byId('radius').value;

    const enabled = {};

    for (const group of [
        'regional',
        'tertiary',
        'medical',
        'other'
    ]) {
        enabled[group] =
            byId(`filter-${group}`).checked;
    }

    const viewport =
        state.map.getBounds();

    const projection =
        state.map.getProjection();

    const rank = {
        regional: 0,
        tertiary: 1,
        medical: 2,
        other: 3
    };

    const candidates = state.hospitals
        .filter((hospital) => {
            if (
                !matchesFilters(
                    hospital,
                    enabled
                )
            ) {
                return false;
            }

            if (
                radius !== 'all' &&
                distanceKm(
                    state.origin,
                    hospital
                ) > Number(radius)
            ) {
                return false;
            }

            return viewport.contain(
                new kakao.maps.LatLng(
                    hospital.lat,
                    hospital.lng
                )
            );
        })
        .sort((a, b) =>
            rank[visualGroup(a)] -
            rank[visualGroup(b)] ||
            distanceKm(state.origin, a) -
            distanceKm(state.origin, b)
        );

    const points = candidates.map(
        (hospital) => {
            const point =
                projection.containerPointFromCoords(
                    new kakao.maps.LatLng(
                        hospital.lat,
                        hospital.lng
                    )
                );

            return {
                x: point.x,
                y: point.y,
                hospital
            };
        }
    );

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
            ? group.items
                .map((item) => item.name)
                .join(' · ')
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

        card.addEventListener(
            'click',
            (event) => {
                event.stopPropagation();

                if (multiple) {
                    openCluster(group.items);
                } else {
                    openHospital(hospital);
                }
            }
        );

        const overlay =
            new kakao.maps.CustomOverlay({
                map: state.map,
                position: new kakao.maps.LatLng(
                    hospital.lat,
                    hospital.lng
                ),
                content: card,
                xAnchor: 0.5,
                yAnchor: 1,
                clickable: true,
                zIndex: 5
            });

        state.markers.push(overlay);
    }

    byId('map-count').textContent =
        `현재 화면 ${candidates.length}개 기관 · 겹치는 카드는 묶어서 표시`;
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
            node(
                'strong',
                '',
                hospital.name
            ),
            node(
                'small',
                '',
                hospitalLabel(hospital)
            ),
            node(
                'small',
                '',
                `응급실 ${bedValue(hospital.beds?.hvec)}`
            )
        );

        button.addEventListener(
            'click',
            () => {
                byId('cluster-dialog').close();
                openHospital(hospital);
            }
        );

        list.append(button);
    }

    byId('cluster-dialog').showModal();
}

function locate() {
    if (!navigator.geolocation) {
        updateCoordinates();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            state.origin = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };

            state.locationKnown = true;
            state.locationAccuracy =
                position.coords.accuracy;

            state.locationUpdated = new Date(
                position.timestamp || Date.now()
            );

            updateCoordinates();
            fitRadius();
            updateMarkers();
        },
        () => {
            state.locationKnown = false;
            state.locationAccuracy = null;
            state.locationUpdated = null;

            updateCoordinates();
            updateMarkers();
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

function updateSearch() {
    const list = byId('search-results');

    const query = byId('keyword')
        .value
        .replace(/\s+/g, '')
        .toLowerCase();

    list.replaceChildren();
    list.hidden = !query;

    if (!query) return;

    const matches = state.hospitals
        .filter((item) =>
            item.name
                .replace(/\s+/g, '')
                .toLowerCase()
                .includes(query)
        )
        .slice(0, 25);

    if (!matches.length) {
        list.append(
            node(
                'li',
                'empty-state',
                '일치하는 기관이 없습니다.'
            )
        );
    }

    for (const hospital of matches) {
        const li = node('li');

        const button = node(
            'button',
            'result-button'
        );

        button.type = 'button';

        button.append(
            node(
                'strong',
                '',
                hospital.name
            ),
            node(
                'small',
                '',
                hospital.type.label
            )
        );

        button.addEventListener(
            'click',
            () => {
                byId('keyword').value =
                    hospital.name;

                list.hidden = true;

                state.map.panTo(
                    new kakao.maps.LatLng(
                        hospital.lat,
                        hospital.lng
                    )
                );

                state.map.setLevel(4);
                openHospital(hospital);
            }
        );

        li.append(button);
        list.append(li);
    }
}

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
        Date.UTC(
            year,
            month - 1,
            day,
            hour - 9,
            minute,
            second
        )
    );

    const display = new Intl.DateTimeFormat(
        'ko-KR',
        {
            timeZone: 'Asia/Seoul',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }
    ).format(date);

    return {
        timestamp: date.getTime(),
        display
    };
}

function empty(container, message) {
    container.replaceChildren(
        node(
            'p',
            'empty-state',
            message
        )
    );
}

function renderMessages(hospital) {
    const target = byId('messages');
    target.replaceChildren();

    if (!state.sources.messages) {
        empty(
            target,
            '공지 조회에 실패했습니다. 병원에 확인하세요.'
        );

        byId('message-count').textContent = '';
        return;
    }

    const now = Date.now();

    const messages = hospital.messages
        .filter((item) => {
            const start = parseApiDate(
                item.symblksttdtm
            );

            const end = parseApiDate(
                item.symblkenddtm
            );

            return (
                (!start || start.timestamp <= now) &&
                (!end || end.timestamp > now) &&
                item.symblkmsg
            );
        })
        .sort((a, b) => {
            const priority = (item) =>
                item.symblkmsgtyp === '중증'
                    ? 0
                    : 1;

            return priority(a) - priority(b);
        });

    byId('message-count').textContent =
        `${messages.length}건`;

    if (!messages.length) {
        empty(
            target,
            '현재 표시할 공지가 없습니다.'
        );
        return;
    }

    for (const item of messages) {
        const level =
            item.symblkmsgtyp === '중증'
                ? 'critical'
                : item.symblkmsgtyp === '응급'
                    ? 'urgent'
                    : 'unknown';

        const article = node(
            'article',
            `message-card ${level}`
        );

        const heading = node(
            'div',
            'message-heading'
        );

        const badge = node(
            'span',
            'message-badge',
            item.symblkmsgtyp || '공지'
        );

        const subject =
            item.trtprtcodmag ||
            item.symtypcodmag ||
            '진료 공지';

        heading.append(
            badge,
            node(
                'strong',
                '',
                subject
            )
        );

        article.append(
            heading,
            node(
                'p',
                'message-text',
                item.symblkmsg
            )
        );

        const end = parseApiDate(
            item.symblkenddtm
        );

        if (end) {
            article.append(
                node(
                    'small',
                    'muted',
                    `종료 예정 ${end.display}`
                )
            );
        }

        target.append(article);
    }
}

function renderSevere(hospital) {
    const target = byId('severe');
    target.replaceChildren();

    byId('severe-time').textContent = '';

    if (!state.sources.severe) {
        empty(
            target,
            '중증질환 정보 조회에 실패했습니다.'
        );
        return;
    }

    const fields = hospital.severe;

    if (!fields) {
        empty(
            target,
            '이 기관의 중증질환 수용 정보가 보고되지 않았습니다.'
        );
        return;
    }

    const keys = Object.keys(fields)
        .filter((key) =>
            /^mkioskty\d+$/.test(key)
        )
        .sort((a, b) =>
            Number(a.slice(8)) -
            Number(b.slice(8))
        );

    let shown = 0;

    for (const key of keys) {
        const value =
            fields[key].toUpperCase();

        if (
            value !== 'Y' &&
            value !== 'N'
        ) {
            continue;
        }

        const index =
            Number(key.slice(8)) - 1;

        const row = node(
            'div',
            'severe-row'
        );

        const title = node(
            'div',
            'severe-name',
            `${DISEASES[index] || key} `
        );

        title.append(
            node(
                'small',
                'field-code',
                key
            )
        );

        const note =
            fields[`${key}msg`];

        if (note) {
            title.append(
                node(
                    'small',
                    'severe-note',
                    note
                )
            );
        }

        row.append(
            title,
            node(
                'span',
                `state-pill ${
                    value === 'Y' ? 'yes' : 'no'
                }`,
                value === 'Y'
                    ? '수용 가능'
                    : '수용 불가'
            )
        );

        target.append(row);
        shown += 1;
    }

    if (!shown) {
        empty(
            target,
            '보고된 Y/N 항목이 없습니다.'
        );
    }

    const reported = parseApiDate(
        fields.hvidate ||
        fields.mkioskdate
    );

    if (reported) {
        byId('severe-time').textContent =
            `보고 ${reported.display}`;
    }
}

function bedValue(raw) {
    if (
        raw === undefined ||
        raw === ''
    ) {
        return '미보고';
    }

    const value = Number(raw);

    if (!Number.isFinite(value)) {
        return raw;
    }

    if (value < 0) {
        return `0석 · ${Math.abs(value)}석 초과 수용`;
    }

    return `${value}석`;
}

function renderBeds(hospital) {
    const important = byId('key-beds');
    const all = byId('all-beds');

    important.replaceChildren();
    all.replaceChildren();

    byId('bed-time').textContent = '';

    if (!state.sources.beds) {
        empty(
            important,
            '병상 정보 조회에 실패했습니다.'
        );

        empty(
            all,
            '세부 항목을 표시할 수 없습니다.'
        );
        return;
    }

    const fields = hospital.beds;

    if (!fields) {
        empty(
            important,
            '이 기관의 병상 정보가 보고되지 않았습니다.'
        );

        empty(
            all,
            '세부 항목이 없습니다.'
        );
        return;
    }

    for (const [key, label] of KNOWN_BEDS) {
        const card = node(
            'div',
            'metric-card'
        );

        card.append(
            node(
                'span',
                'metric-label',
                label
            ),
            node(
                'strong',
                'metric-value',
                bedValue(fields[key])
            ),
            node(
                'small',
                'field-code',
                key
            )
        );

        important.append(card);
    }

    const groups = [
        {
            title: '실시간 세부 항목 · hv (원본값)',
            keys: Object.keys(fields).filter(
                (key) => /^hv\d+$/.test(key)
            )
        },
        {
            title: '병상 관련 항목 · hvs (원본값)',
            keys: Object.keys(fields).filter(
                (key) => /^hvs\d+$/.test(key)
            )
        },
        {
            title: '그 밖의 병상 관련 항목 (원본값)',
            keys: ['hvcc', 'hvccc'].filter(
                (key) => key in fields
            )
        }
    ];

    for (const group of groups) {
        if (!group.keys.length) {
            continue;
        }

        const section = node(
            'section',
            'raw-group'
        );

        section.append(
            node(
                'h3',
                '',
                group.title
            )
        );

        const list = node(
            'dl',
            'raw-grid'
        );

        group.keys.sort((a, b) =>
            a.localeCompare(
                b,
                undefined,
                { numeric: true }
            )
        );

        for (const key of group.keys) {
            const pair = node(
                'div',
                'raw-pair'
            );

            pair.append(
                node(
                    'dt',
                    'field-code',
                    key
                ),
                node(
                    'dd',
                    '',
                    fields[key]
                )
            );

            list.append(pair);
        }

        section.append(list);
        all.append(section);
    }

    if (!all.childElementCount) {
        empty(
            all,
            '세부 항목이 없습니다.'
        );
    }

    const reported = parseApiDate(
        fields.hvidate
    );

    if (reported) {
        byId('bed-time').textContent =
            `보고 ${reported.display}`;
    }
}

function renderEquipment(hospital) {
    const target = byId('equipment');
    target.replaceChildren();

    if (!state.sources.beds) {
        empty(
            target,
            '장비 정보 조회에 실패했습니다.'
        );
        return;
    }

    const fields = hospital.beds;

    if (!fields) {
        empty(
            target,
            '이 기관의 장비 정보가 보고되지 않았습니다.'
        );
        return;
    }

    const keys = Object.keys(fields)
        .filter((key) =>
            key in EQUIPMENT ||
            /^hv[a-z]+ayn$/.test(key)
        );

    keys.sort();

    if (!keys.length) {
        empty(
            target,
            '보고된 장비 항목이 없습니다.'
        );
        return;
    }

    for (const key of keys) {
        const value =
            fields[key].toUpperCase();

        const item = node(
            'div',
            'equipment-item'
        );

        const name = node(
            'span',
            '',
            EQUIPMENT[key] || key
        );

        name.append(
            node(
                'small',
                'field-code',
                key
            )
        );

        const status =
            value === 'Y'
                ? '가능'
                : value === 'N'
                    ? '불가'
                    : fields[key];

        item.append(
            name,
            node(
                'strong',
                value === 'Y'
                    ? 'yes-text'
                    : value === 'N'
                        ? 'no-text'
                        : '',
                status
            )
        );

        target.append(item);
    }
}

function renderBasic(hospital) {
    const target = byId('basic-info');
    target.replaceChildren();

    const blocks = [
        [
            '응급의료기관 기본정보',
            hospital.basic,
            state.sources.basic
        ],
        [
            '외상센터 기본정보',
            hospital.trauma,
            state.sources.traumaBasic
        ]
    ];

    for (
        const [heading, fields, loaded]
        of blocks
        ) {
        const section = node(
            'details',
            'raw-details'
        );

        section.append(
            node(
                'summary',
                '',
                heading
            )
        );

        if (!loaded) {
            section.append(
                node(
                    'p',
                    'empty-state',
                    '조회에 실패했습니다.'
                )
            );
        } else if (
            !fields ||
            !Object.keys(fields).length
        ) {
            section.append(
                node(
                    'p',
                    'empty-state',
                    '보고된 정보가 없습니다.'
                )
            );
        } else {
            const list = node(
                'dl',
                'raw-grid'
            );

            for (
                const [key, value]
                of Object.entries(fields)
                ) {
                if (
                    !value ||
                    ['hpid', 'rnum', 'phpid']
                        .includes(key)
                ) {
                    continue;
                }

                const pair = node(
                    'div',
                    'raw-pair'
                );

                pair.append(
                    node(
                        'dt',
                        'field-code',
                        key
                    ),
                    node(
                        'dd',
                        '',
                        value
                    )
                );

                list.append(pair);
            }

            section.append(list);
        }

        target.append(section);
    }
}

function contactLink(
    text,
    href,
    className
) {
    const link = node(
        'a',
        className,
        text
    );

    link.href = href;
    return link;
}

function isAppleTouchDevice() {
    const userAgent =
        navigator.userAgent || '';

    return (
        /iPad|iPhone|iPod/.test(userAgent) ||
        (
            /Macintosh/.test(userAgent) &&
            navigator.maxTouchPoints > 1
        )
    );
}

function openMobileApp(
    scheme,
    androidPackage,
    fallback
) {
    if (
        /Android/i.test(
            navigator.userAgent
        )
    ) {
        const intent = scheme.replace(
            /^[a-z]+:\/\//,
            'intent://'
        );

        const protocol =
            scheme.split(':')[0];

        window.location.href =
            `${intent}#Intent;scheme=${protocol};` +
            'action=android.intent.action.VIEW;' +
            `package=${androidPackage};` +
            `S.browser_fallback_url=${
                encodeURIComponent(fallback)
            };end`;

        return;
    }

    if (!isAppleTouchDevice()) {
        window.open(
            fallback,
            '_blank',
            'noopener,noreferrer'
        );
        return;
    }

    const started = Date.now();
    let timer;

    const cleanup = () => {
        window.clearTimeout(timer);

        document.removeEventListener(
            'visibilitychange',
            onVisibility
        );

        window.removeEventListener(
            'pagehide',
            cleanup
        );
    };

    const onVisibility = () => {
        if (
            document.visibilityState === 'hidden'
        ) {
            cleanup();
        }
    };

    document.addEventListener(
        'visibilitychange',
        onVisibility
    );

    window.addEventListener(
        'pagehide',
        cleanup
    );

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

function navigationLink(
    provider,
    hospital
) {
    const name = encodeURIComponent(
        hospital.name
    );

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
            scheme:
                `kakaomap://route?${start}` +
                `ep=${lat},${lng}&by=car`,
            package: 'net.daum.android.map',
            fallback:
                `https://map.kakao.com/link/to/` +
                `${name},${lat},${lng}`
        };
    }

    if (provider === 'naver') {
        const appname = encodeURIComponent(
            window.location.origin
        );

        return {
            scheme:
                `nmap://navigation?dlat=${lat}` +
                `&dlng=${lng}&dname=${name}` +
                `&appname=${appname}`,
            package: 'com.nhn.android.nmap',
            fallback: mobile
                ? (
                    isAppleTouchDevice()
                        ? 'https://apps.apple.com/kr/app/id311867728'
                        : 'https://play.google.com/store/apps/details?id=com.nhn.android.nmap'
                )
                : (
                    'https://map.naver.com/p/directions/-/' +
                    `${lng},${lat},${name},,/-/car` +
                    '?c=15.00,0,0,0,dh'
                )
        };
    }

    return {
        scheme: isAppleTouchDevice()
            ? (
                `tmap://route?rGoName=${name}` +
                `&rGoX=${lng}&rGoY=${lat}`
            )
            : (
                `tmap://route?goalname=${name}` +
                `&goalx=${lng}&goaly=${lat}`
            ),
        package: 'com.skt.tmap.ku',
        fallback: isAppleTouchDevice()
            ? 'https://apps.apple.com/kr/app/id431589174'
            : 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku'
    };
}

function launchNavigation(
    provider,
    hospital
) {
    const link = navigationLink(
        provider,
        hospital
    );

    openMobileApp(
        link.scheme,
        link.package,
        link.fallback
    );
}

function renderContacts(hospital) {
    const target = byId('contact-actions');
    target.replaceChildren();

    for (const [label, number] of [
        ['응급실', hospital.erTel],
        ['대표전화', hospital.tel]
    ]) {
        if (/^[0-9+()\s-]+$/.test(number)) {
            target.append(
                contactLink(
                    `${label} ${number}`,
                    `tel:${number.replace(/[^\d+]/g, '')}`,
                    'phone-button'
                )
            );
        }
    }

    for (const [provider, label] of [
        ['kakao', '카카오맵'],
        ['naver', '네이버 지도'],
        ['tmap', 'T맵']
    ]) {
        const button = node(
            'button',
            `map-button ${provider}`,
            label
        );

        button.type = 'button';

        button.addEventListener(
            'click',
            () => launchNavigation(
                provider,
                hospital
            )
        );

        target.append(button);
    }
}

function openHospital(
    hospital,
    focus = true
) {
    if (focus) {
        state.previousFocus =
            document.activeElement;
    }

    if (
        state.selected?.id !== hospital.id
    ) {
        byId('developer-mode').open = false;
    }

    state.selected = hospital;

    byId('hospital-name').textContent =
        hospital.name;

    byId('sheet-updated').textContent =
        state.lastUpdated
            ? `마지막 새로고침 · ${
                state.lastUpdated.toLocaleString(
                    'ko-KR',
                    {
                        timeZone: 'Asia/Seoul',
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    }
                )
            } KST`
            : '전체 조회 시각을 확인할 수 없습니다.';

    byId('hospital-type').textContent =
        hospitalLabel(hospital);

    byId('hospital-address').textContent =
        hospital.address || '주소 미보고';

    const distance = distanceKm(
        state.origin,
        hospital
    ).toFixed(1);

    byId('hospital-distance').textContent =
        `${
            state.locationKnown
                ? '내 위치'
                : '서울시청'
        }에서 직선거리 ${distance} km`;

    renderContacts(hospital);
    renderMessages(hospital);
    renderSevere(hospital);
    renderBeds(hospital);
    renderEquipment(hospital);
    renderBasic(hospital);

    const failed = Object.entries(
        state.sources
    )
        .filter(([, loaded]) => !loaded)
        .map(([name]) => name);

    byId('data-state').textContent =
        failed.length
            ? (
                `일부 데이터 조회 실패: ${
                    failed.join(', ')
                }. 재조회하거나 병원에 문의하세요.`
            )
            : '공공데이터의 보고 시점과 현장 상황은 다를 수 있습니다.';

    byId('sheet-dim').hidden = false;
    byId('sheet').classList.add('open');

    byId('sheet').setAttribute(
        'aria-hidden',
        'false'
    );

    if (focus) {
        byId('sheet')
            .querySelector('.sheet-scroll')
            .scrollTop = 0;

        byId('sheet-close').focus();
    }
}

function closeSheet() {
    byId('sheet').classList.remove('open');
    byId('sheet').style.transform = '';
    byId('sheet').style.transition = '';

    byId('sheet').setAttribute(
        'aria-hidden',
        'true'
    );

    byId('sheet-dim').hidden = true;

    state.selected = null;
    state.previousFocus?.focus?.();
}

function initSheetDrag() {
    const handle = byId(
        'sheet-drag-handle'
    );

    const sheet = byId('sheet');

    let startY = null;
    let delta = 0;

    handle.addEventListener(
        'touchstart',
        (event) => {
            if (
                event.touches.length !== 1
            ) {
                return;
            }

            startY =
                event.touches[0].clientY;

            delta = 0;
            sheet.style.transition = 'none';
        },
        { passive: true }
    );

    handle.addEventListener(
        'touchmove',
        (event) => {
            if (
                startY === null ||
                event.touches.length !== 1
            ) {
                return;
            }

            delta = Math.max(
                0,
                event.touches[0].clientY - startY
            );

            if (delta > 0) {
                event.preventDefault();

                sheet.style.transform =
                    `translateY(${delta}px)`;
            }
        },
        { passive: false }
    );

    const finish = () => {
        if (startY === null) return;

        startY = null;
        sheet.style.transition = '';

        if (delta > 90) {
            closeSheet();
        } else {
            sheet.style.transform = '';
        }

        delta = 0;
    };

    handle.addEventListener(
        'touchend',
        finish,
        { passive: true }
    );

    handle.addEventListener(
        'touchcancel',
        finish,
        { passive: true }
    );
}

function fitBounds(bounds) {
    const height =
        byId('map').clientHeight ||
        window.innerHeight;

    const top = Math.min(
        document.querySelector('.top-panel')
            .offsetHeight + 24,
        height * 0.28
    );

    const bottom = Math.min(
        document.querySelector('.search-panel')
            .offsetHeight + 24,
        height * 0.25
    );

    state.map.setBounds(
        bounds,
        top,
        32,
        bottom,
        32
    );
}

function radiusExtent(
    origin,
    radiusKm
) {
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
    if (!state.map) return;

    const bounds =
        new kakao.maps.LatLngBounds();

    if (
        byId('radius').value === 'all'
    ) {
        if (!state.hospitals.length) {
            bounds.extend(
                new kakao.maps.LatLng(
                    33.1,
                    124.5
                )
            );

            bounds.extend(
                new kakao.maps.LatLng(
                    38.7,
                    131.9
                )
            );
        }

        for (
            const hospital
            of state.hospitals
            ) {
            bounds.extend(
                new kakao.maps.LatLng(
                    hospital.lat,
                    hospital.lng
                )
            );
        }
    } else {
        const box = radiusExtent(
            state.origin,
            Number(byId('radius').value)
        );

        bounds.extend(
            new kakao.maps.LatLng(
                box.south,
                box.west
            )
        );

        bounds.extend(
            new kakao.maps.LatLng(
                box.north,
                box.east
            )
        );
    }

    fitBounds(bounds);
    updateCircle();
}

function noticeHidden() {
    try {
        return (
            localStorage.getItem(NOTICE_KEY) === '1'
        );
    } catch {
        return false;
    }
}

function openNotice() {
    byId('notice-skip').textContent =
        noticeHidden()
            ? '접속할 때 안내 다시 보기'
            : '이 브라우저에서 다시 보지 않기';

    byId('notice-dialog').showModal();
}

function initNotice() {
    const dialog =
        byId('notice-dialog');

    for (const id of [
        'notice-close',
        'notice-confirm'
    ]) {
        byId(id).addEventListener(
            'click',
            () => dialog.close()
        );
    }

    byId('notice-skip').addEventListener(
        'click',
        () => {
            try {
                if (noticeHidden()) {
                    localStorage.removeItem(
                        NOTICE_KEY
                    );
                } else {
                    localStorage.setItem(
                        NOTICE_KEY,
                        '1'
                    );
                }
            } catch {
                setStatus(
                    '이 브라우저에서는 안내 숨김 설정을 저장할 수 없습니다.'
                );
            }

            dialog.close();
        }
    );

    byId('notice-open').addEventListener(
        'click',
        openNotice
    );

    if (!noticeHidden()) {
        openNotice();
    }
}

function init() {
    if (
        navigator.maxTouchPoints > 0 ||
        matchMedia('(pointer: coarse)').matches ||
        isAppleTouchDevice()
    ) {
        document.body.classList.add(
            'touch-device'
        );
    }

    initSheetDrag();
    initNotice();

    byId('developer-mode')
        .addEventListener('toggle', () => {
            if (
                byId('developer-mode').open &&
                state.selected
            ) {
                loadData();
            }
        });

    byId('cluster-close')
        .addEventListener('click', () => {
            byId('cluster-dialog').close();
        });

    byId('cluster-zoom')
        .addEventListener('click', () => {
            const bounds =
                new kakao.maps.LatLngBounds();

            for (
                const hospital
                of state.clusterItems
                ) {
                bounds.extend(
                    new kakao.maps.LatLng(
                        hospital.lat,
                        hospital.lng
                    )
                );
            }

            byId('cluster-dialog').close();
            fitBounds(bounds);
        });

    updateCoordinates();

    byId('search-form')
        .addEventListener('submit', (event) => {
            event.preventDefault();
            updateSearch();

            byId('search-results')
                .querySelector('button')
                ?.click();
        });

    byId('keyword').addEventListener(
        'input',
        updateSearch
    );

    byId('refresh-button').addEventListener(
        'click',
        loadData
    );

    byId('location-button').addEventListener(
        'click',
        locate
    );

    byId('radius').addEventListener(
        'change',
        () => {
            fitRadius();
            updateMarkers();
        }
    );

    for (const id of [
        'filter-regional',
        'filter-tertiary',
        'filter-medical',
        'filter-other'
    ]) {
        byId(id).addEventListener(
            'change',
            updateMarkers
        );
    }

    byId('sheet-close').addEventListener(
        'click',
        closeSheet
    );

    byId('sheet-dim').addEventListener(
        'click',
        closeSheet
    );

    document.addEventListener(
        'keydown',
        (event) => {
            if (
                event.key === 'Escape' &&
                state.selected
            ) {
                closeSheet();
            }
        }
    );

    byId('location-button').disabled = true;

    if (!window.kakao?.maps) {
        setStatus(
            '카카오 지도 SDK를 불러오지 못했습니다.'
        );
        return;
    }

    kakao.maps.load(() => {
        state.map = new kakao.maps.Map(
            byId('map'),
            {
                center: new kakao.maps.LatLng(
                    SEOUL.lat,
                    SEOUL.lng
                ),
                level: 6
            }
        );

        kakao.maps.event.addListener(
            state.map,
            'idle',
            updateMarkers
        );

        window.addEventListener(
            'resize',
            () => state.map.relayout()
        );

        byId('location-button').disabled = false;

        loadData();
        locate();
    });
}

init();