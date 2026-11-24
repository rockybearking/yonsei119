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
/*
 * [JS 문법]
 * - (function 이름() { ... })() : 선언과 동시에 1회 실행되는 즉시 실행 함수(IIFE)임.
 *   · 내부 변수가 전역 스코프로 새어 나가지 않게 격리함.
 * - let / const : 값이 바뀌는 변수는 `let`, 참조가 고정된 변수는 `const`로 선언함.
 * - try { ... } catch (err) { ... } : 저장소 접근이 차단된 환경의 예외를 흡수해 중단을 막음.
 * - === / || / if : 엄격 동등 비교(`===`)와 논리합(`||`)으로 허용된 값만 걸러냄.
 * - void : 표현식을 평가하되 반환값을 버려 미사용 변수 경고를 피하는 연산자임.
 *
 * [브라우저 내장 Web API (이름 변경 불가)]
 * - localStorage.getItem(key) : 브라우저 영구 저장소에서 문자열 설정값을 동기 조회하는 메서드임.
 *   · 비교 : 탭 종료 시 비워지는 `sessionStorage`, 비동기 DB인 `IndexedDB`와 구분됨.
 * - document.querySelector(selector) : CSS 선택자와 일치하는 첫 번째 DOM 요소를 반환함.
 *   · 형제 메서드 : ID 전용 `getElementById()`, 다건 조회 `querySelectorAll()`.
 * - HTMLMetaElement.prototype.content : `<meta>` 태그의 `content` 속성값을 읽고 쓰는 프로퍼티임.
 * - document.documentElement : 문서 최상위 루트 요소(`<html>`)를 가리키는 읽기 전용 프로퍼티임.
 * - HTMLElement.prototype.dataset : 요소의 `data-*` 속성을 카멜 표기 키로 다루는 표준 프로퍼티임.
 *
 * [함수명 및 지역 변수명]
 * - 함수명 : `applyInitialThemeBeforePaint` (초기 화면 그리기 전 테마 확정 IIFE).
 * - 지역 변수명 :
 *   · `initialTheme` : 기본값 `'dark'`로 시작해 최종 적용할 테마 문자열을 담는 변수.
 *   · `savedTheme` : `localStorage`에서 꺼낸 `'yonsei119-theme'` 저장값.
 *   · `storageErr` : 저장소 접근 거부 시 `catch` 블록이 받는 예외 객체.
 *   · `colorSchemeMeta` : `<meta name="color-scheme">` 요소 참조.
 *
 * [동작 흐름]
 * - 호출 출처 : `index.html` `<head>` 안에서 CSS 파일보다 먼저 동기 `<script>`로 실행됨.
 * - 흐름 :
 *   ├── `localStorage`에서 `'yonsei119-theme'` 조회 ──> `'light'`/`'dark'`면 `initialTheme` 갱신
 *   ├── 저장소 차단·오류 발생 ──> `catch`로 예외 무시 후 기본 `'dark'` 유지
 *   └── `<meta name="color-scheme">`와 `<html data-theme>`에 `initialTheme` 즉시 반영
 * - 효과 : 첫 프레임부터 선택된 색상이 적용되어 초기 화면 깜빡임(FOUC)을 막음.
 * - 연동 : 외부 JS 파일로 분리해 CSP 보안 정책과 맞고 `search-controls.js`와 같은 키를 공유함.
 */
