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
 * [1. 역할 및 실행 시점]
 * - 역할 : 모든 HTTP 응답에 6대 웹 보안 헤더(CSP, nosniff, SAMEORIGIN 등)를 부착하는 보안 검색대 필터
 * - 실행 시점 : 서블릿 필터 체인 최상단(`HIGHEST_PRECEDENCE + 10`)에서 매 요청마다 1회 자동 실행됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [Browser]           [SecurityHeadersFilter]      [ApiRateLimitFilter]      [Controller]
 *           |                          |                           |                     |
 *           |-- 1. HTTP Request ------>|                           |                     |  모든 요청 최상단 진입
 *           |                          |-- 2. set 6 headers        |                     |  CSP · nosniff · SAMEORIGIN
 *      +----+--------------------------+---------------------------+---------------------+-------+
 *      | [opt : URI endsWith .webmanifest]                                                       |  PWA 매니페스트 요청 시
 *      |    |                          |-- wrap Content-Type       |                     |       |  application/manifest+json 고정
 *      +----+--------------------------+---------------------------+---------------------+-------+
 *           |                          |-- 3. doFilter() --------->|-- 4. doFilter() --->|  다음 필터 및 컨트롤러 전달
 *           |<-- 5. Secured Response --|                           |                     |  보안 헤더 포함 응답 수신
 *           v                          v                           v                     v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ String        : 헤더 이름 · CSP 정책 문자열을 다루는 표준 내장 클래스
 *   ㄴ String.join() : 여러 CSP 지시어를 `"; "`로 이어 붙이는 표준 내장 정적 메서드
 *   ㄴ Locale.ROOT   : 언어 환경에 흔들리지 않는 소문자 변환 기준 상수
 *   ㄴ IOException   : 네트워크 입출력 예외를 다루는 표준 내장 클래스
 * - Spring 프레임워크
 *   ㄴ @Component           : 필터를 스프링 빈으로 자동 등록하는 어노테이션
 *   ㄴ @Order               : 필터 실행 우선순위를 지정하는 어노테이션
 *   ㄴ OncePerRequestFilter : 포워딩 시 중복 실행 없이 요청당 1회만 실행을 보장하는 추상 클래스
 * - 외부 라이브러리 (표준 스펙)
 *   ㄴ Jakarta Servlet     : `HttpServletRequest`, `HttpServletResponse`, `FilterChain`
 *   ㄴ JSpecify (@NonNull) : 매개변수 null 불가 계약을 명시하는 어노테이션
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 연동되는 프론트엔드 / 테스트 파일
 *   ㄴ frontend/sw.js                   : `X-Frame-Options: SAMEORIGIN`으로 정상 백엔드 응답 식별
 *   ㄴ frontend/js/map-engine.js        : 네이버 지도 · 실시간 교통(`*.pstatic.net`) 도메인 허용
 *   ㄴ Yonsei119BackendTests.java       : Test 13 · Test 18 보안 헤더 및 HTTPS CSP 검증
 *   ㄴ Yonsei119PlaywrightE2ETests.java : 브라우저 `securitypolicyviolation` 0건 검증
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

    /** Render 프록시(`X-Forwarded-Proto: https`) 및 직접 TLS 요청 여부를 판별함 */
    private static boolean isHttpsRequest(HttpServletRequest request) {
        if (request.isSecure()) {
            return true;
        }
        String forwardedProto = request.getHeader("X-Forwarded-Proto");
        return forwardedProto != null && "https".equalsIgnoreCase(forwardedProto.trim());
    }

    /** 네이버 지도 SDK · 실시간 교통 타일(`*.pstatic.net`) · 나눔웹폰트만 최소 권한으로 허용함 */
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
