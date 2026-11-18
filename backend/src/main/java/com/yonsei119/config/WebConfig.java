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
 * [자바 문법]
 * - package : 웹 설정 클래스가 속한 패키지(com.yonsei119.config) 선언문임.
 * - import : 스프링 MVC 설정 인터페이스·레지스트리·캐시 도구와 자바 입출력·시간·배열 도구를 가져오는 선언문임.
 *
 * [패키지명]
 * - com.yonsei119.config : 전역 설정·웹 MVC 구성·서블릿 필터 패키지명임.
 *
 * [자바/스프링 내장 타입 (이름 변경 불가)]
 * - WebMvcConfigurer (출처: org.springframework.web.servlet.config.annotation 패키지)
 *   · 역할 : 스프링 부트 기본 웹 MVC 설정을 유지하면서 정적 리소스·뷰·CORS 규칙을 확장할 때 구현하는 인터페이스임.
 * - ContentNegotiationConfigurer, CorsRegistry, ResourceHandlerRegistry, ViewControllerRegistry (스프링 MVC)
 *   · 역할 : 각 웹 MVC 설정 영역의 URL 매핑 규칙을 등록하는 설정 도우미 클래스들임.
 * - Resource (출처: org.springframework.core.io 패키지) : 로컬 파일이나 JAR 내부 자원을 같은 방식으로 다루는 인터페이스임.
 * - CacheControl, MediaType (출처: org.springframework.http 패키지) : HTTP 캐시 헤더 생성기 및 MIME 타입 클래스임.
 * - IOException (출처: java.io 패키지) : 파일 읽기 등 입출력 실패 시 발생하는 예외 클래스임.
 * - Duration (출처: java.time 패키지) : 일·시간·초 같은 시간 길이를 표현하는 불변 클래스임.
 * - Arrays (출처: java.util 패키지) : 배열을 스트림 변환·정렬·비교할 때 쓰는 정적 유틸리티 클래스임.
 */

@Configuration
public class WebConfig implements WebMvcConfigurer {
/*
 * [스프링 내장 어노테이션]
 * - @Configuration 정의 (출처: org.springframework.context.annotation.Configuration, 이름 변경 불가)
 *   · 역할 : 스프링 설정 정보와 웹·빈 구성을 담고 있는 설정 전용 클래스임을 스프링 컨테이너에 알리는 어노테이션임.
 * - @Configuration 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 WebConfig 클래스
 *   · 작동 원리 : 부팅 시 WebConfig를 스프링 설정 빈으로 등록해 WebMvcConfigurer 재정의 메서드들이 자동 실행되게 함.
 *   · 비교 : 일반 빈 @Component, 서비스 @Service, 저장소 @Repository, REST 컨트롤러 @RestController가 있음.
 *
 * [자바 문법]
 * - public class ... implements : 공개 클래스를 선언하고 WebMvcConfigurer 인터페이스의 약속 메서드를 구현함.
 *   · 비교 : 클래스 단일 상속(extends)과 달리 인터페이스는 여러 개를 동시에 implements 가능함.
 *
 * [클래스명]
 * - WebConfig : 정적 파일 서빙, 루트('/') 포워딩, webmanifest MIME 매핑, /api/** CORS 정책을 담당하는 설정 클래스명임.
 *
 * [동작 흐름]
 * - 호출 출처 : 서버 기동 시 스프링 MVC 자동 설정이 WebConfig의 설정 메서드 4개를 순서대로 호출함.
 * - 흐름 : ContentNegotiation ──> ResourceHandlers ──> ViewControllers ──> CorsMappings 순서로 규칙 등록.
 * - 전달 대상 : 등록된 규칙은 이후 모든 정적 파일 및 API 요청을 DispatcherServlet이 처리할 때 적용됨.
 */

    private final Yonsei119Properties properties;
    /*
     * [자바 문법]
     * - private : WebConfig 클래스 내부에서만 읽고 쓸 수 있게 숨기는 접근 제어자임.
     * - final : 생성자에서 한 번 초기화한 뒤 다른 값으로 바꿀 수 없게 고정하는 예약어임.
     *
     * [프로젝트 내부 정의 타입]
     * - Yonsei119Properties (출처: com.yonsei119.config 패키지) : application.yml의 yonsei119.* 설정을 담은 record 빈임.
     *
     * [필드명 (멤버 변수)]
     * - properties : addCorsMappings()에서 CORS 허용 출처 설정을 읽기 위해 보관하는 멤버 필드임.
     */

    public WebConfig(Yonsei119Properties properties) {
    /*
     * [자바 문법]
     * - public WebConfig(...) : 클래스명과 같고 반환 타입이 없는 생성자 선언임.
     *   · 특징 : 생성자가 1개뿐이므로 스프링이 @Autowired 없이도 매개변수 빈을 자동 주입함.
     *
     * [생성자 및 매개변수명]
     * - 생성자명 : WebConfig.
     * - 매개변수명 : properties (스프링 컨테이너가 주입하는 Yonsei119Properties 빈).
     */
        this.properties = properties;
        /*
         * [자바 문법]
         * - this.properties = properties : 왼쪽 this.properties(멤버 필드)에 오른쪽 매개변수 참조를 저장함.
         *
         * [동작 흐름]
         * - 호출 출처 : 스프링 컨테이너가 WebConfig 빈을 생성할 때 호출함.
         * - 흐름 : 주입된 Yonsei119Properties 빈 ──> this.properties 멤버 필드에 저장.
         * - 전달 대상 : 이후 addCorsMappings() 실행 시 this.properties.cors()를 통해 CORS 패턴을 조회함.
         */
    }

    @Override
    public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
    /*
     * [자바 내장 어노테이션]
     * - @Override 정의 (출처: java.lang.Override, 이름 변경 불가)
     *   · 역할 : 부모 클래스나 인터페이스의 메서드를 재정의할 때 이름·매개변수·반환 타입이 일치하는지 컴파일러가 검사하게 하는 어노테이션임.
     * - @Override 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 WebConfig.configureContentNegotiation(ContentNegotiationConfigurer) 메서드
     *   · 작동 원리 : WebMvcConfigurer 인터페이스의 메서드 시그니처와 일치하는지 컴파일러가 검사해 오타를 막음.
     *   · 비교 : @Deprecated(사용 중단 표시), @SuppressWarnings(컴파일 경고 억제), @FunctionalInterface가 있음.
     *
     * [자바 문법]
     * - public void : 외부에서 호출 가능하며 반환값이 없는 메서드 선언임.
     *
     * [스프링 내장 타입 및 메서드 (이름 변경 불가)]
     * - ContentNegotiationConfigurer : URL 확장자별 미디어 타입 매핑 전략을 등록하는 스프링 MVC 클래스임.
     * - configureContentNegotiation : WebMvcConfigurer 인터페이스에 정의된 고정 콜백 메서드명임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : configureContentNegotiation (인터페이스 규약상 이름 변경 불가).
     * - 매개변수명 : configurer (미디어 타입 매핑을 등록할 설정 객체).
     */
        configurer.mediaType("webmanifest", MediaType.parseMediaType("application/manifest+json"));
        /*
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - configurer.mediaType(String extension, MediaType mediaType) : 파일 확장자에 대응하는 HTTP Content-Type을 등록함.
         * - MediaType.parseMediaType(String mediaType) : MIME 타입 문자열을 파싱해 MediaType 객체로 만드는 정적 메서드임.
         *
         * [동작 흐름]
         * - 호출 출처 : 스프링 MVC 초기화 시 configureContentNegotiation(configurer) 실행.
         * - 흐름 : "webmanifest" 확장자 ──> "application/manifest+json" 매핑 표에 추가.
         * - 전달 대상 : /manifest.webmanifest 요청 시 정확한 MIME 타입이 응답되어 nosniff 환경에서도 PWA가 정상 동작함.
         */
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
    /*
     * [자바 내장 어노테이션]
     * - @Override 정의 (출처: java.lang.Override, 이름 변경 불가)
     *   · 역할 : 부모 클래스나 인터페이스의 메서드를 재정의할 때 이름·매개변수·반환 타입이 일치하는지 컴파일러가 검사하게 하는 어노테이션임.
     * - @Override 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 WebConfig.addResourceHandlers(ResourceHandlerRegistry) 메서드
     *   · 작동 원리 : WebMvcConfigurer 인터페이스의 메서드 시그니처와 일치하는지 컴파일러가 검사해 오타를 막음.
     *   · 비교 : @Deprecated(사용 중단 표시), @SuppressWarnings(컴파일 경고 억제), @FunctionalInterface가 있음.
     *
     * [자바 문법]
     * - public void : 반환값 없는 공개 오버라이드 메서드 선언임.
     *
     * [스프링 내장 타입 및 메서드 (이름 변경 불가)]
     * - ResourceHandlerRegistry : 정적 파일 URL 패턴과 실제 파일 경로를 연결하는 스프링 MVC 등록 클래스임.
     * - addResourceHandlers : WebMvcConfigurer 인터페이스에 선언된 정적 리소스 등록 메서드명임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : addResourceHandlers (인터페이스 규약상 이름 변경 불가).
     * - 매개변수명 : registry (정적 리소스 규칙을 추가할 레지스트리).
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
         * [자바 문법]
         * - 메서드 체이닝 : 메서드 반환 객체에 점(.)을 이어 붙여 옵션을 연속 설정하는 문법임.
         * - :: (메서드 참조) : r -> computeWeakMetadataEtag(r) 람다식을 WebConfig::computeWeakMetadataEtag로 줄여 쓴 문법임.
         *
         * [자바/스프링 내장 메서드 (이름 변경 불가)]
         * - registry.addResourceHandler(String... pathPatterns) : 정적 파일을 연결할 요청 URL 패턴을 등록함.
         * - .addResourceLocations(String... locations) : 파일을 찾을 디스크·JAR 경로 목록을 등록함 (앞 경로가 우선함).
         * - .setCacheControl(CacheControl) : HTTP Cache-Control 응답 헤더 정책을 지정함.
         * - CacheControl.maxAge(Duration).cachePublic() : 지정 기간 동안 브라우저·공용 캐시 재사용을 허용함.
         *   · 형제 옵션 : CacheControl.noStore(), .mustRevalidate() 등이 있음.
         * - Duration.ofDays(long days) (출처: java.time 패키지) : 지정한 일수만큼의 시간 간격 객체를 만듦.
         * - CacheControl.noCache() : 캐시에 저장은 하되 매번 ETag·Last-Modified로 서버에 변경 여부를 다시 확인하게 함.
         * - .setUseLastModified(true) : 파일 수정 시각 기반 Last-Modified 헤더 및 If-Modified-Since 검사를 켬.
         * - .setEtagGenerator(Function<Resource, String>) : 정적 리소스마다 ETag 문자열을 만드는 함수를 연결함.
         *
         * [프로젝트 내부 호출 메서드]
         * - WebConfig::computeWeakMetadataEtag : 파일 수정 시각과 크기만으로 가벼운 Weak ETag를 생성하는 정적 헬퍼 메서드임.
         *
         * [동작 흐름]
         * - 호출 출처 : 브라우저가 정적 이미지(GET /Assets/...) 또는 웹 앱 파일(GET /js/app.js)을 요청할 때 실행됨.
         * - 흐름 :
         *   ├── /Assets/** 요청 ──> 7일 공용 캐시 + Weak ETag 적용
         *   ├── 그 외 /** (HTML/CSS/JS/PWA) ──> CacheControl.noCache() + Weak ETag 적용 (코드 수정 즉시 반영)
         *   └── 파일 탐색 순서 : 1순위 ./frontend/ ──> 2순위 ../frontend/ ──> 3순위 classpath:/static/ (JAR 내부)
         * - 반환값 : 파일 변경 없음이면 HTTP 304 Not Modified, 변경됨 또는 첫 요청이면 HTTP 200 OK와 파일 본문을 반환함.
         */
    }

    private static String computeWeakMetadataEtag(Resource resource) {
    /*
     * [자바 문법]
     * - private static : 클래스 내부에서만 쓰며 객체 생성 없이 호출 가능한 정적 헬퍼 메서드 선언임.
     *
     * [자바/스프링 내장 타입 (이름 변경 불가)]
     * - String (출처: java.lang 패키지) : 생성된 ETag 문자열 반환 타입임.
     * - Resource (출처: org.springframework.core.io 패키지) : 정적 파일 리소스 추상 타입임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : computeWeakMetadataEtag.
     * - 매개변수명 : resource (ETag를 만들 대상 정적 파일 객체).
     */
        try {
            long lastModified = resource.lastModified();
            long contentLength = resource.contentLength();
            return "W/\"" + Long.toHexString(lastModified) + "-" + Long.toHexString(contentLength) + "\"";
        } catch (IOException ex) {
            return "";
        }
        /*
         * [자바 문법]
         * - try { ... } catch (IOException ex) { ... } : 파일 읽기 오류가 나면 프로그램이 멈추지 않고 빈 문자열을 돌려줌.
         * - long : 64비트 정수 기본형임.
         * - return : 계산한 Weak ETag 문자열 또는 ""을 호출한 쪽으로 돌려줌.
         * - \" : 문자열 안에 큰따옴표(") 문자를 넣기 위한 이스케이프 표기임.
         *
         * [자바/스프링 내장 타입 및 메서드 (이름 변경 불가)]
         * - IOException (출처: java.io 패키지) : 파일 메타데이터 읽기 실패 시 발생하는 예외 클래스임.
         * - Resource.lastModified() : 파일의 마지막 수정 시각(밀리초 long)을 읽는 메서드임.
         * - Resource.contentLength() : 파일 크기(바이트 수 long)를 읽는 메서드임.
         * - Long.toHexString(long) (출처: java.lang 패키지) : 10진수 long 숫자를 16진수 소문자 문자열로 바꿈.
         *
         * [지역 변수명]
         * - lastModified : 파일 최종 수정 시각(밀리초) 저장 변수.
         * - contentLength : 파일 바이트 크기 저장 변수.
         * - ex : catch 블록에서 잡은 IOException 예외 객체 변수.
         *
         * [동작 흐름]
         * - 호출 출처 : 정적 파일 요청 시 ResourceHttpRequestHandler가 ETag 생성 콜백으로 호출함.
         * - 흐름 :
         *   ├── 정상 읽기 ──> 수정 시각 + 파일 크기를 16진수 변환 ──> 'W/"수정시각-크기"' 문자열 반환
         *   └── IOException 발생 ──> 빈 문자열 "" 반환으로 서버 오류 방지
         * - 전달 대상 : 응답 ETag 헤더 기록 및 다음 요청의 If-None-Match 비교(304 판정)에 사용됨.
         */
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
    /*
     * [자바 내장 어노테이션]
     * - @Override 정의 (출처: java.lang.Override, 이름 변경 불가)
     *   · 역할 : 부모 클래스나 인터페이스의 메서드를 재정의할 때 이름·매개변수·반환 타입이 일치하는지 컴파일러가 검사하게 하는 어노테이션임.
     * - @Override 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 WebConfig.addViewControllers(ViewControllerRegistry) 메서드
     *   · 작동 원리 : WebMvcConfigurer 인터페이스의 메서드 시그니처와 일치하는지 컴파일러가 검사해 오타를 막음.
     *   · 비교 : @Deprecated(사용 중단 표시), @SuppressWarnings(컴파일 경고 억제), @FunctionalInterface가 있음.
     *
     * [자바 문법]
     * - public void : 반환값 없는 공개 오버라이드 메서드 선언임.
     *
     * [스프링 내장 타입 및 메서드 (이름 변경 불가)]
     * - ViewControllerRegistry : 별도 컨트롤러 없이 단순 URL과 뷰를 연결할 때 쓰는 스프링 MVC 레지스트리임.
     * - addViewControllers : WebMvcConfigurer 인터페이스에 정의된 고정 메서드명임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : addViewControllers (인터페이스 규약상 이름 변경 불가).
     * - 매개변수명 : registry (뷰 연결 규칙을 등록할 레지스트리).
     */
        registry.addViewController("/").setViewName("forward:/index.html");
        /*
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - registry.addViewController(String urlPath) : 지정한 URL 경로를 처리할 뷰 컨트롤러 설정 빌더를 돌려줌.
         * - .setViewName(String viewName) : urlPath로 지정한 경로 요청 시 이동할 뷰 이름을 지정함.
         *   · "forward:/..." : 서버 내부에서 조용히 전달해 주소창 URL과 쿼리 파라미터가 그대로 유지됨.
         *   · 형제 방식("redirect:/...") : 브라우저에 302 응답을 보내 주소창 URL이 바뀌고 요청을 1번 더 보냄.
         *
         * [동작 흐름]
         * - 호출 출처 : 사용자가 http://localhost:8080/ 또는 공유 링크(/?hospital=A2200001)로 GET 요청 전송.
         * - 흐름 : 루트('/') 요청 수신 ──> 서버 내부에서 /index.html 정적 핸들러로 포워딩.
         * - 반환값 : 주소창과 쿼리 파라미터를 유지한 채 frontend/index.html 본문을 HTTP 200 OK로 응답함.
         */
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
    /*
     * [자바 내장 어노테이션]
     * - @Override 정의 (출처: java.lang.Override, 이름 변경 불가)
     *   · 역할 : 부모 클래스나 인터페이스의 메서드를 재정의할 때 이름·매개변수·반환 타입이 일치하는지 컴파일러가 검사하게 하는 어노테이션임.
     * - @Override 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 WebConfig.addCorsMappings(CorsRegistry) 메서드
     *   · 작동 원리 : WebMvcConfigurer 인터페이스의 메서드 시그니처와 일치하는지 컴파일러가 검사해 오타를 막음.
     *   · 비교 : @Deprecated(사용 중단 표시), @SuppressWarnings(컴파일 경고 억제), @FunctionalInterface가 있음.
     *
     * [자바 문법]
     * - public void : 반환값 없는 공개 오버라이드 메서드 선언임.
     *
     * [스프링 내장 타입 및 메서드 (이름 변경 불가)]
     * - CorsRegistry : URL 패턴별로 교차 출처(CORS) 허용 규칙을 등록하는 스프링 MVC 레지스트리임.
     * - addCorsMappings : WebMvcConfigurer 인터페이스에 정의된 고정 메서드명임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : addCorsMappings (인터페이스 규약상 이름 변경 불가).
     * - 매개변수명 : registry (CORS 정책을 등록할 레지스트리).
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
         * [자바 문법]
         * - &&, !=, 논리 부정(!s.isEmpty()) : 단락 논리곱(앞이 false면 뒤 생략), 불일치 비교, 참/거짓 반전 연산자임.
         * - ? : : 조건에 따라 두 값 중 하나를 고르는 삼항 연산자임 (null 방어 및 빈 배열 기본값 처리).
         * - String[], new String[]{"*"} : 문자열 배열 타입 선언 및 초기값 생성 문법임.
         * - s -> !s.isEmpty() : 빈 문자열을 걸러내는 조건을 전달하는 람다식임.
         * - String::trim, String[]::new : 문자열 앞뒤 공백 제거 메서드 참조 및 새 String[] 배열 생성자 참조임.
         * - patterns.length : 자바 배열이 기본으로 제공하는 길이 읽기 속성임.
         *
         * [자바/스프링 내장 타입 및 메서드 (이름 변경 불가)]
         * - String, String[] (출처: java.lang 패키지).
         * - String.split(String regex) : 지정한 구분자(,)로 문자열을 잘라 String[] 배열을 반환함.
         * - Arrays.stream(T[]) (출처: java.util 패키지) : 배열을 Stream 파이프라인으로 변환하는 정적 메서드임.
         * - .map(...), .filter(...), .toArray(...) : 요소 변환·조건 걸러내기·배열 수집용 표준 Stream 메서드임.
         * - String.trim(), String.isEmpty() : 문자열 앞뒤 공백 제거 및 길이가 0인지 확인하는 메서드임.
         * - registry.addMapping(String pathPattern) : CORS 규칙을 적용할 URL 경로 패턴을 지정함.
         * - .allowedOriginPatterns(...), .allowedMethods(...) : 허용할 출처(도메인) 패턴과 HTTP 메서드를 지정함.
         * - .allowedHeaders(...), .maxAge(long seconds) : 허용할 요청 헤더 목록과 사전 확인(Preflight) 캐시 초를 지정함.
         *
         * [프로젝트 내부 호출 메서드]
         * - properties.cors(), properties.cors().allowedOriginPatterns() : application.yml의 yonsei119.cors.* 값을 읽는 조회 메서드임.
         *
         * [지역 변수명]
         * - rawPatterns : 설정에서 읽은 원본 허용 출처 문자열 (미설정 시 "*").
         * - patterns : 콤마 분리 및 공백·빈 항목 제거를 마친 허용 출처 배열.
         * - s : filter 람다 내부에서 각 출처 문자열을 가리키는 변수.
         *
         * [동작 흐름]
         * - 호출 출처 : 부팅 시 CORS 규칙을 등록하며, 런타임에는 다른 도메인/포트의 /api/** 요청 시 CorsFilter가 검사함.
         * - 흐름 :
         *   1) rawPatterns 획득 (null이면 "*") ──> split(",") ──> trim ──> 빈 문자열 제거 ──> patterns 배열 생성
         *   2) /api/** 경로 등록 ──> 허용 출처(비어 있으면 {"*"}) ──> GET·OPTIONS만 허용 ──> 헤더 4종 및 3600초 캐시 적용
         * - 반환값 : 조건에 맞는 요청에는 Access-Control-Allow-* 헤더를 붙이고, POST·DELETE 등은 CORS 단계에서 차단함.
         */
    }
}
