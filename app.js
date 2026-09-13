/* global kakao */

// 공공데이터포털 응급의료기관 API 인증키 (디코딩 적용)
const PUBLIC_API_KEY = decodeURIComponent('s%2FvWNiKH1YndVRu2mPOq7OXAIj%2Byk0M3JTgvN%2B8UVdSFPq8SBR7zuUdG3mxklTrj6WYIiUidSIUwgE8bz09fzQ%3D%3D');

// 위치 권한 미허용 시 사용할 기본 좌표 (서울시청)
const defaultLat = 37.5668;
const defaultLng = 126.9786;

// 저사양 기기 최적화를 위해 지도 화면에 동시에 렌더링할 최대 병원 버블 개수
const MAX_VISIBLE_OVERLAYS = 80;

// ============================================================================
// 국립중앙의료원 중증 응급질환 28개 전 항목 매핑 테이블 (소문자 기준)
// ============================================================================
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

// ============================================================================
// 전역 상태 변수 선언부
// ============================================================================
let map = null;                    // 카카오 지도 인스턴스
let myLocationOverlay = null;      // 내 위치 펄스 마커 커스텀 오버레이
let currentLatLng = null;          // 현재 기준 중심 좌표 (kakao.maps.LatLng)
let activeCircle = null;           // 반경 시각화 Circle 인스턴스
let activeCircleLabel = null;      // 반경 상단 거리 라벨 오버레이
let currentRadiusKm = 10;          // 현재 설정된 탐색 반경 (기본: 10km)
let cachedHospitals = [];          // API로부터 로드된 전국 병원 전체 배열

// 화면에 현재 띄워진 오버레이를 HPID 키로 저장하는 맵 (Diffing 기법으로 깜빡임 차단)
const activeOverlayMap = new Map();

// 뷰포트 이동 중 과도한 연속 갱신을 방지하기 위한 디바운스 타이머
let viewportUpdateTimer = null;

// 병원 분류 필터 상태 객체
let hospitalFilters = {
    tertiary: true, // 상급종합병원
    regional: true, // 지역의료 (의료원)
    general: true   // 일반병원
};

// ============================================================================
// 1. 십진수 좌표 -> 도·분·초(DMS) 포맷 변환 함수
// ============================================================================
function toDMS(decimalCoord) {
    const abs = Math.abs(decimalCoord);
    const degrees = Math.floor(abs);
    const minutesFloat = (abs - degrees) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = ((minutesFloat - minutes) * 60).toFixed(1);
    return `${degrees}도 ${minutes}분 ${seconds}초`;
}

// ============================================================================
// 2. 반경 거리별 테마 색상 반환 함수
// ============================================================================
function getRadiusTheme(radiusKm) {
    if (radiusKm <= 10) {
        return {
            strokeColor: '#2563eb',
            fillColor: '#3b82f6',
            fillOpacity: 0.08,
            labelBg: '#2563eb'
        };
    } else if (radiusKm <= 20) {
        return {
            strokeColor: '#16a34a',
            fillColor: '#22c55e',
            fillOpacity: 0.08,
            labelBg: '#16a34a'
        };
    } else if (radiusKm <= 40) {
        return {
            strokeColor: '#d97706',
            fillColor: '#facc15',
            fillOpacity: 0.12,
            labelBg: '#d97706'
        };
    } else {
        return {
            strokeColor: '#ef4444',
            fillColor: '#f87171',
            fillOpacity: 0.08,
            labelBg: '#ef4444'
        };
    }
}

// ============================================================================
// 3. 애플리케이션 진입점 (SDK 로딩 타이밍 이슈 방지 보강)
// ============================================================================
function startApplication() {
    if (typeof kakao === 'undefined' || !kakao.maps) {
        document.getElementById('status-title').innerText = '❌ 카카오 지도 SDK 오류';
        return;
    }

    kakao.maps.load(function () {
        initMap();
        initBottomSheetEvents();
        initHospitalSearchEvents(); // 실시간 병원 이름 검색 이벤트 등록
    });
}

if (document.readyState === 'complete') {
    startApplication();
} else {
    window.addEventListener('load', startApplication);
}

// ============================================================================
// 4. 카카오 지도 객체 및 이벤트 리스너 초기화 함수
// ============================================================================
function initMap() {
    const mapContainer = document.getElementById('map');
    const mapOption = {
        center: new kakao.maps.LatLng(defaultLat, defaultLng),
        level: 6,
        draggable: true,
        scroll_wheel: true
    };

    map = new kakao.maps.Map(mapContainer, mapOption);

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

    document.getElementById('my-loc-btn').addEventListener('click', () => {
        moveToCurrentLocation(false);
    });

    loadAllEmergencyData().then(() => {
        moveToCurrentLocation(true);
    });
}

// XML 노드의 모든 자식 태그를 소문자로 정규화하여 맵 객체로 반환하는 헬퍼 함수
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

// ============================================================================
// 5. 국립중앙의료원 응급의료 Open API 데이터 병렬 수신 함수
// ============================================================================
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

        // 1. 가용 병상 맵 파싱
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

        // 2. 실시간 제한 공지 메시지 맵 파싱
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

        // 3. 실시간 중증 응급질환 28개 전 항목 파싱
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

        // 4. 병원 기본 정보 파싱 (대표번호와 직통번호 분리 저장)
        cachedHospitals = [];
        const listItems = listDoc.getElementsByTagName('item');
        for (let i = 0; i < listItems.length; i++) {
            const fields = getItemFieldMap(listItems[i]);
            const hpid = fields['hpid'];
            const name = fields['dutyname'] || '응급의료기관';

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

// ============================================================================
// 6. 실시간 병원 이름 검색 및 자동완성 목록 제어 함수
// ============================================================================
function initHospitalSearchEvents() {
    const searchInput = document.getElementById('keyword');
    const searchBtn = document.getElementById('search-btn');
    const searchResultsList = document.getElementById('search-results-list');
    const searchBox = document.getElementById('search-box');

    // 한글 키워드 실시간 입력 시 자동완성 목록 렌더링
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();

        // 입력창이 비어있으면 목록 닫기
        if (!query) {
            searchResultsList.innerHTML = '';
            searchResultsList.classList.remove('open');
            return;
        }

        // 전국 캐시 데이터에서 이름 매칭 필터링
        const matched = cachedHospitals.filter(h => h.name.toLowerCase().includes(query));

        if (matched.length === 0) {
            searchResultsList.innerHTML = '<li class="search-result-empty">일치하는 병원이 없습니다.</li>';
            searchResultsList.classList.add('open');
            return;
        }

        // 너무 많은 DOM 생성을 방지하기 위해 상위 25개까지만 노출
        const sliceMatched = matched.slice(0, 25);
        let html = '';

        sliceMatched.forEach(h => {
            let badgeClass = 'hospital-type-general';
            if (h.type === 'tertiary') badgeClass = 'hospital-type-tertiary';
            else if (h.type === 'regional') badgeClass = 'hospital-type-regional';

            // 현재 내 위치 기준 거리 계산
            const distText = currentLatLng
                ? `${getDistanceKm(currentLatLng.getLat(), currentLatLng.getLng(), h.lat, h.lng).toFixed(1)}km`
                : '';

            // 전화번호 표기
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

        // 드롭다운 항목 클릭 시 해당 병원 선택 처리
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

    // 검색창 바깥 클릭 시 드롭다운 닫기
    document.addEventListener('click', (e) => {
        if (searchBox && !searchBox.contains(e.target)) {
            searchResultsList.classList.remove('open');
        }
    });

    // 엔터키 또는 '검색' 버튼 클릭 시 가장 첫 번째 검색 결과 병원으로 즉시 이동
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

// 검색 목록에서 선택한 병원으로 지도 중심 이동 및 바텀시트 오픈 함수
function selectHospitalFromSearch(h) {
    const searchInput = document.getElementById('keyword');
    const searchResultsList = document.getElementById('search-results-list');

    searchInput.value = h.name;
    searchResultsList.classList.remove('open');

    // 해당 병원 좌표로 지도 이동 및 줌 레벨 확대
    const targetLatLng = new kakao.maps.LatLng(h.lat, h.lng);
    map.setLevel(3);
    map.panTo(targetLatLng);

    // 가용 병상 상태 텍스트 계산
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

    // 내 위치로부터의 거리 계산
    const dist = currentLatLng ? getDistanceKm(currentLatLng.getLat(), currentLatLng.getLng(), h.lat, h.lng) : 0;
    const targetHospitalWithDist = { ...h, distance: dist };

    // 바텀시트 상세 정보 즉시 열기
    openHospitalBottomSheet(targetHospitalWithDist, bedText, bedClass);
}

// ============================================================================
// 7. 현재 GPS 위치 조회 함수
// ============================================================================
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

// ============================================================================
// 8. 반경 원 및 상단 거리 라벨 렌더링
// ============================================================================
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

// ============================================================================
// 9. 뷰포트 기반 Diffing 렌더링 (저사양 기기 최적화 및 깜빡임 방지)
// ============================================================================
function debounceUpdateHospitalsInViewport() {
    if (viewportUpdateTimer) clearTimeout(viewportUpdateTimer);
    viewportUpdateTimer = setTimeout(() => {
        updateHospitalsInViewport();
    }, 120);
}

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

// ============================================================================
// 10. 병원 말풍선(버블) 커스텀 오버레이 생성 함수 (정밀 앵커 및 직통 전화 우선)
// ============================================================================
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
        openHospitalBottomSheet(h, bedText, bedClass);
    });

    return new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(h.lat, h.lng),
        content: wrapper,
        xAnchor: 0.5,
        yAnchor: 1.0,
        zIndex: 6
    });
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

// ============================================================================
// 11. 바텀시트 열기 및 직통/대표 전화, 중증 응급질환 28개 상세 렌더링
// ============================================================================
const sheet = document.getElementById('bottom-sheet');
const dim = document.getElementById('sheet-dim');
const dragArea = document.getElementById('sheet-drag-area');

function openHospitalBottomSheet(h, bedText, bedClass) {
    document.getElementById('sheet-hospital-name').innerText = h.name;
    document.getElementById('sheet-distance').innerText = `내 위치로부터 ${h.distance.toFixed(1)}km`;

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

    // 1. 응급실 직통(핫라인) 전화 행
    const erRow = document.getElementById('sheet-er-tel-row');
    const erLink = document.getElementById('sheet-er-tel-link');
    if (h.erTel) {
        erLink.href = `tel:${h.erTel}`;
        erLink.innerText = `📞 ${h.erTel} 통화`;
        erRow.style.display = 'flex';
    } else {
        erRow.style.display = 'none';
    }

    // 2. 병원 대표 콜센터 전화 행
    const mainRow = document.getElementById('sheet-main-tel-row');
    const mainLink = document.getElementById('sheet-main-tel-link');
    if (h.mainTel) {
        mainLink.href = `tel:${h.mainTel}`;
        mainLink.innerText = `📞 ${h.mainTel} 통화`;
        mainRow.style.display = 'flex';
    } else {
        mainRow.style.display = 'none';
    }

    // 실시간 공지 메시지
    const msgEl = document.getElementById('sheet-msg-content');
    if (h.message) {
        msgEl.innerHTML = h.message;
        msgEl.style.color = '#991b1b';
    } else {
        msgEl.innerHTML = '현재 등록된 실시간 제한/공지 메시지가 없습니다.';
        msgEl.style.color = '#64748b';
    }

    // 실시간 중증 응급질환 28개 수용 상태 (불가 N 항목 상단 빨간색 우선 노출)
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
}

function initBottomSheetEvents() {
    document.getElementById('sheet-close-btn').addEventListener('click', closeBottomSheet);
    dim.addEventListener('click', closeBottomSheet);

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