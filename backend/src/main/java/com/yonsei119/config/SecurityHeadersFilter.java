package com.yonsei119.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import org.jspecify.annotations.NonNull;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Locale;

/*
 * [역할 및 실행 시점]
 * - 역할: 모든 HTTP 응답이 브라우저로 나가기 전에 6대 웹 보안 헤더(CSP, nosniff 등)를 찍어 주는 보안 검색대 문지기 필터
 * - 실행 시점: 서버 부팅 시 서블릿 필터 체인 최상단(`HIGHEST_PRECEDENCE + 10`)에 등록되며, 모든 요청마다 딱 1번씩 자동 실행됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   모든 HTTP 요청(HTML, CSS, JS, SVG, `/api/**`) 진입
 *   ──> doFilterInternal()
 *       ├── 1) 보안 헤더 6종 부착 (nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy, COOP, CSP)
 *       ├── 2) `.webmanifest` 요청이면 Content-Type이 덮어써지지 않도록 응답 래퍼(HttpServletResponseWrapper) 적용
 *       └── 3) `filterChain.doFilter()`로 다음 필터(ApiRateLimitFilter) 및 컨트롤러/정적 핸들러에 전달
 *
 * [내장 / 프레임워크 / 라이브러리 구분]
 * - Java 표준 내장: String, Locale, IOException
 * - Jakarta Servlet 표준: HttpServletRequest, HttpServletResponse, HttpServletResponseWrapper, FilterChain
 * - Spring / JSpecify: @Component, @Order, OncePerRequestFilter, @NonNull
 *
 * [사용처 및 IDE 추적 가이드]
 * - 연동 파일: frontend/js/theme-init.js(인라인 스크립트 없이 외부 파일로 분리해 CSP 준수), frontend/js/map-engine.js(네이버 지도 도메인 허용)
 * - 테스트 검증처: Yonsei119BackendTests.testRootStaticResourcesAndSecurityHeaders()
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class SecurityHeadersFilter extends OncePerRequestFilter {

    private static final String WEB_MANIFEST_CONTENT_TYPE = "application/manifest+json;charset=UTF-8";
    public static final String CONTENT_SECURITY_POLICY = buildCsp(false);
    public static final String LOCAL_HTTP_CONTENT_SECURITY_POLICY = buildCsp(true);

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {
        // [웹 보안 헤더 6종] XSS·클릭재킹·MIME 추측 실행·불필요한 카메라/마이크 권한 접근을 브라우저 단에서 차단함
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "SAMEORIGIN");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
        response.setHeader(
                "Content-Security-Policy",
                isHttpsRequest(request) ? CONTENT_SECURITY_POLICY : LOCAL_HTTP_CONTENT_SECURITY_POLICY
        );

        String uri = request.getRequestURI();
        boolean isWebManifest = uri != null && uri.toLowerCase(Locale.ROOT).endsWith(".webmanifest");
        HttpServletResponse targetResponse = response;

        // `.webmanifest` 파일 서빙 시 하위 핸들러가 Content-Type을 일반 텍스트로 덮어쓰지 못하도록 보호함
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
    }

    /** Render 등 리버스 프록시 뒤의 HTTPS 요청(`X-Forwarded-Proto: https`)과 직접 TLS 요청을 모두 판별함 */
    private static boolean isHttpsRequest(HttpServletRequest request) {
        if (request.isSecure()) {
            return true;
        }
        String forwardedProto = request.getHeader("X-Forwarded-Proto");
        return forwardedProto != null && "https".equalsIgnoreCase(forwardedProto.trim());
    }

    /** 운영 HTTPS 환경과 로컬 HTTP 개발 환경에서 네이버 지도 WebGL SDK·나눔스퀘어네오 웹폰트만 최소 권한으로 허용하는 CSP 문자열을 조립함 */
    private static String buildCsp(boolean allowHttpNaverSubresources) {
        String scriptHttpNaver = allowHttpNaverSubresources
                ? " http://oapi.map.naver.com http://*.map.naver.com http://*.map.naver.net http://*.pstatic.net"
                : "";
        String imgHttpNaver = allowHttpNaverSubresources
                ? " http://*.naver.com http://*.naver.net http://*.pstatic.net"
                : "";
        String connectHttpNaver = allowHttpNaverSubresources
                ? " http://oapi.map.naver.com http://*.map.naver.com http://*.map.naver.net http://*.pstatic.net http://*.naver.com http://*.naver.net http://*.nelo.navercorp.com http://*.navercorp.com"
                : "";

        return String.join("; ",
                "default-src 'self'",
                "script-src 'self' https://oapi.map.naver.com https://*.map.naver.com https://*.map.naver.net https://*.pstatic.net" + scriptHttpNaver,
                "style-src 'self' 'unsafe-inline' https://hangeul.pstatic.net https://*.pstatic.net",
                "img-src 'self' data: blob: https://*.naver.com https://*.naver.net https://*.pstatic.net" + imgHttpNaver,
                "font-src 'self' data: https://hangeul.pstatic.net https://*.pstatic.net",
                "connect-src 'self' https://oapi.map.naver.com https://*.map.naver.com https://*.map.naver.net https://*.pstatic.net https://hangeul.pstatic.net https://*.naver.com https://*.naver.net https://*.nelo.navercorp.com https://*.navercorp.com" + connectHttpNaver,
                "worker-src 'self' blob:",
                "child-src 'self' blob:",
                "manifest-src 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "frame-ancestors 'self'"
        );
    }
}
