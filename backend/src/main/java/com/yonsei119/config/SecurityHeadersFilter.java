package com.yonsei119.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import org.jspecify.annotations.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Locale;
/*
 * [자바 문법]
 * - package : 웹 보안 헤더 필터가 속한 패키지(com.yonsei119.config) 선언문임.
 * - import : Jakarta Servlet 표준 API, 스프링 컴포넌트·단일 실행 필터, 자바 예외·로케일 클래스를 가져오는 선언문임.
 *
 * [패키지명]
 * - com.yonsei119.config : 설정 및 HTTP 필터 컴포넌트 패키지명임.
 *
 * [자바/서블릿/스프링 내장 타입 (이름 변경 불가)]
 * - OncePerRequestFilter (출처: org.springframework.web.filter 패키지)
 *   · 역할 : 내부 포워딩이 일어나도 하나의 HTTP 요청당 필터가 딱 1번만 실행되도록 보장하는 추상 클래스임.
 * - HttpServletRequest, HttpServletResponse, FilterChain, ServletException (출처: jakarta.servlet.* 패키지)
 *   · 역할 : HTTP 요청·응답 객체, 다음 필터로 넘기는 체인 인터페이스, 서블릿 처리 예외 클래스임.
 * - HttpServletResponseWrapper (출처: jakarta.servlet.http 패키지)
 *   · 역할 : 기존 HttpServletResponse를 감싸 setContentType·setHeader 동작을 가로채 바꿀 때 쓰는 표준 래퍼 클래스임.
 * - IOException (출처: java.io 패키지) : 입출력 작업 실패 시 발생하는 예외 클래스임.
 * - Locale (출처: java.util 패키지) : 국가·언어 환경에 따라 대소문자 변환 규칙이 달라지는 것을 막을 때 쓰는 클래스임.
 */

@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {
/*
 * [스프링 내장 어노테이션]
 * - @Component 정의 (출처: org.springframework.stereotype.Component, 이름 변경 불가)
 *   · 역할 : 개발자가 작성한 클래스를 컴포넌트 스캔 대상에 포함해 스프링 싱글톤 빈으로 자동 생성·등록하는 범용 어노테이션임.
 * - @Component 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 SecurityHeadersFilter 클래스
 *   · 작동 원리 : 컴포넌트 스캔으로 SecurityHeadersFilter를 싱글톤 빈으로 등록한 뒤 서블릿 필터 체인에 자동 연결함.
 *   · 비교 : 설정 @Configuration, 서비스 @Service, 저장소 @Repository, REST 컨트롤러 @RestController가 있음.
 *
 * [자바 문법]
 * - public class ... extends : 공개 클래스를 선언하고 OncePerRequestFilter 추상 클래스의 기능을 단일 상속함.
 *
 * [클래스명]
 * - SecurityHeadersFilter : 모든 HTTP 응답에 보안 헤더 5종을 붙이고 .webmanifest의 Content-Type 덮어쓰기를 막는 필터 클래스명임.
 *
 * [동작 흐름]
 * - 호출 출처 : 브라우저의 모든 HTTP 요청(HTML, CSS, JS, webmanifest, /api/**)이 내장 Tomcat에 도착함.
 * - 흐름 : OncePerRequestFilter.doFilter() ──> 1회 실행 확인 ──> doFilterInternal() 보안 헤더 5종·MIME 보정 ──> filterChain.doFilter()
 * - 전달 대상 : 필터를 통과한 응답에 보안 헤더 5종과 올바른 Content-Type이 담겨 브라우저로 전송됨.
 */

    private static final String WEB_MANIFEST_CONTENT_TYPE = "application/manifest+json;charset=UTF-8";
    /*
     * [자바 문법]
     * - private static final : 클래스 내부에서만 쓰고 실행 중 값이 바뀌지 않는 공용 상수 선언임.
     *
     * [자바 표준 내장 타입 (이름 변경 불가)]
     * - String (출처: java.lang 패키지).
     *
     * [상수명]
     * - WEB_MANIFEST_CONTENT_TYPE : PWA 웹 매니페스트 표준 MIME 타입과 UTF-8 인코딩을 합친 상수 문자열임.
     */

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {
    /*
     * [자바/라이브러리 내장 어노테이션]
     * - @Override 정의 (출처: java.lang.Override, 이름 변경 불가)
     *   · 역할 : 부모 클래스나 인터페이스의 메서드를 재정의할 때 이름·매개변수·반환 타입이 일치하는지 컴파일러가 검사하게 하는 어노테이션임.
     * - @Override 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 SecurityHeadersFilter.doFilterInternal(HttpServletRequest, HttpServletResponse, FilterChain) 메서드
     *   · 작동 원리 : OncePerRequestFilter의 추상 메서드 시그니처와 일치하는지 컴파일 단계에서 검사해 오타를 막음.
     *   · 비교 : @Deprecated(사용 중단 표시), @SuppressWarnings(컴파일 경고 억제), @FunctionalInterface가 있음.
     * - @NonNull 정의 (출처: org.jspecify.annotations.NonNull, 이름 변경 불가)
     *   · 역할 : 매개변수·필드·반환값에 null이 들어올 수 없음을 컴파일러와 정적 분석 도구에 명시하는 어노테이션임.
     * - @NonNull 현재 코드 적용
     *   · 적용 대상 : SecurityHeadersFilter.doFilterInternal()의 request, response, filterChain 매개변수 3개
     *   · 작동 원리 : 부모 OncePerRequestFilter 패키지의 @NullMarked 규약과 null 불가 계약을 일치시켜 정적 분석 경고를 방지함.
     *   · 비교 : null 허용을 뜻하는 @Nullable, 패키지·클래스 전체에 null 불가를 기본 적용하는 @NullMarked가 있음.
     *
     * [자바 문법]
     * - protected : 같은 패키지(com.yonsei119.config)와 상속 자식 클래스에서 호출 가능한 접근 제어자임.
     * - void : 반환값 없음 선언임.
     * - throws ServletException, IOException : doFilterInternal() 실행 중 서블릿·I/O 오류가 나면 호출한 서버로 넘긴다는 선언임.
     *
     * [서블릿/스프링 내장 타입 및 메서드 (이름 변경 불가)]
     * - HttpServletRequest, HttpServletResponse, FilterChain, ServletException, IOException.
     * - doFilterInternal : OncePerRequestFilter가 요청당 1번 실행할 실제 작업으로 호출하는 고정 추상 메서드명임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : doFilterInternal (부모 클래스 규약상 이름 변경 불가).
     * - 매개변수명 : request(HTTP 요청 객체), response(HTTP 응답 객체), filterChain(다음 필터·컨트롤러로 넘기는 체인 객체).
     */
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "SAMEORIGIN");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
        /*
         * [서블릿 내장 메서드 (이름 변경 불가)]
         * - response.setHeader(String name, String value) (출처: jakarta.servlet.http 패키지)
         *   · 역할 : 지정한 이름의 HTTP 응답 헤더를 설정(이미 있으면 덮어쓰기)함 (형제: addHeader, getHeader, setStatus).
         *
         * [동작 흐름]
         * - 호출 출처 : doFilterInternal() 진입 직후 실행됨.
         * - 흐름 : 응답 본문을 쓰기 전 아래 5가지 보안 헤더를 response 객체에 기록함.
         *   ├── X-Content-Type-Options: nosniff ──> 브라우저의 임의 파일 형식 추측 실행 차단
         *   ├── X-Frame-Options: SAMEORIGIN ──> 외부 사이트 iframe 삽입(클릭재킹) 차단
         *   ├── Referrer-Policy: strict-origin-when-cross-origin ──> 외부 이동 시 상세 경로 유출 최소화
         *   ├── Permissions-Policy: camera=(), microphone=(), geolocation=(self) ──> 카메라·마이크 차단, 위치는 동일 출처만 허용
         *   └── Cross-Origin-Opener-Policy: same-origin-allow-popups ──> 외부 내비 새 창은 열되 opener 접근 격리
         * - 전달 대상 : 보안 헤더 5종이 담긴 response 객체가 isWebManifest 매니페스트 검사 단계로 넘어감.
         */

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
        /*
         * [자바 문법]
         * - boolean : true/false 논리값 기본형임.
         * - !=, && : null이 아닌지 비교하고 앞이 참일 때만 뒤를 평가하는 단락 논리곱 연산자임.
         * - if { ... } : 조건이 true일 때만 블록 안 코드를 실행함.
         * - new HttpServletResponseWrapper(response) { ... } : 기존 클래스를 즉석 상속해 메서드를 바꾼 익명 서브클래스 생성 문법임.
         * - super.setContentType(...), super.setHeader(...) : 감싸진 부모 클래스 HttpServletResponseWrapper의 setContentType(), setHeader() 메서드를 호출함.
         * - return; : void 메서드에서 나머지 코드를 건너뛰고 즉시 끝내는 분기문임.
         *
         * [자바/서블릿 내장 타입, 상수 및 메서드 (이름 변경 불가)]
         * - String, HttpServletResponse, HttpServletResponseWrapper, Locale.ROOT (로케일 영향 없는 변환 기준 상수).
         * - HttpServletRequest.getRequestURI() : 요청 URL에서 호스트·쿼리를 뺀 경로 부분만 반환함.
         * - String.toLowerCase(Locale.ROOT), String.endsWith(String) : 표준 소문자 변환 및 끝 문자열 일치 확인 메서드임.
         * - HttpServletResponse.setContentType(String), setHeader(String, String) : 응답 타입과 헤더를 지정하는 표준 메서드임.
         * - String.equalsIgnoreCase(String) : 대소문자 구분 없이 문자열이 같은지 비교함.
         *
         * [자바 내장 어노테이션]
         * - @Override 정의 (출처: java.lang.Override, 이름 변경 불가)
         *   · 역할 : 부모 클래스나 인터페이스의 메서드를 재정의할 때 이름·매개변수·반환 타입이 일치하는지 컴파일러가 검사하게 하는 어노테이션임.
         * - @Override 현재 코드 적용
         *   · 적용 대상 : 바로 위 선언된 HttpServletResponseWrapper 익명 클래스의 setContentType(String type), setHeader(String name, String value) 메서드
         *   · 작동 원리 : 두 메서드가 부모 HttpServletResponseWrapper의 시그니처와 일치하는지 컴파일러가 검증함.
         *   · 비교 : @Deprecated(사용 중단 표시), @SuppressWarnings(컴파일 경고 억제), @FunctionalInterface가 있음.
         *
         * [지역 변수명]
         * - uri : 요청 경로 URI 문자열 변수.
         * - isWebManifest : 요청이 .webmanifest 파일인지 판별한 boolean 변수.
         * - targetResponse : 다음 체인에 넘길 응답 객체 (일반 요청은 원본 response, 매니페스트 요청은 보호 래퍼).
         * - type, name, value : 재정의된 setContentType·setHeader 메서드의 매개변수명.
         *
         * [동작 흐름]
         * - 호출 출처 : 보안 헤더 5종 설정 직후 실행됨.
         * - 흐름 :
         *   ├── uri가 .webmanifest로 끝남 ──> WEB_MANIFEST_CONTENT_TYPE 고정 + 덮어쓰기 차단 래퍼 생성 ──> targetResponse 대입
         *   └── 그 외 일반 요청 (HTML/JS/JSON) ──> 원본 response 그대로 targetResponse에 유지
         * - 전달 대상 : targetResponse 변수가 다음 줄의 filterChain.doFilter(request, targetResponse)로 전달됨.
         */

        filterChain.doFilter(request, targetResponse);
        /*
         * [서블릿 내장 메서드 (이름 변경 불가)]
         * - FilterChain.doFilter(ServletRequest request, ServletResponse response) (출처: jakarta.servlet 패키지)
         *   · 역할 : 현재 필터 작업을 마치고 다음 필터나 최종 목적지(정적 파일 핸들러·컨트롤러)로 요청·응답을 넘김.
         *   · 주의 : FilterChain.doFilter() 메서드를 호출하지 않으면 요청이 다음 단계로 넘어가지 않아 응답 본문이 생성되지 않음.
         *
         * [동작 흐름]
         * - 호출 출처 : doFilterInternal() 마지막 단계에서 실행됨.
         * - 흐름 : request·targetResponse 전달 ──> 다음 필터 통과 ──> 정적 파일 서빙 또는 EmergencyApiController 실행.
         * - 반환값 : 반환값 없음 (체인 실행 완료 시 보안 헤더와 보정된 Content-Type이 포함된 응답이 클라이언트로 전송됨).
         */
    }
}
