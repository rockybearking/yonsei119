/*
 * ============================================================================
 * [1. 역할 및 실행 시점]
 * - 역할 : 병원 상세 시트(`#sheet`)의 3단 반응형 레이아웃, 대학병원 정적 워터마크 배경,
 *          직통 전화·3사 내비 연동, 실시간 병상·장비·공지·28대 중증질환 현황판,
 *          그리고 개발자 모드 원본 대조표(`GET /api/hospitals/{hpid}`)를 조립하는 모듈
 * - 실행 시점 : 앱 부팅 시 반응형·드래그 이벤트가 바인딩되며, 병원 선택 시 `openHospital()` 실행
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [Card / Search]            [hospital-sheet.js]               [user-features.js]      [directions / API]
 *              |                            |                                 |                       |
 *              |-- 1. openHospital(hosp) -->|                                 |                       |  상세 시트 열기
 *              |                            |-- 2. resolveUniversityLogo() -->|                       |  소속 대학교 로고 확인
 *              |                            |<-- 3. SVG path (no medical) ----|                       |  정적 배경 워터마크 배치
 *              |                            |-- 4. render beds & severe       |                       |  병상 · 장비 · 28대 질환 보드
 *              |                            |-- 5. loadDirectionsFor...() ----|---------------------->|  실시간 자동차 경로 조회
 *         +----+----------------------------+---------------------------------+-----------------------+----------+
 *         | [opt : #developer-mode opened]                                                                       |  하단 개발자 모드 펼침 시
 *         |    |                            |-- 6. GET /hospitals/{hpid} -----|---------------------->|          |  60개 전체 원시 태그 조회
 *         +----+----------------------------+---------------------------------+-----------------------+----------+
 *              v                            v                                 v                       v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프로젝트 내부)]
 * - JS / 브라우저 표준 내장
 *   ㄴ fetch()                     : 단건 상세 원본 API(`/api/hospitals/{hpid}`) 비동기 조회
 *   ㄴ navigator.share / clipboard : 병원 공유 링크 전송 및 클립보드 복사 내장 API
 *   ㄴ Pointer Events              : 모바일 바텀시트 터치 드래그(`pointerdown/move/up`) 처리
 *   ㄴ URL / encodeURIComponent    : 네이버·카카오·T맵 외부 앱/웹 길안내 딥링크 생성
 *   ㄴ requestAnimationFrame       : 시트 열림 후 전광판 마퀴 폭 계산 타이밍 동기화
 * - 프로젝트 내부 모듈
 *   ㄴ constants.js / state.js / utils.js / user-features.js / directions-eta.js
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 프론트엔드 호출처
 *   ㄴ frontend/js/app.js             : 시트 초기화 · 닫기 · 개발자 모드 토글
 *   ㄴ frontend/js/markers-cluster.js : 병원 카드 및 클러스터 항목 클릭 시 열기
 *   ㄴ frontend/js/directions-eta.js  : 추천 순위 클릭 · 상단 경로 배너 병원 다시 열기
 *   ㄴ frontend/js/search-controls.js : 검색 자동완성 선택 · 60초 실시간 시트 무음 갱신
 * - 연결 HTML / CSS
 *   ㄴ frontend/index.html         : `#sheet`, `#sheet-univ-watermark`, `#developer-mode`
 *   ㄴ frontend/css/sheet-egen.css : 상세 시트 · 워터마크 · 병상/질환 배지 스타일
 * ============================================================================
 */

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
import {
    resolveUniversityHospitalLogo
} from './user-features.js';

let marqueeTimerId = null;
let watermarkErrorBound = false;

/*
 * [역할 및 데이터 흐름]
 * - 역할: 대학교병원(의료원 제외) 상세 시트를 열 때 소속 대학교 로고를 `.sheet-scroll` 바깥의 `#sheet-univ-watermark`에 정적 배치함
 *   · `.sheet-scroll`과 형제 레이어로 분리되어 있어 내부 내용을 스크롤해도 대학교 로고는 흔들리지 않고 제자리에 고정됨
 * - 호출처: `openHospital()`, `closeSheet()`
 */
function syncSheetUniversityWatermark(hospital) {
    const sheet = byId('sheet');
    const wrap = byId('sheet-univ-watermark');
    const img = byId('sheet-univ-logo');
    if (!sheet || !wrap || !img) {
        return;
    }

    if (!watermarkErrorBound) {
        watermarkErrorBound = true;
        img.addEventListener('error', () => {
            sheet.classList.remove('has-univ-logo');
            delete sheet.dataset.univCode;
            wrap.hidden = true;
        });
    }

    const logoInfo = resolveUniversityHospitalLogo(hospital);
    if (!logoInfo) {
        sheet.classList.remove('has-univ-logo');
        delete sheet.dataset.univCode;
        wrap.hidden = true;
        img.removeAttribute('src');
        return;
    }

    sheet.classList.add('has-univ-logo');
    sheet.dataset.univCode = logoInfo.code;
    if (img.getAttribute('src') !== logoInfo.assetPath) {
        img.setAttribute('src', logoInfo.assetPath);
    }
    wrap.hidden = false;
}

/*
 * [역할 및 호출처]
 * - 역할: 시트 열림 트랜지션(220ms)이 끝난 직후 `updateMarquees()`를 실행해 긴 텍스트 전광판 폭을 정확히 계산함
 * - 호출처: `openHospital()`, `closeSheet()`(취소용)
 */
function scheduleMarqueeRefresh() {
    if (marqueeTimerId !== null) {
        clearTimeout(marqueeTimerId);
    }
    marqueeTimerId = setTimeout(() => {
        marqueeTimerId = null;
        updateMarquees();
    }, 260);
}

/*
 * [역할 및 호출처]
 * - 역할: `tel:` 전화 발신용 `<a>` 버튼 요소를 생성함
 * - 호출처: `renderContacts(hospital)`
 */
function contactLink(text, href, className) {
    const link = node('a', className, text);
    link.href = href;
    return link;
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 기기 OS에 맞춰 모바일 내비게이션 앱을 실행하고, 앱이 설치되어 있지 않으면 스토어·웹 지도로 안전하게 연결함
 * - 분기 흐름:
 *   ㄴ Android: `intent://...#Intent;scheme=...;package=...;S.browser_fallback_url=...;end` 실행
 *   ㄴ 데스크톱 PC: `window.open(fallback, '_blank', 'noopener,noreferrer')` 새 탭 웹 지도 열기
 *   ㄴ iOS/iPadOS: 커스텀 스킴 실행 후 `1.8초` 안에 앱 전환(`visibilityState === 'hidden'`)이 없으면 `fallback` 이동
 * - 호출처: `launchNavigation(provider, hospital)`
 */
function openMobileApp(scheme, androidPackage, fallback) {
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
 * [역할 및 데이터 흐름]
 * - 역할: 네이버지도(`nmap://`), 카카오맵(`kakaomap://`), T맵(`tmap://`)의 출발지·목적지 길안내 딥링크와 웹 폴백 주소를 조립함
 * - 호출처: `launchNavigation(provider, hospital)`
 */
function navigationLink(provider, hospital) {
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
 * [역할 및 호출처]
 * - 역할: 선택한 내비게이션 사업자(`naver`·`kakao`·`tmap`) 링크를 만들어 앱/웹 실행을 위임함
 * - 호출처: `renderContacts(hospital)` 내 내비게이션 버튼 클릭 리스너
 */
function launchNavigation(provider, hospital) {
    const link = navigationLink(provider, hospital);
    openMobileApp(link.scheme, link.package, link.fallback);
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 선택한 병원으로 바로 열리는 직통 링크(`?hospital=HPID`)를 생성해 모바일 공유창 또는 클립보드 복사로 전달함
 * - 흐름: URL 조립 -> 모바일 `navigator.share()` 우선 시도 -> 미지원·데스크톱은 `navigator.clipboard.writeText()` 후 토스트 안내
 * - 호출처: `renderContacts(hospital)`의 `'공유하기'` 버튼 클릭 리스너
 */
async function shareHospital(hospital) {
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
 * [역할 및 데이터 흐름]
 * - 역할: 시트 상단 `#contact-actions`에 응급실·대표전화 발신 버튼과 3사 내비게이션·공유 버튼을 렌더링함
 * - 호출처: `openHospital(hospital)`
 */
function renderContacts(hospital) {
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
 * [역할 및 데이터 흐름]
 * - 역할: 현재 시각에 유효한 실시간 응급·중증 진료 공지(`getEmrrmSrsillDissMsgInqire`)를 중요도(`[중증]` 우선) 순으로 `#messages`에 표시함
 * - 흐름: `getActiveMessages(hospital)` -> 중요도·진료과·본문 정렬 -> `#message-count` 건수 갱신 및 `.message-card` 조립
 * - 호출처: `openHospital(hospital)`
 */
function renderMessages(hospital) {
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
 * [역할 및 데이터 정합성 핵심 — 실측 비고값 보정 반영]
 * - 역할: 28대 중증응급질환 수용 여부(`mkioskty1`~`28`)와 실시간 차단 공지·비고(`*msg`)를 교차 검증해 `#severe`에 그림
 * - 배지 우선순위(실제 NEMC 응답 사례 반영):
 *   1) 의미 없는 자리표시 비고(`'.'`, `'-'`, `'정보미제공'`, `'미정보'`, `'없음'`)는 빈 비고로 정제
 *   2) 원본값이 `'N*'`(`status.className === 'no'`)이거나 실시간 차단 공지(`isBlockedByNotice`) 또는 비고가 `'불가능'`인 경우 -> 빨강 `'불가능'` 최우선 적용!
 *   3) 원본값이 `'Y'`일 때 연령·시간 조건부 비고(`'36개월 이상'`, `'문의 요망'` 등)가 있으면 노랑 `'확인 필요'`,
 *      `'연령제한없음'`·`'제한없음'`·`'0세 이상'`이거나 비고가 없으면 초록 `'가능'` 표시
 * - 호출처: `openHospital(hospital)`
 */
function renderSevere(hospital) {
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
            const rawMsgTrimmed = isBlankOrNull(rawMsg) ? '' : String(rawMsg).trim();
            const cleanMsg = /^(?:\.+|[-−–—]+|정보\s*미제공|미정보|없음)$/i.test(rawMsgTrimmed)
                ? ''
                : rawMsgTrimmed;

            const status = availability(rawVal, '가능', '불가능');
            const isBlockedByNotice = isDiseaseSpecificallyBlocked(activeMessages, item.key);
            const cleanMsgWithoutNoLimit = cleanMsg.replace(/제한\s*없음/g, '');
            const hasBlockingRemark = Boolean(
                cleanMsg && /(불가능|불가|차단|중단|부재|휴진)/.test(cleanMsgWithoutNoLimit)
            );
            const isUnrestrictedRemark =
                /^(?:연령\s*)?제한\s*없음$|^0세\s*이상$|^전\s*연령(?:\s*가능)?$|^정상(?:\s*진료)?$|^가능$/i.test(cleanMsg);
            const hasConditionalRemark = Boolean(cleanMsg && !hasBlockingRemark && !isUnrestrictedRemark);

            if (status.className === 'no' || isBlockedByNotice || hasBlockingRemark) {
                valWrap.append(node('span', 'egen-badge-avail-red', '불가능'));
            } else if (status.className === 'yes') {
                if (hasConditionalRemark) {
                    valWrap.append(node('span', 'egen-badge-avail-yellow', '확인 필요'));
                } else {
                    valWrap.append(node('span', 'egen-badge-avail-green', '가능'));
                }
            } else if (hasConditionalRemark) {
                valWrap.append(node('span', 'egen-badge-avail-yellow', '확인 필요'));
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
 * [역할 및 데이터 흐름]
 * - 역할: 가용 병상(`current`)과 기준 병상(`baseline`) 비율을 계산해 E-Gen 스타일 배지 클래스·문구를 산출함
 * - 판정 흐름:
 *   ㄴ 분만실(`type === 'delivery'`): `'Y'` 또는 양수면 초록 `'Y / 기준'`
 *   ㄴ 결측치(`isBlankOrNull`): 회색 `'-'` (`.egen-badge-dash`)
 *   ㄴ 음수(`current < 0`): 진빨강 `'초과수용 N/기준'` (`.egen-badge-overflow` 보존!)
 *   ㄴ 가용률 비교: `<= 35%`·`0석` 빨강 `'혼잡'`, `< 70%` 주황 `'보통'`, `>= 70%` 초록 `'원활'`
 * - 호출처: `createBedCell(fields, item)`
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
 * [역할 및 호출처]
 * - 역할: 병상 1개 항목의 상단 라벨·배지와 하단 API 원본 수신값(`[가용 / 기준]`) 셀(`.egen-cell`)을 생성함
 * - 호출처: `renderErBeds()`, `renderInpatientBeds()`
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
 * [역할 및 호출처]
 * - 역할: `EMERGENCY_BED_ITEMS` 11종 응급실 병상 현황판을 `#er-beds-board`에 렌더링함
 * - 호출처: `renderBeds(hospital)`
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
 * [역할 및 호출처]
 * - 역할: `INPATIENT_BED_SECTIONS` 6개 분과 입원·중환자실·수술실 현황판을 `#inpatient-beds-board`에 렌더링함
 * - 호출처: `renderBeds(hospital)`
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
 * [역할 및 호출처]
 * - 역할: 응급실·입원 병상 보드를 일괄 갱신하고 보고일시(`hvidate`)를 `#bed-time`에 표시함
 * - 호출처: `openHospital(hospital)`
 */
function renderBeds(hospital) {
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
 * [역할 및 호출처]
 * - 역할: 의료 장비 1개 항목(`hv*ayn` 및 기준 대수 `hvs*`)의 상태 셀(`.equipment-cell`)을 생성함
 * - 호출처: `renderEquipment(hospital)`
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
 * [역할 및 호출처]
 * - 역할: `EQUIPMENT_TABLE_ITEMS` 11종 특수 응급장비 가용 보드를 `#equipment`에 렌더링함
 * - 호출처: `openHospital(hospital)`
 */
function renderEquipment(hospital) {
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
 * [역할 및 호출처]
 * - 역할: 개발자 모드 `#all-beds` 영역에 `hv*`, `hvs*`, 당직의·보고시각 원본 키-값을 빠짐없이 대조 출력함
 * - 호출처: `renderDeveloperInspector(hospital)`
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
 * [역할 및 호출처]
 * - 역할: 개발자 모드 `#all-severe`에 `mkioskty1`~`28` 및 모든 비고(`*msg`) 원본 필드를 출력함
 * - 호출처: `renderDeveloperInspector(hospital)`
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
 * [역할 및 호출처]
 * - 역할: 개발자 모드 `#all-messages`에 실시간 진료 공지 XML 원본 태그 10종을 건별로 전부 표시함
 * - 호출처: `renderDeveloperInspector(hospital)`
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
 * [역할 및 호출처]
 * - 역할: 개발자 모드 `#basic-info`에 응급의료기관 기본정보 및 권역외상센터 기본정보 원본 필드를 표시함
 * - 호출처: `renderDeveloperInspector(hospital)`
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
 * [역할 및 백엔드 API 연결]
 * - 역할: 초기 경량 목록(`?compact=true`)에서 생략된 장문 약도·원본 태그들을 `GET /api/hospitals/{hpid}`로 온디맨드 보충함
 * - 백엔드 연결: `EmergencyApiController.getHospitalDetail(hpid)` -> `HospitalDto` 전체 JSON 반환 -> `state.detailCache` 캐싱
 * - 호출처: `renderDeveloperInspector(hospital)`
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
 * [역할 및 데이터 흐름]
 * - 역할: 개발자 모드 아코디언(`#developer-mode`)이 펼쳐졌을 때 4종 원본 대조표를 그리고 필요 시 단건 상세 데이터를 보강함
 * - 호출처: `app.js` (`#developer-mode` `toggle` 이벤트), `openHospital(hospital)`
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
 * [역할 및 접근성 원리]
 * - 역할: 모달 시트가 열렸을 때 뒤쪽 지도·검색창에 키보드 탭·스크린 리더 포커스가 새지 않도록 `inert` 속성을 일괄 전환함
 * - 호출처: `snapSheetToHalfPeek()`, `expandSheetFromHalfPeek()`, `openHospital()`, `closeSheet()`
 */
function setBackgroundInert(value) {
    for (const selector of ['#map', '#search-panel', '#active-route-banner', '#mobile-top-left-menu']) {
        const el = document.querySelector(selector);
        if (el) {
            el.inert = value;
        }
    }
}

/*
 * [역할 및 호출처]
 * - 역할: 모바일에서 경로 표시 후 시트를 하단 `268px` 반열림(`.half-peek`)으로 내려 지도 경로선과 전화·내비 버튼을 동시에 조작하게 함
 * - 호출처: `directions-eta.js:initDirectionsControls()` (`uiCallbacks.onSnapSheetHalfPeek`), `initSheetDrag()`
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
 * [역할 및 호출처]
 * - 역할: 반열림(`.half-peek`) 상태인 시트를 다시 전체 모달 상태로 펼침
 * - 호출처: `directions-eta.js:initDirectionsControls()` (`uiCallbacks.onExpandSheetFromHalfPeek`), `syncResponsiveSheetLayout()`, `initSheetDrag()`
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
 * [역할 및 데이터 흐름]
 * - 역할: 선택된 병원의 상세 시트(`#sheet`)를 열고 대학교 배경 로고·연락처·공지·병상·장비·중증질환·길찾기를 한 번에 채움
 * - 호출처: `markers-cluster.js` (카드·클러스터 클릭), `search-controls.js` (검색·딥링크·실시간 자동갱신·미리보기), `directions-eta.js` (추천순위·배너)
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
    syncSheetUniversityWatermark(hospital);
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

    scheduleMarqueeRefresh();
}

/*
 * [역할 및 데이터 흐름]
 * - 역할: 열린 병원 상세 시트를 닫고 URL의 `?hospital=` 쿼리를 정리한 뒤 직전 초점 요소로 포커스를 복원함
 * - 호출처: `app.js` (`#sheet-close`, `#sheet-dim`, `Escape` 키), `directions-eta.js`, `search-controls.js`, `initSheetDrag()`
 */
export function closeSheet() {
    if (marqueeTimerId !== null) {
        clearTimeout(marqueeTimerId);
        marqueeTimerId = null;
    }
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
    syncSheetUniversityWatermark(null);
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
 * [역할 및 데이터 흐름]
 * - 역할: 화면 크기와 터치 기기 여부에 따라 시트 형태를 `modal`(`1200×680` 이상 PC) / `slider`(일반 PC) / `mobile`(`640px` 이하·터치)로 동기화함
 * - 호출처: `app.js` (`init`, `window` `resize` 리스너)
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
 * [역할 및 데이터 흐름]
 * - 역할: 모바일 바텀시트 상단 손잡이(`#sheet-drag-handle`) 터치 스와이프를 감지해 전체 펼침 <-> 반열림(`Half-Peek`) <-> 닫기를 처리함
 * - 호출처: `app.js:init()`에서 앱 시작 시 1회 바인딩
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
