/*
 * ============================================================================
 * [1. 역할 및 실행 시점]
 * - 역할 : 첫 화면이 그려지기 전 저장된 다크·라이트 테마를 즉시 적용하여
 *          흰 화면 깜빡임(FOUC)을 막고 한글 웹폰트를 비차단 활성화하는 선발대 스크립트
 * - 실행 시점 : `index.html`의 `<head>` 최상단에서 동기 `<script>`로 즉시 1회 실행됨
 *
 * [2. 전체 실행 흐름 (시퀀스 다이어그램)]
 *
 *    [index.html <head>]      [theme-init.js]            [localStorage]      [DOM <html>]
 *             |                      |                          |                  |
 *             |-- 1. sync execute -->|                          |                  |  CSS 렌더링 전 즉시 실행
 *             |                      |-- 2. getItem(theme) ---->|                  |  저장된 테마 조회
 *             |                      |<-- 'dark' or 'light' ----|                  |  미저장 시 'dark' 기본값
 *             |                      |-- 3. set data-theme -----|----------------->|  .dark-mode · meta 반영
 *             |                      |-- 4. font media='all' ---|----------------->|  로드 후 웹폰트 비차단 적용
 *             v                      v                          v                  v
 *
 * [3. 사용된 요소 구분 (표준 내장)]
 * - JS / 브라우저 표준 내장
 *   ㄴ IIFE (function(){})()    : 전역 변수 오염 없이 즉시 1회 실행하는 표준 함수 패턴
 *   ㄴ localStorage.getItem()   : 브라우저 영구 저장소에서 테마 설정을 읽는 내장 메서드
 *   ㄴ document.documentElement : `<html>` 루트 요소를 가리키는 표준 DOM 속성
 *   ㄴ classList.toggle()       : `.dark-mode` 클래스를 켜고 끄는 표준 DOM 메서드
 *   ㄴ document.querySelector() : `<meta>` 태그를 탐색하는 표준 DOM 메서드
 *
 * [4. 실제 사용처 (연결 위치) 및 IDE 추적 가이드]
 * - 연결 파일
 *   ㄴ frontend/index.html            : `<script src="js/theme-init.js"></script>`
 *   ㄴ frontend/js/search-controls.js : `initThemeToggle()`, `applyTheme()`과 키 공유
 *   ㄴ SecurityHeadersFilter.java     : 인라인 스크립트 제거로 `script-src 'self'` 준수
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
