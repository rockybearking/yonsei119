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
 * [JS 문법] import { ... } from './...' : 스키마 상수, 전역 상태, 데이터 정제 유틸, 병원 라벨, 길찾기 모듈을 가져옴.
 * [아키텍처 계층] `hospital-sheet.js`는 3단계 반응형 병원 상세 관제 시트(`#sheet`), 모바일 Half-Peek 2단 스냅, 3대 내비 출발점 연동, 병원 직통 URL 공유,
 *   E-Gen 병상·장비·28대 중증질환 매트릭스 보드, 그리고 온디맨드(`GET /api/hospitals/{hpid}`) 개발자 모드 원본 인스펙터를 전담함.
 */

function contactLink(text, href, className) {
    const link = node('a', className, text);
    link.href = href;
    return link;
}
/*
 * [내가 지은 이름] contactLink : 전화 발신용 `<a href="tel:...">` 앵커 엘리먼트를 안전하게 생성하는 내부 보조 함수임.
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
 * [브라우저 내장 도구/함수] window.open(..., '_blank', 'noopener,noreferrer') (탭내핑 보안 옵션 `noopener,noreferrer` 필수 지정), document.visibilityState (이름 변경 불가)
 * [내가 지은 이름] openMobileApp : Android는 표준 `intent://` 스킴으로, iOS는 `visibilitychange` 감시 기반 커스텀 스킴으로 네이티브 내비 앱을 즉시 깨우고 미설치 시 스토어·웹 지도로 연결함.
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
 * [내가 지은 이름] navigationLink : 네이버지도·카카오맵·T맵 3사 모두에 사용자가 우클릭·검색·GPS로 지정한 출발지(`state.origin`)를 동기화해 전달함.
 * [완성 딥링크 URL 예시 (출발지 지정 시)]
 *   - 네이버 앱 : nmap://route/car?slat=37.3190&slng=127.9012&sname=%EC%B6%9C%EB%B0%9C%EC%A7%80&dlat=37.3188&dlng=127.9456&dname=...
 *   - 카카오 앱 : kakaomap://route?sp=37.3190,127.9012&ep=37.3188,127.9456&by=car
 *   - T맵 앱    : tmap://route?startname=...&startx=127.9012&starty=37.3190&goalname=...&goalx=127.9456&goaly=37.3188
 */

function launchNavigation(provider, hospital) {
    const link = navigationLink(provider, hospital);
    openMobileApp(link.scheme, link.package, link.fallback);
}
/*
 * [내가 지은 이름] launchNavigation : 선택한 내비게이션 공급자의 딥링크 객체를 생성해 실행함.
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
 * [브라우저 내장 도구(API) & 함수]
 * - new URL(window.location.href), shareUrlObj.searchParams.set('hospital', id) : 현재 도메인에 `?hospital=기관코드` 쿼리를 안전하게 조립함 (이름 변경 불가).
 * - navigator.share({ title, text, url }) : 모바일 OS(iOS 에어드롭/메시지/카카오톡, Android 공유 시트) 네이티브 공유 창을 띄움 (이름 변경 불가).
 * - navigator.clipboard.writeText(shareUrl) : PC 브라우저 등에서 클립보드로 즉시 URL을 복사함 (이름 변경 불가).
 * [완성 공유 URL 예시]
 *   https://현재서비스주소/?hospital=A2200001
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
 * [내가 지은 이름] renderContacts : 응급실·대표 직통 전화(`tel:`) 2열과 네이버지도·카카오맵·T맵·공유하기 4열 액션 바(모두 최소 높이 44px 보장)를 렌더링함.
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
 * [내가 지은 이름] renderMessages : 현재 시각 기준 유효한 진료 제한 공지만 추려 `[중증]` 경고를 최상단에 정렬해 보여 줌.
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
 * [내가 지은 이름] renderSevere : 28대 중증응급질환(`mkioskty1~28`) 수용 가능 여부와 실시간 차단 공지(`isDiseaseSpecificallyBlocked`)를 교차 검증해 매트릭스 보드를 그림.
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
 * [내가 지은 이름] getBedStatusBadge : 가용률(`current / baseline`)에 따라 `원활`(초록, >=70%), `보통`(주황, 36~69%), `혼잡`(빨강, <=35%), `초과수용`(음수 강조) 배지를 판별함.
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
 * [내가 지은 이름] createBedCell : E-Gen 스타일 병상 전광판의 개별 항목 셀 1칸을 생성함.
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
 * [내가 지은 이름] renderErBeds : 응급실 병상 11종 현황판을 `#er-beds-board`에 렌더링함.
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
 * [내가 지은 이름] renderInpatientBeds : 중환자실·응급전용·외상전용·감염병·일반입원실 병상 현황판을 `#inpatient-beds-board`에 렌더링함.
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
 * [내가 지은 이름] renderBeds : 응급실·입원 병상 보드와 보고 시각(`hvidate`)을 일괄 갱신함.
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
 * [내가 지은 이름] createEquipmentCell : CT·MRI·ECMO·CRRT 등 개별 특수 의료 장비 셀을 생성함.
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
 * [내가 지은 이름] renderEquipment : 11대 핵심 응급의료 장비 보드를 `#equipment`에 렌더링함.
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
 * [내가 지은 이름] renderRawBeds : 개발자 모드 아코디언 내 `hv*` / `hvs*` 공공데이터 XML 원본 태그 대조표를 렌더링함.
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
 * [내가 지은 이름] renderRawSevere : 개발자 모드 아코디언 내 `mkioskty1~28` 원본값 대조표를 렌더링함.
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
 * [내가 지은 이름] renderRawMessages : 개발자 모드 아코디언 내 실시간 진료 공지 XML 전문을 출력함.
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
 * [내가 지은 이름] renderBasic : 기관 기본정보(`basic`) 및 권역외상센터 기본정보(`trauma`) 원본 사전을 렌더링함.
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
         * [온디맨드 상세 페이로드 조회 URL 예시 (`antigravityV2` 3-2 반영)]
         *   GET /api/hospitals/A2200001
         *   -> 초기 목록(`/api/hospitals?compact=true`)에서는 뺐던 무거운 `basic`/`trauma` 전체 원본 태그를 개발자 모드를 열었을 때만 지연 수신함.
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
 * [내가 지은 이름] hydrateHospitalDetailIfNeeded : 초기 로딩 속도를 위해 경량화된 병원 객체에 단건 상세 API(`GET /api/hospitals/{hpid}`) 원본 필드를 합쳐 줌.
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
 * [내가 지은 이름] renderDeveloperInspector : `<details id="developer-mode">`가 펼쳐졌을 때 즉시 현재 데이터를 먼저 그린 뒤, 백그라운드에서 전체 원본 태그를 보충해 갱신함.
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
 * [브라우저 내장 속성] el.inert = true|false : 모달 시트가 전체로 열려 있을 때 배경 요소로의 키보드 탭 이동과 스크린 리더 탐색을 원천 차단하는 표준 접근성 속성임 (이름 변경 불가).
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
 * [내가 지은 이름] snapSheetToHalfPeek : 모바일에서 `'지도에 경로 표시'` 시 바텀시트를 하단 268px 요약 높이로 스냅하고 배경 딤과 `inert`를 해제해 지도 조작과 전화/내비 발신을 동시에 허용함.
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
 * [내가 지은 이름] expandSheetFromHalfPeek : 반열림(Half-Peek) 상태의 시트를 다시 전체 높이 모달 시트로 펼침.
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
 * [내가 지은 이름] openHospital : 지도 카드·검색·추천 순위·딥링크에서 선택된 병원의 종합 관제 시트를 열고 모든 세부 섹션을 렌더링함.
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
 * [브라우저 내장 함수] window.history.replaceState(null, '', url) : 공유 링크(`?hospital=...`)로 열었던 시트를 닫을 때 새로고침 없이 주소창 쿼리를 정리함 (이름 변경 불가).
 * [내가 지은 이름] closeSheet : 상세 시트를 닫고 직전 포커스 요소로 키보드 초점을 안전하게 되돌림.
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
 * [브라우저 내장 함수] window.matchMedia('(pointer: coarse)') : 마우스 없는 순수 터치 기기(스마트폰·태블릿)인지 하드웨어 입력 특성을 판별함 (이름 변경 불가).
 * [내가 지은 이름] syncResponsiveSheetLayout : 뷰포트와 입력 장치에 맞춰 `mobile`(바텀시트) ↔ `slider`(우측 드로어) ↔ `modal`(중앙 대화면 카드) 3단 레이아웃을 자동 전환함.
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
 * [내가 지은 이름] initSheetDrag : 모바일 손잡이(`#sheet-drag-handle`) 2단 터치 제스처를 바인딩함.
 * [제스처 작동 흐름]
 *   - 전체 펼침 상태 : 살짝 내리면(`70~210px`, 경로 활성 시) `Half-Peek` 반열림 스냅 / 끝까지 내리면(`>95px`) 완전 닫힘
 *   - 반열림 상태    : 위로 끌어올리거나(`< -45px`) 헤더를 탭하면 전체 펼침 복귀 / 아래로 내리면(`> 75px`) 완전 닫힘
 */
