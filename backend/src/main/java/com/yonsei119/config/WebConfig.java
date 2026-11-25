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
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 프론트엔드 정적 파일(HTML·CSS·JS·대학로고 SVG) 서빙, 루트(`/`) 포워딩,
 *          Weak ETag 캐시 재검증, CORS 정책을 담당하는 웹 안내 데스크 설정 클래스
 * - 실행 시점 : 서버 기동 시 `@Configuration` 빈으로 등록되어 MVC 초기화 단계에 자동 실행됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [Browser]            [WebConfig (MVC)]      [Static / ApiController]
 *           |                        |                          |
 *      +----+------------------------+--------------------------+-------------+
 *      | [alt : request URI routing]                                          |  요청 경로별 서빙 분기
 *      |    |-- 1a. GET / ---------->|-- forward:/index.html -->|             |  주소 유지 내부 포워딩
 *      +----+------------------------+--------------------------+-------------+
 *      | [else : GET /Assets/** or /*.js, /*.css]                             |  정적 파일 · 대학로고 요청
 *      |    |-- 1b. If-None-Match -->|-- Weak ETag check ------>|             |  변경 없으면 304 반환
 *      +----+------------------------+--------------------------+-------------+
 *      | [else : GET /api/**]                                                 |  백엔드 데이터 API 요청
 *      |    |-- 1c. CORS check ----->|-- pass to Controller --->|             |  허용 헤더 부착 후 전달
 *      +----+------------------------+--------------------------+-------------+
 *           v                        v                          v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ String           : 경로 문자열 및 ETag 조합용 표준 내장 클래스
 *   ㄴ Path             : OS별 파일 경로를 정규화하는 표준 내장 인터페이스 (`java.nio.file`)
 *   ㄴ Duration         : 캐시 유지 기간(`ofDays(7)`)을 표현하는 표준 내장 시간 클래스
 *   ㄴ Arrays.stream()  : 쉼표로 구분된 CORS 패턴 배열을 가공하는 표준 내장 스트림 메서드
 *   ㄴ Long.toHexString : 수정시각·파일크기를 16진수 문자열로 바꾸는 표준 내장 정적 메서드
 *   ㄴ IOException      : 파일 메타데이터 조회 실패 시 처리하는 표준 내장 예외 클래스
 * - Spring 프레임워크
 *   ㄴ @Configuration   : 스프링 설정 클래스임을 선언하는 어노테이션
 *   ㄴ WebMvcConfigurer : 정적 리소스 · 뷰 컨트롤러 · CORS 설정을 커스터마이징하는 인터페이스
 *   ㄴ CacheControl     : HTTP `Cache-Control` 응답 헤더를 조립하는 빌더 클래스
 *   ㄴ MediaType        : MIME 타입(`application/manifest+json`)을 다루는 클래스
 *   ㄴ Resource         : 로컬 폴더 또는 JAR 내부 정적 파일을 추상화한 인터페이스
 * - 프로젝트 내부 타입
 *   ㄴ Yonsei119Properties : CORS 허용 패턴 설정을 읽어 오는 설정 레코드
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 연동 대상 파일
 *   ㄴ frontend/index.html            : `/` 요청 시 포워딩 대상 문서
 *   ㄴ frontend/Assets/universities/* : 대학병원 배경 워터마크 로고 정적 서빙
 *   ㄴ Yonsei119BackendTests.java     : Test 13 정적 리소스 · ETag 304 통합 검증
 * - IntelliJ 추적 단축키
 *   ㄴ 구현 메서드 추적 : 메서드명 위에서 `Ctrl + Alt + H`
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final Yonsei119Properties properties;

    public WebConfig(Yonsei119Properties properties) {
        this.properties = properties;
    }

    /** `.webmanifest` 확장자가 표준 PWA MIME 타입(`application/manifest+json`)으로 서빙되도록 등록함 */
    @Override
    public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
        configurer.mediaType("webmanifest", MediaType.parseMediaType("application/manifest+json"));
    }

    /** 로컬 개발(`frontend/`)과 운영 단일 JAR(`classpath:/static/`) 모두에서 정적 파일을 찾고 ETag를 부여함 */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/Assets/**")
                .addResourceLocations(
                        fileResourceLocation("./frontend/Assets"),
                        fileResourceLocation("../frontend/Assets"),
                        "classpath:/static/Assets/"
                )
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(7)).cachePublic())
                .setUseLastModified(true)
                .setEtagGenerator(WebConfig::computeWeakMetadataEtag);

        registry.addResourceHandler("/**")
                .addResourceLocations(
                        fileResourceLocation("./frontend"),
                        fileResourceLocation("../frontend"),
                        "classpath:/static/"
                )
                .setCacheControl(CacheControl.noCache())
                .setUseLastModified(true)
                .setEtagGenerator(WebConfig::computeWeakMetadataEtag);
    }

    /** 파일 바이트 전체를 읽지 않고 수정 시각과 크기만으로 초경량 Weak ETag(`W/"..."`)를 생성함 */
    private static String computeWeakMetadataEtag(Resource resource) {
        try {
            long lastModified = resource.lastModified();
            long contentLength = resource.contentLength();
            return "W/\"" + Long.toHexString(lastModified) + "-" + Long.toHexString(contentLength) + "\"";
        } catch (IOException ex) {
            return "";
        }
    }

    /** 루트(`/`) 접속 시 302 리다이렉트 없이 `/index.html`로 포워딩함 (`?hospital=...` 쿼리 유지) */
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/").setViewName("forward:/index.html");
    }

    /** `/api/**` 요청에 대해 읽기 전용 메서드(`GET`, `OPTIONS`) 및 ETag·레이트리밋 헤더 노출을 허용함 */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
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
                .exposedHeaders("ETag", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After")
                .maxAge(3600);
    }

    /** 실행 위치와 무관하게 정규화된 절대 `file:///` URI를 만들어 한글 파일명 서빙 오류를 예방함 */
    private static String fileResourceLocation(String relativeDir) {
        String uri = Path.of(relativeDir).toAbsolutePath().normalize().toUri().toString();
        return uri.endsWith("/") ? uri : uri + "/";
    }
}
