/* global kakao */

/**
 * ============================================================================
 * [상수 정의부] 공공데이터 인증키, 기준 좌표, 한도 및 질환 매핑 테이블
 * ============================================================================
 */

// 국립중앙의료원 전국 응급의료 오픈 API 인증키
const PUBLIC_API_KEY = decodeURIComponent('s%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D');

// 위치 권한 미허용 시 기본 중심 좌표 (서울시청 기준)
const defaultLat = 37.5668;
const defaultLng = 126.9786;

// 저사양 모바일 브라우저 렌더링 과부하 방지 최대 개수 (PC/전국 모드에서는 자동 해제)
// ※ 80개: 60fps 부드러운 스크롤을 유지하는 최적 권장치
const MAX_MOBILE_VISIBLE_OVERLAYS = 80;

// 국립중앙의료원 응급의료센터 중증 응급질환 28종 표준 질환명 매핑
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
 * [전역 상태 및 영구 캐시 관리부]
 * ============================================================================
 */
let map = null;
let myLocationOverlay = null;
let currentLatLng = null;
let activeCircle = null;
let activeCircleLabel = null;
let currentRadiusKm = 10;
let cachedHospitals = [];
let activeSearchPin = null;

let kakaoPlaces = null;
let kakaoGeocoder = null;

// 한 번 검증 완료된 정밀 건물 중심점(십자가) 좌표를 영구 보존하는 전역 캐시 (Key: hpid, Value: {lat, lng})
// ※ 다른 곳을 드래그하고 돌아와도 비동기 검색을 다시 하지 않고 0ms 즉각 동기 반영
const preciseCoordCache = new Map();

// 생성된 오버레이 인스턴스를 파괴하지 않고 보존하는 맵 (Key: hpid, Value: kakao.maps.CustomOverlay)
const activeOverlayMap = new Map();
let viewportUpdateTimer = null;

// 분류 필터 상태
let hospitalFilters = {
    tertiary: true,
    regional: true,
    general: true
};

let currentSelectedHospital = null;

const sheet = document.getElementById('bottom-sheet');
const dim = document.getElementById('sheet-dim');
const dragArea = document.getElementById('sheet-drag-area');

/**
 * ============================================================================
 * [유틸리티 함수군]
 * ============================================================================
 */

/**
 * 디바이스 환경 판별 (갤럭시탭, iPadOS 데스크톱 모드 터치 스크린 완벽 대응)
 */
function getDeviceEnvironment() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isAppleTablet = (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua) || isAppleTablet;

    return {
        isMobileOrTablet: isAndroid || isIOS || isTouch,
        os: isAndroid ? 'android' : (isIOS ? 'ios' : 'desktop')
    };
}

/**
 * 십진수 위·경도 좌표를 도/분/초 단위 문자열로 변환
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
 * 탐색 반경별 테마 색상 반환
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
 * 하버사인 공식 구면 직선 거리(km) 계산
 */
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * ============================================================================
 * [3중 안전 검증 정밀 POI 보정 엔진 (영구 캐시 우선 조회)]
 * - 캐시에 있으면 비동기 요청 자체를 생략하고 즉시 반환
 * - 최초 1회만 카카오 십자가 POI 검증(400m 이내 & 병원 카테고리) 후 캐시에 고정
 * ============================================================================
 */
function ensurePreciseHospitalCoordinate(h, callback) {
    // 1. 이미 영구 캐시에 확정된 좌표가 있다면 0ms 즉각 반환 (드래그 재진입 시 지연 완전 차단)
    if (preciseCoordCache.has(h.hpid)) {
        const cached = preciseCoordCache.get(h.hpid);
        h.lat = cached.lat;
        h.lng = cached.lng;
        callback(h);
        return;
    }

    if (!kakaoPlaces) {
        callback(h);
        return;
    }

    let regionToken = '';
    if (h.address) {
        const addrParts = h.address.split(' ');
        if (addrParts.length > 1) {
            regionToken = addrParts[1];
        }
    }

    // 장소 검색용 질의어는 접두어(법인명)만 분리하여 매칭 확률 극대화
    const searchTargetName = h.name.replace(/^(의료법인|학교법인|사회복지법인|재단법인|사단법인)\s*/, '');
    const searchQuery = `${regionToken} ${searchTargetName}`.trim();

    kakaoPlaces.keywordSearch(searchQuery, (data, status) => {
        if (status === kakao.maps.services.Status.OK && data && data.length > 0) {
            const validPlace = data.find(place => {
                const pLat = parseFloat(place.y);
                const pLng = parseFloat(place.x);
                // 1차 검증: 공공데이터 원본 좌표와 400m 이내인가?
                const distFromRaw = getDistanceKm(h.rawLat, h.rawLng, pLat, pLng);
                if (distFromRaw > 0.4) return false;

                // 2차 검증: 의료기관 카테고리인가? (엉뚱한 간호대학, 장례식장 기각)
                const category = place.category_group_code || '';
                const categoryName = place.category_name || '';
                return category === 'HP8' || categoryName.includes('의료') || categoryName.includes('병원');
            });

            if (validPlace) {
                h.lat = parseFloat(validPlace.y);
                h.lng = parseFloat(validPlace.x);
                if (!h.address || h.address.trim() === '') {
                    h.address = validPlace.road_address_name || validPlace.address_name || '';
                }
            }
        }

        // 보정된 최종 좌표를 영구 캐시에 등록
        preciseCoordCache.set(h.hpid, { lat: h.lat, lng: h.lng });
        callback(h);
    }, {
        location: new kakao.maps.LatLng(h.rawLat, h.rawLng),
        radius: 500
    });
}

/**
 * ============================================================================
 * [3대 내비게이션 자동 목적지 연동부]
 * ============================================================================
 */
function launchNavigationApp(provider) {
    if (!currentSelectedHospital) return;

    const h = currentSelectedHospital;
    const { os } = getDeviceEnvironment();
    const targetName = h.name;
    const encName = encodeURIComponent(targetName);
    const lat = h.lat;
    const lng = h.lng;

    if (provider === 'kakao') {
        if (os === 'android') {
            window.location.href = `intent://route?ep=${lat},${lng}&by=CAR#Intent;scheme=kakaomap;package=net.daum.android.map;end`;
        } else if (os === 'ios') {
            window.location.href = `kakaomap://route?ep=${lat},${lng}&by=CAR`;
            setTimeout(() => {
                window.location.href = `https://map.kakao.com/link/to/${encName},${lat},${lng}`;
            }, 1500);
        } else {
            window.open(`https://map.kakao.com/link/to/${encName},${lat},${lng}`, '_blank');
        }
    } else if (provider === 'naver') {
        if (os === 'android') {
            window.location.href = `intent://route/car?dlat=${lat}&dlng=${lng}&dname=${encName}&appname=rockybearking.github.io#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end`;
        } else if (os === 'ios') {
            window.location.href = `nmap://route/car?dlat=${lat}&dlng=${lng}&dname=${encName}&appname=rockybearking.github.io`;
            setTimeout(() => {
                window.location.href = `https://map.naver.com/p/directions/-/${lat},${lng},${encName}/-/car`;
            }, 1500);
        } else {
            window.open(`https://map.naver.com/p/directions/-/${lat},${lng},${encName}/-/car`, '_blank');
        }
    } else if (provider === 'tmap') {
        if (os === 'android') {
            window.location.href = `intent://route?goalname=${encName}&goallat=${lat}&goallng=${lng}#Intent;scheme=tmap;package=com.skt.tmap.ku;end`;
        } else if (os === 'ios') {
            window.location.href = `tmap://route?goalname=${encName}&goallat=${lat}&goallng=${lng}`;
            setTimeout(() => {
                window.location.href = 'https://apps.apple.com/kr/app/tmap-%EB%82%B4%EB%B9%84%EA%B2%8C%EC%9D%B4%EC%85%98-%EC%A7%80%EB%8F%84/id431589174';
            }, 1500);
        } else {
            alert('티맵(Tmap)은 모바일 전용 서비스입니다. 스마트폰에서 이용해 주세요.');
        }
    }
}

/**
 * ============================================================================
 * [어플리케이션 초기화]
 * ============================================================================
 */
function startApplication() {
    if (typeof kakao === 'undefined' || !kakao.maps) {
        document.getElementById('status-title').innerText = '❌ 카카오 지도 SDK 로드 실패';
        return;
    }

    kakao.maps.load(function () {
        initMap();
        initBottomSheetEvents();
        initHospitalSearchEvents();
    });
}

if (document.readyState === 'complete') {
    startApplication();
} else {
    window.addEventListener('load', startApplication);
}

function initMap() {
    const mapContainer = document.getElementById('map');
    const mapOption = {
        center: new kakao.maps.LatLng(defaultLat, defaultLng),
        level: 6,
        draggable: true,
        scroll_wheel: true
    };

    map = new kakao.maps.Map(mapContainer, mapOption);
    kakaoPlaces = new kakao.maps.services.Places();
    kakaoGeocoder = new kakao.maps.services.Geocoder();

    window.addEventListener('resize', () => {
        if (map) map.relayout();
    });

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

    kakao.maps.event.addListener(map, 'idle', function () {
        debounceUpdateHospitalsInViewport();
    });

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

    document.addEventListener('click', () => {
        if (radiusOptions) radiusOptions.classList.remove('open');
        if (filterOptions) filterOptions.classList.remove('open');
    });

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
            if (radiusOptions) radiusOptions.classList.remove('open');
        });
    });

    const filterTertiary = document.getElementById('filter-tertiary');
    const filterRegional = document.getElementById('filter-regional');
    const filterGeneral = document.getElementById('filter-general');

    const handleFilterChange = () => {
        hospitalFilters.tertiary = filterTertiary.checked;
        hospitalFilters.regional = filterRegional.checked;
        hospitalFilters.general = filterGeneral.checked;

        if (currentLatLng) updateHospitalsInViewport();
    };

    filterTertiary.addEventListener('change', handleFilterChange);
    filterRegional.addEventListener('change', handleFilterChange);
    filterGeneral.addEventListener('change', handleFilterChange);

    document.getElementById('my-loc-btn').addEventListener('click', () => {
        moveToCurrentLocation(false);
    });

    loadAllEmergencyData().then(() => {
        moveToCurrentLocation(true);
    });
}

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
 * ============================================================================
 * [응급의료 오픈 API 데이터 병렬 수신 - 정식 명칭 100% 보존]
 * ============================================================================
 */
async function loadAllEmergencyData() {
    document.getElementById('status-title').innerText = '⏳ 응급의료기관 데이터 수신 중...';

    try {
        const listUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytListInfoInqire?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;
        const bedUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;
        const msgUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmSrsillDissMsgInqire?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;
        const severeUrl = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getSrsillDissAceptncPosblInfoInqire?serviceKey=${encodeURIComponent(PUBLIC_API_KEY)}&pageNo=1&numOfRows=1000`;

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

        cachedHospitals = [];
        const listItems = listDoc.getElementsByTagName('item');
        for (let i = 0; i < listItems.length; i++) {
            const fields = getItemFieldMap(listItems[i]);
            const hpid = fields['hpid'];
            const rawName = fields['dutyname'] || '응급의료기관';
            const address = fields['dutyaddr'] || '';
            const mainTel = fields['dutytel1'] || '';
            const erTel = fields['dutytel3'] || '';

            const rawLat = parseFloat(fields['wgs84lat']);
            const rawLng = parseFloat(fields['wgs84lon']);
            const dutyDivNam = fields['dutydivnam'] || '';
            const dutyEmclsName = fields['dutyemclsname'] || '';

            if (!isNaN(rawLat) && !isNaN(rawLng)) {
                let type = 'general';
                let typeLabel = '일반병원';

                if (rawName.includes('의료원')) {
                    type = 'regional';
                    typeLabel = '지역의료';
                } else {
                    const isTertiary = (
                        dutyDivNam.includes('상급종합') ||
                        dutyEmclsName.includes('권역') ||
                        /대학|대학교|의과대학|세브란스|아산병원|삼성서울|성모병원/.test(rawName)
                    );
                    if (isTertiary) {
                        type = 'tertiary';
                        typeLabel = '상급종합';
                    }
                }

                // 법인명 등을 삭제하지 않고 보건복지부 공식 명칭 완전 보존
                cachedHospitals.push({
                    hpid,
                    name: rawName,
                    address,
                    mainTel,
                    erTel,
                    rawLat,
                    rawLng,
                    lat: rawLat,
                    lng: rawLng,
                    type,
                    typeLabel,
                    hvec: bedMap.has(hpid) ? bedMap.get(hpid) : null,
                    message: msgMap.get(hpid) || null,
                    severeData: severeMap.get(hpid) || null
                });
            }
        }

        document.getElementById('status-title').innerText = '✅ 응급의료 데이터 준비 완료';
    } catch (err) {
        console.error('데이터 로드 실패:', err);
        document.getElementById('status-title').innerText = '⚠️ 데이터 수신 지연';
    }
}

/**
 * ============================================================================
 * [병원 검색 및 띄어쓰기 무관 자동완성]
 * ============================================================================
 */
function initHospitalSearchEvents() {
    const searchInput = document.getElementById('keyword');
    const searchBtn = document.getElementById('search-btn');
    const searchResultsList = document.getElementById('search-results-list');
    const searchBox = document.getElementById('search-box');

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.replace(/\s+/g, '').toLowerCase();

        if (!query) {
            searchResultsList.innerHTML = '';
            searchResultsList.classList.remove('open');
            return;
        }

        const matched = cachedHospitals.filter(h => {
            const cleanTarget = h.name.replace(/\s+/g, '').toLowerCase();
            return cleanTarget.includes(query);
        });

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

        searchResultsList.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const hpid = item.getAttribute('data-hpid');
                const target = cachedHospitals.find(h => h.hpid === hpid);
                if (target) selectHospitalFromSearch(target);
            });
        });
    });

    document.addEventListener('click', (e) => {
        if (searchBox && !searchBox.contains(e.target)) {
            searchResultsList.classList.remove('open');
        }
    });

    const executeSearchSubmit = () => {
        const query = searchInput.value.replace(/\s+/g, '').toLowerCase();
        if (!query) return;

        const matched = cachedHospitals.filter(h => {
            const cleanTarget = h.name.replace(/\s+/g, '').toLowerCase();
            return cleanTarget.includes(query);
        });

        if (matched.length > 0) {
            selectHospitalFromSearch(matched[0]);
        } else {
            alert('해당 이름을 포함하는 병원을 찾을 수 없습니다.');
        }
    };

    searchBtn.addEventListener('click', executeSearchSubmit);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') executeSearchSubmit();
    });
}

function selectHospitalFromSearch(h) {
    const searchInput = document.getElementById('keyword');
    const searchResultsList = document.getElementById('search-results-list');

    searchInput.value = h.name;
    searchResultsList.classList.remove('open');

    ensurePreciseHospitalCoordinate(h, (preciseHospital) => {
        const preciseLatLng = new kakao.maps.LatLng(preciseHospital.lat, preciseHospital.lng);
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

        if (activeOverlayMap.has(preciseHospital.hpid)) {
            activeOverlayMap.get(preciseHospital.hpid).setPosition(preciseLatLng);
        }

        let bedText = '정보 없음';
        let bedClass = 'bed-warning';
        if (preciseHospital.hvec !== null && preciseHospital.hvec !== undefined) {
            if (preciseHospital.hvec > 5) {
                bedText = `${preciseHospital.hvec}석 여유`;
                bedClass = 'bed-normal';
            } else if (preciseHospital.hvec > 0) {
                bedText = `${preciseHospital.hvec}석 혼잡`;
                bedClass = 'bed-warning';
            } else {
                bedText = '병상 부족';
                bedClass = 'bed-danger';
            }
        }

        const dist = currentLatLng ? getDistanceKm(currentLatLng.getLat(), currentLatLng.getLng(), preciseHospital.lat, preciseHospital.lng) : 0;
        const targetHospitalWithDist = { ...preciseHospital, distance: dist };

        openHospitalBottomSheet(targetHospitalWithDist, bedText, bedClass);
    });
}

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

function debounceUpdateHospitalsInViewport() {
    if (viewportUpdateTimer) clearTimeout(viewportUpdateTimer);
    viewportUpdateTimer = setTimeout(() => {
        updateHospitalsInViewport();
    }, 100);
}

/**
 * ============================================================================
 * [뷰포트 갱신: 오버레이 인스턴스 재사용 & 영구 캐시 즉각 주입]
 * - 화면 밖으로 나간 오버레이는 파괴(delete)하지 않고 setMap(null)로 숨김
 * - 다시 돌아오면 캐시된 정밀 좌표로 0ms 즉각 화면 표출 (점프 현상 완벽 방지)
 * ============================================================================
 */
function updateHospitalsInViewport() {
    if (!map || !currentLatLng || cachedHospitals.length === 0) return;

    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // 가장자리 잘림 방지 버퍼 (15%)
    const latSpan = ne.getLat() - sw.getLat();
    const lngSpan = ne.getLng() - sw.getLng();
    const bufferRatio = 0.15;

    const bufferedSwLat = sw.getLat() - (latSpan * bufferRatio);
    const bufferedSwLng = sw.getLng() - (lngSpan * bufferRatio);
    const bufferedNeLat = ne.getLat() + (latSpan * bufferRatio);
    const bufferedNeLng = ne.getLng() + (lngSpan * bufferRatio);

    const centerLat = currentLatLng.getLat();
    const centerLng = currentLatLng.getLng();

    const { isMobileOrTablet } = getDeviceEnvironment();
    const isNationwideOrPC = !isMobileOrTablet || currentRadiusKm >= 500;
    const maxVisibleLimit = isNationwideOrPC ? 4000 : MAX_MOBILE_VISIBLE_OVERLAYS;

    const visibleCandidates = [];
    for (let i = 0; i < cachedHospitals.length; i++) {
        const h = cachedHospitals[i];

        if (!hospitalFilters[h.type]) continue;

        const dist = getDistanceKm(centerLat, centerLng, h.lat, h.lng);
        if (dist > currentRadiusKm) continue;

        if (h.lat >= bufferedSwLat && h.lat <= bufferedNeLat &&
            h.lng >= bufferedSwLng && h.lng <= bufferedNeLng) {
            visibleCandidates.push({ ...h, distance: dist });
        }
    }

    if (!isNationwideOrPC && visibleCandidates.length > maxVisibleLimit) {
        visibleCandidates.sort((a, b) => {
            if (a.type === 'tertiary' && b.type !== 'tertiary') return -1;
            if (a.type !== 'tertiary' && b.type === 'tertiary') return 1;
            return a.distance - b.distance;
        });
        visibleCandidates.length = maxVisibleLimit;
    }

    const currentVisibleHpidSet = new Set(visibleCandidates.map(h => h.hpid));

    // 1. 화면 밖으로 나간 오버레이는 인스턴스를 파괴하지 않고 지도에서만 숨김 처리
    for (const [hpid, overlay] of activeOverlayMap.entries()) {
        if (!currentVisibleHpidSet.has(hpid)) {
            overlay.setMap(null);
        }
    }

    // 2. 화면에 들어온 병원 표시 (캐시 우선 즉시 주입)
    visibleCandidates.forEach(h => {
        // 이미 영구 캐시에 검증된 좌표가 있다면 즉각 갱신
        if (preciseCoordCache.has(h.hpid)) {
            const cached = preciseCoordCache.get(h.hpid);
            h.lat = cached.lat;
            h.lng = cached.lng;
        }

        if (activeOverlayMap.has(h.hpid)) {
            // 기존에 생성된 오버레이가 있다면 지도에 다시 표출 (0ms 지연 없음)
            const overlay = activeOverlayMap.get(h.hpid);
            if (!overlay.getMap()) {
                overlay.setPosition(new kakao.maps.LatLng(h.lat, h.lng));
                overlay.setMap(map);
            }
        } else {
            // 앱 실행 후 최초로 화면에 등장한 병원만 신규 생성
            const overlay = createHospitalBubbleOverlay(h);
            overlay.setMap(map);
            activeOverlayMap.set(h.hpid, overlay);

            // 최초 1회만 비동기 검증 실행 후 영구 캐시에 저장
            if (!preciseCoordCache.has(h.hpid)) {
                ensurePreciseHospitalCoordinate(h, (preciseHospital) => {
                    overlay.setPosition(new kakao.maps.LatLng(preciseHospital.lat, preciseHospital.lng));
                });
            }
        }
    });
}

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
    if (h.type === 'tertiary') typeBadgeClass = 'hospital-type-tertiary';
    else if (h.type === 'regional') typeBadgeClass = 'hospital-type-regional';

    const displayTel = h.erTel ? `🚨 ${h.erTel}` : (h.mainTel ? `📞 ${h.mainTel}` : '번호 없음');

    const wrapper = document.createElement('div');
    wrapper.className = 'hospital-overlay-wrapper';
    wrapper.title = '클릭하여 응급실 상세 정보 확인';
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

        ensurePreciseHospitalCoordinate(h, (preciseHospital) => {
            const overlay = activeOverlayMap.get(preciseHospital.hpid);
            if (overlay) {
                overlay.setPosition(new kakao.maps.LatLng(preciseHospital.lat, preciseHospital.lng));
            }
            openHospitalBottomSheet(preciseHospital, bedText, bedClass);
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

function openHospitalBottomSheet(h, bedText, bedClass) {
    currentSelectedHospital = h;

    document.getElementById('sheet-hospital-name').innerText = h.name;

    const addrElement = document.getElementById('sheet-address');
    if (h.address && h.address.trim() !== '') {
        addrElement.innerText = h.address;
    } else {
        addrElement.innerText = '주소 조회 중...';
        if (kakaoGeocoder) {
            kakaoGeocoder.coord2Address(h.lng, h.lat, (result, status) => {
                if (status === kakao.maps.services.Status.OK && result[0]) {
                    const fallbackAddr = result[0].road_address
                        ? result[0].road_address.address_name
                        : result[0].address.address_name;
                    h.address = fallbackAddr;
                    addrElement.innerText = fallbackAddr;
                } else {
                    addrElement.innerText = '주소 정보가 없습니다.';
                }
            });
        } else {
            addrElement.innerText = '주소 정보가 없습니다.';
        }
    }

    document.getElementById('sheet-distance').innerText = `내 위치로부터 ${h.distance.toFixed(1)}km`;

    const typeEl = document.getElementById('sheet-hospital-type');
    typeEl.innerText = h.typeLabel;

    let badgeClass = 'hospital-type-general';
    if (h.type === 'tertiary') badgeClass = 'hospital-type-tertiary';
    else if (h.type === 'regional') badgeClass = 'hospital-type-regional';
    typeEl.className = `hospital-type-badge ${badgeClass}`;

    const badgeEl = document.getElementById('sheet-bed-badge');
    badgeEl.className = `bed-badge ${bedClass}`;
    badgeEl.innerText = bedText;

    const erRow = document.getElementById('sheet-er-tel-row');
    const erLink = document.getElementById('sheet-er-tel-link');
    if (h.erTel) {
        erLink.href = `tel:${h.erTel}`;
        erLink.innerText = `📞 ${h.erTel} 통화`;
        erRow.style.display = 'flex';
    } else {
        erRow.style.display = 'none';
    }

    const mainRow = document.getElementById('sheet-main-tel-row');
    const mainLink = document.getElementById('sheet-main-tel-link');
    if (h.mainTel) {
        mainLink.href = `tel:${h.mainTel}`;
        mainLink.innerText = `📞 ${h.mainTel} 통화`;
        mainRow.style.display = 'flex';
    } else {
        mainRow.style.display = 'none';
    }

    const msgEl = document.getElementById('sheet-msg-content');
    if (h.message) {
        msgEl.innerHTML = h.message;
        msgEl.style.color = '#991b1b';
    } else {
        msgEl.innerHTML = '현재 등록된 실시간 제한/공지 메시지가 없습니다.';
        msgEl.style.color = '#64748b';
    }

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

function closeBottomSheet() {
    sheet.classList.remove('open');
    sheet.style.transform = '';
    dim.classList.remove('active');

    if (activeSearchPin) {
        activeSearchPin.setMap(null);
        activeSearchPin = null;
    }
}

function initBottomSheetEvents() {
    document.getElementById('sheet-close-btn').addEventListener('click', closeBottomSheet);
    dim.addEventListener('click', closeBottomSheet);

    document.getElementById('navi-kakao').addEventListener('click', (e) => {
        e.preventDefault();
        launchNavigationApp('kakao');
    });
    document.getElementById('navi-naver').addEventListener('click', (e) => {
        e.preventDefault();
        launchNavigationApp('naver');
    });
    document.getElementById('navi-tmap').addEventListener('click', (e) => {
        e.preventDefault();
        launchNavigationApp('tmap');
    });

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    dragArea.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        isDragging = true;
        sheet.style.transition = 'none';
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) sheet.style.transform = `translateY(${deltaY}px)`;
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

    dragArea.addEventListener('mousedown', (e) => {
        startY = e.clientY;
        isDragging = true;
        sheet.style.transition = 'none';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        currentY = e.clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) sheet.style.transform = `translateY(${deltaY}px)`;
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