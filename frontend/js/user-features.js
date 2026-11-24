import {
    state
} from './state.js';
import {
    bedValue,
    byId,
    distanceKm,
    getActiveMessages,
    isMissing,
    setStatus
} from './utils.js';

const LEGACY_REMOVED_KEYS = [
    'yonsei119-favorites-v1',
    'yonsei119-bed-alert-v1',
    'yonsei119-lang-v1',
    'yonsei119-recent-v1'
];

/**
 * 문서 언어를 한국어로 고정하고 제거된 구버전 `localStorage` 키를 정리한다.
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

function syncTtsButtonUi(hospitalId) {
    const ttsBtn = byId('sheet-tts-btn');
    if (!ttsBtn) {
        return;
    }
    const speaking = Boolean(hospitalId && state.speakingHospitalId === hospitalId);
    ttsBtn.setAttribute('aria-pressed', String(speaking));
    ttsBtn.textContent = speaking ? '⏹ 음성 중지' : '🔊 음성 안내';
}

/**
 * 진행 중인 Web Speech API 음성 안내를 중단한다.
 */
export function stopHospitalSpeech() {
    state.speakingHospitalId = null;
    if ('speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
        } catch (err) {
            void err;
        }
    }
    syncTtsButtonUi(state.selected?.id);
}

function buildHospitalVoiceSummary(hospital) {
    const erBedsText = bedValue(hospital.beds?.hvec);
    const km = distanceKm(state.origin, hospital).toFixed(1);
    const activeNotices = getActiveMessages(hospital);
    const erTel = isMissing(hospital.erTel)
        ? (isMissing(hospital.tel) ? '번호 없음' : hospital.tel)
        : hospital.erTel;

    return `${hospital.name}. 직선거리 ${km}킬로미터. 응급실 일반병상 ${erBedsText}. `
        + `진료 공지 ${activeNotices.length}건. 연락처 ${erTel}.`;
}

/**
 * 선택된 병원의 핵심 현황 요약을 Web Speech API(한국어)로 낭독하거나 중지한다.
 */
export function toggleHospitalSpeech(hospital) {
    if (!hospital?.id) {
        return;
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
        setStatus('이 브라우저에서는 Web Speech 음성 안내를 지원하지 않습니다.');
        return;
    }

    if (state.speakingHospitalId === hospital.id) {
        stopHospitalSpeech();
        return;
    }

    stopHospitalSpeech();
    const utterance = new SpeechSynthesisUtterance(buildHospitalVoiceSummary(hospital));
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;

    state.speakingHospitalId = hospital.id;
    syncTtsButtonUi(hospital.id);

    const clearSpeaking = () => {
        if (state.speakingHospitalId === hospital.id) {
            state.speakingHospitalId = null;
            syncTtsButtonUi(state.selected?.id);
        }
    };
    utterance.onend = clearSpeaking;
    utterance.onerror = clearSpeaking;

    window.speechSynthesis.speak(utterance);
}
