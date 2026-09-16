/* global kakao */

/**
 * ============================================================================
 * [상수 정의부] 공공데이터 인증키, 기본 좌표, 렌더링 한도 및 질환 코드 정의
 * ============================================================================
 */

// 공공데이터포털 국립중앙의료원 응급의료 오픈 API 인증키 (인코딩된 키 디코딩 처리)
const PUBLIC_API_KEY = decodeURIComponent('s%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D');

// 사용자가 위치 권한을 거부하거나 Geolocation 실패 시 사용할 기본 중심 좌표 (서울시청)
const defaultLat = 37.5668;
const defaultLng = 126.9786;

// 모바일 기기 브라우저 과부하 및 프레임 드랍을 막기 위한 화면 내 최대 마커 오버레이 렌더링 개수
const MAX_VISIBLE_OVERLAYS = 80;

// 국립중앙의료원 응급의료센터 중증 응급질환 28개 코드 및 표준 질환명 매핑 테이블
const SEVERE_DISEASE_MAP = {
    'mkioskty1': '[재관류중재술] 심근경색',
    'mkioskty2': '[재관류중재술] 뇌경색',
    'mkioskty3': '[뇌출혈수술] 거미막하출혈',
    'mkioskty4': '[뇌출혈수술] 거미막하출혈 외',
    'mkioskty5': '[대동맥응급] 흉부',
    'mkioskty6': '[대동맥응급] 복부',
    'mkioskty7': '[담낭담관질환] 담낭질환',
    'mkioskty8': '[담낭담관질환] 담도포함질환',
    'mkioskty9': '[복부응급수술] 비외상',
    'mkioskty10': '[장중첩/폐색] 영유아',
    'mkioskty11': '[응급내시경] 성인 위장관',
    'mkioskty12': '[응급내시경] 영유아 위장관',
    'mkioskty13': '[응급내시경] 성인 기관지',
    'mkioskty14': '[응급내시경] 영유아 기관지',
    'mkioskty15': '[저체중출생아] 집중치료',
    'mkioskty16': '[산부인과응급] 분만',
    'mkioskty17': '[산부인과응급] 산과수술',
    'mkioskty18': '[산부인과응급] 부인과수술',
    'mkioskty19': '[중증화상] 전문치료',
    'mkioskty20': '[사지접합] 수족지접합',
    'mkioskty21': '[사지접합] 수족지접합 외',
    'mkioskty22': '[응급투석] HD',
    'mkioskty23': '[응급투석] CRRT',
    'mkioskty24': '[정신과적응급] 폐쇄병동입원',
    'mkioskty25': '[안과적수술] 응급',
    'mkioskty26': '[영상의학혈관중재] 성인',
    'mkioskty27': '[영상의학혈관중재] 영유아',
    'mkioskty28': '응급실(Emergency gate keeper)'
};

/**
 * ============================================================================
 * [전역 상태 변수 선언부] 지도 인스턴스, 캐시 데이터 및 필터 상태 관리
 * ============================================================================
 */
let map = null;                    // 카카오 지도 객체 인스턴스
let myLocationOverlay = null;      // 내 현재 위치 펄스 애니메이션 커스텀 오버레이
let currentLatLng = null;          // 현재 기준 중심 좌표 (kakao.maps.LatLng)
let activeCircle = null;           // 지도 위에 렌더링된 탐색 반경 Circle 객체
let activeCircleLabel = null;      // 탐색 반경 상단 거리 뱃지 오버레이
let currentRadiusKm = 10;          // 현재 설정된 탐색 반경 (기본 10km)
let cachedHospitals = [];          // 공공데이터 API로부터 수신한 전국 병원 전체 목록 캐시
let activeSearchPin = null;        // 검색 결과 선택 시 목적지에 꽂히는 정밀 핀 오버레이

let kakaoGeocoder = null;          // 카카오 도로명주소 지오코더 서비스 인스턴스
let kakaoPlaces = null;            // 카카오 키워드 장소(POI) 검색 서비스 인스턴스

const activeOverlayMap = new Map();// 현재 지도 화면에 실제로 렌더링되어 있는 병원 오버레이 맵 (key: hpid, value: CustomOverlay)
let viewportUpdateTimer = null;    // 지도 줌/이동 시 연산 과부하를 막기 위한 디바운스 타이머

// 병원 종별 필터 토글 상태
let hospitalFilters = {
    tertiary: true,  // 상급종합병원
    regional: true,  // 지역의료원
    general: true    // 일반병원
};

/**
 * 십진수 위/경도 좌표를 "도/분/초" (DMS) 표기법 문자열로 변환하는 유틸리티 함수
 * @param {number} decimalCoord - 십진수 좌표값
 * @returns {string} 예: "37도 34분 1.2초"
 */
function toDMS(decimalCoord) {
    const abs = Math.abs(decimalCoord);
    const degrees = Math.floor(abs);
    const minutesFloat = (abs - degrees) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = ((minutesFloat - minutes) * 60).toFixed(1);
    return `${degrees}도 ${minutes}분 ${seconds}초`;
}

/**
 * 선택된 탐색 반경(km)에 따라 직관적인 테마 색상을 반환하는 함수
 * @param {number} radiusKm - 반경(km)
 * @returns {object} strokeColor, fillColor, fillOpacity, labelBg
 */
function getRadiusTheme(radiusKm) {
    if (radiusKm <= 10) {
        return { strokeColor: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.08, labelBg: '#2563eb' };
    } else if (radiusKm <= 20) {
        return { strokeColor: '#16a34a', fillColor: '#22c55e', fillOpacity: 0.08, labelBg: '#16a34a' };
    } else if (radiusKm <= 40) {
        return { strokeColor: '#d97706', fillColor: '#facc15', fillOpacity: 0.12, labelBg: '#d97706' };
    } else {
        return { strokeColor: '#ef4444', fillColor: '#f87171', fillOpacity: 0.08, labelBg: '#ef4444' };
    }
}

/**
 * 어플리케이션 진입점: 카카오 SDK 로드 완료 여부를 체크하고 모듈들을 초기화
 */
function startApplication() {
    if (typeof kakao === 'undefined' || !kakao.maps) {
        document.getElementById('status-title').innerText = '❌ 카카오 지도 SDK 오류';
        return;
    }

    kakao.maps.load(function () {
        initMap();
        initBottomSheetEvents();
        initHospitalSearchEvents();
    });
}

// DOM 준비 상태에 맞추어 애플리케이션 시작
if (document.readyState === 'complete') {
    startApplication();
} else {
    window.addEventListener('load', startApplication);
}

/**
 * 카카오 지도 생성, UI 이벤트 등록 및 GPS/데이터 수신 파이프라인을 가동하는 함수
 */
function initMap() {
    const mapContainer = document.getElementById('map');
    const mapOption = {
        center: new kakao.maps.LatLng(defaultLat, defaultLng),
        level: 6,
        draggable: true,
        scroll_wheel: true
    };

    map = new kakao.maps.Map(mapContainer, mapOption);

    // 카카오 Geocoder 및 Places 정밀 주소 검색 서비스 인스턴스 초기화
    kakaoGeocoder = new kakao.maps.services.Geocoder();
    kakaoPlaces = new kakao.maps.services.Places();

    // 화면 리사이즈 시 지도 깨짐 방지
    window.addEventListener('resize', () => {
        if (map) map.relayout();
    });

    // 지도 줌 레벨 변경 시 반경 원 시각화 가시성 제어
    kakao.maps.event.addListener(map, 'zoom_changed', function () {
        const level = map.getLevel();
        if (!activeCircle) return;

        if (currentRadiusKm >= 500) {
            if (!activeCircle.getMap()) activeCircle.setMap(map);
            if (activeCircleLabel && !activeCircleLabel.getMap()) activeCircleLabel.setMap(map);
        } else if (currentRadiusKm >= 20 && level <= 4) {
            if (activeCircle.getMap()) activeCircle.setMap(null);
            if (activeCircleLabel && activeCircleLabel.getMap()) activeCircleLabel.setMap(null);
        } else {
            if (!activeCircle.getMap()) activeCircle.setMap(map);
            if (activeCircleLabel && !activeCircleLabel.getMap()) activeCircleLabel.setMap(map);
        }
    });

    // 지도 이동 및 드래그 완료(idle) 시 현재 화면 영역 내 병원 버블 갱신
    kakao.maps.event.addListener(map, 'idle', function () {
        debounceUpdateHospitalsInViewport();
    });

    // 내 위치 펄스 마커 엘리먼트 생성 및 커스텀 오버레이 등록
    const markerContent = document.createElement('div');
    markerContent.className = 'my-location-marker';
    markerContent.innerHTML = '<div class="my-location-pulse"></div><div class="my-location-dot"></div>';

    myLocationOverlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(defaultLat, defaultLng),
        content: markerContent,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 10
    });

    // 플로팅 메뉴 토글 제어 이벤트
    const radiusMainBtn = document.getElementById('radius-main-btn');
    const radiusOptions = document.getElementById('radius-options');
    const filterMainBtn = document.getElementById('filter-main-btn');
    const filterOptions = document.getElementById('filter-options');

    if (radiusMainBtn && radiusOptions) {
        radiusMainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            filterOptions.classList.remove('open');
            radiusOptions.classList.toggle('open');
        });
    }

    if (filterMainBtn && filterOptions) {
        filterMainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            radiusOptions.classList.remove('open');
            filterOptions.classList.toggle('open');
        });
    }

    // 지도 드래그 제스처와 단순 탭 클릭을 구분하여 팝업이 닫히도록 처리
    let isPageDragging = false;
    let pageDownX = 0;
    let pageDownY = 0;

    document.addEventListener('mousedown', (e) => {
        isPageDragging = false;
        pageDownX = e.clientX;
        pageDownY = e.clientY;
    });

    document.addEventListener('mousemove', (e) => {
        if (Math.abs(e.clientX - pageDownX) > 6 || Math.abs(e.clientY - pageDownY) > 6) {
            isPageDragging = true;
        }
    });

    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            isPageDragging = false;
            pageDownX = e.touches[0].clientX;
            pageDownY = e.touches[0].clientY;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            if (Math.abs(e.touches[0].clientX - pageDownX) > 6 || Math.abs(e.touches[0].clientY - pageDownY) > 6) {
                isPageDragging = true;
            }
        }
    }, { passive: true });

    document.addEventListener('click', (e) => {
        if (isPageDragging) {
            isPageDragging = false;
            return;
        }
        const radiusWrapper = document.getElementById('radius-menu-wrapper');
        const filterWrapper = document.getElementById('filter-menu-wrapper');

        if (radiusWrapper && !radiusWrapper.contains(e.target) && radiusOptions) {
            radiusOptions.classList.remove('open');
        }
        if (filterWrapper && !filterWrapper.contains(e.target) && filterOptions) {
            filterOptions.classList.remove('open');
        }
    });

    // 반경 변경 버튼 클릭 이벤트
    document.querySelectorAll('.radius-btn').forEach(button => {
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            document.querySelectorAll('.radius-btn').forEach(b => {
                b.classList.remove('active');
                b.style.backgroundColor = '';
                b.style.borderColor = '';
            });
            this.classList.add('active');

            currentRadiusKm = parseInt(this.getAttribute('data-radius'), 10);
            const theme = getRadiusTheme(currentRadiusKm);
            this.style.backgroundColor = theme.labelBg;
            this.style.borderColor = theme.labelBg;

            if (currentLatLng) {
                renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
            }
            if (radiusOptions) {
                radiusOptions.classList.remove('open');
            }
        });
    });

    // 병원 분류 필터(체크박스) 변경 이벤트
    const filterTertiary = document.getElementById('filter-tertiary');
    const filterRegional = document.getElementById('filter-regional');
    const filterGeneral = document.getElementById('filter-general');

    const handleFilterChange = () => {
        hospitalFilters.tertiary = filterTertiary.checked;
        hospitalFilters.regional = filterRegional.checked;
        hospitalFilters.general = filterGeneral.checked;

        if (currentLatLng) {
            updateHospitalsInViewport();
        }
    };

    filterTertiary.addEventListener('change', handleFilterChange);
    filterRegional.addEventListener('change', handleFilterChange);
    filterGeneral.addEventListener('change', handleFilterChange);

    // 내 위치 바로가기 버튼
    document.getElementById('my-loc-btn').addEventListener('click', () => {
        moveToCurrentLocation(false);
    });

    // 전국 응급의료기관 API 병렬 로딩 완료 후 현재 위치로 이동 및 초기 렌더링
    loadAllEmergencyData().then(() => {
        moveToCurrentLocation(true);
    });
}

/**
 * XML DOM 노드로부터 태그 이름을 키로 하는 데이터 오브젝트 맵을 추출하는 헬퍼 함수
 * @param {Element} item - 개별 XML 아이템 노드
 * @returns {object} 태그명-텍스트 매핑 객체
 */
function getItemFieldMap(item) {
    const map = {};
    const children = item.children || item.childNodes;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.nodeType === 1) {
            map[child.nodeName.toLowerCase()] = (child.textContent || '').trim();
        }
    }
    return map;
}

/**
 * 국립중앙의료원 응급의료 Open API의 4대 핵심 데이터를 Promise.all로 병렬 수신하여 캐시하는 함수
 * 1. 전국 응급의료기관 목록 (getEgytListInfoInqire)
 * 2. 실시간 응급실 가용병상 정보 (getEmrrmRltmUsefulSckbdInfoInqire)
 * 3. 응급실 중증질환 제한 공지사항 (getEmrrmSrsillDissMsgInqire)
 * 4. 28개 중증응급질환 실시간 수용 가능 여부 (getSrsillDissAceptncPosblInfoInqire)
 */
async function loadAllEmergencyData() {
    document.getElementById('status-title').innerText = '⏳ 응급의료기관 데이터 수신 중...';

    try {
        const listUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytListInfoInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        const bedUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        const msgUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmSrsillDissMsgInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        const severeUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getSrsillDissAceptncPosblInfoInqire` +
            `?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

        const [listRes, bedRes, msgRes, severeRes] = await Promise.all([
            fetch(listUrl),
            fetch(bedUrl),
            fetch(msgUrl),
            fetch(severeUrl)
        ]);

        const [listXmlText, bedXmlText, msgXmlText, severeXmlText] = await Promise.all([
            listRes.text(),
            bedRes.text(),
            msgRes.text(),
            severeRes.text()
        ]);

        const parser = new DOMParser();
        const listDoc = parser.parseFromString(listXmlText, 'application/xml');
        const bedDoc = parser.parseFromString(bedXmlText, 'application/xml');
        const msgDoc = parser.parseFromString(msgXmlText, 'application/xml');
        const severeDoc = parser.parseFromString(severeXmlText, 'application/xml');

        // 가용 병상 정보 파싱 및 매핑
        const bedMap = new Map();
        const bedItems = bedDoc.getElementsByTagName('item');
        for (let i = 0; i < bedItems.length; i++) {
            const fields = getItemFieldMap(bedItems[i]);
            const hpid = fields['hpid'];
            const hvecStr = fields['hvec'];
            if (hpid) {
                const hvecNum = hvecStr !== undefined && hvecStr !== '' ? parseInt(hvecStr, 10) : null;
                bedMap.set(hpid, isNaN(hvecNum) ? null : hvecNum);
            }
        }

        // 실시간 제한/주의 공지 메시지 파싱
        const msgMap = new Map();
        const msgItems = msgDoc.getElementsByTagName('item');
        for (let i = 0; i < msgItems.length; i++) {
            const fields = getItemFieldMap(msgItems[i]);
            const hpid = fields['hpid'];
            const msg = fields['symblkmsg'];
            if (hpid && msg) {
                if (msgMap.has(hpid)) {
                    msgMap.set(hpid, msgMap.get(hpid) + '<br>• ' + msg);
                } else {
                    msgMap.set(hpid, '• ' + msg);
                }
            }
        }

        // 28개 중증 응급질환 수용 가능/불가 여부 파싱
        const severeMap = new Map();
        const severeItems = severeDoc.getElementsByTagName('item');
        for (let i = 0; i < severeItems.length; i++) {
            const fields = getItemFieldMap(severeItems[i]);
            const hpid = fields['hpid'];
            if (!hpid) continue;

            const available = [];
            const unavailable = [];

            Object.keys(SEVERE_DISEASE_MAP).forEach(tag => {
                const val = (fields[tag] || '').toUpperCase();
                const diseaseName = SEVERE_DISEASE_MAP[tag];
                const msgTag = `${tag}msg`;
                const noteMsg = fields[msgTag] ? ` (${fields[msgTag]})` : '';

                if (val === 'Y') {
                    available.push(`${diseaseName}${noteMsg}`);
                } else if (val === 'N') {
                    unavailable.push(`${diseaseName}${noteMsg}`);
                }
            });

            if (available.length > 0 || unavailable.length > 0) {
                severeMap.set(hpid, { available, unavailable });
            }
        }

        // 전국 병원 기본 목록과 병상·공지·중증질환 데이터를 하나로 병합
        cachedHospitals = [];
        const listItems = listDoc.getElementsByTagName('item');
        for (let i = 0; i < listItems.length; i++) {
            const fields = getItemFieldMap(listItems[i]);
            const hpid = fields['hpid'];
            const name = fields['dutyname'] || '응급의료기관';
            const address = fields['dutyaddr'] || '';
            const mainTel = fields['dutytel1'] || '';
            const erTel = fields['dutytel3'] || '';

            const lat = parseFloat(fields['wgs84lat']);
            const lng = parseFloat(fields['wgs84lon']);
            const dutyDivNam = fields['dutydivnam'] || '';
            const dutyEmclsName = fields['dutyemclsname'] || '';

            if (!isNaN(lat) && !isNaN(lng)) {
                let type = 'general';
                let typeLabel = '일반병원';

                if (name.includes('의료원')) {
                    type = 'regional';
                    typeLabel = '지역의료';
                } else {
                    const isTertiary = (
                        dutyDivNam.includes('상급종합') ||
                        dutyEmclsName.includes('권역') ||
                        /대학|대학교|의과대학|세브란스|아산병원|삼성서울|성모병원/.test(name)
                    );
                    if (isTertiary) {
                        type = 'tertiary';
                        typeLabel = '상급종합';
                    }
                }

                cachedHospitals.push({
                    hpid,
                    name,
                    address,
                    mainTel,
                    erTel,
                    lat,
                    lng,
                    type,
                    typeLabel,
                    hvec: bedMap.has(hpid) ? bedMap.get(hpid) : null,
                    message: msgMap.get(hpid) || null,
                    severeData: severeMap.get(hpid) || null
                });
            }
        }

        document.getElementById('status-title').innerText = '✅ 데이터 준비 완료';
    } catch (err) {
        console.error('데이터 수신 실패:', err);
        document.getElementById('status-title').innerText = '⚠️ 데이터 수신 지연';
    }
}

/**
 * 카카오 키워드 검색(Places) 및 주소 변환(Geocoder)을 사용하여
 * 공공데이터의 오차 좌표를 카카오 지도 공식 실제 건물 좌표로 정밀 보정하는 함수
 * @param {object} h - 병원 데이터 객체
 * @param {function} callback - 정밀 좌표(kakao.maps.LatLng)를 인수로 전달받는 콜백
 */
function resolvePreciseHospitalPosition(h, callback) {
    if (!kakaoPlaces || !kakaoGeocoder) {
        callback(new kakao.maps.LatLng(h.lat, h.lng));
        return;
    }

    // 법인 접두어 제거 (예: "의료법인 성수의료재단 인천백병원" -> "인천백병원")
    const cleanName = h.name.replace(/^의료법인\s+[^\s]+\s+/, '').trim();

    // 1단계: 카카오 공식 POI 키워드 장소 검색 시도
    kakaoPlaces.keywordSearch(cleanName, (data, status) => {
        if (status === kakao.maps.services.Status.OK && data && data.length > 0) {
            const matchedPlace = data.find(p => {
                if (!h.address || !p.address_name) return true;
                const regionTokens = h.address.split(' ');
                return regionTokens.some(token => token.length >= 2 && p.address_name.includes(token));
            }) || data[0];

            const preciseLat = parseFloat(matchedPlace.y);
            const preciseLng = parseFloat(matchedPlace.x);

            h.lat = preciseLat;
            h.lng = preciseLng;
            callback(new kakao.maps.LatLng(preciseLat, preciseLng));
            return;
        }

        // 2단계: 장소 검색 실패 시 도로명 주소 지오코딩 시도
        if (h.address) {
            const cleanAddr = h.address.replace(/\(.*?\)/g, '').trim();
            kakaoGeocoder.addressSearch(cleanAddr, (addrData, addrStatus) => {
                if (addrStatus === kakao.maps.services.Status.OK && addrData && addrData.length > 0) {
                    const preciseLat = parseFloat(addrData[0].y);
                    const preciseLng = parseFloat(addrData[0].x);

                    h.lat = preciseLat;
                    h.lng = preciseLng;
                    callback(new kakao.maps.LatLng(preciseLat, preciseLng));
                    return;
                }

                // 3단계: 모두 실패 시 원본 좌표 유지
                callback(new kakao.maps.LatLng(h.lat, h.lng));
            });
        } else {
            callback(new kakao.maps.LatLng(h.lat, h.lng));
        }
    });
}

/**
 * 실시간 병원 이름 검색창 인풋 및 자동완성 목록 드롭다운 제어 이벤트 초기화
 */
function initHospitalSearchEvents() {
    const searchInput = document.getElementById('keyword');
    const searchBtn = document.getElementById('search-btn');
    const searchResultsList = document.getElementById('search-results-list');
    const searchBox = document.getElementById('search-box');

    // 입력 시 실시간 필터링 및 자동완성 렌더링
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();

        if (!query) {
            searchResultsList.innerHTML = '';
            searchResultsList.classList.remove('open');
            return;
        }

        const matched = cachedHospitals.filter(h => h.name.toLowerCase().includes(query));

        if (matched.length === 0) {
            searchResultsList.innerHTML = '<li class="search-result-empty">일치하는 병원이 없습니다.</li>';
            searchResultsList.classList.add('open');
            return;
        }

        const sliceMatched = matched.slice(0, 25);
        let html = '';

        sliceMatched.forEach(h => {
            let badgeClass = 'hospital-type-general';
            if (h.type === 'tertiary') badgeClass = 'hospital-type-tertiary';
            else if (h.type === 'regional') badgeClass = 'hospital-type-regional';

            const distText = currentLatLng
                ? `${getDistanceKm(currentLatLng.getLat(), currentLatLng.getLng(), h.lat, h.lng).toFixed(1)}km`
                : '';

            const telText = h.erTel ? `🚨 직통: ${h.erTel}` : (h.mainTel ? `📞 대표: ${h.mainTel}` : '');

            html += `
                <li class="search-result-item" data-hpid="${h.hpid}">
                    <div class="search-item-title">
                        <span class="hospital-type-badge ${badgeClass}">${h.typeLabel}</span>
                        <span>${h.name}</span>
                    </div>
                    <div class="search-item-sub">
                        <span>${distText}</span>
                        <span>${telText}</span>
                    </div>
                </li>
            `;
        });

        searchResultsList.innerHTML = html;
        searchResultsList.classList.add('open');

        // 자동완성 항목 클릭 이벤트 연결
        searchResultsList.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const hpid = item.getAttribute('data-hpid');
                const target = cachedHospitals.find(h => h.hpid === hpid);
                if (target) {
                    selectHospitalFromSearch(target);
                }
            });
        });
    });

    // 외부 영역 클릭 시 드롭다운 닫기
    document.addEventListener('click', (e) => {
        if (searchBox && !searchBox.contains(e.target)) {
            searchResultsList.classList.remove('open');
        }
    });

    const executeSearchSubmit = () => {
        const query = searchInput.value.trim().toLowerCase();
        if (!query) return;

        const matched = cachedHospitals.filter(h => h.name.toLowerCase().includes(query));
        if (matched.length > 0) {
            selectHospitalFromSearch(matched[0]);
        } else {
            alert('해당 이름을 포함하는 병원을 찾을 수 없습니다.');
        }
    };

    searchBtn.addEventListener('click', executeSearchSubmit);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            executeSearchSubmit();
        }
    });
}

/**
 * 검색 결과나 자동완성에서 특정 병원을 선택했을 때
 * 정밀 위치 보정, 지도 포커스, 빨간 핀 생성 및 바텀시트를 호출하는 함수
 * @param {object} h - 병원 데이터 객체
 */
function selectHospitalFromSearch(h) {
    const searchInput = document.getElementById('keyword');
    const searchResultsList = document.getElementById('search-results-list');

    searchInput.value = h.name;
    searchResultsList.classList.remove('open');

    resolvePreciseHospitalPosition(h, (preciseLatLng) => {
        map.setLevel(3);
        map.panTo(preciseLatLng);

        if (activeSearchPin) {
            activeSearchPin.setMap(null);
        }

        const pinElement = document.createElement('div');
        pinElement.className = 'search-target-pin';
        pinElement.innerHTML = `
            <svg width="36" height="44" viewBox="0 0 24 24" fill="#ef4444" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3" fill="#ffffff"></circle>
            </svg>
        `;

        activeSearchPin = new kakao.maps.CustomOverlay({
            position: preciseLatLng,
            content: pinElement,
            xAnchor: 0.5,
            yAnchor: 1.0,
            zIndex: 50
        });
        activeSearchPin.setMap(map);

        if (activeOverlayMap.has(h.hpid)) {
            activeOverlayMap.get(h.hpid).setPosition(preciseLatLng);
        }

        let bedText = '정보 없음';
        let bedClass = 'bed-warning';
        if (h.hvec !== null && h.hvec !== undefined) {
            if (h.hvec > 5) {
                bedText = `${h.hvec}석 여유`;
                bedClass = 'bed-normal';
            } else if (h.hvec > 0) {
                bedText = `${h.hvec}석 혼잡`;
                bedClass = 'bed-warning';
            } else {
                bedText = '병상 부족';
                bedClass = 'bed-danger';
            }
        }

        const dist = currentLatLng ? getDistanceKm(currentLatLng.getLat(), currentLatLng.getLng(), preciseLatLng.getLat(), preciseLatLng.getLng()) : 0;
        const targetHospitalWithDist = { ...h, distance: dist };

        openHospitalBottomSheet(targetHospitalWithDist, bedText, bedClass);
    });
}

/**
 * 브라우저 Geolocation API를 사용하여 현재 위치를 측정하고 지도를 중심 이동하는 함수
 * @param {boolean} isInitial - 앱 구동 시 최초 이동 여부
 */
function moveToCurrentLocation(isInitial) {
    if (!navigator.geolocation) {
        document.getElementById('status-title').innerText = '❌ Geolocation 미지원';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = Math.round(position.coords.accuracy);

            currentLatLng = new kakao.maps.LatLng(lat, lng);

            document.getElementById('status-title').innerText = '✅ 위치 갱신 완료';
            document.getElementById('coords').innerHTML =
                `• 위도: ${toDMS(lat)}<br>• 경도: ${toDMS(lng)}<br>• 오차범위: 약 ±${accuracy}m`;

            myLocationOverlay.setPosition(currentLatLng);
            myLocationOverlay.setMap(map);

            if (isInitial) {
                map.setCenter(currentLatLng);
            } else {
                map.panTo(currentLatLng);
            }

            renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
        },
        function () {
            document.getElementById('status-title').innerText = '⚠️ 기본 위치(서울시청) 적용';
            document.getElementById('coords').innerHTML =
                `• 위도: ${toDMS(defaultLat)}<br>• 경도: ${toDMS(defaultLng)}<br>• 위치 권한 미허용 상태`;
            currentLatLng = new kakao.maps.LatLng(defaultLat, defaultLng);
            renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

/**
 * 중심 좌표와 반경(km)을 기반으로 원형 영역을 그리고 지도 시야(Bounds)를 반경에 맞춤 조정하는 함수
 * @param {kakao.maps.LatLng} center - 중심 좌표
 * @param {number} radiusKm - 반경(km)
 */
function renderRadiusAndHospitals(center, radiusKm) {
    const radiusMeters = radiusKm * 1000;
    const theme = getRadiusTheme(radiusKm);

    if (activeCircle) activeCircle.setMap(null);
    if (activeCircleLabel) activeCircleLabel.setMap(null);

    activeCircle = new kakao.maps.Circle({
        center: center,
        radius: radiusMeters,
        strokeWeight: 2.2,
        strokeColor: theme.strokeColor,
        strokeOpacity: 0.8,
        strokeStyle: 'solid',
        fillColor: theme.fillColor,
        fillOpacity: theme.fillOpacity
    });
    activeCircle.setMap(map);

    const latOffset = radiusMeters / 111319.5;
    const topPosition = new kakao.maps.LatLng(center.getLat() + latOffset, center.getLng());

    const labelBadge = document.createElement('div');
    labelBadge.className = 'circle-top-label';
    labelBadge.style.backgroundColor = theme.labelBg;
    labelBadge.innerText = radiusKm >= 500 ? '전국' : `${radiusKm}km`;

    activeCircleLabel = new kakao.maps.CustomOverlay({
        position: topPosition,
        content: labelBadge,
        xAnchor: 0.5,
        yAnchor: 1.0,
        zIndex: 5
    });
    activeCircleLabel.setMap(map);

    const cosLat = Math.cos(center.getLat() * (Math.PI / 180));
    const lngOffset = radiusMeters / (111319.5 * (cosLat === 0 ? 1 : cosLat));
    const sw = new kakao.maps.LatLng(center.getLat() - latOffset, center.getLng() - lngOffset);
    const ne = new kakao.maps.LatLng(center.getLat() + latOffset, center.getLng() + lngOffset);
    map.setBounds(new kakao.maps.LatLngBounds(sw, ne));

    updateHospitalsInViewport();
}

/**
 * 지도 드래그 및 줌 중 연속적인 DOM 렌더링을 지연 처리하는 디바운스 함수
 */
function debounceUpdateHospitalsInViewport() {
    if (viewportUpdateTimer) clearTimeout(viewportUpdateTimer);
    viewportUpdateTimer = setTimeout(() => {
        updateHospitalsInViewport();
    }, 120);
}

/**
 * 현재 지도 화면의 사각 가시 영역(Viewport)과 설정된 탐색 반경 내에 존재하는 병원만 필터링하여 오버레이를 갱신하는 함수
 */
function updateHospitalsInViewport() {
    if (!map || !currentLatLng || cachedHospitals.length === 0) return;

    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const centerLat = currentLatLng.getLat();
    const centerLng = currentLatLng.getLng();

    const visibleCandidates = [];
    for (let i = 0; i < cachedHospitals.length; i++) {
        const h = cachedHospitals[i];

        // 체크박스 필터 통과 여부 검사
        if (!hospitalFilters[h.type]) continue;

        // 원형 반경 범위 내 포함 여부 검사
        const dist = getDistanceKm(centerLat, centerLng, h.lat, h.lng);
        if (dist > currentRadiusKm) continue;

        // 현재 지도 화면 사각틀(Bounds) 내부 포함 여부 검사
        if (h.lat >= sw.getLat() && h.lat <= ne.getLat() &&
            h.lng >= sw.getLng() && h.lng <= ne.getLng()) {
            visibleCandidates.push({ ...h, distance: dist });
        }
    }

    // 저사양 기기 최적화: 상급종합병원 우선 정렬 후 최대 표시 개수 제한
    if (visibleCandidates.length > MAX_VISIBLE_OVERLAYS) {
        visibleCandidates.sort((a, b) => {
            if (a.type === 'tertiary' && b.type !== 'tertiary') return -1;
            if (a.type !== 'tertiary' && b.type === 'tertiary') return 1;
            return a.distance - b.distance;
        });
        visibleCandidates.length = MAX_VISIBLE_OVERLAYS;
    }

    const nextHpidSet = new Set(visibleCandidates.map(h => h.hpid));

    // 화면 밖으로 벗어난 기존 오버레이 제거
    for (const [hpid, overlay] of activeOverlayMap.entries()) {
        if (!nextHpidSet.has(hpid)) {
            overlay.setMap(null);
            activeOverlayMap.delete(hpid);
        }
    }

    // 화면 내에 새로 들어온 병원 오버레이 렌더링
    visibleCandidates.forEach(h => {
        if (!activeOverlayMap.has(h.hpid)) {
            const overlay = createHospitalBubbleOverlay(h);
            overlay.setMap(map);
            activeOverlayMap.set(h.hpid, overlay);
        }
    });
}

/**
 * 지도 위에 띄울 병원 말풍선(버블) 커스텀 오버레이 DOM 엘리먼트를 생성하는 함수
 * @param {object} h - 병원 데이터 객체
 * @returns {kakao.maps.CustomOverlay}
 */
function createHospitalBubbleOverlay(h) {
    let bedText = '정보 없음';
    let bedClass = 'bed-warning';

    if (h.hvec !== null && h.hvec !== undefined) {
        if (h.hvec > 5) {
            bedText = `${h.hvec}석 여유`;
            bedClass = 'bed-normal';
        } else if (h.hvec > 0) {
            bedText = `${h.hvec}석 혼잡`;
            bedClass = 'bed-warning';
        } else {
            bedText = '병상 부족';
            bedClass = 'bed-danger';
        }
    }

    let typeBadgeClass = 'hospital-type-general';
    if (h.type === 'tertiary') {
        typeBadgeClass = 'hospital-type-tertiary';
    } else if (h.type === 'regional') {
        typeBadgeClass = 'hospital-type-regional';
    }

    const displayTel = h.erTel ? `🚨 ${h.erTel}` : (h.mainTel ? `📞 ${h.mainTel}` : '번호 없음');

    const wrapper = document.createElement('div');
    wrapper.className = 'hospital-overlay-wrapper';
    wrapper.title = '클릭하여 상세 정보 확인';
    wrapper.innerHTML = `
        <div class="hospital-bubble">
            <div class="hospital-name">
                <span class="hospital-type-badge ${typeBadgeClass}">${h.typeLabel}</span>
                ${h.name}
            </div>
            <div class="hospital-info">${h.distance.toFixed(1)}km | ${displayTel}</div>
            <div>
                <span style="font-size:10px; color:#64748b;">응급실: </span>
                <span class="bed-badge ${bedClass}">${bedText}</span>
            </div>
        </div>
        <div class="hospital-bubble-tail"></div>
    `;

    // 마우스 드래그와 단순 클릭 판별 플래그
    let isDraggingBubble = false;
    let bubbleDownX = 0;
    let bubbleDownY = 0;

    wrapper.addEventListener('mousedown', (e) => {
        isDraggingBubble = false;
        bubbleDownX = e.clientX;
        bubbleDownY = e.clientY;
    });

    wrapper.addEventListener('mousemove', (e) => {
        if (Math.abs(e.clientX - bubbleDownX) > 5 || Math.abs(e.clientY - bubbleDownY) > 5) {
            isDraggingBubble = true;
        }
    });

    wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isDraggingBubble) {
            isDraggingBubble = false;
            return;
        }

        // 말풍선 클릭 시 실제 건물 좌표로 정밀 보정 후 바텀시트 열기
        resolvePreciseHospitalPosition(h, (preciseLatLng) => {
            const overlay = activeOverlayMap.get(h.hpid);
            if (overlay) {
                overlay.setPosition(preciseLatLng);
            }
            openHospitalBottomSheet(h, bedText, bedClass);
        });
    });

    return new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(h.lat, h.lng),
        content: wrapper,
        xAnchor: 0.5,
        yAnchor: 1.0,
        zIndex: 6
    });
}

/**
 * 하버사인 공식(Haversine Formula)을 적용하여 구면 위 두 위경도 좌표 간의 직선거리(km)를 산출하는 함수
 * @param {number} lat1 - 시작점 위도
 * @param {number} lon1 - 시작점 경도
 * @param {number} lat2 - 도착점 위도
 * @param {number} lon2 - 도착점 경도
 * @returns {number} 거리 (km 단위)
 */
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // 지구 평균 반경 (km)
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

const sheet = document.getElementById('bottom-sheet');
const dim = document.getElementById('sheet-dim');
const dragArea = document.getElementById('sheet-drag-area');

/**
 * 병원 버블 클릭 또는 검색 선택 시 상세 정보 바텀시트를 표시하고
 * 카카오내비, 네이버지도, 티맵 길안내 바로가기 링크를 동적으로 바인딩하는 함수
 * @param {object} h - 병원 상세 정보 객체 (좌표, 이름, 전화번호 등 포함)
 * @param {string} bedText - 가용 병상 안내 문구
 * @param {string} bedClass - 병상 상태 스타일 클래스 (bed-normal, bed-warning, bed-danger)
 */
function openHospitalBottomSheet(h, bedText, bedClass) {
    document.getElementById('sheet-hospital-name').innerText = h.name;
    document.getElementById('sheet-address').innerText = h.address || '주소 정보가 없습니다.';
    document.getElementById('sheet-distance').innerText = `내 위치로부터 ${h.distance.toFixed(1)}km`;

    // ------------------------------------------------------------------------
    // [3대 내비게이션 길안내 바로가기 동적 링크 바인딩]
    // ------------------------------------------------------------------------
    const encName = encodeURIComponent(h.name);

    // 1. 카카오내비/카카오맵 길찾기 웹 및 앱 연동 스킴 (목적지명, 위도, 경도)
    const kakaoBtn = document.getElementById('navi-kakao');
    kakaoBtn.href = `https://map.kakao.com/link/to/${encName},${h.lat},${h.lng}`;

    // 2. 네이버지도 모바일 웹 및 앱 연동 길찾기 스킴 (도착지명, 경도, 위도)
    const naverBtn = document.getElementById('navi-naver');
    naverBtn.href = `https://m.map.naver.com/route.nhn?menu=route&ename=${encName}&ex=${h.lng}&ey=${h.lat}&pathType=0&showMap=true`;

    // 3. 티맵(TMAP) 모바일 앱 길안내 실행 커스텀 URI 스킴
    const tmapBtn = document.getElementById('navi-tmap');
    tmapBtn.href = `tmap://route?goalname=${encName}&goallat=${h.lat}&goallng=${h.lng}`;
    // ------------------------------------------------------------------------

    const typeEl = document.getElementById('sheet-hospital-type');
    typeEl.innerText = h.typeLabel;

    let badgeClass = 'hospital-type-general';
    if (h.type === 'tertiary') {
        badgeClass = 'hospital-type-tertiary';
    } else if (h.type === 'regional') {
        badgeClass = 'hospital-type-regional';
    }
    typeEl.className = `hospital-type-badge ${badgeClass}`;

    const badgeEl = document.getElementById('sheet-bed-badge');
    badgeEl.className = `bed-badge ${bedClass}`;
    badgeEl.innerText = bedText;

    // 응급실 직통 전화 연결 버튼 처리
    const erRow = document.getElementById('sheet-er-tel-row');
    const erLink = document.getElementById('sheet-er-tel-link');
    if (h.erTel) {
        erLink.href = `tel:${h.erTel}`;
        erLink.innerText = `📞 ${h.erTel} 통화`;
        erRow.style.display = 'flex';
    } else {
        erRow.style.display = 'none';
    }

    // 대표 전화 연결 버튼 처리
    const mainRow = document.getElementById('sheet-main-tel-row');
    const mainLink = document.getElementById('sheet-main-tel-link');
    if (h.mainTel) {
        mainLink.href = `tel:${h.mainTel}`;
        mainLink.innerText = `📞 ${h.mainTel} 통화`;
        mainRow.style.display = 'flex';
    } else {
        mainRow.style.display = 'none';
    }

    // 실시간 응급실 진료 제한 메시지 렌더링
    const msgEl = document.getElementById('sheet-msg-content');
    if (h.message) {
        msgEl.innerHTML = h.message;
        msgEl.style.color = '#991b1b';
    } else {
        msgEl.innerHTML = '현재 등록된 실시간 제한/공지 메시지가 없습니다.';
        msgEl.style.color = '#64748b';
    }

    // 실시간 중증 응급질환 수용 가능/불가 태그 렌더링
    const severeEl = document.getElementById('sheet-severe-content');
    if (h.severeData && (h.severeData.available.length > 0 || h.severeData.unavailable.length > 0)) {
        let html = '';

        if (h.severeData.unavailable.length > 0) {
            html += `<div style="font-size:11px; font-weight:700; color:#b91c1c; margin-bottom:4px;">🚨 수용 불가 질환 (${h.severeData.unavailable.length}건)</div>`;
            html += '<div class="severe-grid" style="margin-bottom:10px;">';
            h.severeData.unavailable.forEach(name => {
                html += `<span class="severe-tag imposbl">✖ ${name}</span>`;
            });
            html += '</div>';
        }

        if (h.severeData.available.length > 0) {
            html += `<div style="font-size:11px; font-weight:700; color:#15803d; margin-bottom:4px;">✔ 수용 가능 질환 (${h.severeData.available.length}건)</div>`;
            html += '<div class="severe-grid">';
            h.severeData.available.forEach(name => {
                html += `<span class="severe-tag posbl">${name}</span>`;
            });
            html += '</div>';
        }

        severeEl.innerHTML = html;
    } else {
        severeEl.innerHTML = '<span style="color:#64748b; font-size:12px;">등록된 실시간 중증질환 수용 정보가 없습니다. (해당 기관 미보고)</span>';
    }

    sheet.style.transform = '';
    sheet.classList.add('open');
    dim.classList.add('active');
}

/**
 * 열려있는 바텀시트 모달을 닫고 검색 핀을 제거하는 함수
 */
function closeBottomSheet() {
    sheet.classList.remove('open');
    sheet.style.transform = '';
    dim.classList.remove('active');

    if (activeSearchPin) {
        activeSearchPin.setMap(null);
        activeSearchPin = null;
    }
}

/**
 * 모바일 터치 드래그다운 제스처 및 마우스 드래그를 감지하여 바텀시트를 부드럽게 닫는 인터랙션 초기화 함수
 */
function initBottomSheetEvents() {
    document.getElementById('sheet-close-btn').addEventListener('click', closeBottomSheet);
    dim.addEventListener('click', closeBottomSheet);

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    // 모바일 터치 이벤트
    dragArea.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        isDragging = true;
        sheet.style.transition = 'none';
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) {
            sheet.style.transform = `translateY(${deltaY}px)`;
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';

        const deltaY = currentY - startY;
        if (deltaY > 70) {
            closeBottomSheet();
        } else {
            sheet.style.transform = 'translateY(0)';
        }
        startY = 0;
        currentY = 0;
    });

    // 데스크톱 마우스 드래그 이벤트
    dragArea.addEventListener('mousedown', (e) => {
        startY = e.clientY;
        isDragging = true;
        sheet.style.transition = 'none';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        currentY = e.clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) {
            sheet.style.transform = `translateY(${deltaY}px)`;
        }
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';

        const deltaY = currentY - startY;
        if (deltaY > 70) {
            closeBottomSheet();
        } else {
            sheet.style.transform = 'translateY(0)';
        }
        startY = 0;
        currentY = 0;
    });
}