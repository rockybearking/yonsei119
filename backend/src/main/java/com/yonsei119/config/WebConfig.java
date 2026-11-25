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
 * [역할 및 실행 시점]
 * - 역할: 프론트엔드 정적 파일(HTML/CSS/JS/로고 SVG) 서빙, 루트(`/`) 연결, ETag 캐시, CORS 정책을 세팅하는 웹 안내 데스크 설정 클래스
 * - 실행 시점: 서버 부팅 시 `@Configuration` 빈으로 등록되어 스프링 MVC 초기화 단계에 4개 설정 메서드가 1회씩 자동 실행됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   브라우저 HTTP 요청 도착
 *   ├── GET `/`                        ──> addViewControllers() ──> `/index.html`로 내부 포워딩 (주소창·딥링크 쿼리 유지)
 *   ├── GET `/Assets/**`               ──> addResourceHandlers() ──> 7일 공용 캐시 + Weak ETag(304 재검증) 서빙
 *   ├── GET `/*.js`, `/*.css`, `/sw.js` ──> addResourceHandlers() ──> `no-cache` + Weak ETag 서빙 (코드 수정 즉시 반영)
 *   ├── GET `/manifest.webmanifest`    ──> configureContentNegotiation() ──> `application/manifest+json` MIME 매핑
 *   └── GET/OPTIONS `/api/**`          ──> addCorsMappings() ──> 허용 도메인·헤더 검사 후 응답 헤더 부착
 *
 * [내장 / 프레임워크 구분]
 * - Java 표준 내장: Path(java.nio.file), Duration(java.time), Arrays(java.util), IOException
 * - Spring 프레임워크: @Configuration, WebMvcConfigurer, ResourceHandlerRegistry, CacheControl, MediaType, Resource
 *
 * [사용처 및 IDE 추적 가이드]
 * - 연동 파일: frontend/index.html, frontend/sw.js, frontend/Assets/universities/*, SecurityHeadersFilter
 * - 테스트 검증처: Yonsei119BackendTests.testRootStaticResourcesAndSecurityHeaders() (Test 13)
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final Yonsei119Properties properties;

    public WebConfig(Yonsei119Properties properties) {
        this.properties = properties;
    }

    /** `.webmanifest` 확장자가 `nosniff` 보안 환경에서도 표준 PWA 매니페스트 MIME 타입으로 응답되도록 등록함 */
    @Override
    public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
        configurer.mediaType("webmanifest", MediaType.parseMediaType("application/manifest+json"));
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 로컬 개발(`frontend/`)과 운영 단일 JAR(`classpath:/static/`) 모두에서 정적 리소스를 찾고 Weak ETag를 부여함
     * - 흐름:
     *   파일 탐색(1순위 `./frontend` ──> 2순위 `../frontend` ──> 3순위 `classpath:/static/`)
     *   ──> computeWeakMetadataEtag()로 수정시각·크기 기반 ETag 생성 ──> 변경 없으면 HTTP 304 Not Modified 반환
     */
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

    /** 파일 전체 바이트를 매번 읽지 않고 최종 수정 시각과 바이트 크기만으로 초경량 Weak ETag(`W/"..."`)를 생성함 */
    private static String computeWeakMetadataEtag(Resource resource) {
        try {
            long lastModified = resource.lastModified();
            long contentLength = resource.contentLength();
            return "W/\"" + Long.toHexString(lastModified) + "-" + Long.toHexString(contentLength) + "\"";
        } catch (IOException ex) {
            return "";
        }
    }

    /** 루트 경로(`/`) 접속 시 리다이렉트(302) 없이 서버 내부에서 `/index.html`로 즉시 연결함 (`?hospital=...` 공유 링크 보존) */
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/").setViewName("forward:/index.html");
    }

    /** `/api/**` 엔드포인트에 대해 읽기 전용 메서드(`GET`, `OPTIONS`)와 ETag·레이트리밋 응답 헤더 노출을 허용함 */
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

    /** 작업 디렉터리가 루트이든 `backend/`이든 `../` 없이 정규화된 절대 `file:///` 경로를 만들어 한글 파일명 서빙 오류를 방지함 */
    private static String fileResourceLocation(String relativeDir) {
        String uri = Path.of(relativeDir).toAbsolutePath().normalize().toUri().toString();
        return uri.endsWith("/") ? uri : uri + "/";
    }
}
