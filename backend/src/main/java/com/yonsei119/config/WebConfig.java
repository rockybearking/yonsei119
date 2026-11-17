package com.yonsei119.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.config.annotation.ContentNegotiationConfigurer;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.IOException;
import java.time.Duration;
import java.util.Arrays;
/*
 * [자바 문법] package, import : 웹 서버 라우팅·정적 리소스·CORS 규칙을 담는 설정 패키지 선언과 스프링 MVC 도구 불러오기임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - WebMvcConfigurer : 스프링 MVC의 기본 웹 동작(정적 파일 위치, 홈 화면 연결, CORS, MIME 타입)을 커스터마이징할 때 구현하는 공식 인터페이스임 (이름 변경 불가).
 * - Resource, CacheControl, MediaType, Duration, Arrays : 파일 메타데이터 조회 및 HTTP 캐시·미디어 타입 지정용 내장 도구임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @Configuration (출처: org.springframework.context.annotation) : "이 클래스는 서버 설정 도면임"라고 스프링에게 알려주는 어노테이션임.
 */

@Configuration
public class WebConfig implements WebMvcConfigurer {
/*
 * [스프링/라이브러리 내장 어노테이션] @Configuration : 부팅 시 스프링이 이 설정 클래스를 자동으로 읽어들임.
 * [자바 문법] public class ... implements : WebMvcConfigurer 인터페이스(약속된 설계 규격)를 구현(implements)하는 클래스 선언임 (상속 extends와 달리 여러 규격을 동시에 구현 가능).
 * [내가 지은 이름] WebConfig : 대문자로 시작하는 웹 설정 클래스 이름임.
 * [핵심 원리 & 비유]
 * - 식당 입구의 '안내 데스크' 역할임.
 * - 손님이 메뉴판(HTML/CSS/JS/PWA 파일)을 달라고 하면 frontend/ 폴더에서 꺼내 주고, 주문(/api/...)을 하면 카운터(EmergencyApiController)로 안내함.
 */

    private final Yonsei119Properties properties;
    /*
     * [자바 문법] private final : 이 클래스 내부에서만 접근 가능(private)하고 한 번 꽂히면 바뀌지 않는(final) 멤버 변수 선언임.
     * [내가 지은 이름] Yonsei119Properties(대문자 타입명) vs properties(소문자 변수 상자명)
     */

    public WebConfig(Yonsei119Properties properties) {
    /*
     * [자바 문법] public WebConfig(...) : 클래스 이름과 똑같은 이름을 가진 '생성자(Constructor)'로, 스프링이 설정 객체를 자동 주입(DI)할 때 호출함.
     * [내가 지은 이름] properties : 외부에서 전달받은 설정 객체를 가리키는 매개변수 이름임.
     */
        this.properties = properties;
        /*
         * [자바 문법] this.properties = properties : 내 클래스의 상자(this.properties)에 방금 전달받은 설정값(properties)을 담아 고정함.
         */
    }

    @Override
    public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
    /*
     * [스프링/라이브러리 내장 어노테이션] @Override (출처: java.lang) : 부모 인터페이스(WebMvcConfigurer)의 공식 메서드를 오타 없이 재정의했음을 컴파일러가 검증함.
     * [자바/스프링/라이브러리 내장 도구(타입)] ContentNegotiationConfigurer : 파일 확장자별 HTTP Content-Type 응답 헤더를 매핑하는 내장 설정기임 (이름 변경 불가).
     * [스프링/자바 내장 함수] configureContentNegotiation : 스프링이 정해 둔 약속된 함수 이름으로 바꿀 수 없음.
     * [내가 지은 이름] configurer : 설정 도구를 받아 쓰는 소문자 변수명임.
     */
        configurer.mediaType("webmanifest", MediaType.parseMediaType("application/manifest+json"));
        /*
         * [스프링/자바 내장 함수] .mediaType(...), MediaType.parseMediaType(...) (이름 변경 불가)
         * [핵심 원리] PWA 앱 설치에 쓰이는 manifest.webmanifest 요청 시 표준 MIME 타입('application/manifest+json')을 정확히 내려주어
         * X-Content-Type-Options: nosniff 보안 헤더 환경에서도 크롬·사파리가 매니페스트를 완벽히 인식하게 함.
         */
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
    /*
     * [스프링/라이브러리 내장 어노테이션] @Override
     * [자바/스프링/라이브러리 내장 도구(타입)] ResourceHandlerRegistry : URL 패턴과 실제 디스크/JAR 폴더 위치를 연결하는 내장 등록부임 (이름 변경 불가).
     * [스프링/자바 내장 함수] addResourceHandlers : 정적 파일 서빙 규칙을 등록하는 공식 약속 메서드임 (이름 변경 불가).
     * [내가 지은 이름] registry : 등록부 객체를 가리키는 소문자 변수명임.
     */
        registry.addResourceHandler("/Assets/**")
                .addResourceLocations(
                        "file:./frontend/Assets/",
                        "file:../frontend/Assets/",
                        "classpath:/static/Assets/"
                )
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(7)).cachePublic())
                .setUseLastModified(true)
                .setEtagGenerator(WebConfig::computeWeakMetadataEtag);

        registry.addResourceHandler("/**")
                .addResourceLocations(
                        "file:./frontend/",
                        "file:../frontend/",
                        "classpath:/static/"
                )
                .setCacheControl(CacheControl.noCache())
                .setUseLastModified(true)
                .setEtagGenerator(WebConfig::computeWeakMetadataEtag);
        /*
         * [스프링/자바 내장 함수]
         * - .addResourceHandler(...) : 브라우저가 요청하는 URL 패턴 지정
         * - .addResourceLocations(...) : 파일을 찾아볼 폴더 순서 지정 (로컬 ./frontend/ -> ../frontend/ -> 배포 JAR 내부 classpath:/static/)
         * - .setCacheControl(...) : CacheControl.maxAge(...) (일정 기간 재요청 생략) vs CacheControl.noCache() (매번 변경 여부 ETag 확인) (형제 옵션: .noStore(), .mustRevalidate())
         * - .setEtagGenerator(WebConfig::computeWeakMetadataEtag) : 자바 메서드 참조(::) 문법으로 파일 지문(ETag) 생성기를 연결함.
         * [정적 파일 탐색 흐름 예시]
         *   브라우저 요청: GET http://localhost:8080/js/map-engine.js
         *   └──> 1순위: ./frontend/js/map-engine.js (로컬 개발 시 수정 즉시 반영)
         *   └──> 3순위: yonsei119-backend.jar!/BOOT-INF/classes/static/js/map-engine.js (클라우드 배포 시)
         */
    }

    private static String computeWeakMetadataEtag(Resource resource) {
    /*
     * [자바 문법] private static : 이 파일 내부에서만 쓰는(private) 공용 유틸 함수(static) 선언임.
     * [자바/스프링/라이브러리 내장 도구(타입)] String, Resource (이름 변경 불가)
     * [내가 지은 이름] computeWeakMetadataEtag(함수명), resource(파일 리소스 변수명)
     */
        try {
            long lastModified = resource.lastModified();
            long contentLength = resource.contentLength();
            return "W/\"" + Long.toHexString(lastModified) + "-" + Long.toHexString(contentLength) + "\"";
        } catch (IOException ex) {
            return "";
        }
        /*
         * [자바 문법] try { ... } catch (IOException ex) { ... }, return : 파일 입출력 중 예외가 나도 서버가 죽지 않고 빈 문자열("")을 안전하게 돌려줌.
         * [스프링/자바 내장 함수] resource.lastModified(), resource.contentLength(), Long.toHexString(...) (이름 변경 불가)
         * [생성되는 ETag 헤더 예시]
         *   파일 수정시각(1731834000000) + 파일 크기(4096 바이트)
         *   └──> ETag: W/"19338b1ac00-1000" (변경이 없으면 브라우저는 본문 다운로드 없이 304 Not Modified로 0.001초 만에 통과)
         */
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
    /*
     * [스프링/라이브러리 내장 어노테이션] @Override
     * [자바/스프링/라이브러리 내장 도구(타입)] ViewControllerRegistry (이름 변경 불가)
     * [스프링/자바 내장 함수] addViewControllers : 별도 컨트롤러 코드 없이 단순 화면 경로를 연결하는 내장 메서드임 (이름 변경 불가).
     */
        registry.addViewController("/").setViewName("forward:/index.html");
        /*
         * [스프링/자바 내장 함수] .addViewController("/"), .setViewName("forward:/index.html")
         * [내가 지은 이름] "/", "forward:/index.html"
         * [핵심 원리 & 비교]
         * - "forward:/index.html" : 주소창 URL(http://localhost:8080/?hospital=A2200001)과 쿼리 파라미터를 그대로 유지한 채 서버 내부에서 index.html을 즉시 전달함.
         * - 형제 방식인 "redirect:/index.html"을 쓰면 302 재요청이 발생해 주소창이 바뀌고 초기 로딩이 한 왕복 느려지므로 forward를 사용했음.
         */
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
    /*
     * [스프링/라이브러리 내장 어노테이션] @Override
     * [자바/스프링/라이브러리 내장 도구(타입)] CorsRegistry (이름 변경 불가)
     * [스프링/자바 내장 함수] addCorsMappings : 다른 포트(예: 프론트엔드 개발 서버 5500번)에서 /api/**를 호출할 때 브라우저 차단을 풀어주는 공식 메서드임.
     */
        String rawPatterns = (properties.cors() != null && properties.cors().allowedOriginPatterns() != null)
                ? properties.cors().allowedOriginPatterns()
                : "*";
        String[] patterns = Arrays.stream(rawPatterns.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toArray(String[]::new);

        registry.addMapping("/api/**")
                .allowedOriginPatterns(patterns.length > 0 ? patterns : new String[]{"*"})
                .allowedMethods("GET", "OPTIONS")
                .allowedHeaders("Accept", "Content-Type", "If-None-Match", "Cache-Control")
                .maxAge(3600);
        /*
         * [스프링/자바 내장 함수] .addMapping(...), .allowedOriginPatterns(...), .allowedMethods(...), .allowedHeaders(...), .maxAge(...) (이름 변경 불가)
         * [핵심 원리 & 보안 설계]
         * - 이 프로젝트의 모든 공개 API는 읽기 전용 조회이므로 허용 메서드를 "GET", "OPTIONS"로 최소 권한 제한했음 (불필요한 POST/DELETE 원천 차단).
         * - .maxAge(3600)으로 브라우저가 사전 확인(OPTIONS Preflight) 결과를 1시간(3600초) 동안 기억하게 하여 불필요한 왕복 통신을 없앴음.
         */
    }
}
