import {
    EMERGENCY_BED_ITEMS,
    EQUIPMENT_TABLE_ITEMS,
    HVS_LABELS,
    HV_LABELS,
    INPATIENT_BED_SECTIONS,
    LARGE_MONITOR_MIN_HEIGHT,
    LARGE_MONITOR_MIN_WIDTH,
    MKIOSKTY_METADATA,
    MOBILE_MAX_WIDTH,
    SEVERE_DISEASE_GROUPS
} from './constants.js';
import {
    state,
    uiCallbacks
} from './state.js';
import {
    availability,
    bedValue,
    byId,
    createMarqueeEl,
    displayValue,
    distanceKm,
    empty,
    fieldLabel,
    firstReported,
    formatParamLabel,
    getActiveMessages,
    getOriginDisplayLabel,
    integerValue,
    isAppleTouchDevice,
    isBlankOrNull,
    isDiseaseSpecificallyBlocked,
    isMissing,
    node,
    parseApiDate,
    setStatus,
    updateMarquees
} from './utils.js';
import {
    hospitalLabel
} from './markers-cluster.js';
import {
    hasRenderedRoute,
    loadDirectionsForHospital,
    populateWaypointSelect
} from './directions-eta.js';
/*
 * [JS 문법]
 * - import { ... } from './모듈.js' : 다른 JS 파일에서 공개한 상수·함수를 가져오는 ES 모듈 문법임.
 * - 브라우저 네이티브 ES 모듈에서는 상대 경로('./...') 뒤에 '.js' 확장자를 꼭 붙여야 함.
 *
 * [프로젝트 내부 모듈 의존성]
 * - constants.js (스키마) : EMERGENCY_BED_ITEMS, INPATIENT_BED_SECTIONS, EQUIPMENT_TABLE_ITEMS, SEVERE_DISEASE_GROUPS.
 * - constants.js (사전·화면) : MKIOSKTY_METADATA, HV_LABELS, HVS_LABELS, LARGE_MONITOR_MIN_*, MOBILE_MAX_WIDTH.
 * - state.js : 공용 런타임 상태(state)와 순환 참조 방지용 콜백 모음(uiCallbacks)을 가져옴.
 * - utils.js (DOM·거리) : byId, node, empty, createMarqueeEl, updateMarquees, setStatus, distanceKm, getOriginDisplayLabel.
 * - utils.js (정제·판정) : availability, bedValue, displayValue, fieldLabel, firstReported, formatParamLabel, integerValue.
 * - utils.js (공지·기기) : isBlankOrNull, isMissing, parseApiDate, getActiveMessages, isDiseaseSpecificallyBlocked, isAppleTouchDevice.
 * - markers-cluster.js : 병원 종별·권역 라벨 문자열 생성 함수(hospitalLabel)를 가져옴.
 * - directions-eta.js : hasRenderedRoute, loadDirectionsForHospital, populateWaypointSelect를 가져옴.
 *
 * [아키텍처 계층]
 * - hospital-sheet.js는 3단 반응형 병원 상세 시트(#sheet)와 모바일 Half-Peek 스냅·터치 드래그를 담당함.
 * - 3사 내비 딥링크(네이버·카카오·T맵), 직통 공유 URL(?hospital=...), E-Gen 병상·장비·질환 보드를 그림.
 * - 개발자 모드 원본 인스펙터와 필요 시 GET /api/hospitals/{hpid} 상세 보충 조회를 처리함.
 */

function contactLink(text, href, className) {
    const link = node('a', className, text);
    link.href = href;
    return link;
}
/*
 * [JS 문법]
 * - function (hospital-sheet.js 모듈 내부 비공개 함수 선언), const, return
 *
 * [브라우저 내장 Web API]
 * - HTMLAnchorElement.prototype.href : <a> 링크 요소에 이동 주소('tel:...' 등)를 설정하는 표준 속성임.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : contactLink.
 * - 매개변수명 : text(버튼 글자), href('tel:...' 전화 연결 주소), className(CSS 클래스명).
 *
 * [지역 변수명]
 * - link : utils.js의 node()로 만든 <a> DOM 요소.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderContacts()에서 응급실·대표 전화 버튼을 만들 때 호출됨.
 * - 흐름 : node('a', className, text) 생성 ──> link.href = href 지정 ──> link 반환.
 */

export function openMobileApp(scheme, androidPackage, fallback) {
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
        if (document.visibilityState === 'visible' && Date.now() - started < 3000) {
            window.location.href = fallback;
        }
    }, 1800);

    window.location.href = scheme;
}
/*
 * [JS 문법]
 * - export function, const, let, 화살표 함수(=>), if, !isAppleTouchDevice(), &&, <, -, 템플릿 리터럴, return
 * - 정규표현식 : /Android/i (대소문자 구분 없이 Android 확인), /^[a-z]+:\/\// (앱 스킴 앞부분 치환)
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - navigator.userAgent : 현재 브라우저와 운영체제 정보를 담은 문자열 속성임.
 * - String.prototype.replace(), .split(), RegExp.prototype.test(), encodeURIComponent() : 문자열 가공·인코딩.
 * - window.location.href : 현재 탭 주소를 바꿔 모바일 앱 스킴이나 스토어·웹 주소를 실행함.
 * - window.open(url, '_blank', 'noopener,noreferrer') : 데스크톱에서 새 탭을 열어 원래 탭 조작 위험을 막음.
 * - Date.now(), window.setTimeout(), window.clearTimeout() : 1.8초 뒤 앱 전환 실패 여부를 확인하는 타이머 API.
 * - document.addEventListener('visibilitychange', ...), window.addEventListener('pagehide', ...) : 탭 숨김 감시.
 * - document.visibilityState : 페이지가 화면에 보이는지('visible') 숨겨졌는지('hidden') 확인하는 속성임.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : openMobileApp.
 * - 매개변수명 : scheme(앱 실행 주소), androidPackage(Android 패키지 ID), fallback(미설치 시 이동 주소).
 *
 * [지역 변수명 및 내부 함수]
 * - intent, protocol : 'intent://'로 바꾼 URI 앞부분과 추출한 원래 스킴명('nmap'|'kakaomap'|'tmap').
 * - started, timer : iOS 딥링크 시도 시작 시각(ms)과 1800ms 타이머 ID.
 * - cleanup, onVisibility : 타이머·감시 리스너를 정리하고 화면 백그라운드 전환을 확인하는 내부 함수.
 *
 * [Android Intent URI 조립 분해]
 *   intent://route/car?slat=...&dlat=...#Intent;scheme=nmap;action=android.intent.action.VIEW;package=com.nhn.android.nmap;S.browser_fallback_url=https%3A%2F%2Fplay.google.com...;end
 *   ├── intent://...              : 원본 스킴 접두사(nmap://, kakaomap://, tmap://)를 intent://로 치환한 본체
 *   ├── #Intent;scheme=protocol;  : 실제 앱이 받을 커스텀 스킴 이름 지정
 *   ├── action=...VIEW;           : Android 표준 VIEW 액티비티 실행 액션
 *   ├── package=androidPackage;   : 실행 대상 패키지(com.nhn.android.nmap | net.daum.android.map | com.skt.tmap.ku)
 *   └── S.browser_fallback_url=.. : 앱 미설치 시 Chrome이 자동으로 여는 인코딩된 스토어·웹 주소
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 launchNavigation()에서 호출됨.
 * - 흐름 :
 *   1) Android ──> Intent URI 조립 ──> window.location.href로 앱 실행(미설치 시 fallback 이동)
 *   2) PC 데스크톱 ──> window.open(fallback, '_blank', 'noopener,noreferrer')로 새 탭 웹 지도 열기
 *   3) iOS/iPadOS ──> document 'visibilitychange' -> onVisibility() · window 'pagehide' -> cleanup() 등록
 *      └── scheme 실행 후 1.8초 내 백그라운드 미전환 시 cleanup() 후 fallback 이동
 */

export function navigationLink(provider, hospital) {
    const name = encodeURIComponent(hospital.name);
    const lat = hospital.lat;
    const lng = hospital.lng;

    const hasCustomOrigin = Boolean(
        state.locationKnown &&
        Number.isFinite(state.origin.lat) &&
        Number.isFinite(state.origin.lng)
    );
    const sLat = state.origin.lat;
    const sLng = state.origin.lng;
    const sName = encodeURIComponent(state.originAddress || state.originLabel || '출발지');

    const mobile = /Android/i.test(navigator.userAgent) || isAppleTouchDevice();

    if (provider === 'naver') {
        const appname = encodeURIComponent(window.location.origin);
        const scheme = hasCustomOrigin
            ? `nmap://route/car?slat=${sLat}&slng=${sLng}&sname=${sName}&dlat=${lat}&dlng=${lng}&dname=${name}&appname=${appname}`
            : `nmap://navigation?dlat=${lat}&dlng=${lng}&dname=${name}&appname=${appname}`;

        let fallback;
        if (mobile) {
            fallback = isAppleTouchDevice()
                ? 'https://apps.apple.com/kr/app/id311867728'
                : 'https://play.google.com/store/apps/details?id=com.nhn.android.nmap';
        } else {
            const originSegment = hasCustomOrigin ? `${sLng},${sLat},${sName},,` : '-';
            fallback =
                `https://map.naver.com/p/directions/${originSegment}/` +
                `${lng},${lat},${name},,/-/car?c=15.00,0,0,0,dh`;
        }

        return {
            scheme,
            package: 'com.nhn.android.nmap',
            fallback
        };
    }

    if (provider === 'kakao') {
        const start = hasCustomOrigin ? `sp=${sLat},${sLng}&` : '';
        const webFallback = hasCustomOrigin
            ? `https://map.kakao.com/link/from/${sName},${sLat},${sLng}/to/${name},${lat},${lng}`
            : `https://map.kakao.com/link/to/${name},${lat},${lng}`;
        return {
            scheme: `kakaomap://route?${start}ep=${lat},${lng}&by=car`,
            package: 'net.daum.android.map',
            fallback: webFallback
        };
    }

    const tmapScheme = isAppleTouchDevice()
        ? (hasCustomOrigin
            ? `tmap://route?rStName=${sName}&rStX=${sLng}&rStY=${sLat}&rGoName=${name}&rGoX=${lng}&rGoY=${lat}`
            : `tmap://route?rGoName=${name}&rGoX=${lng}&rGoY=${lat}`)
        : (hasCustomOrigin
            ? `tmap://route?startname=${sName}&startx=${sLng}&starty=${sLat}&goalname=${name}&goalx=${lng}&goaly=${lat}`
            : `tmap://route?goalname=${name}&goalx=${lng}&goaly=${lat}`);

    return {
        scheme: tmapScheme,
        package: 'com.skt.tmap.ku',
        fallback: isAppleTouchDevice()
            ? 'https://apps.apple.com/kr/app/id431589174'
            : 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku'
    };
}
/*
 * [JS 문법]
 * - export function, const, let, if, ===, ||, &&, ? : 중첩, 템플릿 리터럴, 객체 반환, /Android/i
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - encodeURIComponent(str) : 한글·공백·특수문자가 들어간 이름이나 주소를 URL 안전 문자로 바꿈.
 * - Boolean(val), Number.isFinite(val) : 불리언 변환 및 NaN·무한대가 아닌 정상 숫자인지 검사함.
 * - navigator.userAgent, window.location.origin : 기기 판별 문자열과 현재 서비스 도메인 출처 조회.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : navigationLink.
 * - 매개변수명 : provider('naver'|'kakao'|'tmap'), hospital(도착지 병원 객체).
 *
 * [지역 변수명]
 * - name, lat, lng : URL 인코딩된 병원명과 도착 위도·경도.
 * - hasCustomOrigin, sLat, sLng, sName : 확정된 출발지 유무와 출발 위도·경도·인코딩 이름.
 * - mobile, appname, scheme, fallback, originSegment : 모바일 여부 및 네이버지도 링크 변수.
 * - start, webFallback, tmapScheme : 카카오맵 출발 쿼리·웹 링크 및 T맵 분기 딥링크.
 *
 * [3사 내비게이션 딥링크 URL 분해]
 * - 1) 네이버지도 (provider === 'naver', 패키지: com.nhn.android.nmap)
 *   · 출발지 지정 시 : nmap://route/car?slat={sLat}&slng={sLng}&sname={sName}&dlat={lat}&dlng={lng}&dname={name}&appname={appname}
 *   · 출발지 미지정  : nmap://navigation?dlat={lat}&dlng={lng}&dname={name}&appname={appname}
 *   · PC 웹 폴백     : https://map.naver.com/p/directions/{sLng,sLat,sName,, | -}/{lng},{lat},{name},,/-/car?c=15.00,0,0,0,dh
 *   · 파라미터 의미  : slat/slng/sname(출발 위경도·이름), dlat/dlng/dname(도착 위경도·이름), appname(호출 출처)
 *
 * - 2) 카카오맵 (provider === 'kakao', 패키지: net.daum.android.map)
 *   · 딥링크 구조    : kakaomap://route?[sp={sLat},{sLng}&]ep={lat},{lng}&by=car
 *   · 웹 폴백        : https://map.kakao.com/link/[from/{sName},{sLat},{sLng}/]to/{name},{lat},{lng}
 *   · 파라미터 의미  : sp(출발 위도,경도), ep(도착 위도,경도), by=car(자동차 길안내)
 *
 * - 3) T맵 (기본 분기, 패키지: com.skt.tmap.ku)
 *   · iOS/iPadOS     : tmap://route?[rStName={sName}&rStX={sLng}&rStY={sLat}&]rGoName={name}&rGoX={lng}&rGoY={lat}
 *   · Android/기타   : tmap://route?[startname={sName}&startx={sLng}&starty={sLat}&]goalname={name}&goalx={lng}&goaly={lat}
 *   · 좌표 순서 주의 : T맵은 X=경도(lng), Y=위도(lat)이며 Apple은 rSt·rGo, Android는 start·goal 접두사를 씀.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 launchNavigation()에서 호출됨.
 * - 흐름 : 출발지 확정 여부 + provider·OS 판별 ──> 딥링크(scheme)·패키지·대체 URL(fallback) 객체 조립 후 반환.
 */

function launchNavigation(provider, hospital) {
    const link = navigationLink(provider, hospital);
    openMobileApp(link.scheme, link.package, link.fallback);
}
/*
 * [JS 문법]
 * - function (비공개 보조 함수), const
 *
 * [함수명 및 매개변수명]
 * - 함수명 : launchNavigation.
 * - 매개변수명 : provider('naver'|'kakao'|'tmap'), hospital(목적지 병원 객체).
 *
 * [지역 변수명]
 * - link : navigationLink()가 반환한 { scheme, package, fallback } 객체.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderContacts()가 만든 네이버지도·카카오맵·T맵 버튼 클릭 시 호출됨.
 * - 흐름 : navigationLink(provider, hospital) ──> link 생성 ──> openMobileApp(scheme, package, fallback) 실행.
 */

export async function shareHospital(hospital) {
    if (!hospital?.id) {
        return;
    }

    const shareUrlObj = new URL(window.location.href);
    shareUrlObj.searchParams.delete('preview');
    shareUrlObj.searchParams.delete('hpid');
    shareUrlObj.searchParams.set('hospital', hospital.id);
    const shareUrl = shareUrlObj.toString();

    const erSummary = bedValue(hospital.beds?.hvec);
    const shareTitle = `${hospital.name} · 연세 119 응급실 현황`;
    const shareText = `${hospital.name} (응급실 ${erSummary}) 위치·병상·전화번호 바로 보기`;

    const isMobileDevice = /Android/i.test(navigator.userAgent) || isAppleTouchDevice();
    if (isMobileDevice && typeof navigator.share === 'function') {
        try {
            await navigator.share({
                title: shareTitle,
                text: shareText,
                url: shareUrl
            });
            return;
        } catch (shareErr) {
            if (shareErr?.name === 'AbortError') {
                return;
            }
        }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setStatus(`'${hospital.name}' 직통 공유 링크를 클립보드에 복사했습니다.`);
            return;
        } catch (clipErr) {
            void clipErr;
        }
    }

    setStatus(`공유 주소: ${shareUrl}`);
}
/*
 * [JS 문법]
 * - export async function, ?., if, !hospital?.id, return, const, ||, &&, ===, typeof, try/catch, void, 템플릿 리터럴, await
 *
 * [브라우저 내장 Web API]
 * - new URL(url), .toString() : 주소 문자열을 다루기 쉬운 URL 객체로 만들고 다시 문자열로 바꿈.
 * - URLSearchParams.prototype.delete(), .set() : URL 쿼리(?key=val) 파라미터를 지우거나 새로 넣음.
 * - navigator.userAgent, navigator.share({ title, text, url }) : 모바일 기본 공유 창을 여는 Web Share API(취소 시 AbortError).
 * - navigator.clipboard.writeText(text) : 보안 환경(HTTPS/localhost)에서 클립보드에 글자를 복사하는 API.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : shareHospital.
 * - 매개변수명 : hospital (공유 링크를 만들 병원 객체).
 *
 * [지역 변수명]
 * - shareUrlObj, shareUrl, erSummary, shareTitle, shareText, isMobileDevice, shareErr, clipErr.
 *
 * [공유 URL 조립 분해]
 * - 1단계 : new URL(window.location.href)로 현재 페이지 주소를 복사함.
 * - 2단계 : searchParams.delete('preview'), delete('hpid')로 시연·예전 파라미터를 지움.
 * - 3단계 : searchParams.set('hospital', hospital.id)로 병원 ID를 넣고 .toString()으로 완성함.
 *   https://서비스도메인/?hospital=A2200001
 *   ├── origin/path : window.location.href 기준 현재 서비스 루트 주소
 *   └── ?hospital=  : 수신자가 열면 search-controls.js가 읽어 해당 병원으로 이동 후 시트를 엶.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderContacts()가 만든 '공유하기' 버튼 클릭 시 호출됨.
 * - 흐름 :
 *   1) 공유 URL 조립 ──> 모바일 & navigator.share 지원 시 네이티브 공유 창 호출(취소 시 종료)
 *   2) 미지원·실패 ──> clipboard.writeText() 복사 시도 ──> setStatus() 안내(복사 실패 시 주소 직접 표시)
 */

export function renderContacts(hospital) {
    const target = byId('contact-actions');
    if (!target) {
        return;
    }
    const phones = node('div', 'phone-actions');
    const maps = node('div', 'navigation-actions');

    phones.setAttribute('aria-label', '병원 직통 전화');
    maps.setAttribute('aria-label', '내비게이션 길찾기 및 병원 링크 공유');

    for (const [label, raw] of [
        ['응급실', hospital.erTel],
        ['대표전화', hospital.tel]
    ]) {
        const number = isMissing(raw) ? '' : String(raw).trim();
        if (/^[0-9+()\s-]+$/.test(number) && /\d/.test(number)) {
            phones.append(
                contactLink(
                    `${label} ${number}`,
                    `tel:${number.replace(/[^\d+]/g, '')}`,
                    'phone-button'
                )
            );
        } else {
            phones.append(node('span', 'phone-missing', `${label} 미정보`));
        }
    }

    for (const [provider, label] of [
        ['naver', '네이버지도'],
        ['kakao', '카카오맵'],
        ['tmap', 'T맵']
    ]) {
        const button = node('button', `map-button ${provider}`, label);
        button.type = 'button';
        button.addEventListener('click', () => launchNavigation(provider, hospital));
        maps.append(button);
    }

    const shareBtn = node('button', 'map-button share-hospital-btn', '공유하기');
    shareBtn.type = 'button';
    shareBtn.title = '가족·동승자에게 이 병원의 실시간 현황 직통 링크를 공유합니다';
    shareBtn.addEventListener('click', () => shareHospital(hospital));
    maps.append(shareBtn);

    target.replaceChildren(phones, maps);
}
/*
 * [JS 문법]
 * - export function, const, if/else, !target, &&, for...of + 배열 구조 분해([label, raw], [provider, label]), ? :, 화살표 함수
 * - 정규표현식 : /^[0-9+()\s-]+$/ (허용 전화 문자), /\d/ (숫자 포함), /[^\d+]/g (tel: 링크용 숫자·'+' 외 제거)
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - String(val), String.prototype.trim(), .replace() : 문자열 변환 및 양쪽 공백·특수문자 정제.
 * - RegExp.prototype.test(str) : 문자열이 정규표현식 규칙에 맞는지 검사함.
 * - Element.prototype.setAttribute(), .append(), .replaceChildren(), HTMLButtonElement.prototype.type : DOM 속성·자식 교체.
 * - HTMLElement.prototype.title, EventTarget.prototype.addEventListener('click', fn) : 툴팁 지정·클릭 이벤트 등록.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderContacts.
 * - 매개변수명 : hospital (전화·길찾기 버튼을 그릴 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : target(#contact-actions).
 * - 지역 변수 : phones, maps, label, raw, number, provider, button, shareBtn.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 openHospital()에서 호출됨.
 * - 흐름 : 응급실·대표전화 검증(tel: 또는 미정보) ──> 네이버·카카오·T맵·공유 버튼 생성 ──> #contact-actions 교체
 *   ├── button(.map-button.naver|kakao|tmap) 'click' ──> launchNavigation(provider, hospital)
 *   └── shareBtn(.share-hospital-btn) 'click' ──> shareHospital(hospital)
 */

export function renderMessages(hospital) {
    const target = byId('messages');
    const countEl = byId('message-count');
    if (!target) {
        return;
    }
    target.replaceChildren();

    if (!state.sources.messages) {
        empty(target, '미정보 · 공지 조회에 실패했습니다. 병원에 확인하세요.');
        if (countEl) {
            countEl.textContent = '';
        }
        return;
    }

    const messages = getActiveMessages(hospital).sort((a, b) => {
        const isCritA = a.symblkmsgtyp === '중증' ? 0 : 1;
        const isCritB = b.symblkmsgtyp === '중증' ? 0 : 1;
        if (isCritA !== isCritB) {
            return isCritA - isCritB;
        }

        const deptA = String(a.trtprtcodmag || a.symtypcodmag || '').trim();
        const deptB = String(b.trtprtcodmag || b.symtypcodmag || '').trim();
        const deptCompare = deptA.localeCompare(deptB, 'ko', { numeric: true });
        if (deptCompare !== 0) {
            return deptCompare;
        }

        const msgA = String(a.symblkmsg || '').trim();
        const msgB = String(b.symblkmsg || '').trim();
        return msgA.localeCompare(msgB, 'ko');
    });

    if (countEl) {
        countEl.textContent = `${messages.length}건`;
    }

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

        if (item.symtypcodmag && item.symtypcodmag !== deptName && item.symtypcodmag !== '응급실') {
            heading.append(node('span', 'message-subtag', item.symtypcodmag));
        }

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
/*
 * [JS 문법]
 * - export function, const, if/else if, !target, !==, ===, &&, ||, >, ? : 중첩, 화살표 함수, for...of, 템플릿 리터럴, return
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - Array.prototype.sort(compareFn) : [중증] 우선 -> 진료과명 한국어·숫자순 -> 공지 본문 가나다순 정렬.
 * - String(val), String.prototype.trim(), .localeCompare(..., 'ko', { numeric: true }) : 한국어·숫자 자연순 비교.
 * - Element.prototype.replaceChildren(), .append(), .childElementCount, Node.prototype.textContent : DOM 조립·자식 수 확인.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderMessages.
 * - 매개변수명 : hospital (진료 공지를 표시할 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : target(#messages), countEl(#message-count).
 * - 정렬·집계 변수 : messages, isCritA, isCritB, deptA, deptB, deptCompare, msgA, msgB.
 * - 카드 생성 변수 : item, level, article, heading, deptName, badge, deptTitle, end, start, meta.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 openHospital()에서 호출됨.
 * - 흐름 :
 *   1) state.sources.messages 실패 ──> 안내 문구 출력 후 종료
 *   2) 정상 ──> getActiveMessages(hospital) 정렬 ──> #message-count 건수 표시 ──> 공지 카드(#messages) 조립
 */

export function renderSevere(hospital) {
    const target = byId('severe');
    const severeTimeEl = byId('severe-time');
    if (!target) {
        return;
    }
    target.replaceChildren();

    if (severeTimeEl) {
        severeTimeEl.textContent = '보고 시각 미정보';
    }

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
    const activeMessages = getActiveMessages(hospital);

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

            const paramText = `${item.key}\u00A0\u00A0\u00A0수신값 [${cleanVal}]`;
            const paramEl = createMarqueeEl('div', 'egen-cell-param', paramText, paramText);

            row.append(topRow, paramEl);

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

    const reported = parseApiDate(firstReported(fields.hvidate, fields.mkioskdate));
    if (reported && severeTimeEl) {
        severeTimeEl.textContent = `보고 ${reported.display}`;
    }
}
/*
 * [JS 문법]
 * - export function, const, if/else if/else, !target, ||, ===, &&, ? :, 중첩 for...of, 템플릿 리터럴, '\u00A0'
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - String(val), String.prototype.trim() : 값을 문자열로 바꾸고 앞뒤 공백을 잘라냄.
 * - Element.prototype.replaceChildren(), .append(), Node.prototype.textContent : DOM 자식 교체·추가 및 텍스트 갱신.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderSevere.
 * - 매개변수명 : hospital (28대 중증응급질환 현황을 그릴 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : target(#severe), severeTimeEl(#severe-time).
 * - 보드·순회 변수 : fields, card, header, scrollArea, matrix, activeMessages, group, box, item, row, topRow, label, valWrap.
 * - 값·판별 변수 : rawVal, rawMsg, cleanVal, cleanMsg, status, isBlockedByNotice, paramText, paramEl, remarkText, remarkEl, reported.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 openHospital()에서 호출됨.
 * - 흐름 :
 *   1) SEVERE_DISEASE_GROUPS 순회 ──> availability()와 isDiseaseSpecificallyBlocked() 교차 판별
 *   2) 연령 비고(*msg) 있으면 '확인 필요'(노랑), 불가·차단 공지면 '불가능'(빨강), 정상이면 '가능'(초록) 배지 부여
 *   3) #severe에 매트릭스 보드 삽입 ──> hvidate/mkioskdate 중 먼저 보고된 시각으로 #severe-time 갱신
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

    if (isBlankOrNull(rawVal)) {
        return { className: 'egen-badge-dash', text: '-' };
    }

    const current = integerValue(rawVal);
    const baseline = integerValue(rawBase);

    if (current === null) {
        return { className: 'egen-badge-dash', text: '-' };
    }

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

    if (baseline !== null && baseline > 0) {
        const ratio = current / baseline;
        const textVal = `${current}/${baseline}`;
        if (current === 0 || ratio <= 0.35) {
            return { className: 'egen-badge-pill-red', text: `혼잡 ${textVal}` };
        }
        if (ratio < 0.70) {
            return { className: 'egen-badge-pill-orange', text: `보통 ${textVal}` };
        }
        return { className: 'egen-badge-pill-green', text: `원활 ${textVal}` };
    }

    if (current > 0) {
        return { className: 'egen-badge-pill-green', text: `원활 ${current}` };
    }
    return { className: 'egen-badge-pill-red', text: '혼잡 0' };
}
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, if, ===, !==, &&, ||, ?? (null/undefined 기본값), <, >, <=, >=, /, ? :, 템플릿 리터럴, return
 *
 * [JS 표준 내장 API]
 * - String(val), String.prototype.trim(), .toUpperCase() : 문자열 변환, 공백 제거, 대문자 통일.
 * - Math.abs(num) : 음수(예: -4)의 부호를 떼어 절댓값(4)을 구함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : getBedStatusBadge.
 * - 매개변수명 : fields(hospital.beds 객체), def({ label, current, baseline, type } 병상 항목 정의).
 *
 * [지역 변수명]
 * - rawVal, rawBase, valStr, baseNum, currNum, isY, count, current, baseline, overflow, textVal, ratio.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 createBedCell()에서 호출됨.
 * - 흐름 :
 *   1) 분만실(type === 'delivery') ──> 'Y' 또는 양수면 기준 대수와 함께 초록 배지('Y / N') 반환
 *   2) 일반 병상 ──> 빈 값('-') · 음수('초과수용') · 가용률(<=35% 혼잡, <70% 보통, >=70% 원활) 배지 객체 반환
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
    const baseRaw = item.baseline
        ? (isBlankOrNull(fields[item.baseline]) ? '-' : String(fields[item.baseline]).trim())
        : null;

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
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, let, ? :, if/else, !==, +=, 템플릿 리터럴, '\u00A0', return
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - String(val), String.prototype.trim() : 값을 문자열로 바꾸고 앞뒤 공백을 제거함.
 * - Element.prototype.append(...nodes) : 만든 DOM 요소들을 부모 요소 끝에 순서대로 붙임.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : createBedCell.
 * - 매개변수명 : fields(hospital.beds), item(EMERGENCY_BED_ITEMS 또는 INPATIENT_BED_SECTIONS 항목).
 *
 * [지역 변수명]
 * - cell, topRow, badge, currRaw, baseRaw, paramText, paramEl.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderErBeds(), renderInpatientBeds()에서 병상 항목마다 호출됨.
 * - 흐름 : getBedStatusBadge()로 배지 계산 ──> createMarqueeEl()로 파라미터 줄 생성 ──> .egen-cell 조립 후 반환.
 */

function renderErBeds(hospital) {
    const target = byId('er-beds-board');
    if (!target) {
        return;
    }
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
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, if, !target, ||, for...of
 *
 * [브라우저 내장 Web API]
 * - Element.prototype.replaceChildren(), .append(...nodes) : 기존 자식을 비우고 새 요소들을 삽입함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderErBeds.
 * - 매개변수명 : hospital (대상 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : target(#er-beds-board).
 * - 지역 변수 : fields, card, header, grid, item.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderBeds()에서 호출됨.
 * - 흐름 : state.sources.beds 확인 ──> EMERGENCY_BED_ITEMS 11개 순회 ──> createBedCell() 호출 후 #er-beds-board에 삽입.
 */

function renderInpatientBeds(hospital) {
    const target = byId('inpatient-beds-board');
    if (!target) {
        return;
    }
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
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, if, !target, ||, 중첩 for...of
 *
 * [브라우저 내장 Web API]
 * - Element.prototype.replaceChildren(), .append(...nodes) : 기존 자식을 비우고 섹션별 그리드를 삽입함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderInpatientBeds.
 * - 매개변수명 : hospital (대상 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : target(#inpatient-beds-board).
 * - 지역 변수 : fields, card, header, section, subHeader, subGrid, item.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderBeds()에서 호출됨.
 * - 흐름 : INPATIENT_BED_SECTIONS 6개 섹션 순회 ──> 소제목 + createBedCell() 조립 ──> #inpatient-beds-board에 삽입.
 */

export function renderBeds(hospital) {
    const bedTimeEl = byId('bed-time');
    if (bedTimeEl) {
        bedTimeEl.textContent = '보고 시각 미정보';
    }

    renderErBeds(hospital);
    renderInpatientBeds(hospital);

    const fields = hospital.beds || {};
    const reported = parseApiDate(fields.hvidate);
    if (reported && bedTimeEl) {
        bedTimeEl.textContent = `보고 ${reported.display}`;
    }
}
/*
 * [JS 문법]
 * - export function, const, if, ||, &&, 템플릿 리터럴
 *
 * [브라우저 내장 Web API]
 * - Node.prototype.textContent : HTML 태그 해석 없이 안전한 일반 글자만 요소에 설정함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderBeds.
 * - 매개변수명 : hospital (대상 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : bedTimeEl(#bed-time).
 * - 지역 변수 : fields, reported.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 openHospital()에서 호출됨.
 * - 흐름 : renderErBeds() ──> renderInpatientBeds() ──> parseApiDate(fields.hvidate) ──> #bed-time 보고 시각 갱신.
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
        } else if (valStr.startsWith('N') || numVal === 0) {
            badgeClass = 'egen-badge-dash';
            badgeText = '-';
        }
    }

    topRow.append(
        node('span', 'egen-cell-label', item.label),
        node('span', badgeClass, badgeText)
    );

    const currRaw = isBlankOrNull(rawVal) ? '-' : String(rawVal).trim();
    const baseRaw = item.baseline
        ? (isBlankOrNull(rawBase) ? '-' : String(fields[item.baseline]).trim())
        : null;

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
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, let, if/else if/else, !isBlankOrNull(), ===, !==, &&, ||, >, >=, ? :, +=, 템플릿 리터럴, '\u00A0', return
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - String(val), String.prototype.trim(), .toUpperCase(), .startsWith('N') : 문자열 정규화 및 'N' 시작 여부 검사.
 * - Element.prototype.append(...nodes) : 장비명·배지 상단 행과 파라미터 줄을 셀에 조립함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : createEquipmentCell.
 * - 매개변수명 : fields(hospital.beds), item(EQUIPMENT_TABLE_ITEMS 항목).
 *
 * [지역 변수명]
 * - cell, topRow, rawVal, rawBase, badgeClass, badgeText, valStr, numVal, isAvail, baseline, currRaw, baseRaw, paramText, paramEl.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderEquipment()에서 11대 의료 장비마다 호출됨.
 * - 흐름 : rawVal === 'Y' 또는 양수면 'Y / N' 초록 배지, 'N*'·0·빈 값이면 '-' 배지 ──> 장비 셀 조립 후 반환.
 */

export function renderEquipment(hospital) {
    const target = byId('equipment');
    if (!target) {
        return;
    }
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
/*
 * [JS 문법]
 * - export function, const, if, !target, ||, for...of
 *
 * [브라우저 내장 Web API]
 * - Element.prototype.replaceChildren(), .append(...nodes) : 기존 자식을 비우고 장비 카드 그리드를 삽입함.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderEquipment.
 * - 매개변수명 : hospital (대상 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : target(#equipment).
 * - 지역 변수 : fields, card, header, grid, item.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 openHospital()에서 호출됨.
 * - 흐름 : state.sources.beds 확인 ──> EQUIPMENT_TABLE_ITEMS 11종 순회 ──> createEquipmentCell() 생성 후 #equipment에 삽입.
 */

function renderRawBeds(hospital) {
    const all = byId('all-beds');
    if (!all) {
        return;
    }
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
            keys: ['hvec', 'hvoc', 'hvcc', 'hvncc', 'hvccc', 'hvicc', 'hvgc', 'hvdnm', 'hvidate']
        }
    ];

    for (const group of groups) {
        if (!group.keys.length) {
            continue;
        }

        const section = node('section', 'raw-group');
        section.append(node('h3', '', group.title));

        const list = node('dl', 'raw-grid');
        group.keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

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
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, if, !all, [...new Set([...])], 화살표 함수, /^hv\d+$/, /^hvs\d+$/, 중첩 for...of, continue
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - new Set(iterable) : 중복된 키를 자동으로 제거하는 표준 집합 컬렉션임.
 * - Object.keys(obj) : 객체의 키 이름들을 배열로 꺼냄.
 * - Array.prototype.filter(), .sort(), String.prototype.localeCompare(..., { numeric: true }) : hv1, hv2, ..., hv10 숫자순 정렬.
 * - RegExp.prototype.test(str) : 문자열이 정규표현식 규칙과 일치하는지 확인함.
 * - Element.prototype.replaceChildren(), .append(), .childElementCount : 정의 목록 DOM 조립·자식 유무 확인.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderRawBeds.
 * - 매개변수명 : hospital (대상 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : all(#all-beds).
 * - 지역 변수 : fields, groups, group, section, list, key, pair.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderDeveloperInspector()에서 호출됨.
 * - 흐름 : hv*·hvs*·기타 병상 키 중복 제거 및 숫자순 정렬 ──> fieldLabel(key) + displayValue() 쌍으로 #all-beds에 출력.
 */

function renderRawSevere(hospital) {
    const all = byId('all-severe');
    if (!all) {
        return;
    }
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

    for (const key of [...standardKeys, ...extraKeys]) {
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
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, if, !all, [...Array.from(...), ...], 화살표 함수, &&, !==, ||, ? :, 템플릿 리터럴, for...of
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - Array.from({ length: 28 }, mapFn) : 길이 28 배열을 만들어 mkioskty1~28 키 목록을 생성함.
 * - Object.keys(obj), Array.prototype.filter(), .includes(val) : 기본 키 외 추가 수신 키를 추려냄.
 * - String(val), String.prototype.trim() : 원본값 문자열 변환 및 양쪽 공백 제거.
 * - Element.prototype.replaceChildren(), .append(...nodes) : 정의 목록 DOM을 비우고 새로 채움.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderRawSevere.
 * - 매개변수명 : hospital (대상 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : all(#all-severe).
 * - 지역 변수 : fields, section, list, standardKeys, extraKeys, key, val, label, pair.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderDeveloperInspector()에서 호출됨.
 * - 흐름 : mkioskty1~28·비고·보고일시·추가 키 결합 ──> MKIOSKTY_METADATA 한글 설명 + 원본값을 #all-severe에 출력.
 */

function renderRawMessages(hospital) {
    const all = byId('all-messages');
    if (!all) {
        return;
    }
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
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, if, !all, ||, for (let i = 0; ...), for...of + 구조 분해([dt, dd]), ? :, 템플릿 리터럴
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - String(val), String.prototype.trim() : 값을 문자열로 바꾸고 양쪽 공백을 제거함.
 * - Element.prototype.replaceChildren(), .append(...nodes) : 기존 자식을 비우고 새 카드 목록을 채움.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderRawMessages.
 * - 매개변수명 : hospital (대상 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : all(#all-messages).
 * - 지역 변수 : msgs, section, i, item, card, dl, fields, dt, dd, pair, titleText.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderDeveloperInspector()에서 호출됨.
 * - 흐름 : hospital.messages 배열 순회 ──> 공지마다 10개 XML 원본 태그를 <dl> 카드로 조립 ──> #all-messages에 삽입.
 */

function renderBasic(hospital) {
    const target = byId('basic-info');
    if (!target) {
        return;
    }
    target.replaceChildren();

    const blocks = [
        ['응급의료기관 기본정보', hospital.basic, state.sources.basic],
        ['외상센터 기본정보', hospital.trauma, state.sources.traumaBasic]
    ];

    for (const [heading, fields, loaded] of blocks) {
        const section = node('details', 'raw-details');
        section.append(node('summary', '', heading));

        if (!loaded) {
            section.append(node('p', 'empty-state', '미정보 · 조회에 실패했습니다.'));
        } else if (!fields || !Object.keys(fields).length) {
            section.append(node('p', 'empty-state', '미정보 · 보고된 정보가 없습니다.'));
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
/*
 * [JS 문법]
 * - function (내부 보조 함수), const, if/else if/else, !target, ||, for...of + 구조 분해([heading, fields, loaded], [key, value]), continue
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - Object.keys(obj), Object.entries(obj) : 객체의 키 배열과 [키, 값] 쌍 배열을 얻음.
 * - Array.prototype.includes(val) : 배열에 특정 값이 들어 있는지 검사함.
 * - Element.prototype.replaceChildren(), .append(...nodes) : 기존 자식을 비우고 아코디언 목록을 채움.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderBasic.
 * - 매개변수명 : hospital (대상 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : target(#basic-info).
 * - 지역 변수 : blocks, heading, fields, loaded, section, list, key, value, pair.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderDeveloperInspector()에서 호출됨.
 * - 흐름 : hospital.basic·hospital.trauma 순회 ──> 로딩 상태 확인 ──> 중복 키 제외 후 <dl> 원본 사전을 #basic-info에 출력.
 */

async function hydrateHospitalDetailIfNeeded(hospital) {
    if (!hospital?.id || hospital._detailHydrated) {
        return hospital;
    }

    const cached = state.detailCache.get(hospital.id);
    if (cached) {
        Object.assign(hospital, {
            basic: cached.basic || hospital.basic,
            beds: { ...(hospital.beds || {}), ...(cached.beds || {}) },
            severe: { ...(hospital.severe || {}), ...(cached.severe || {}) },
            messages: cached.messages || hospital.messages,
            trauma: cached.trauma || hospital.trauma,
            _detailHydrated: true
        });
        return hospital;
    }

    const spinner = byId('developer-spinner');
    const statusText = byId('developer-status');
    if (spinner) {
        spinner.hidden = false;
    }
    if (statusText) {
        statusText.textContent = `'${hospital.name}' 전체 원본 상세 필드 수신 중…`;
    }

    try {
        const response = await fetch(`/api/hospitals/${encodeURIComponent(hospital.id)}`, {
            priority: 'low',
            headers: { Accept: 'application/json' }
        });
        /*
         * [JS 문법]
         * - const, await, 템플릿 리터럴
         *
         * [브라우저 내장 Web API]
         * - encodeURIComponent(str) : URL 경로에 들어갈 ID 문자열의 특수문자를 안전하게 인코딩함.
         * - fetch(url, { priority: 'low', headers }) : 낮은 네트워크 우선순위로 HTTP GET 요청을 보냄.
         *
         * [경로 변수 URL 조립 분해]
         * - 1단계 (경로 접두사) : '/api/hospitals/'
         * - 2단계 (경로 변수 인코딩) : encodeURIComponent(hospital.id) (예: 'A2200001')
         *   GET /api/hospitals/A2200001
         *   ├── 경로 prefix     : /api                        (EmergencyApiController @RequestMapping("/api"))
         *   ├── 매핑 경로       : /hospitals/{hpid}           (EmergencyApiController.getHospitalDetail() @GetMapping)
         *   └── 경로 변수 {hpid} : @PathVariable("hpid") String (형식 검증 통과 시 전체 HospitalDto JSON 반환, 오류 400, 없음 404)
         *   ──> 초기 목록(?compact=true)에서 뺐던 약 60여 개 상세 필드를 개발자 모드 열람 시 추가 수신함.
         */
        if (response.ok) {
            const fullDto = await response.json();
            state.detailCache.set(hospital.id, fullDto);
            Object.assign(hospital, {
                basic: fullDto.basic || hospital.basic,
                beds: { ...(hospital.beds || {}), ...(fullDto.beds || {}) },
                severe: { ...(hospital.severe || {}), ...(fullDto.severe || {}) },
                messages: fullDto.messages || hospital.messages,
                trauma: fullDto.trauma || hospital.trauma,
                _detailHydrated: true
            });
            state.diagnostics.detailHydratedCount += 1;
            if (statusText) {
                statusText.textContent = `'${hospital.name}' 전체 원본 필드 동기화 완료`;
            }
        }
    } catch (detailErr) {
        void detailErr;
    } finally {
        if (spinner && !state.loading) {
            spinner.hidden = true;
        }
    }
    return hospital;
}
/*
 * [JS 문법]
 * - async function, ?., ||, !hospital?.id, if, 객체 펼치기({ ...(hospital.beds || {}), ...(cached.beds || {}) })
 * - 예외·제어 : try/catch/finally, void, +=, return
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - Map.prototype.get(key), .set(key, val) : 키-값 캐시 맵에서 데이터를 바로 꺼내거나 저장함.
 * - Object.assign(target, ...sources) : 기존 객체의 속성을 덮어써서 여러 객체 내용을 하나로 합침.
 * - response.ok, response.json() : HTTP 2xx 성공 확인 및 응답 JSON -> JS 객체 변환.
 * - HTMLElement.prototype.hidden, Node.prototype.textContent : 요소 숨김 및 안내 문구 텍스트 갱신.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : hydrateHospitalDetailIfNeeded.
 * - 매개변수명 : hospital (전체 원본 필드를 채워 넣을 병원 객체).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : spinner(#developer-spinner), statusText(#developer-status).
 * - 지역 변수 : cached, response, fullDto, detailErr.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 renderDeveloperInspector()에서 호출됨.
 * - 흐름 :
 *   1) _detailHydrated가 참이면 즉시 hospital 반환
 *   2) state.detailCache.get() 캐시 적중 ──> Object.assign()으로 hospital에 바로 합쳐 반환
 *   3) 캐시 미적중 ──> GET /api/hospitals/{hpid} 호출 ──> detailCache·hospital 저장 + detailHydratedCount += 1
 *   4) finally에서 !state.loading이면 스피너 숨김 ──> hospital 반환
 */

export async function renderDeveloperInspector(hospital) {
    if (!hospital) {
        return;
    }
    renderRawBeds(hospital);
    renderBasic(hospital);
    renderRawSevere(hospital);
    renderRawMessages(hospital);
    state.renderedDevHospitalRef = hospital;

    if (!hospital._detailHydrated) {
        await hydrateHospitalDetailIfNeeded(hospital);
        if (state.selected?.id === hospital.id && byId('developer-mode')?.open) {
            renderRawBeds(hospital);
            renderBasic(hospital);
            renderRawSevere(hospital);
            renderRawMessages(hospital);
        }
    }
}
/*
 * [JS 문법]
 * - export async function, if, !hospital, await, ?., ===, &&
 *
 * [브라우저 내장 Web API]
 * - HTMLDetailsElement.prototype.open : <details> 접힘·펼침 상태를 불리언으로 확인하는 속성임.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : renderDeveloperInspector.
 * - 매개변수명 : hospital (개발자 인스펙터에 출력할 병원 객체).
 *
 * [동작 흐름]
 * - 호출 출처 : app.js의 #developer-mode toggle 이벤트 및 hospital-sheet.js의 openHospital()에서 호출됨.
 * - 흐름 :
 *   1) 현재 데이터로 renderRawBeds·renderBasic·renderRawSevere·renderRawMessages 4종 먼저 그리기
 *   2) !_detailHydrated ──> hydrateHospitalDetailIfNeeded() 호출 ──> 같은 병원·열린 상태면 4종 다시 그리기
 */

export function setBackgroundInert(value) {
    for (const selector of ['#map', '#search-panel', '#active-route-banner', '#mobile-top-left-menu']) {
        const el = document.querySelector(selector);
        if (el) {
            el.inert = value;
        }
    }
}
/*
 * [JS 문법]
 * - export function, for...of, const, if
 *
 * [브라우저 내장 Web API]
 * - document.querySelector(selector) : CSS 선택자와 일치하는 첫 번째 DOM 요소를 찾음.
 * - HTMLElement.prototype.inert : true일 때 클릭·Tab 초점·스크린 리더 접근을 모두 막는 HTML 표준 속성임.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : setBackgroundInert.
 * - 매개변수명 : value (true면 배경 조작 차단, false면 배경 조작 복구).
 *
 * [지역 변수명]
 * - selector : 배경 영역 선택자('#map', '#search-panel', '#active-route-banner', '#mobile-top-left-menu').
 * - el : 찾은 DOM 요소.
 *
 * [동작 흐름]
 * - 호출 출처 : hospital-sheet.js의 snapSheetToHalfPeek(), expandSheetFromHalfPeek(), openHospital(), closeSheet()에서 호출됨.
 * - 흐름 : 4개 배경 영역 순회 ──> querySelector(selector) ──> el.inert = value 일괄 적용.
 */

export function snapSheetToHalfPeek() {
    const sheet = byId('sheet');
    const dim = byId('sheet-dim');
    if (!sheet || !state.selected) {
        return;
    }

    state.sheetHalfPeek = true;
    sheet.classList.add('open', 'half-peek');
    sheet.style.transform = '';
    sheet.style.transition = '';
    sheet.inert = false;
    sheet.setAttribute('aria-modal', 'false');
    if (dim) {
        dim.hidden = true;
    }
    setBackgroundInert(false);

    const scrollBox = sheet.querySelector('.sheet-scroll');
    if (scrollBox) {
        scrollBox.scrollTop = 0;
    }
}
/*
 * [JS 문법]
 * - export function, const, if, !sheet, ||
 *
 * [브라우저 내장 Web API]
 * - Element.prototype.classList.add(...classes) : 요소에 CSS 클래스를 추가함.
 * - HTMLElement.prototype.style.transform, .style.transition, .inert, .hidden : 인라인 스타일·비활성·숨김 제어.
 * - Element.prototype.setAttribute(), .querySelector(), .scrollTop : 속성 지정·하위 조회·스크롤 맨 위 이동.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : snapSheetToHalfPeek (매개변수 없음).
 *
 * [DOM 요소 참조명]
 * - sheet(#sheet), dim(#sheet-dim), scrollBox(.sheet-scroll).
 *
 * [동작 흐름]
 * - 호출 출처 : directions-eta.js의 initDirectionsControls()(onSnapSheetHalfPeek 콜백) 및 hospital-sheet.js의 initSheetDrag().
 * - 흐름 :
 *   1) state.sheetHalfPeek = true ──> 'open', 'half-peek' 클래스 추가 ──> 드래그 스타일·배경 딤 해제
 *   2) setBackgroundInert(false) ──> scrollTop = 0으로 맞춰 지도 경로와 전화·내비 버튼을 동시에 보게 함.
 */

export function expandSheetFromHalfPeek() {
    const sheet = byId('sheet');
    const dim = byId('sheet-dim');
    if (!sheet || !state.selected) {
        return;
    }

    state.sheetHalfPeek = false;
    sheet.classList.remove('half-peek');
    sheet.classList.add('open');
    sheet.style.transform = '';
    sheet.style.transition = '';
    sheet.inert = false;
    sheet.setAttribute('aria-modal', 'true');
    if (dim) {
        dim.hidden = false;
    }
    setBackgroundInert(true);
}
/*
 * [JS 문법]
 * - export function, const, if, !sheet, ||
 *
 * [브라우저 내장 Web API]
 * - Element.prototype.classList.remove(), .add() : CSS 클래스를 제거하거나 추가함.
 * - HTMLElement.prototype.style.transform, .style.transition, .inert, .hidden, Element.prototype.setAttribute() : 모달 상태 제어.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : expandSheetFromHalfPeek (매개변수 없음).
 *
 * [DOM 요소 참조명]
 * - sheet(#sheet), dim(#sheet-dim).
 *
 * [동작 흐름]
 * - 호출 출처(외부) : directions-eta.js의 reopenActiveRouteHospital()(onExpandSheetFromHalfPeek 콜백).
 * - 호출 출처(내부) : hospital-sheet.js의 syncResponsiveSheetLayout()·initSheetDrag().
 * - 흐름 : sheetHalfPeek = false ──> 'half-peek' 제거 ──> #sheet-dim 표시 ──> setBackgroundInert(true)로 전체 시트 복귀.
 */

export function openHospital(hospital, focus = true, options = {}) {
    if (!hospital) {
        return;
    }

    uiCallbacks.onCloseRadius?.();
    const searchResultsEl = byId('search-results');
    if (searchResultsEl) {
        searchResultsEl.hidden = true;
    }

    state.diagnostics.lastHospitalOpened = {
        id: hospital.id,
        name: hospital.name,
        erBeds: hospital.beds?.hvec ?? null,
        timestamp: Date.now()
    };

    if (focus) {
        state.previousFocus = document.activeElement;
    }

    const isDifferentHospital = state.selected?.id !== hospital.id;
    const devModeEl = byId('developer-mode');
    if (isDifferentHospital && devModeEl) {
        devModeEl.open = false;
        state.renderedDevHospitalRef = null;
        state.sheetRouteData = null;
    }

    state.selected = hospital;
    const dirClearBtn = byId('directions-clear-btn');
    if (dirClearBtn) {
        dirClearBtn.hidden = !state.activeRoute;
    }
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
        const offlineNote = state.offlineMode ? ' · 오프라인 저장본' : '';
        byId('sheet-updated').textContent = `마지막 새로고침 · ${updated} KST${offlineNote}`;
    } else {
        byId('sheet-updated').textContent = '전체 조회 시각을 확인할 수 없습니다.';
    }

    byId('hospital-type').textContent = hospitalLabel(hospital);
    byId('hospital-address').textContent = `주소 ${displayValue(hospital.address)}`;

    const distance = distanceKm(state.origin, hospital).toFixed(1);
    const originName = getOriginDisplayLabel();
    byId('hospital-distance').textContent = `${originName}에서 직선거리 ${distance} km`;

    if (isDifferentHospital) {
        populateWaypointSelect(hospital);
    }

    renderContacts(hospital);
    renderMessages(hospital);
    renderBeds(hospital);
    renderEquipment(hospital);
    renderSevere(hospital);

    if (devModeEl?.open) {
        renderDeveloperInspector(hospital);
    } else {
        state.renderedDevHospitalRef = null;
    }

    if (!options.skipDirections) {
        loadDirectionsForHospital(hospital, false);
    }

    const failed = Object.entries(state.sources)
        .filter(([, loaded]) => !loaded)
        .map(([name]) => name);

    byId('data-state').textContent = failed.length
        ? `일부 데이터 조회 실패: ${failed.join(', ')}. 재조회하거나 병원에 문의하세요.`
        : '공공데이터의 보고 시점과 현장 상황은 다를 수 있습니다.';

    const sheet = byId('sheet');
    if (focus || isDifferentHospital || !state.sheetHalfPeek) {
        state.sheetHalfPeek = false;
        sheet.classList.remove('half-peek');
        sheet.setAttribute('aria-modal', 'true');
        byId('sheet-dim').hidden = false;
        setBackgroundInert(true);
    }
    sheet.inert = false;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');

    if (focus) {
        sheet.querySelector('.sheet-scroll').scrollTop = 0;
        byId('sheet-close').focus();
    }

    setTimeout(updateMarquees, 100);
    setTimeout(updateMarquees, 350);
}
/*
 * [JS 문법]
 * - export function, 기본값 매개변수(focus = true, options = {}), const, if/else, !hospital, ?., ??, !==, &&, ||, ? :
 * - 화살표 함수 + 구조 분해(([, loaded]), ([name])), 템플릿 리터럴
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - Date.now(), Date.prototype.toLocaleString('ko-KR', opts) : 현재 타임스탬프·한국 시간 문자열 변환.
 * - document.activeElement : 현재 키보드 초점이 놓인 요소를 기억함.
 * - Object.entries(obj), Array.prototype.filter(), .map(), .join(), Number.prototype.toFixed() : 목록 추출·거리 포맷.
 * - HTMLElement.prototype.hidden, .inert, .focus(), .classList, .setAttribute(), .querySelector(), .scrollTop, setTimeout() : 시트 제어.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : openHospital.
 * - 매개변수명 : hospital(열 병원 객체), focus(포커스·스크롤 초기화 여부), options({ skipDirections } 길찾기 생략 여부).
 *
 * [DOM 요소 및 지역 변수]
 * - 시트·검색 요소 : searchResultsEl(#search-results), devModeEl(#developer-mode), dirClearBtn(#directions-clear-btn), sheet(#sheet).
 * - 텍스트·버튼 ID : #hospital-name, #sheet-updated, #hospital-type, #hospital-address, #hospital-distance, #data-state.
 * - 닫기·배경 ID : #sheet-dim, #sheet-close.
 * - 지역 변수 : isDifferentHospital, updated, offlineNote, distance, originName, failed.
 *
 * [동작 흐름]
 * - 호출 출처(내부·배너) : directions-eta.js의 순위 클릭·배너 재열기.
 * - 호출 출처(지도·검색) : markers-cluster.js의 마커·클러스터 클릭, search-controls.js의 딥링크·검색·스냅샷·프리뷰.
 * - 흐름 :
 *   1) 반경 팝오버·검색 결과 닫기 ──> 직전 포커스 저장 ──> 병원 변경 시 개발자 모드·경로 캐시 초기화
 *   2) 상단 정보 갱신 ──> populateWaypointSelect() ──> 연락처·공지·병상·장비·질환(열려 있으면 인스펙터) 렌더링
 *   3) !options.skipDirections ──> loadDirectionsForHospital(hospital, false)
 *   4) 시트 열기 + setBackgroundInert(true) ──> #sheet-close 포커스 ──> updateMarquees() 100ms·350ms 재실행
 */

export function closeSheet() {
    const sheet = byId('sheet');
    if (!sheet) {
        return;
    }

    state.sheetHalfPeek = false;
    sheet.classList.remove('open', 'half-peek');
    sheet.style.transform = '';
    sheet.style.transition = '';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.setAttribute('aria-modal', 'true');
    byId('sheet-dim').hidden = true;

    state.selected = null;
    sheet.inert = true;
    setBackgroundInert(false);

    try {
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.has('hospital') || currentUrl.searchParams.has('hpid')) {
            currentUrl.searchParams.delete('hospital');
            currentUrl.searchParams.delete('hpid');
            window.history.replaceState(null, '', currentUrl.toString());
        }
    } catch (histErr) {
        void histErr;
    }

    const previous = state.previousFocus;
    if (
        previous?.isConnected &&
        !previous.closest('[hidden], [inert], dialog:not([open])') &&
        previous !== byId('keyword') &&
        previous.getClientRects().length > 0
    ) {
        previous.focus();
    } else {
        byId('search-toggle')?.focus({ preventScroll: true });
    }
}
/*
 * [JS 문법]
 * - export function, const, if/else, !sheet, ?., ||, &&, !==, >, try/catch, void
 *
 * [브라우저 내장 Web API]
 * - Element.prototype.classList.remove(), .setAttribute(), HTMLElement.prototype.style, .hidden, .inert : 시트 상태 초기화.
 * - new URL(url), URLSearchParams.prototype.has(), .delete(), window.history.replaceState() : 새로고침 없이 URL 쿼리 제거.
 * - Node.prototype.isConnected, Element.prototype.closest(), .getClientRects(), HTMLElement.prototype.focus() : 안전 포커스 복원.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : closeSheet (매개변수 없음).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : sheet(#sheet), #sheet-dim, #keyword, #search-toggle.
 * - 지역 변수 : currentUrl, histErr, previous.
 *
 * [동작 흐름]
 * - 호출 출처 : app.js(ESC·닫기·딤), directions-eta.js(onCloseSheet), search-controls.js, hospital-sheet.js의 initSheetDrag().
 * - 흐름 :
 *   1) 시트 'open'·'half-peek' 제거 + sheet.inert = true + setBackgroundInert(false)
 *   2) URL에 ?hospital 또는 ?hpid 있으면 history.replaceState()로 주소창 쿼리만 정리
 *   3) previous 요소가 화면에 살아 있으면 focus() 복원 ──> 아니면 #search-toggle로 포커스 이동
 */

export function syncResponsiveSheetLayout() {
    const isCoarseOnlyMobile =
        window.matchMedia('(pointer: coarse)').matches &&
        !window.matchMedia('(any-pointer: fine)').matches;
    const isMobileEnv =
        window.innerWidth <= MOBILE_MAX_WIDTH ||
        isAppleTouchDevice() ||
        isCoarseOnlyMobile;

    document.body.classList.toggle('touch-device', isMobileEnv);

    let layoutMode = 'slider';
    if (isMobileEnv) {
        layoutMode = 'mobile';
    } else if (
        window.innerWidth >= LARGE_MONITOR_MIN_WIDTH &&
        window.innerHeight >= LARGE_MONITOR_MIN_HEIGHT
    ) {
        layoutMode = 'modal';
    }

    if (document.body.dataset.sheetLayout !== layoutMode) {
        document.body.dataset.sheetLayout = layoutMode;
        const sheet = byId('sheet');
        if (sheet) {
            if (!isMobileEnv && state.sheetHalfPeek) {
                expandSheetFromHalfPeek();
            }
            sheet.style.transform = '';
            sheet.style.transition = '';
        }
    }
}
/*
 * [JS 문법]
 * - export function, const, let, &&, ||, !window.matchMedia(), <=, >=, !==, if/else if
 *
 * [브라우저 내장 Web API]
 * - window.matchMedia(query), MediaQueryList.prototype.matches : 마우스 없이 터치 입력만 있는 환경인지 미디어 쿼리로 확인함.
 * - window.innerWidth, window.innerHeight : 현재 브라우저 화면 가로·세로 크기(px).
 * - DOMTokenList.prototype.toggle(cls, force) : 조건에 따라 CSS 클래스를 붙이거나 뗌.
 * - HTMLElement.prototype.dataset, .style.transform, .style.transition : data-* 속성 및 인라인 스타일 제어.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : syncResponsiveSheetLayout (매개변수 없음).
 *
 * [DOM 요소 및 지역 변수]
 * - isCoarseOnlyMobile, isMobileEnv, layoutMode, sheet(#sheet).
 *
 * [동작 흐름]
 * - 호출 출처 : app.js의 init() 및 window resize 이벤트에서 호출됨.
 * - 흐름 :
 *   1) 폭 640px 이하·Apple 터치·순수 터치 -> 'mobile' / 1200x680 이상 -> 'modal' / 나머지 PC -> 'slider'
 *   2) body.dataset.sheetLayout 변경 시 갱신 ──> 비모바일에서 Half-Peek 중이었으면 expandSheetFromHalfPeek() 자동 복귀
 */

export function initSheetDrag() {
    const handle = byId('sheet-drag-handle');
    const sheet = byId('sheet');
    if (!handle || !sheet) {
        return;
    }

    let startY = null;
    let delta = 0;

    handle.addEventListener(
        'touchstart',
        event => {
            if (!document.body.classList.contains('touch-device') || event.touches.length !== 1) {
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
            delta = event.touches[0].clientY - startY;
            if (state.sheetHalfPeek) {
                event.preventDefault();
                const baseOffset = Math.max(0, sheet.offsetHeight - 268);
                const nextOffset = Math.max(0, baseOffset + delta);
                sheet.style.transform = `translate3d(0, ${nextOffset}px, 0)`;
            } else if (delta > 0) {
                event.preventDefault();
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
        sheet.style.transform = '';

        if (state.sheetHalfPeek) {
            if (delta < -45) {
                expandSheetFromHalfPeek();
            } else if (delta > 75) {
                closeSheet();
            }
        } else if (hasRenderedRoute() && delta > 70 && delta <= 210) {
            snapSheetToHalfPeek();
        } else if (delta > 95) {
            closeSheet();
        }
        delta = 0;
    };

    handle.addEventListener('touchend', finish, { passive: true });
    handle.addEventListener('touchcancel', finish, { passive: true });

    sheet.querySelector('.sheet-header')?.addEventListener('click', event => {
        if (state.sheetHalfPeek && !event.target.closest('#sheet-close')) {
            expandSheetFromHalfPeek();
        }
    });
}
/*
 * [JS 문법]
 * - export function, const, let, if/else if, !handle, ||, &&, ===, !==, >, <, <=, -, 화살표 함수, 템플릿 리터럴, ?.
 *
 * [JS 표준 및 브라우저 내장 Web API]
 * - EventTarget.prototype.addEventListener(type, fn, options) : touchmove만 { passive: false }로 등록해 preventDefault() 허용.
 * - TouchEvent.prototype.touches, Touch.prototype.clientY : 한 손가락 터치 개수와 수직 Y 좌표를 읽음.
 * - Math.max(a, b) : 계산 결과가 0 미만 음수로 내려가지 않도록 하한을 제한함.
 * - HTMLElement.prototype.offsetHeight, .style.transform, .style.transition : translate3d로 드래그 위치를 실시간 반영함.
 * - DOMTokenList.prototype.contains(), Element.prototype.querySelector(), .closest() : 클래스 유무·조상 요소 검사.
 *
 * [함수명 및 매개변수명]
 * - 함수명 : initSheetDrag (매개변수 없음).
 * - 내부 보조 함수명 : finish (손가락을 뗐을 때 스냅·닫기 결정 함수).
 *
 * [DOM 요소 및 지역 변수]
 * - DOM 요소 : handle(#sheet-drag-handle), sheet(#sheet).
 * - 지역 변수 : startY, delta, baseOffset, nextOffset.
 *
 * [동작 흐름]
 * - 호출 출처 : app.js의 init()에서 앱 시작 시 1회 호출되어 터치 제스처를 등록함.
 * - 이벤트 바인딩 :
 *   ├── handle(#sheet-drag-handle) 'touchstart' ──> startY·delta 초기화 및 sheet.style.transition 해제
 *   ├── handle(#sheet-drag-handle) 'touchmove' ──> preventDefault() 후 sheet.style.transform 실시간 이동
 *   ├── handle(#sheet-drag-handle) 'touchend' · 'touchcancel' ──> finish()로 스냅·닫기 판정
 *   └── #sheet .sheet-header 'click' ──> Half-Peek && #sheet-close 외 탭 시 expandSheetFromHalfPeek()
 * - 스냅·닫기 임계값 흐름 :
 *   1) 전체 펼침 ──> 경로 있고 아래로 70 초과~210px 이하 드래그 ──> snapSheetToHalfPeek()
 *      └── 경로 없거나 95px 초과(또는 210px 초과) 아래 드래그 ──> closeSheet()
 *   2) Half-Peek ──> 위로 45px 넘게(delta < -45) 또는 .sheet-header 탭 ──> expandSheetFromHalfPeek()
 *      └── 아래로 75px 넘게 드래그(delta > 75) ──> closeSheet()
 */
