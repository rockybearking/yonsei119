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

// 저사양 브라우저 렌더링 과부하 방지: 전국/광역 뷰에서는 최대 100개로 제한
const MAX_VISIBLE_OVERLAYS = 100;

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

// 정밀 건물 중심점 영구 보존 캐시
const preciseCoordCache = new Map();

// 생성된 오버레이 인스턴스 맵 (Key: hpid, Value: { overlay, mode })
const activeOverlayMap = new Map();
let viewportUpdateTimer = null;

// 필터 기본값: 상급종합병원만 활성화
let hospitalFilters = {
    tertiary: true,
    regional: false,
    general: false
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

function toDMS(decimalCoord) {
    const abs = Math.abs(decimalCoord);
    const degrees = Math.floor(abs);
    const minutesFloat = (abs - degrees) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = ((minutesFloat - minutes) * 60).toFixed(1);
    return `${degrees}도 ${minutes}분 ${seconds}초`;
}

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

function ensurePreciseHospitalCoordinate(h, callback) {
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

    const searchTargetName = h.name.replace(/^(의료법인|학교법인|사회복지법인|재단법인|사단법인)\s*/, '');
    const searchQuery = `${regionToken} ${searchTargetName}`.trim();

    kakaoPlaces.keywordSearch(searchQuery, (data, status) => {
        if (status === kakao.maps.services.Status.OK && data && data.length > 0) {
            const validPlace = data.find(place => {
                const pLat = parseFloat(place.y);
                const pLng = parseFloat(place.x);
                const distFromRaw = getDistanceKm(h.rawLat, h.rawLng, pLat, pLng);
                if (distFromRaw > 0.4) return false;

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

        preciseCoordCache.set(h.hpid, { lat: h.lat, lng: h.lng });
        callback(h);
    }, {
        location: new kakao.maps.LatLng(h.rawLat, h.rawLng),
        radius: 500
    });
}

/**
 * ============================================================================
 * [병상 상태 판정 및 통일된 링/초과 수용 처리 함수]
 * ============================================================================
 */
function evaluateBedStatus(curVal, totalVal, type = 'count') {
    // 분만실: 원형 링 디자인 통일 (가능: 정상 링, 불가: 위험 링)
    if (type === 'delivery') {
        const strVal = String(curVal || '').trim().toUpperCase();
        const total = totalVal !== null && totalVal !== undefined && !isNaN(totalVal) ? Math.max(0, parseInt(totalVal, 10)) : null;

        if (strVal === 'Y' || parseInt(strVal, 10) > 0) {
            return {
                indicatorClass: 'bed-ind-normal',
                indicatorText: '가능',
                valueText: total ? `가능/${total}` : '가능',
                barClass: 'bg-normal',
                tooltip: total ? `가능/${total}` : '가능'
            };
        } else if (strVal === 'N' || parseInt(strVal, 10) <= 0) {
            return {
                indicatorClass: 'bed-ind-danger',
                indicatorText: '불가',
                valueText: total ? `0/${total}` : '불가',
                barClass: 'bg-danger',
                tooltip: total ? `0/${total} (불가)` : '불가'
            };
        } else {
            return {
                indicatorClass: 'bed-ind-none',
                indicatorText: '-',
                valueText: '-',
                barClass: 'bg-muted',
                tooltip: '정보 없음'
            };
        }
    }

    if (curVal === null || curVal === undefined || isNaN(curVal)) {
        return {
            indicatorClass: 'bed-ind-none',
            indicatorText: '-',
            valueText: '-',
            barClass: 'bg-muted',
            tooltip: '정보 없음'
        };
    }

    const rawCur = parseInt(curVal, 10);
    const rawTotal = totalVal !== null && totalVal !== undefined && !isNaN(totalVal) ? parseInt(totalVal, 10) : null;
    const total = rawTotal !== null ? Math.max(0, rawTotal) : null;

    // 음수 병상 예외 처리: 실제 가용 병상은 0으로 두고, 초과 인원을 '초과 수용'으로 명시
    const isOverCapacity = rawCur < 0;
    const overCapacityCount = isOverCapacity ? Math.abs(rawCur) : 0;
    const available = Math.max(0, rawCur);

    let displayVal = '';
    let tooltipVal = '';

    if (isOverCapacity) {
        if (total !== null) {
            displayVal = `0/${total}<span style="display:block; font-size:9.5px; color:#ef4444; font-weight:600; margin-top:2px;">${overCapacityCount}석 초과 수용</span>`;
            tooltipVal = `0/${total} (${overCapacityCount}석 초과 수용)`;
        } else {
            displayVal = `0석<span style="display:block; font-size:9.5px; color:#ef4444; font-weight:600; margin-top:2px;">${overCapacityCount}석 초과 수용</span>`;
            tooltipVal = `0석 (${overCapacityCount}석 초과 수용)`;
        }
    } else if (rawCur === 0) {
        if (total !== null) {
            displayVal = `0/${total}`;
            tooltipVal = `0/${total} (잔여 0석)`;
        } else {
            displayVal = `0석`;
            tooltipVal = `0석`;
        }
    } else {
        if (total !== null) {
            displayVal = `${available}/${total}`;
            tooltipVal = `${available}/${total}`;
        } else {
            displayVal = `${available}석`;
            tooltipVal = `${available}석`;
        }
    }

    // 잔여 0석 이하인 경우 혼잡/초과 수용
    if (rawCur <= 0) {
        return {
            indicatorClass: 'bed-ind-danger',
            indicatorText: '혼잡',
            valueText: displayVal,
            barClass: 'bg-danger',
            tooltip: `${tooltipVal} (혼잡)`
        };
    }

    // 보통: 잔여 3석 이하 또는 가용률 25% 이하
    const isModerate = rawCur <= 3 || (total && (rawCur / total) <= 0.25);
    if (isModerate) {
        return {
            indicatorClass: 'bed-ind-warning',
            indicatorText: '보통',
            valueText: displayVal,
            barClass: 'bg-warning',
            tooltip: `${tooltipVal} (보통)`
        };
    }

    // 원활
    return {
        indicatorClass: 'bed-ind-normal',
        indicatorText: '원활',
        valueText: displayVal,
        barClass: 'bg-normal',
        tooltip: `${tooltipVal} (원활)`
    };
}

/**
 * 5종 핵심 병상 파싱 (코호트 격리 병상 제외 완료)
 */
function parseBedDetailInfo(fields) {
    const parseNum = (v) => {
        if (v === undefined || v === null || v === '') return null;
        const n = parseInt(v, 10);
        return isNaN(n) ? null : n;
    };

    return {
        er: evaluateBedStatus(parseNum(fields['hvec']), parseNum(fields['hvs01']), 'count'),
        pediatric: evaluateBedStatus(parseNum(fields['hv28']), parseNum(fields['hvs02']), 'count'),
        delivery: evaluateBedStatus(fields['hv41'], parseNum(fields['hvs41'] || fields['hvs47']), 'delivery'),
        negative: evaluateBedStatus(parseNum(fields['hv29']), parseNum(fields['hvs04'] || fields['hvs03']), 'count'),
        isolation: evaluateBedStatus(parseNum(fields['hv30']), parseNum(fields['hvs05']), 'count')
    };
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
            window.location.href = `intent://route/car?dlat=${lat}&dlng=${lng}&dname=${encName}&appname=emergency-map#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end`;
        } else if (os === 'ios') {
            window.location.href = `nmap://route/car?dlat=${lat}&dlng=${lng}&dname=${encName}&appname=emergency-map`;
            setTimeout(() => {
                window.location.href = `https://map.naver.com/p/directions/-/${lat},${lng},${encName}/-/car`;
            }, 1500);
        } else {
            window.open(`https://map.naver.com/p/directions/-/${lat},${lng},${encName}/-/car`, '_blank');
        }
    } else if (provider === 'tmap') {
        const tmapParams = `rGoName=${encName}&rGoX=${lng}&rGoY=${lat}&goalname=${encName}&goallat=${lat}&goallng=${lng}&goalx=${lng}&goaly=${lat}`;

        if (os === 'android') {
            window.location.href = `intent://route?${tmapParams}#Intent;scheme=tmap;package=com.skt.tmap.ku;end`;
        } else if (os === 'ios') {
            window.location.href = `tmap://route?${tmapParams}`;
            setTimeout(() => {
                window.location.href = 'https://apps.apple.com/kr/app/tmap-%EB%82%B4%EB%B9%84%EA%B2%8C%EC%9D%B4%EC%85%98-%EC%A7%80%EB%8F%84/id431589174';
            }, 1500);
        } else {
            alert('티맵(Tmap)은 모바일 앱 전용 내비게이션입니다. 스마트폰이나 태블릿에서 이용해 주세요.');
        }
    }
}

/**
 * ============================================================================
 * [어플리케이션 초기화]
 * ============================================================================
 */
function startApplication() {
    initNoticeModal();

    if (typeof kakao === 'undefined' || !kakao.maps) {
        document.getElementById('status-title').innerText = '카카오 지도 SDK 로드 실패';
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
 * 첫 진입 안내 팝업창 바인딩
 */
function initNoticeModal() {
    const backdrop = document.getElementById('notice-modal-backdrop');
    const closeBtn = document.getElementById('notice-close-btn');
    const confirmBtn = document.getElementById('notice-confirm-btn');

    const closeNotice = () => {
        if (backdrop) {
            backdrop.classList.add('hidden');
            setTimeout(() => {
                backdrop.style.display = 'none';
                if (map) map.relayout();
            }, 250);
        }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeNotice);
    if (confirmBtn) confirmBtn.addEventListener('click', closeNotice);

    // 배경 클릭 시에도 닫히도록 지원
    if (backdrop) {
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeNotice();
        });
    }
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
            if (activeCircle.getMap()) activeCircle.setMap(null);
            if (activeCircleLabel && activeCircleLabel.getMap()) activeCircleLabel.setMap(null);
        } else if (currentRadiusKm >= 20 && level <= 4) {
            if (activeCircle.getMap()) activeCircle.setMap(null);
            if (activeCircleLabel && activeCircleLabel.getMap()) activeCircleLabel.setMap(null);
        } else {
            if (!activeCircle.getMap()) activeCircle.setMap(map);
            if (activeCircleLabel && !activeCircleLabel.getMap()) activeCircleLabel.setMap(map);
        }
        debounceUpdateHospitalsInViewport();
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

async function loadAllEmergencyData() {
    document.getElementById('status-title').innerText = '응급의료기관 데이터 수신 중...';

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
            if (hpid) {
                const parsedBeds = parseBedDetailInfo(fields);
                const hvecStr = fields['hvec'];
                const hvecNum = hvecStr !== undefined && hvecStr !== '' ? parseInt(hvecStr, 10) : null;
                bedMap.set(hpid, {
                    hvec: isNaN(hvecNum) ? null : hvecNum,
                    details: parsedBeds
                });
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

                const bedData = bedMap.get(hpid);

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
                    hvec: bedData ? bedData.hvec : null,
                    bedDetails: bedData ? bedData.details : parseBedDetailInfo({}),
                    message: msgMap.get(hpid) || null,
                    severeData: severeMap.get(hpid) || null
                });
            }
        }

        document.getElementById('status-title').innerText = '응급의료 데이터 준비 완료';
    } catch (err) {
        console.error('데이터 로드 실패:', err);
        document.getElementById('status-title').innerText = '데이터 수신 지연';
    }
}

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

            const telText = h.erTel ? `직통: ${h.erTel}` : (h.mainTel ? `대표: ${h.mainTel}` : '');

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
            activeOverlayMap.get(preciseHospital.hpid).overlay.setPosition(preciseLatLng);
        }

        const dist = currentLatLng ? getDistanceKm(currentLatLng.getLat(), currentLatLng.getLng(), preciseHospital.lat, preciseHospital.lng) : 0;
        const targetHospitalWithDist = { ...preciseHospital, distance: dist };

        openHospitalBottomSheet(targetHospitalWithDist);
    });
}

function moveToCurrentLocation(isInitial) {
    if (!navigator.geolocation) {
        document.getElementById('status-title').innerText = 'Geolocation 미지원';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = Math.round(position.coords.accuracy);

            currentLatLng = new kakao.maps.LatLng(lat, lng);

            document.getElementById('status-title').innerText = '위치 갱신 완료';
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
            document.getElementById('status-title').innerText = '기본 위치(서울시청) 적용';
            document.getElementById('coords').innerHTML =
                `• 위도: ${toDMS(defaultLat)}<br>• 경도: ${toDMS(defaultLng)}<br>• 위치 권한 미허용 상태`;
            currentLatLng = new kakao.maps.LatLng(defaultLat, defaultLng);
            renderRadiusAndHospitals(currentLatLng, currentRadiusKm);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function renderRadiusAndHospitals(center, radiusKm) {
    if (activeCircle) activeCircle.setMap(null);
    if (activeCircleLabel) activeCircleLabel.setMap(null);

    if (radiusKm >= 500) {
        map.setLevel(13);
        map.setCenter(new kakao.maps.LatLng(36.3, 127.8));
        updateHospitalsInViewport();
        return;
    }

    const radiusMeters = radiusKm * 1000;
    const theme = getRadiusTheme(radiusKm);

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
    labelBadge.innerText = `${radiusKm}km`;

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
    }, 80);
}

/**
 * ============================================================================
 * [뷰포트 갱신: LOD(Level of Detail) 렌더링 최적화]
 * ============================================================================
 */
function updateHospitalsInViewport() {
    if (!map || !currentLatLng || cachedHospitals.length === 0) return;

    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const currentLevel = map.getLevel();

    const renderMode = currentLevel >= 9 ? 'dot' : 'bubble';

    const latSpan = ne.getLat() - sw.getLat();
    const lngSpan = ne.getLng() - sw.getLng();
    const bufferRatio = 0.10;

    const bufferedSwLat = sw.getLat() - (latSpan * bufferRatio);
    const bufferedSwLng = sw.getLng() - (lngSpan * bufferRatio);
    const bufferedNeLat = ne.getLat() + (latSpan * bufferRatio);
    const bufferedNeLng = ne.getLng() + (lngSpan * bufferRatio);

    const centerLat = currentLatLng.getLat();
    const centerLng = currentLatLng.getLng();

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

    if (visibleCandidates.length > MAX_VISIBLE_OVERLAYS) {
        visibleCandidates.sort((a, b) => {
            if (a.type === 'tertiary' && b.type !== 'tertiary') return -1;
            if (a.type !== 'tertiary' && b.type === 'tertiary') return 1;
            return a.distance - b.distance;
        });
        visibleCandidates.length = MAX_VISIBLE_OVERLAYS;
    }

    const currentVisibleHpidSet = new Set(visibleCandidates.map(h => h.hpid));

    for (const [hpid, item] of activeOverlayMap.entries()) {
        if (!currentVisibleHpidSet.has(hpid)) {
            item.overlay.setMap(null);
        }
    }

    visibleCandidates.forEach(h => {
        if (preciseCoordCache.has(h.hpid)) {
            const cached = preciseCoordCache.get(h.hpid);
            h.lat = cached.lat;
            h.lng = cached.lng;
        }

        const existing = activeOverlayMap.get(h.hpid);

        if (existing && existing.mode === renderMode) {
            if (!existing.overlay.getMap()) {
                existing.overlay.setPosition(new kakao.maps.LatLng(h.lat, h.lng));
                existing.overlay.setMap(map);
            }
        } else {
            if (existing) {
                existing.overlay.setMap(null);
            }

            const overlay = renderMode === 'dot'
                ? createHospitalDotOverlay(h)
                : createHospitalBubbleOverlay(h);

            overlay.setMap(map);
            activeOverlayMap.set(h.hpid, { overlay, mode: renderMode });

            if (!preciseCoordCache.has(h.hpid)) {
                ensurePreciseHospitalCoordinate(h, (preciseHospital) => {
                    overlay.setPosition(new kakao.maps.LatLng(preciseHospital.lat, preciseHospital.lng));
                });
            }
        }
    });
}

/**
 * ============================================================================
 * [광역/전국 축척용 점(Dot) 오버레이]
 * ============================================================================
 */
function createHospitalDotOverlay(h) {
    let bedClass = 'dot-warning';
    if (h.hvec !== null && h.hvec !== undefined) {
        if (h.hvec > 5) bedClass = 'dot-normal';
        else if (h.hvec > 0) bedClass = 'dot-warning';
        else bedClass = 'dot-danger';
    }

    let borderClass = 'border-general';
    if (h.type === 'tertiary') borderClass = 'border-tertiary';
    else if (h.type === 'regional') borderClass = 'border-regional';

    const wrapper = document.createElement('div');
    wrapper.className = `hospital-mini-dot ${bedClass} ${borderClass}`;
    wrapper.title = `${h.name} (${h.typeLabel})`;

    let isDotDragging = false;
    let dotDownX = 0;
    let dotDownY = 0;

    wrapper.addEventListener('mousedown', (e) => {
        isDotDragging = false;
        dotDownX = e.clientX;
        dotDownY = e.clientY;
    });

    wrapper.addEventListener('mousemove', (e) => {
        if (Math.abs(e.clientX - dotDownX) > 6 || Math.abs(e.clientY - dotDownY) > 6) {
            isDotDragging = true;
        }
    });

    wrapper.addEventListener('touchstart', (e) => {
        isDotDragging = false;
        if (e.touches && e.touches[0]) {
            dotDownX = e.touches[0].clientX;
            dotDownY = e.touches[0].clientY;
        }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
            if (Math.abs(e.touches[0].clientX - dotDownX) > 6 || Math.abs(e.touches[0].clientY - dotDownY) > 6) {
                isDotDragging = true;
            }
        }
    }, { passive: true });

    wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isDotDragging) {
            isDotDragging = false;
            return;
        }

        map.setLevel(4);
        map.panTo(new kakao.maps.LatLng(h.lat, h.lng));

        ensurePreciseHospitalCoordinate(h, (preciseHospital) => {
            openHospitalBottomSheet(preciseHospital);
        });
    });

    return new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(h.lat, h.lng),
        content: wrapper,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: h.type === 'tertiary' ? 4 : 2
    });
}

/**
 * ============================================================================
 * [근거리/상세 모드용 카드 말풍선 오버레이]
 * (코호트 격리 세그먼트 제거 및 5종 상태 바 반영)
 * ============================================================================
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
        } else if (h.hvec < 0) {
            bedText = `0석 (${Math.abs(h.hvec)}석 초과 수용)`;
            bedClass = 'bed-danger';
        } else {
            bedText = '0석 (병상 부족)';
            bedClass = 'bed-danger';
        }
    }

    let typeBadgeClass = 'hospital-type-general';
    if (h.type === 'tertiary') typeBadgeClass = 'hospital-type-tertiary';
    else if (h.type === 'regional') typeBadgeClass = 'hospital-type-regional';

    const displayTel = h.erTel ? `${h.erTel}` : (h.mainTel ? `${h.mainTel}` : '번호 없음');
    const beds = h.bedDetails || parseBedDetailInfo({});

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
            <div style="display:flex; align-items:center; justify-content:space-between;">
                <span style="font-size:10.5px; color:#64748b;">응급실:</span>
                <span class="bed-badge ${bedClass}">${bedText}</span>
            </div>
            <div class="hospital-bed-bars" title="일반 | 소아 | 분만실 | 음압격리 | 일반격리">
                <div class="bed-bar-segment ${beds.er.barClass}" title="응급실일반: ${beds.er.tooltip}"></div>
                <div class="bed-bar-segment ${beds.pediatric.barClass}" title="응급실소아: ${beds.pediatric.tooltip}"></div>
                <div class="bed-bar-segment ${beds.delivery.barClass}" title="분만실: ${beds.delivery.tooltip}"></div>
                <div class="bed-bar-segment ${beds.negative.barClass}" title="음압격리: ${beds.negative.tooltip}"></div>
                <div class="bed-bar-segment ${beds.isolation.barClass}" title="일반격리: ${beds.isolation.tooltip}"></div>
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
        if (Math.abs(e.clientX - bubbleDownX) > 6 || Math.abs(e.clientY - bubbleDownY) > 6) {
            isDraggingBubble = true;
        }
    });

    wrapper.addEventListener('touchstart', (e) => {
        isDraggingBubble = false;
        if (e.touches && e.touches[0]) {
            bubbleDownX = e.touches[0].clientX;
            bubbleDownY = e.touches[0].clientY;
        }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
            if (Math.abs(e.touches[0].clientX - bubbleDownX) > 6 || Math.abs(e.touches[0].clientY - bubbleDownY) > 6) {
                isDraggingBubble = true;
            }
        }
    }, { passive: true });

    wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isDraggingBubble) {
            isDraggingBubble = false;
            return;
        }

        ensurePreciseHospitalCoordinate(h, (preciseHospital) => {
            const existing = activeOverlayMap.get(preciseHospital.hpid);
            if (existing && existing.overlay) {
                existing.overlay.setPosition(new kakao.maps.LatLng(preciseHospital.lat, preciseHospital.lng));
            }
            openHospitalBottomSheet(preciseHospital);
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
 * ============================================================================
 * [바텀시트 오픈]
 * 5열 가로 정렬 및 코호트 격리 제외 렌더링
 * ============================================================================
 */
function openHospitalBottomSheet(h) {
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

    const distText = h.distance !== undefined ? `내 위치로부터 ${h.distance.toFixed(1)}km` : '';
    document.getElementById('sheet-distance').innerText = distText;

    const typeEl = document.getElementById('sheet-hospital-type');
    typeEl.innerText = h.typeLabel;

    let badgeClass = 'hospital-type-general';
    if (h.type === 'tertiary') badgeClass = 'hospital-type-tertiary';
    else if (h.type === 'regional') badgeClass = 'hospital-type-regional';
    typeEl.className = `hospital-type-badge ${badgeClass}`;

    const beds = h.bedDetails || parseBedDetailInfo({});
    const gridEl = document.getElementById('sheet-bed-grid');

    const renderBedCol = (title, bed) => `
        <div class="bed-col">
            <span class="bed-col-title">${title}</span>
            <div class="bed-status-indicator ${bed.indicatorClass}">${bed.indicatorText}</div>
            <div class="bed-col-value" style="white-space:normal; line-height:1.25;">${bed.valueText}</div>
        </div>
    `;

    // 코호트 격리 항목 제외 (5종 컬럼 렌더링)
    gridEl.innerHTML = `
        ${renderBedCol('응급실일반', beds.er)}
        ${renderBedCol('응급실소아', beds.pediatric)}
        ${renderBedCol('분만실', beds.delivery)}
        ${renderBedCol('음압격리', beds.negative)}
        ${renderBedCol('일반격리', beds.isolation)}
    `;

    const erRow = document.getElementById('sheet-er-tel-row');
    const erLink = document.getElementById('sheet-er-tel-link');
    if (h.erTel) {
        erLink.href = `tel:${h.erTel}`;
        erLink.innerText = `${h.erTel} 통화`;
        erRow.style.display = 'flex';
    } else {
        erRow.style.display = 'none';
    }

    const mainRow = document.getElementById('sheet-main-tel-row');
    const mainLink = document.getElementById('sheet-main-tel-link');
    if (h.mainTel) {
        mainLink.href = `tel:${h.mainTel}`;
        mainLink.innerText = `${h.mainTel} 통화`;
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
            html += `<div style="font-size:11px; font-weight:700; color:#b91c1c; margin-bottom:4px;">수용 불가 질환 (${h.severeData.unavailable.length}건)</div>`;
            html += '<div class="severe-grid" style="margin-bottom:10px;">';
            h.severeData.unavailable.forEach(name => {
                html += `<span class="severe-tag imposbl">${name}</span>`;
            });
            html += '</div>';
        }

        if (h.severeData.available.length > 0) {
            html += `<div style="font-size:11px; font-weight:700; color:#15803d; margin-bottom:4px;">수용 가능 질환 (${h.severeData.available.length}건)</div>`;
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