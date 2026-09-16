/* global kakao */

/**
 * ============================================================================
 * [상수 정의부] 공공데이터 인증키, 기본 좌표, 렌더링 한도 및 질환 코드 정의
 * ============================================================================
 */

// 공공데이터포털 국립중앙의료원 응급의료 오픈 API 인증키
const PUBLIC_API_KEY = decodeURIComponent('s%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D');

// 사용자가 위치 권한을 거부하거나 Geolocation 실패 시 사용할 기본 중심 좌표 (서울시청)
const defaultLat = 37.5668;
const defaultLng = 126.9786;

// 모바일 기기 브라우저 과부하 방지를 위한 최대 렌더링 개수
const MAX_VISIBLE_OVERLAYS = 80;

// 국립중앙의료원 응급의료센터 중증 응급질환 28개 코드 및 표준 질환명 매핑
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
 * [전역 상태 변수 선언부]
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

let kakaoGeocoder = null;
let kakaoPlaces = null;

const activeOverlayMap = new Map();
let viewportUpdateTimer = null;

let hospitalFilters = {
    tertiary: true,
    regional: true,
    general: true
};

// 현재 바텀시트에 로드된 병원 데이터 캐시
let currentSelectedHospital = null;

const sheet = document.getElementById('bottom-sheet');
const dim = document.getElementById('sheet-dim');
const dragArea = document.getElementById('sheet-drag-area');

/**
 * 모바일 디바이스 환경 판별 유틸리티 (Android / iOS / Desktop)
 */
function getMobileOS() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    if (/android/i.test(ua)) return 'android';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios';
    return 'other';
}

/**
 * 십진수 좌표를 도/분/초 단위 문자열로 변환
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
 * 반경에 따른 시각화 테마 색상 반환
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
 * 하버사인 공식 직선거리 계산
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
 * 3대 내비게이션 네이티브 앱 Direct 실행 및 웹 폴백(Fallback) 함수
 * @param {'kakao'|'naver'|'tmap'} provider
 */
function launchNavigationApp(provider) {
    if (!currentSelectedHospital) return;

    const h = currentSelectedHospital;
    const os = getMobileOS();
    const encName = encodeURIComponent(h.name);
    const lat = h.lat;
    const lng = h.lng;

    if (provider === 'tmap') {
        if (os === 'android') {
            window.location.href = `intent://route?goalname=${encName}&goallat=${lat}&goallng=${lng}#Intent;scheme=tmap;package=com.skt.tmap.ku;end`;
        } else if (os === 'ios') {
            window.location.href = `tmap://route?goalname=${encName}&goallat=${lat}&goallng=${lng}`;
            setTimeout(() => {
                window.location.href = 'https://apps.apple.com/kr/app/tmap-%EB%82%B4%EB%B9%84%EA%B2%8C%EC%9D%B4%EC%85%98-%EC%A7%80%EB%8F%84/id431589174';
            }, 1500);
        } else {
            alert('티맵은 모바일 전용 서비스입니다. 모바일 기기에서 사용해주세요.');
        }
    } else if (provider === 'naver') {
        if (os === 'android') {
            window.location.href = `intent://route/car?dlat=${lat}&dlng=${lng}&dname=${encName}&appname=rockybearking.github.io#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end`;
        } else if (os === 'ios') {
            window.location.href = `nmap://route/car?dlat=${lat}&dlng=${lng}&dname=${encName}&appname=rockybearking.github.io`;
            setTimeout(() => {
                window.location.href = `https://m.map.naver.com/route.nhn?menu=route&ename=${encName}&ex=${lng}&ey=${lat}&pathType=0&showMap=true`;
            }, 1500);
        } else {
            window.open(`https://map.naver.com/v5/directions/-/-/-/car?c=${lng},${lat},15,0,0,0,dh`, '_blank');
        }
    } else if (provider === 'kakao') {
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
    }
}

/**
 * 어플리케이션 진입점
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

if (document.readyState === 'complete') {
    startApplication();
} else {
    window.addEventListener('load', startApplication);
}

/**
 * 카카오 지도 생성 및 UI 초기화
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

    kakaoGeocoder = new kakao.maps.services.Geocoder();
    kakaoPlaces = new kakao.maps.services.Places();

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

    // 플로팅 메뉴 제어
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

    document.addEventListener('click', () => {
        if (isPageDragging) {
            isPageDragging = false;
            return;
        }
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

/**
 * XML 노드 텍스트 추출 헬퍼
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
 * 국립중앙의료원 오픈 API 4대 데이터 병렬 수신
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
 * 카카오 검색 API를 통한 병원 실좌표 및 도로명 주소 정합 보정
 */
function resolvePreciseHospitalPosition(h, callback) {
    if (!kakaoPlaces || !kakaoGeocoder) {
        callback(new kakao.maps.LatLng(h.lat, h.lng));
        return;
    }

    const cleanName = h.name.replace(/^의료법인\s+[^\s]+\s+/, '').trim();

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

            // 주소가 비어있는 경우 검색된 실제 도로명/지번 주소 보완
            if (!h.address || h.address.trim() === '') {
                h.address = matchedPlace.road_address_name || matchedPlace.address_name || '';
            }

            callback(new kakao.maps.LatLng(preciseLat, preciseLng));
            return;
        }

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
                callback(new kakao.maps.LatLng(h.lat, h.lng));
            });
        } else {
            callback(new kakao.maps.LatLng(h.lat, h.lng));
        }
    });
}

/**
 * 병원 이름 검색 이벤트 초기화
 */
function initHospitalSearchEvents() {
    const searchInput = document.getElementById('keyword');
    const searchBtn = document.getElementById('search-btn');
    const searchResultsList = document.getElementById('search-results-list');
    const searchBox = document.getElementById('search-box');

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
        if (e.key === 'Enter') executeSearchSubmit();
    });
}

/**
 * 검색 결과 선택 시 포커싱 및 바텀시트 호출
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
 * 현재 GPS 좌표 측정
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
 * 반경 원 시각화 및 가시 병원 렌더링
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

function debounceUpdateHospitalsInViewport() {
    if (viewportUpdateTimer) clearTimeout(viewportUpdateTimer);
    viewportUpdateTimer = setTimeout(() => {
        updateHospitalsInViewport();
    }, 120);
}

/**
 * 현재 화면 영역 내 병원만 선별하여 오버레이 갱신
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

        if (!hospitalFilters[h.type]) continue;

        const dist = getDistanceKm(centerLat, centerLng, h.lat, h.lng);
        if (dist > currentRadiusKm) continue;

        if (h.lat >= sw.getLat() && h.lat <= ne.getLat() &&
            h.lng >= sw.getLng() && h.lng <= ne.getLng()) {
            visibleCandidates.push({ ...h, distance: dist });
        }
    }

    if (visibleCandidates.length > MAX_VISIBLE_OVERLAYS) {
        visibleCandidates.sort((a, b) => {
            if (a.type === 'tertiary' && b.type !== 'tertiary') return -1;
            if (a.type !== 'tertiary' && b.type === 'tertiary') return 1;
            return a.distance - b.distance;
        });
        visibleCandidates.length = MAX_VISIBLE_OVERLAYS;
    }

    const nextHpidSet = new Set(visibleCandidates.map(h => h.hpid));

    for (const [hpid, overlay] of activeOverlayMap.entries()) {
        if (!nextHpidSet.has(hpid)) {
            overlay.setMap(null);
            activeOverlayMap.delete(hpid);
        }
    }

    visibleCandidates.forEach(h => {
        if (!activeOverlayMap.has(h.hpid)) {
            const overlay = createHospitalBubbleOverlay(h);
            overlay.setMap(map);
            activeOverlayMap.set(h.hpid, overlay);
        }
    });
}

/**
 * 병원 마커 말풍선 엘리먼트 생성
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
    if (h.type === 'tertiary') typeBadgeClass = 'hospital-type-tertiary';
    else if (h.type === 'regional') typeBadgeClass = 'hospital-type-regional';

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

        resolvePreciseHospitalPosition(h, (preciseLatLng) => {
            const overlay = activeOverlayMap.get(h.hpid);
            if (overlay) overlay.setPosition(preciseLatLng);
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
 * 병원 상세 정보 바텀시트 표시 및 데이터 바인딩
 */
function openHospitalBottomSheet(h, bedText, bedClass) {
    currentSelectedHospital = h;

    document.getElementById('sheet-hospital-name').innerText = h.name;

    // 주소 정보 누락 방지 및 역지오코딩 처리
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

/**
 * 바텀시트 닫기
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
 * 바텀시트 이벤트 및 내비게이션 클릭 이벤트 등록
 */
function initBottomSheetEvents() {
    document.getElementById('sheet-close-btn').addEventListener('click', closeBottomSheet);
    dim.addEventListener('click', closeBottomSheet);

    // 내비게이션 버튼 다이렉트 딥링크 이벤트
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

    // 모바일 터치 드래그 제스처
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

    // 데스크톱 마우스 드래그
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