package com.yonsei119.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Locale;
/*
 * [자바 문법] package, import : 모든 HTTP 응답에 웹 보안 헤더와 표준 PWA 미디어 타입을 자동으로 입혀주는 필터 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - OncePerRequestFilter : 하나의 HTTP 요청당(내부 forward가 일어나더라도) 딱 한 번만 실행됨을 스프링이 보장해 주는 표준 필터 부모 클래스임 (이름 변경 불가).
 * - HttpServletRequest, HttpServletResponse, HttpServletResponseWrapper, FilterChain : 요청·응답 편지 및 응답 헤더 보호 래퍼 내장 타입임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @Component (출처: org.springframework.stereotype) : 스프링이 서버 시작 시 이 필터를 자동으로 찾아 웹 서버 입구에 배치하게 함 (형제 어노테이션: @Service, @Repository, @Configuration).
 */

@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {
/*
 * [스프링/라이브러리 내장 어노테이션] @Component
 * [자바 문법] public class ... extends : OncePerRequestFilter 부모 클래스의 기능을 물려받아(extends) 확장함.
 * [내가 지은 이름] SecurityHeadersFilter : 대문자로 시작하는 웹 보안 헤더 주입 필터 이름임.
 * [핵심 원리 & 비유]
 * - 식당에서 포장 도시락(HTML, JS, JSON, PWA 매니페스트 응답)이 나갈 때마다 출구에서 '위조 방지 안심 스티커(보안 헤더 5종)'와 정확한 품목 라벨을 붙여 주는 보안 요원임.
 */

    private static final String WEB_MANIFEST_CONTENT_TYPE = "application/manifest+json;charset=UTF-8";
    /*
     * [자바 문법] private static final : 변하지 않는 클래스 고정 상수 선언임.
     * [내가 지은 이름] WEB_MANIFEST_CONTENT_TYPE : W3C PWA 웹 매니페스트 공식 MIME 타입 문자열임.
     */

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
    /*
     * [스프링/라이브러리 내장 어노테이션] @Override (출처: java.lang)
     * [자바 문법] protected void ... throws : 부모 클래스와 약속된 접근 범위(protected)이며, 입출력 예외 발생 가능성을 선언(throws)함.
     * [스프링/자바 내장 함수] doFilterInternal : OncePerRequestFilter가 요구하는 고정 메서드 이름임 (이름 변경 불가).
     * [내가 지은 이름] request(요청 상자), response(응답 상자), filterChain(다음 단계 전달 체인)
     */
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "SAMEORIGIN");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");

        String uri = request.getRequestURI();
        boolean isWebManifest = uri != null && uri.toLowerCase(Locale.ROOT).endsWith(".webmanifest");
        HttpServletResponse targetResponse = response;

        if (isWebManifest) {
            response.setContentType(WEB_MANIFEST_CONTENT_TYPE);
            targetResponse = new HttpServletResponseWrapper(response) {
                @Override
                public void setContentType(String type) {
                    super.setContentType(WEB_MANIFEST_CONTENT_TYPE);
                }

                @Override
                public void setHeader(String name, String value) {
                    if ("Content-Type".equalsIgnoreCase(name)) {
                        super.setHeader(name, WEB_MANIFEST_CONTENT_TYPE);
                        return;
                    }
                    super.setHeader(name, value);
                }
            };
        }

        filterChain.doFilter(request, targetResponse);
        /*
         * [스프링/자바 내장 함수]
         * - response.setHeader(이름, 값), response.setContentType(...) : HTTP 응답 봉투 겉면에 보안 규칙과 표준 MIME 헤더를 기록함 (형제 함수: addHeader, getHeader, setStatus).
         * - filterChain.doFilter(request, targetResponse) : 보안 스티커 부착 후 실제 컨트롤러나 정적 파일 서빙 단계로 요청을 통과시킴 (호출 필수).
         * [부착되는 응답 헤더 구조 예시]
         *   HTTP/1.1 200 OK
         *   ├── Content-Type: application/manifest+json;charset=UTF-8  (*.webmanifest 요청 시 컨테이너 기본값에 덮어씌워지지 않게 보장)
         *   ├── X-Content-Type-Options: nosniff                        (브라우저의 임의 파일 형식 추측 실행 차단)
         *   ├── X-Frame-Options: SAMEORIGIN                            (외부 피싱 사이트의 iframe 끼워넣기 클릭재킹 차단)
         *   ├── Referrer-Policy: strict-origin-when-cross-origin       (외부 이동 시 민감 URL 쿼리 노출 최소화)
         *   ├── Permissions-Policy: camera=(), microphone=(), geolocation=(self) (카메라·마이크 차단, 내 위치 GPS만 본인 도메인 허용)
         *   └── Cross-Origin-Opener-Policy: same-origin-allow-popups   (내비게이션 새 창 실행은 허용하되 악성 부모 창 접근 차단)
         */
    }
}
