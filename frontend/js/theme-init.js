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

    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) {
        colorSchemeMeta.content = initialTheme;
    }
    document.documentElement.dataset.theme = initialTheme;
})();
/*
 * [JS 문법]
 * - (function 함수명() { ... })() : 선언과 동시에 딱 1번 즉시 실행되고 전역 변수 오염을 남기지 않는 즉시 실행 함수 표현식(IIFE)임.
 * - let / const : 값 재할당이 필요한 변수는 `let`, 한 번 담으면 바뀌지 않는 상자 참조는 `const`로 선언함.
 * - try { ... } catch (...) { ... } : 사파리 시크릿 모드나 서드파티 쿠키 차단 환경에서 스토리지 접근 시 발생할 수 있는 보안 예외를 안전하게 흡수함.
 * - void : 표현식을 평가하되 반환값은 사용하지 않음을 명시하는 자바스크립트 예약어임.
 * [브라우저 내장 도구(API) & 내장 함수]
 * - localStorage.getItem('키') : 브라우저 영구 로컬 저장소에서 문자열 설정값을 꺼내는 내장 함수임 (이름 변경 불가).
 *   (형제 저장소 비교: 탭을 닫으면 사라지는 `sessionStorage`, 대용량 구조화 DB인 `IndexedDB`, 서비스 워커용 `CacheStorage`)
 * - document.querySelector(...) : CSS 선택자로 HTML 요소를 1개 찾는 내장 DOM 함수임 (형제 함수: `getElementById`, `querySelectorAll`).
 * - document.documentElement.dataset.theme : `<html>` 루트 태그의 `data-theme="..."` 사용자 정의 속성을 읽고 쓰는 내장 프로퍼티임.
 * [내가 지은 이름]
 * - applyInitialThemeBeforePaint(초기 테마 동기화 함수명), initialTheme(초기 테마 상자), savedTheme(저장된 테마값), colorSchemeMeta(메타 태그 참조)
 * [핵심 원리 — 왜 이 파일만 `defer`나 `type="module"` 없이 `<head>` 최상단에서 실행하는 이유]
 * - 비유하자면 '연극 막이 오르기 전에 무대 조명(암전/주간)을 먼저 세팅하는 스태프'임.
 * - 스타일시트(`css/style.css`)가 화면을 칠하기 직전에 `<html data-theme="dark|light">`와 `<meta name="color-scheme">`를 먼저 확정해 두어야,
 *   야간 응급 상황에서 다크 모드로 접속했을 때 순간적으로 하얀 화면이 번쩍이는 현상(FOUC, Flash of Unstyled Content)을 0ms로 원천 차단할 수 있음.
 * - 또한 인라인 `<script>` 대신 외부 파일(`js/theme-init.js`)로 분리하여 콘텐츠 보안 정책(CSP) 호환성과 코드 모듈성을 함께 확보했음.
 */
