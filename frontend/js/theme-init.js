/*
 * ============================================================================
 * [역할 및 실행 시점]
 * - 역할: 첫 화면이 그려지기 직전 저장된 다크·라이트 테마를 즉시 확정해 흰 화면 깜빡임(FOUC)을 막는 선발대 스크립트
 * - 실행 시점: `index.html`의 `<head>` 최상단에서 일반 동기 `<script src="js/theme-init.js">`로 CSS보다 먼저 즉시 1회 실행(IIFE)됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   `<head>` 파싱 시작 ──> `applyInitialThemeBeforePaint()` 즉시 실행
 *   ├── `localStorage.getItem('yonsei119-theme')` 조회 (미저장·차단 시 기본 `'dark'`)
 *   ├── `<html data-theme>`·`.dark-mode` 클래스·`<meta name="color-scheme">`·`<meta name="theme-color">` 동기화
 *   └── `DOMContentLoaded` 이후 `#nanum-webfont-link`(`media="print"` -> `'all'`)를 비차단 활성화해 초기 렌더링 지연을 예방함
 *
 * [내장 API 및 보안 특징]
 * - 브라우저 내장 API: `localStorage`, `document.documentElement`, `document.querySelector`, `addEventListener`, `setTimeout`
 * - 보안(CSP): 인라인 `<script>` 대신 외부 파일로 분리하여 `SecurityHeadersFilter`의 엄격한 `script-src 'self'` 정책을 100% 준수함
 *
 * [사용처 및 IDE 추적 가이드]
 * - 로드 위치: `frontend/index.html` (`<script src="js/theme-init.js"></script>`)
 * - 테마 토글 연동: `frontend/js/search-controls.js` -> `initThemeToggle()`, `applyTheme()` (`yonsei119-theme` 키 공유)
 * - IntelliJ 추적 팁: `Ctrl + Shift + F`로 `yonsei119-theme` 또는 `nanum-webfont-link` 검색
 * ============================================================================
 */
(function applyInitialThemeBeforePaint() {
    let initialTheme = 'dark';
    try {
        const savedTheme = localStorage.getItem('yonsei119-theme');
        if (savedTheme === 'light' || savedTheme === 'dark') {
            initialTheme = savedTheme;
        }
    } catch (storageErr) {
        void storageErr;
    }

    const isDark = initialTheme === 'dark';
    const root = document.documentElement;
    root.dataset.theme = initialTheme;
    root.classList.toggle('dark-mode', isDark);

    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) {
        colorSchemeMeta.content = initialTheme;
    }

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.content = isDark ? '#0f172a' : '#f6f8fc';
    }

    const promoteFontStylesheet = () => {
        const fontLink = document.getElementById('nanum-webfont-link');
        if (!fontLink || fontLink.media === 'all') {
            return;
        }
        const activate = () => {
            fontLink.media = 'all';
        };
        if (fontLink.sheet) {
            activate();
            return;
        }
        fontLink.addEventListener('load', activate, { once: true });
        fontLink.addEventListener('error', activate, { once: true });
        setTimeout(activate, 1500);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', promoteFontStylesheet, { once: true });
    } else {
        promoteFontStylesheet();
    }
})();
