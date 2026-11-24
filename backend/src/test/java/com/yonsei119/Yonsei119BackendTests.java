package com.yonsei119;

import com.yonsei119.config.ApiRateLimitFilter;
import com.yonsei119.config.SecurityHeadersFilter;
import com.yonsei119.config.Yonsei119Properties;
import com.yonsei119.controller.EmergencyApiController;
import com.yonsei119.dto.DirectionsResponseDto;
import com.yonsei119.dto.EmergencySnapshotDto;
import com.yonsei119.dto.FrontendConfigDto;
import com.yonsei119.dto.GeocodeResponseDto;
import com.yonsei119.dto.HospitalDto;
import com.yonsei119.dto.HospitalEtaRankDto;
import com.yonsei119.dto.HospitalTypeDto;
import com.yonsei119.dto.ReverseGeocodeResponseDto;
import com.yonsei119.service.EmergencyDataService;
import com.yonsei119.service.HospitalClassifier;
import com.yonsei119.service.HospitalRecommendationScorer;
import com.yonsei119.service.NaverDirectionsService;
import com.yonsei119.service.NaverGeocodingService;
import com.yonsei119.service.NmcOpenApiClient;
import com.yonsei119.util.BoundedTtlCache;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
/*
 * [패키지명]
 * - com.yonsei119 : 메인 앱(Yonsei119Application)과 같은 루트 패키지임.
 *   · 같은 패키지 권한으로 package-private 테스트 클래스에서 백엔드 빈을 검증함.
 *
 * [자바 문법]
 * - package (키워드) : Yonsei119BackendTests.java 파일이 속한 패키지 경로를 선언함.
 * - import (키워드) : 다른 패키지의 클래스·정적 단언 메서드·외부 타입을 짧은 이름으로 불러옴.
 * - import static (키워드) : Assertions의 정적 검증 메서드를 클래스명 없이 바로 호출함.
 *
 * [프로젝트 내부 타입]
 * - 컨트롤러 : EmergencyApiController (com.yonsei119.controller)
 * - DTO : DirectionsResponseDto, EmergencySnapshotDto, FrontendConfigDto, GeocodeResponseDto
 *   · HospitalDto, HospitalEtaRankDto, HospitalTypeDto, ReverseGeocodeResponseDto 포함
 * - 서비스·유틸 : EmergencyDataService, HospitalClassifier, HospitalRecommendationScorer
 *   · NaverDirectionsService, NaverGeocodingService, NmcOpenApiClient, BoundedTtlCache 포함
 *
 * [자바 표준 내장 타입 (이름 변경 불가)]
 * - HttpClient, HttpRequest, HttpResponse (java.net.http) : HTTP 요청·응답 처리용 Java 11+ 표준 API임.
 * - URI (java.net) : URL 문자열을 인터넷 주소 객체로 변환하는 표준 타입임.
 * - ByteArrayInputStream, GZIPInputStream : 바이트 배열을 스트림으로 감싸 GZIP 압축을 해제함.
 * - StandardCharsets (java.nio.charset) : UTF-8 등 표준 문자 인코딩 상수를 제공함.
 * - List<E>, Map<K, V> (java.util) : 순서 있는 목록과 키-값 쌍을 다루는 표준 컬렉션임.
 *
 * [JUnit 내장 단언 메서드 (org.junit.jupiter.api.Assertions)]
 * - assertEquals, assertTrue, assertFalse, assertNotNull, assertNull (이름 변경 불가)
 *   · 실제 결과와 기댓값이 다르면 AssertionError를 던져 테스트를 실패 처리함.
 */

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "yonsei119.nemc.auto-refresh-enabled=false",
                "yonsei119.nemc.service-key=",
                "yonsei119.naver.client-secret="
        }
)
class Yonsei119BackendTests {
/*
 * [스프링 내장 어노테이션]
 * - @SpringBootTest 정의 (출처: org.springframework.boot.test.context.SpringBootTest, 이름 변경 불가)
 *   · 역할 : 실제 운영 환경과 동일하게 전체 스프링 애플리케이션 컨텍스트와 빈들을 로드하여 통합 테스트를 수행하는 어노테이션임.
 * - @SpringBootTest(webEnvironment = RANDOM_PORT, properties = {...}) 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 Yonsei119BackendTests 클래스
 *   · 작동 원리 : 전체 스프링 빈을 등록하고 임의 포트(RANDOM_PORT)로 내장 Tomcat 서버를 띄워 통합 테스트함.
 *   · 속성 동작 : properties 설정으로 테스트 실행 동안만 백그라운드 스케줄과 외부 키 값을 안전하게 덮어씀.
 *   · 비교 : @WebMvcTest는 웹 계층만 띄우고 서비스는 @MockitoBean으로 대체하며, MOCK 환경은 포트를 열지 않음.
 *   · 포트 비교 : DEFINED_PORT는 고정 포트를 써 병렬 실행 시 충돌할 수 있으나 RANDOM_PORT는 빈 포트를 배정함.
 *
 * [자바 문법]
 * - class (키워드) : 테스트 메서드를 담는 클래스를 선언함.
 *   · JUnit 5에서는 테스트 클래스와 메서드에 public을 생략한 package-private 선언을 권장함.
 *
 * [클래스명 및 프로젝트 테스트 설정]
 * - Yonsei119BackendTests : 분류·파싱·병합·추천·캐시·HTTP 서빙 13개 시나리오를 검증하는 통합 테스트 클래스임.
 * - yonsei119.nemc.auto-refresh-enabled=false : 테스트 중 NEMC 백그라운드 자동 갱신을 끔.
 * - yonsei119.naver.client-secret= : 네이버 비밀키를 비워 외부 유료 API 호출 없이 안전하게 격리 검증함.
 *
 * [테스트 실행 방법 및 결과]
 * - IntelliJ IDEA : 클래스 옆 초록색 실행 버튼 클릭 시 13개 전체 실행, 메서드 옆 클릭 시 1건만 실행됨.
 * - PowerShell : 루트 또는 backend 폴더에서 `.\gradlew.bat test --no-daemon` 실행함.
 *   · --no-daemon은 Gradle 백그라운드 프로세스를 남기지 않고 1회 실행 후 종료하는 옵션임.
 * - 실행 결과 : 13건 모두 통과 시 `BUILD SUCCESSFUL`(종료 코드 0), 1건이라도 실패 시 종료 코드 1 반환함.
 *
 * [동작 흐름]
 * - 테스트 시작 -> @SpringBootTest가 전체 빈과 내장 Tomcat(임의 포트) 기동
 *   ├── Test 1~12 : 분류·XML/JSON 파싱·병합·추천·LRU 캐시 등 서비스/컨트롤러 검증
 *   └── Test 13 : HttpClient로 실제 HTTP·GZIP·보안 헤더·ETag 304 종단간 검증
 */

    @LocalServerPort
    private int port;

    @Autowired
    private HospitalClassifier hospitalClassifier;

    @Autowired
    private NmcOpenApiClient nmcOpenApiClient;

    @Autowired
    private EmergencyDataService emergencyDataService;

    @Autowired
    private HospitalRecommendationScorer recommendationScorer;

    @Autowired
    private NaverDirectionsService naverDirectionsService;

    @Autowired
    private NaverGeocodingService naverGeocodingService;

    @Autowired
    private EmergencyApiController emergencyApiController;

    @Autowired
    private Environment environment;
    /*
     * [스프링 내장 어노테이션]
     * - @LocalServerPort 정의 (출처: org.springframework.boot.test.web.server.LocalServerPort, 이름 변경 불가)
     *   · 역할 : 통합 테스트에서 임의 포트(RANDOM_PORT)로 기동된 내장 웹 서버의 실제 포트 번호를 필드에 주입해 주는 어노테이션임.
     * - @LocalServerPort 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 port (int) 필드
     *   · 작동 원리 : RANDOM_PORT로 기동된 내장 Tomcat의 실제 바인딩 포트 번호를 테스트 실행 전에 주입함.
     *   · 비교 : @Value("${local.server.port}")와 동일하게 동작하는 스프링 부트 테스트 전용 축약형임.
     * - @Autowired 정의 (출처: org.springframework.beans.factory.annotation.Autowired, 이름 변경 불가)
     *   · 역할 : 스프링 컨테이너에 등록된 빈 중에서 타입이 일치하는 객체를 찾아 필드·생성자·메서드에 자동 의존성 주입(DI)해 주는 어노테이션임.
     * - @Autowired 현재 코드 적용
     *   · 적용 대상 (1/2) : hospitalClassifier, nmcOpenApiClient, emergencyDataService, recommendationScorer 필드
     *   · 적용 대상 (2/2) : naverDirectionsService, naverGeocodingService, emergencyApiController 필드 (총 7개)
     *   · 작동 원리 : 스프링 컨테이너가 타입에 맞는 실제 빈 인스턴스를 찾아 리플렉션으로 필드에 자동 주입(DI)함.
     *   · 비교 : 가짜 객체를 끼우는 @MockitoBean과 다르며, 같은 타입 빈이 여럿일 때 @Qualifier로 구분함.
     *
     * [자바 문법]
     * - private (키워드) : Yonsei119BackendTests 클래스 내부에서만 필드에 접근하도록 제한함.
     * - int (키워드) : 동적으로 할당된 서버 포트 번호를 담는 32비트 정수 기본형임.
     *
     * [프로젝트 내부 타입 및 필드명]
     * - port (int) : 테스트 웹 서버가 배정받은 포트 번호를 보관하며 Test 13의 URL 조립에 씀.
     * - hospitalClassifier (HospitalClassifier) : 병원 4종 분류 규칙 검증 대상 빈임.
     * - nmcOpenApiClient (NmcOpenApiClient) : NEMC XML 파싱 및 Hot/Cold 맵 검증 대상 빈임.
     * - emergencyDataService (EmergencyDataService) : 7종 병합 및 장애 폴백 검증 대상 빈임.
     * - recommendationScorer (HospitalRecommendationScorer) : 차단 공지 판별 검증 대상 빈임.
     * - naverDirectionsService (NaverDirectionsService) : 길찾기 파싱 및 ETA 순위 검증 대상 빈임.
     * - naverGeocodingService (NaverGeocodingService) : 역지오코딩·지오코딩 파싱 검증 대상 빈임.
     * - emergencyApiController (EmergencyApiController) : REST API 컨트롤러 응답 검증 대상 빈임.
     */

    @Test
    @DisplayName("1. 상급종합병원 / 권역응급의료센터 / 의료원 / 일반·기타 종별 분류가 정확히 동작해야 한다")
    void testHospitalClassification() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testHospitalClassification() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testHospitalClassification() 메서드를 1번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testHospitalClassification() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 테스트는 단언 성공 또는 예외 발생으로 판정하므로 반환값이 없음.
     *
     * [테스트 메서드명]
     * - testHospitalClassification : 상급종합·권역응급·의료원·일반/기타 종별 분류 정확도를 검증함.
     */
        Map<String, String> wonjuInfo = Map.of(
                "dutyname", "연세대학교원주세브란스기독병원",
                "dutyaddr", "강원특별자치도 원주시 일산로 20",
                "dutyemclsname", "권역응급의료센터"
        );
        HospitalTypeDto wonjuType = hospitalClassifier.classify(wonjuInfo, "연세대학교원주세브란스기독병원");
        assertEquals("tertiary", wonjuType.group());
        assertEquals("상급종합병원", wonjuType.label());
        assertTrue(hospitalClassifier.isRegional(wonjuInfo));

        Map<String, String> medicalInfo = Map.of(
                "dutyname", "강원특별자치도원주의료원",
                "dutyaddr", "강원특별자치도 원주시 서원대로 387",
                "dutyemclsname", "지역응급의료센터"
        );
        HospitalTypeDto medicalType = hospitalClassifier.classify(medicalInfo, "강원특별자치도원주의료원");
        assertEquals("medical", medicalType.group());
        assertEquals("의료원", medicalType.label());

        Map<String, String> otherInfo = Map.of(
                "dutyname", "원주성지병원",
                "dutyaddr", "강원특별자치도 원주시 원일로 67",
                "dutyemclsname", "지역응급의료기관"
        );
        HospitalTypeDto otherType = hospitalClassifier.classify(otherInfo, "원주성지병원");
        assertEquals("other", otherType.group());
        assertEquals("일반·기타 응급의료기관", otherType.label());
        /*
         * [자바/JUnit 내장 타입]
         * - Map<K, V> (java.util.Map, 이름 변경 불가) : 병원 속성 태그 키-값 쌍을 담는 표준 인터페이스임.
         * - String (java.lang.String, 이름 변경 불가) : 병원명·주소·종별 문자열을 다루는 표준 클래스임.
         *
         * [자바/JUnit 내장 메서드]
         * - Map.of(...) (이름 변경 불가) : 수정할 수 없는 불변 Map 객체를 생성함 (최대 10쌍 지원).
         * - assertEquals(expected, actual), assertTrue(cond) (이름 변경 불가) : 값 일치와 참 여부를 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - HospitalTypeDto : 분류 그룹("tertiary" 등)과 한글 라벨("상급종합병원" 등)을 담는 DTO임.
         * - hospitalClassifier.classify(...) : 병원 정보와 이름으로 종별 DTO를 판정함.
         * - hospitalClassifier.isRegional(...) : 권역응급의료센터 해당 여부를 boolean으로 반환함.
         * - wonjuType.group(), wonjuType.label() 등 : HospitalTypeDto 레코드의 필드 조회 메서드임.
         *
         * [지역 변수명]
         * - wonjuInfo, medicalInfo, otherInfo : 상급종합/권역, 의료원, 일반·기타 입력용 테스트 Map임.
         * - wonjuType, medicalType, otherType : classify()가 반환한 종별 결과 DTO 변수임.
         *
         * [동작 흐름]
         * - wonjuInfo(원주세브란스기독병원, 권역응급의료센터) -> classify()
         *   ├── 47개 상급종합병원 명단·시도 접두어 일치 -> group="tertiary", label="상급종합병원" 검증
         *   └── isRegional(wonjuInfo) -> 권역응급의료센터 문구 감지로 true 반환 검증
         * - medicalInfo(원주의료원) -> classify() -> "의료원" 규칙으로 group="medical" 검증
         * - otherInfo(원주성지병원) -> classify() -> 기본 규칙으로 group="other" 검증
         *
         * [검증 핵심]
         * - 원주세브란스기독병원이 상급종합과 권역응급으로 이중 인식되어 양쪽 필터에서 누락되지 않음을 보장함.
         */
    }

    @Test
    @DisplayName("2. XML 파싱 시 음수 병상 값(초과수용)과 미보고 빈 값을 0으로 왜곡하지 않고 그대로 보존해야 한다")
    void testXmlParsingPreservesOverflowAndBlankValues() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testXmlParsingPreservesOverflowAndBlankValues() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testXmlParsingPreservesOverflowAndBlankValues() 메서드를 2번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testXmlParsingPreservesOverflowAndBlankValues() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testXmlParsingPreservesOverflowAndBlankValues : 음수 병상과 빈 값이 0으로 바뀌지 않는지 검증함.
     */
        String sampleXml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <response>
                  <header>
                    <resultCode>00</resultCode>
                    <resultMsg>NORMAL SERVICE.</resultMsg>
                  </header>
                  <body>
                    <items>
                      <item>
                        <hpid>A2200001</hpid>
                        <dutyName>연세대학교원주세브란스기독병원</dutyName>
                        <hvec>-4</hvec>
                        <hvs01>30</hvs01>
                        <hv28></hv28>
                        <hvctayn>Y</hvctayn>
                        <hvoxyayn>N1</hvoxyayn>
                      </item>
                    </items>
                    <totalCount>1</totalCount>
                  </body>
                </response>
                """;

        NmcOpenApiClient.ParsedXmlPage parsed = nmcOpenApiClient.parseXmlResponse(
                sampleXml, "getEmrrmRltmUsefulSckbdInfoInqire"
        );
        assertEquals(1, parsed.totalCount());
        assertEquals(1, parsed.items().size());

        Map<String, String> item = parsed.items().getFirst();
        assertEquals("A2200001", item.get("hpid"));
        assertEquals("-4", item.get("hvec"));
        assertEquals("30", item.get("hvs01"));
        assertEquals("", item.get("hv28"));
        assertEquals("N1", item.get("hvoxyayn"));
        /*
         * [자바 문법]
         * - 텍스트 블록(""" ... """) : Java 15+ 여러 줄 문자열 문법으로 XML 샘플을 그대로 작성함.
         *
         * [자바/JUnit 내장 타입]
         * - String, Map<K, V> (이름 변경 불가) : XML 원문 문자열과 파싱된 태그 맵 표준 타입임.
         *
         * [자바/JUnit 내장 메서드]
         * - List.size(), List.get(0), Map.get(key) (이름 변경 불가) : 목록 길이, 첫 항목, 키 값을 조회함.
         * - assertEquals(expected, actual) (이름 변경 불가) : 파싱 건수와 문자열 값이 같은지 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - NmcOpenApiClient.ParsedXmlPage : 파싱 성공 여부, 전체 건수, 소문자 키 맵 목록을 담은 레코드임.
         * - nmcOpenApiClient.parseXmlResponse(xml, op) : XML 문자열을 DOM 파서로 읽어 레코드로 변환함.
         * - parsed.totalCount(), parsed.items() : ParsedXmlPage 레코드의 건수와 항목 목록 조회 메서드임.
         *
         * [지역 변수명]
         * - sampleXml : 정상 헤더(00)와 hvec(-4), hvs01(30), 빈 hv28, hvoxyayn(N1)을 담은 XML임.
         * - parsed : parseXmlResponse()가 반환한 ParsedXmlPage 결과 변수임.
         * - item : parsed.items().get(0)으로 꺼낸 첫 번째 병원 데이터 Map 변수임.
         *
         * [동작 흐름]
         * - sampleXml -> nmcOpenApiClient.parseXmlResponse()
         *   ├── XXE 차단 DOM 파서로 XML 파싱 및 태그명 소문자 통일 -> ParsedXmlPage 생성
         *   ├── totalCount() == 1, items().size() == 1 확인
         *   └── item.get() -> hvec="-4", hvs01="30", hv28="", hvoxyayn="N1" 원형 보존 검증
         *
         * [검증 핵심]
         * - 초과수용 음수(-4)나 미보고 빈 값("")을 0으로 왜곡하면 만실 상태를 오판하므로 무손실 보존함.
         */
    }

    @Test
    @DisplayName("3. 공공데이터포털 인증키 이중 인코딩 방지 및 Hot(3종)/Cold(4종) 오퍼레이션 분리가 정확해야 한다")
    void testServiceKeyEncodingAndHotColdSplit() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testServiceKeyEncodingAndHotColdSplit() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testServiceKeyEncodingAndHotColdSplit() 메서드를 3번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testServiceKeyEncodingAndHotColdSplit() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testServiceKeyEncodingAndHotColdSplit : 인증키 이중 인코딩 방지와 Hot/Cold 7종 분리를 검증함.
     */
        String encoded = "dummy%2Ftest%2BserviceKey1234567890abcdef%3D%3D";
        String decoded = "dummy/test+serviceKey1234567890abcdef==";

        assertEquals(encoded, NmcOpenApiClient.ensureUrlEncodedServiceKey(encoded));
        assertEquals(encoded, NmcOpenApiClient.ensureUrlEncodedServiceKey(decoded));

        assertEquals(4, NmcOpenApiClient.COLD_ENDPOINTS.size());
        assertEquals(3, NmcOpenApiClient.HOT_ENDPOINTS.size());
        assertEquals(7, NmcOpenApiClient.ENDPOINTS.size());
        assertTrue(NmcOpenApiClient.HOT_ENDPOINTS.containsKey("beds"));
        assertTrue(NmcOpenApiClient.COLD_ENDPOINTS.containsKey("list"));
        /*
         * [자바 문법]
         * - 클래스명.정적멤버 : 객체 생성 없이 static 메서드와 불변 Map 상수를 직접 호출·참조함.
         *
         * [자바/JUnit 내장 타입]
         * - String (java.lang.String, 이름 변경 불가) : 인코딩된 키와 평문 키를 담는 문자열 타입임.
         *
         * [자바/JUnit 내장 메서드]
         * - Map.size(), Map.containsKey(key) (이름 변경 불가) : 맵 항목 개수와 특정 키 포함 여부를 확인함.
         * - assertEquals, assertTrue (이름 변경 불가) : 인코딩 결과 일치와 맵 크기·키 포함 여부를 검증함.
         *
         * [프로젝트 내부 상수 및 메서드]
         * - NmcOpenApiClient.ensureUrlEncodedServiceKey(key) : '%' 유무를 확인해 필요 시 1회만 URL 인코딩함.
         * - NmcOpenApiClient.COLD_ENDPOINTS, HOT_ENDPOINTS, ENDPOINTS : Cold 4종, Hot 3종, 전체 7종 맵 상수임.
         *
         * [지역 변수명]
         * - encoded : 이미 URL 인코딩(%2F, %2B, %3D)된 공공데이터포털 Encoding 인증키 예시임.
         * - decoded : 특수문자(/, +, =)가 그대로 들어 있는 Decoding 평문 인증키 예시임.
         *
         * [동작 흐름]
         * - encoded -> ensureUrlEncodedServiceKey() -> '%' 감지로 재인코딩 없이 encoded 그대로 반환 검증
         * - decoded -> ensureUrlEncodedServiceKey() -> '%' 없음 감지로 1회 인코딩 후 encoded 일치 검증
         * - 정적 맵 확인 -> COLD_ENDPOINTS(4, "list" 포함) + HOT_ENDPOINTS(3, "beds" 포함) == ENDPOINTS(7)
         *
         * [검증 핵심]
         * - Encoding/Decoding 키 어느 쪽을 넣어도 인증 오류가 없고 7종 수집 대상이 누락·중복되지 않음.
         */
    }

    @Test
    @DisplayName("4. 7개 데이터셋 교차 병합, 경량 목록(?compact=true) 및 개별 상세(/api/hospitals/{hpid}) 분리가 정확해야 한다")
    void testDatasetCrossMergeAndCompactDetailSeparation() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testDatasetCrossMergeAndCompactDetailSeparation() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testDatasetCrossMergeAndCompactDetailSeparation() 메서드를 4번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testDatasetCrossMergeAndCompactDetailSeparation() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testDatasetCrossMergeAndCompactDetailSeparation : 7종 병합, 경량 목록과 상세 API 분리를 검증함.
     */
        try {
            Map<String, List<Map<String, String>>> rawDatasets = Map.of(
                    "list", List.of(
                            Map.of("hpid", "A2200001", "dutyname", "연세대학교원주세브란스기독병원", "wgs84lat", "37.31912", "wgs84lon", "127.94561", "dutyaddr", "강원특별자치도 원주시 일산로 20"),
                            Map.of("hpid", "INVALID01", "dutyname", "좌표오류병원", "wgs84lat", "0.0", "wgs84lon", "0.0")
                    ),
                    "basic", List.of(
                            Map.of("hpid", "A2200001", "dutyemclsname", "권역응급의료센터", "dutytel1", "033-741-0114", "dutytel3", "033-741-1119", "dutyetc", "매우 긴 약도 설명 원문 텍스트")
                    ),
                    "beds", List.of(
                            Map.of("hpid", "A2200001", "hvec", "-2", "hvs01", "30", "hv13", "1", "hvs46", "4", "hv999_unused", "raw")
                    ),
                    "messages", List.of(
                            Map.of("hpid", "A2200001", "symblkmsg", "소아응급 진료 가능", "symblkmsgtyp", "응급")
                    ),
                    "severe", List.of(
                            Map.of("hpid", "A2200001", "mkioskty1", "Y", "mkioskty28", "Y")
                    ),
                    "traumaList", List.of(
                            Map.of("hpid", "A2200001", "dutyname", "연세대학교원주세브란스기독병원")
                    ),
                    "traumaBasic", List.of(
                            Map.of("hpid", "A2200001", "dutyemclsname", "권역외상센터")
                    )
            );

            EmergencySnapshotDto snapshot = emergencyDataService.mergeDatasetsIntoSnapshot(rawDatasets);
            assertEquals(1, snapshot.totalCount());
            assertEquals(1, snapshot.tertiaryCount());
            assertEquals(1, snapshot.traumaCount());

            emergencyDataService.setCachedSnapshotForTest(snapshot);

            EmergencySnapshotDto compactSnap = emergencyApiController.getHospitals(false, true).getBody();
            assertNotNull(compactSnap);
            HospitalDto compactHospital = compactSnap.hospitals().getFirst();
            assertEquals("-2", compactHospital.beds().get("hvec"));
            assertFalse(compactHospital.basic().containsKey("dutyetc"), "경량 목록 응답에서는 불필요한 장문 원문 태그가 제거되어야 합니다.");
            assertNull(compactHospital.beds().get("hv999_unused"));

            HospitalDto fullDetail = emergencyApiController.getHospitalDetail("A2200001").getBody();
            assertNotNull(fullDetail);
            assertEquals("매우 긴 약도 설명 원문 텍스트", fullDetail.basic().get("dutyetc"), "개별 상세 API에서는 모든 원본 태그가 100% 보존되어야 합니다.");
            assertEquals("raw", fullDetail.beds().get("hv999_unused"));
            assertEquals(404, emergencyApiController.getHospitalDetail("NO_SUCH_ID").getStatusCode().value());
            assertEquals(400, emergencyApiController.getHospitalDetail("bad/id!").getStatusCode().value());
        } finally {
            emergencyDataService.setCachedSnapshotForTest(null);
        }
        /*
         * [자바 문법]
         * - try { ... } finally { ... } : 테스트가 실패해도 finally가 실행되어 테스트 캐시를 꼭 비움.
         *
         * [자바/스프링/JUnit 내장 타입]
         * - Map<K, V>, List<E>, String (이름 변경 불가) : 중첩 데이터셋을 구성하는 표준 컬렉션·문자열 타입임.
         * - ResponseEntity<T> (org.springframework.http, 이름 변경 불가) : HTTP 상태 코드와 응답 본문을 감싸는 타입임.
         *
         * [자바/JUnit 내장 메서드]
         * - Map.of(...), List.of(...) (이름 변경 불가) : 테스트용 불변 맵과 불변 리스트를 생성함.
         * - List.get(0), Map.get(key), Map.containsKey(key) (이름 변경 불가) : 항목 조회 및 키 유무를 확인함.
         * - ResponseEntity.getBody(), getStatusCode(), HttpStatusCode.value() (이름 변경 불가)
         *   · 컨트롤러 응답에서 본문 객체와 정수형 HTTP 상태 코드(404, 400)를 꺼냄.
         * - assertEquals, assertNotNull, assertFalse, assertNull (이름 변경 불가) : 값·null·상태 코드를 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - EmergencySnapshotDto, HospitalDto : 병합된 전체 스냅샷과 개별 병원 정보를 담는 DTO임.
         * - emergencyDataService.mergeDatasetsIntoSnapshot(raw) : 7종 데이터를 hpid 기준으로 병합함.
         * - emergencyDataService.setCachedSnapshotForTest(snap) : 테스트용 메모리 스냅샷 캐시를 설정·초기화함.
         * - emergencyApiController.getHospitals(false, true) : 경량 목록(?compact=true) 응답을 반환함.
         * - emergencyApiController.getHospitalDetail(hpid) : 전체 원본 태그가 담긴 상세 응답을 반환함.
         * - GeoUtils.isValidKoreaCoordinate : 병합 과정에서 한반도 밖 좌표(0.0, 0.0)를 걸러내는 유틸임.
         *
         * [지역 변수명]
         * - rawDatasets : 7종(list, basic, beds, messages, severe, traumaList, traumaBasic) 원시 데이터 Map임.
         * - snapshot : mergeDatasetsIntoSnapshot()이 반환한 전체 통합 스냅샷 DTO 변수임.
         * - compactSnap, compactHospital : 경량 목록 응답에서 꺼낸 스냅샷과 첫 번째 병원 DTO 변수임.
         * - fullDetail : 상세 API 응답에서 꺼낸 원본 HospitalDto 변수임.
         *
         * [동작 흐름]
         * - rawDatasets(정상 A2200001 + 오류 좌표 INVALID01) -> mergeDatasetsIntoSnapshot()
         *   ├── GeoUtils가 INVALID01(0.0, 0.0) 제외 -> totalCount=1, tertiaryCount=1, traumaCount=1 검증
         *   └── setCachedSnapshotForTest(snapshot)로 테스트 캐시 채움
         * - getHospitals(false, true) -> 경량 요약 DTO 반환 -> hvec="-2" 유지, dutyetc·hv999_unused 제거 검증
         * - getHospitalDetail("A2200001") -> 원본 DTO 반환 -> dutyetc·hv999_unused 100% 보존 검증
         * - 잘못된 ID 조회 -> "NO_SUCH_ID"는 404, 형식 오류 ID는 400 상태 코드 검증 -> finally에서 캐시 초기화
         *
         * [검증 핵심]
         * - 목록 API는 경량화로 응답 속도를 높이고, 상세 API는 원본을 무손실 보존하며 잘못된 ID를 차단함.
         */
    }

    @Test
    @DisplayName("5. 네이버 Directions 5 / 15 JSON 응답 파싱이 정확히 수행되어야 한다")
    void testNaverDirectionsJsonParsing() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testNaverDirectionsJsonParsing() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testNaverDirectionsJsonParsing() 메서드를 5번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testNaverDirectionsJsonParsing() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testNaverDirectionsJsonParsing : 네이버 길찾기 JSON 파싱과 단위 환산·혼잡도 매핑을 검증함.
     */
        String sampleDirectionsJson = """
                {
                  "code": 0,
                  "message": "길찾기를 성공하였습니다.",
                  "currentDateTime": "2026-11-03T17:00:00",
                  "route": {
                    "trafast": [
                      {
                        "summary": {
                          "distance": 8450,
                          "duration": 960000,
                          "departureTime": "2026-11-03T17:00:00",
                          "tollFare": 0,
                          "taxiFare": 11800,
                          "fuelPrice": 1120
                        },
                        "path": [
                          [127.901228, 37.319040],
                          [127.920100, 37.319500],
                          [127.945610, 37.319120]
                        ],
                        "section": [
                          { "pointIndex": 0, "pointCount": 2, "distance": 5200, "name": "서원대로", "congestion": 2, "speed": 32 },
                          { "pointIndex": 1, "pointCount": 2, "distance": 3250, "name": "일산로", "congestion": 3, "speed": 14 }
                        ],
                        "guide": [
                          {"instructions": "연세대길 방면 우회전"},
                          {"instructions": "일산로 방면 직진"},
                          {"instructions": "목적지 도착"}
                        ]
                      }
                    ]
                  }
                }
                """;

        DirectionsResponseDto dto = naverDirectionsService.parseDirectionsJson(
                sampleDirectionsJson, "directions15", "Directions 15", "trafast", "실시간 빠른길"
        );

        assertNotNull(dto);
        assertEquals(0, dto.code());
        assertEquals("directions15", dto.apiType());
        assertEquals(8450, dto.distanceMeters());
        assertEquals(8.5, dto.distanceKm());
        assertEquals(16, dto.durationMinutes());
        assertEquals("약 16분", dto.durationText());
        assertEquals(11800, dto.taxiFare());
        assertEquals(3, dto.path().size());
        assertEquals(2, dto.sections().size());
        assertEquals("서원대로", dto.sections().getFirst().name());
        assertEquals(2, dto.sections().getFirst().congestion());
        assertEquals("일산로", dto.sections().get(1).name());
        assertEquals(3, dto.sections().get(1).congestion());
        assertFalse(dto.guidePrompts().isEmpty());
        /*
         * [자바 문법]
         * - 텍스트 블록(""" ... """) : 여러 줄 JSON 샘플을 이스케이프 없이 그대로 작성함.
         *
         * [자바/JUnit 내장 타입]
         * - String (java.lang.String, 이름 변경 불가) : 모의 JSON 입력 문자열을 담는 표준 클래스임.
         *
         * [자바/JUnit 내장 메서드]
         * - List.size(), List.get(idx), List.isEmpty() (이름 변경 불가) : 목록 크기·원소·빈 여부를 확인함.
         * - assertNotNull, assertEquals, assertFalse (이름 변경 불가) : 객체 존재, 계산값 일치, 비어있지 않음을 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - DirectionsResponseDto : 거리, 소요 시간, 요금, 경로 좌표, 구간 혼잡도, 안내 문구를 담는 DTO임.
         * - naverDirectionsService.parseDirectionsJson(...) : 네이버 경로 JSON을 DTO로 변환함.
         * - RouteCongestionAnalyzer : JSON의 section과 guide를 분석해 구간별 혼잡도를 산출하는 내부 서비스임.
         * - dto.distanceKm(), dto.durationMinutes(), dto.sections() 등 : DirectionsResponseDto 필드 조회 메서드임.
         *
         * [지역 변수명]
         * - sampleDirectionsJson : trafast 경로 요약·좌표·구간·안내를 담은 테스트용 JSON 문자열임.
         * - dto : parseDirectionsJson()이 조립해 반환한 DirectionsResponseDto 결과 변수임.
         *
         * [동작 흐름]
         * - sampleDirectionsJson(8450m, 960000ms, 3좌표, 2구간, 3안내) -> parseDirectionsJson()
         *   ├── 요약 환산 -> 8.5km, 16분, "약 16분", 택시요금 11800원, 경로 좌표 3점 매핑 검증
         *   └── RouteCongestionAnalyzer 연동 -> 서원대로(혼잡 2)·일산로(혼잡 3) 및 안내 문구 추출 검증
         *
         * [검증 핵심]
         * - 외부 네이버 API 호출 없이도 JSON 파싱, 단위 환산(m->km, ms->분), 구간 혼잡도 추출이 정확함을 보장함.
         */
    }

    @Test
    @DisplayName("6. XML 비정상 응답(에러 코드 또는 빈 문자열) 시 success=false가 반환되어야 한다")
    void testXmlParsingDetectsFailureResponses() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testXmlParsingDetectsFailureResponses() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testXmlParsingDetectsFailureResponses() 메서드를 6번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testXmlParsingDetectsFailureResponses() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testXmlParsingDetectsFailureResponses : 빈 응답과 XML 에러 코드 시 실패(success=false) 판정을 검증함.
     */
        NmcOpenApiClient.ParsedXmlPage blankParsed = nmcOpenApiClient.parseXmlResponse("", "getEmrrmSrsillDissMsgInqire");
        assertFalse(blankParsed.success());

        String errorXml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <response>
                  <header>
                    <resultCode>99</resultCode>
                    <resultMsg>DEADLINE_EXPIRED_ERROR</resultMsg>
                  </header>
                </response>
                """;
        NmcOpenApiClient.ParsedXmlPage errorParsed = nmcOpenApiClient.parseXmlResponse(errorXml, "getSrsillDissAceptncPosblInfoInqire");
        assertFalse(errorParsed.success());
        assertTrue(errorParsed.items().isEmpty());
        /*
         * [자바 문법]
         * - 텍스트 블록(""" ... """) : 공공데이터포털 에러 응답 XML 샘플을 표현함.
         *
         * [자바/JUnit 내장 타입]
         * - String (java.lang.String, 이름 변경 불가) : 빈 문자열과 에러 XML 샘플을 담는 타입임.
         *
         * [자바/JUnit 내장 메서드]
         * - List.isEmpty() (이름 변경 불가) : 파싱 결과 목록이 비어 있는지 확인함.
         * - assertFalse, assertTrue (이름 변경 불가) : 실패 상태(false)와 빈 목록(true)을 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - NmcOpenApiClient.ParsedXmlPage : XML 파싱 성공 여부와 항목 목록을 담는 레코드임.
         * - nmcOpenApiClient.parseXmlResponse(...) : 빈 문자열·에러 코드를 감지해 실패 레코드를 반환함.
         * - blankParsed.success(), errorParsed.items() : ParsedXmlPage 필드 조회 메서드임.
         *
         * [지역 변수명]
         * - blankParsed : 빈 문자열("") 입력에 대한 파싱 결과 레코드 변수임.
         * - errorXml : resultCode가 "99"인 실패 XML 샘플 문자열 변수임.
         * - errorParsed : errorXml 입력에 대한 파싱 결과 레코드 변수임.
         *
         * [동작 흐름]
         * - 빈 문자열("") -> parseXmlResponse() -> 공백 검사 가드 동작 -> success=false 반환 검증
         * - errorXml(resultCode="99") -> parseXmlResponse() -> "00" 불일치 감지 -> success=false, items=[] 검증
         *
         * [검증 핵심]
         * - API 장애나 키 만료 에러를 "정상 0건"으로 착각해 기존 정상 캐시를 빈 목록으로 덮어쓰는 사고를 막음.
         */
    }

    @Test
    @DisplayName("7. 네이버 다중 옵션 파싱 및 분리된 NaverGeocodingService 역지오코딩·지오코딩 파싱이 정확히 동작해야 한다")
    void testMultiOptionAndGeocodingParsing() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testMultiOptionAndGeocodingParsing() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testMultiOptionAndGeocodingParsing() 메서드를 7번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testMultiOptionAndGeocodingParsing() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testMultiOptionAndGeocodingParsing : 다중 경로 대안 파싱과 역지오코딩·지오코딩 파싱을 검증함.
     */
        String multiOptionJson = """
                {
                  "code": 0,
                  "message": "길찾기를 성공하였습니다.",
                  "route": {
                    "trafast": [
                      {
                        "summary": { "distance": 8450, "duration": 840000, "tollFare": 1200, "taxiFare": 11800, "fuelPrice": 1120 },
                        "path": [[127.9012, 37.3190], [127.9456, 37.3191]]
                      }
                    ],
                    "traavoidtoll": [
                      {
                        "summary": { "distance": 9800, "duration": 1140000, "tollFare": 0, "taxiFare": 13200, "fuelPrice": 1290 },
                        "path": [[127.9012, 37.3190], [127.9456, 37.3191]]
                      }
                    ]
                  }
                }
                """;

        DirectionsResponseDto dto = naverDirectionsService.parseDirectionsJson(
                multiOptionJson, "directions5", "Directions 5", "trafast", "실시간 빠른길"
        );
        assertEquals(0, dto.code());
        assertEquals(2, dto.alternatives().size());
        assertEquals("trafast", dto.alternatives().getFirst().option());
        assertEquals(1200, dto.alternatives().getFirst().tollFare());
        assertEquals("traavoidtoll", dto.alternatives().get(1).option());
        assertEquals(0, dto.alternatives().get(1).tollFare());

        String sampleRevGeo = """
                {
                  "status": { "code": 0, "name": "ok", "message": "done" },
                  "results": [
                    {
                      "name": "roadaddr",
                      "region": {
                        "area1": { "name": "강원특별자치도", "alias": "강원" },
                        "area2": { "name": "원주시" },
                        "area3": { "name": "흥업면" }
                      },
                      "land": {
                        "name": "연세대길",
                        "number1": "1",
                        "number2": "",
                        "addition0": { "value": "연세대학교 미래캠퍼스" }
                      }
                    }
                  ]
                }
                """;
        ReverseGeocodeResponseDto revDto = naverGeocodingService.parseReverseGeocodeJson(sampleRevGeo, 37.3190, 127.9012);
        assertEquals(0, revDto.code());
        assertEquals("강원 원주시 흥업면", revDto.shortAddress());
        assertTrue(revDto.roadAddress().contains("연세대길 1"));

        String sampleGeo = """
                {
                  "status": "OK",
                  "addresses": [
                    {
                      "roadAddress": "강원특별자치도 원주시 흥업면 연세대길 1",
                      "jibunAddress": "강원특별자치도 원주시 흥업면 매지리 1496",
                      "x": "127.9009998",
                      "y": "37.2808750"
                    }
                  ]
                }
                """;
        List<GeocodeResponseDto.GeocodeItemDto> geoItems = naverGeocodingService.parseGeocodeJson(sampleGeo);
        assertEquals(1, geoItems.size());
        assertEquals(37.2808750, geoItems.getFirst().lat(), 0.0001);
        assertEquals(127.9009998, geoItems.getFirst().lng(), 0.0001);
        /*
         * [자바 문법]
         * - 텍스트 블록(""" ... """) : 다중 경로, 역지오코딩, 지오코딩 3종의 JSON 샘플을 작성함.
         *
         * [자바/JUnit 내장 타입]
         * - String, List<E> (이름 변경 불가) : JSON 입력 문자열과 결과 목록을 다루는 자바 표준 타입임.
         *
         * [자바/JUnit 내장 메서드]
         * - List.size(), List.get(idx), String.contains(...) (이름 변경 불가) : 목록 조회와 문자열 포함 검사 메서드임.
         * - assertEquals(exp, act), assertEquals(exp, act, delta), assertTrue (이름 변경 불가)
         *   · 세 번째 인자 delta(0.0001)로 실수 위경도 좌표를 허용 오차 범위 안에서 비교함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - DirectionsResponseDto, ReverseGeocodeResponseDto, GeocodeResponseDto.GeocodeItemDto
         *   · 경로 대안 목록, 역지오코딩 주소, 지오코딩 좌표 항목을 담는 프로젝트 DTO임.
         * - naverDirectionsService.parseDirectionsJson(...) : trafast·traavoidtoll 대안 목록을 함께 파싱함.
         * - naverGeocodingService.parseReverseGeocodeJson(...) : 좌표 기반 주소 JSON을 DTO로 파싱함.
         * - naverGeocodingService.parseGeocodeJson(...) : 주소 검색 JSON에서 한반도 유효 좌표 목록을 추출함.
         *
         * [지역 변수명]
         * - multiOptionJson, dto : trafast·traavoidtoll 다중 옵션 JSON과 파싱 결과 DTO 변수임.
         * - sampleRevGeo, revDto : 역지오코딩 샘플 JSON과 파싱 결과 DTO 변수임.
         * - sampleGeo, geoItems : 지오코딩 샘플 JSON과 파싱된 좌표 항목 리스트 변수임.
         *
         * [동작 흐름]
         * - multiOptionJson -> parseDirectionsJson() -> 대안 2건(trafast 1200원, traavoidtoll 0원) 검증
         * - sampleRevGeo -> parseReverseGeocodeJson() -> "강원 원주시 흥업면" 및 "연세대길 1" 포함 검증
         * - sampleGeo(x=127.9009998, y=37.2808750) -> parseGeocodeJson()
         *   └── 한반도 좌표 검증 통과 후 lat=37.2808750, lng=127.9009998(x·y 매핑) 일치 검증
         *
         * [검증 핵심]
         * - 분리된 NaverGeocodingService의 주소·좌표 파싱과 경로 대안 목록 파싱이 모두 정상 동작함을 검증함.
         */
    }

    @Test
    @DisplayName("8. /api/config 엔드포인트는 공개 Client ID와 기본 출발 좌표를 반환하고 시크릿은 노출하지 않아야 한다")
    void configEndpointExposesPublicClientIdOnly() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 configEndpointExposesPublicClientIdOnly() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 configEndpointExposesPublicClientIdOnly() 메서드를 8번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 configEndpointExposesPublicClientIdOnly() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - configEndpointExposesPublicClientIdOnly : /api/config가 공개 키와 기본 좌표만 반환하는지 검증함.
     */
        var response = emergencyApiController.getConfig();
        FrontendConfigDto body = response.getBody();
        assertNotNull(body);
        assertNotNull(body.naverClientId());
        assertNotNull(body.naverDarkStyleId());
        assertTrue(body.defaultLat() > 33.0 && body.defaultLat() < 39.0);
        assertTrue(body.defaultLng() > 124.0 && body.defaultLng() < 132.0);
        assertFalse(body.defaultLabel().isBlank());
        /*
         * [자바 문법]
         * - var (Java 10+ 키워드) : 우변 반환 타입을 컴파일러가 자동 추론해 지역 변수 타입 표기를 줄임.
         * - &&, >, < (연산자) : 위도·경도가 한반도 범위 안에 있는지 논리 AND와 크기 비교로 검사함.
         *
         * [스프링/자바/JUnit 내장 타입]
         * - ResponseEntity<T> (org.springframework.http, 이름 변경 불가) : var로 추론된 HTTP 응답 래퍼 타입임.
         *
         * [스프링/자바/JUnit 내장 메서드]
         * - ResponseEntity.getBody() (이름 변경 불가) : HTTP 응답 객체에서 본문 데이터를 꺼냄.
         * - String.isBlank() (이름 변경 불가) : 문자열이 비어 있거나 공백 문자만 있는지 확인함.
         * - assertNotNull, assertTrue, assertFalse (이름 변경 불가) : 키 존재, 좌표 범위, 라벨 비공백을 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - FrontendConfigDto : 공개용 클라이언트 ID, 다크 스타일 ID, 기본 출발 좌표·라벨만 담은 DTO임.
         * - emergencyApiController.getConfig() : 설정 빈에서 공개 항목만 골라 FrontendConfigDto로 반환함.
         * - body.naverClientId(), body.defaultLat() 등 : FrontendConfigDto 레코드 필드 조회 메서드임.
         *
         * [지역 변수명]
         * - response : getConfig()가 반환한 ResponseEntity 응답 객체 변수임.
         * - body : response.getBody()로 꺼낸 FrontendConfigDto 레코드 변수임.
         *
         * [동작 흐름]
         * - emergencyApiController.getConfig() 호출 -> 설정 빈에서 공개 항목만 FrontendConfigDto로 조립
         * - response.getBody() -> naverClientId·naverDarkStyleId 비null 확인
         *   └── defaultLat(33~39)·defaultLng(124~132) 한반도 범위 및 defaultLabel 비공백 검증
         *
         * [검증 핵심]
         * - FrontendConfigDto 구조 자체에 비밀키(clientSecret) 필드가 없어 브라우저 유출을 원천 차단함.
         */
    }

    @Test
    @DisplayName("9. RouteCongestionAnalyzer 세부 구간 생성 시 이미 분해된 영역 위에 원본 section이 중복 추가되지 않아야 한다")
    void testDetailedSectionsDoNotDuplicateCongestionSegments() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testDetailedSectionsDoNotDuplicateCongestionSegments() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testDetailedSectionsDoNotDuplicateCongestionSegments() 메서드를 9번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testDetailedSectionsDoNotDuplicateCongestionSegments() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testDetailedSectionsDoNotDuplicateCongestionSegments : 세부 분해 구간 위에 원본 구간 중복 방지를 검증함.
     */
        String detailedJson = """
                {
                  "code": 0,
                  "message": "ok",
                  "route": {
                    "trafast": [
                      {
                        "summary": { "distance": 2000, "duration": 240000, "tollFare": 0, "taxiFare": 4800, "fuelPrice": 300 },
                        "path": [
                          [127.90, 37.31], [127.91, 37.31], [127.92, 37.31], [127.93, 37.31], [127.94, 37.31]
                        ],
                        "section": [
                          { "pointIndex": 0, "pointCount": 4, "distance": 2000, "name": "서원대로", "congestion": 2, "speed": 22 }
                        ],
                        "guide": [
                          { "pointIndex": 2, "distance": 1200, "duration": 90000, "type": 1, "instructions": "서원대로 직진" },
                          { "pointIndex": 4, "distance": 800, "duration": 240000, "type": 88, "instructions": "목적지 도착" }
                        ]
                      }
                    ]
                  }
                }
                """;

        DirectionsResponseDto dto = naverDirectionsService.parseDirectionsJson(
                detailedJson, "directions5", "Directions 5", "trafast", "실시간 빠른길"
        );
        assertEquals(2, dto.sections().size());
        assertEquals(1, dto.sections().getFirst().congestion());
        assertEquals(3, dto.sections().get(1).congestion());
        /*
         * [자바 문법]
         * - 텍스트 블록(""" ... """) : 원본 section 1개와 guide 2개가 함께 들어 있는 JSON 샘플을 작성함.
         *
         * [자바/JUnit 내장 타입]
         * - String (java.lang.String, 이름 변경 불가) : 테스트용 길찾기 JSON 문자열을 담는 표준 클래스임.
         *
         * [자바/JUnit 내장 메서드]
         * - List.size(), List.get(idx) (이름 변경 불가) : 분해된 구간 개수와 각 구간 항목을 조회함.
         * - assertEquals (이름 변경 불가) : 구간 수(2)와 혼잡도 코드(1, 3)가 기댓값과 같은지 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - DirectionsResponseDto : 파싱된 경로 정보와 구간 혼잡도 리스트(sections)를 담는 DTO임.
         * - naverDirectionsService.parseDirectionsJson(...) : RouteCongestionAnalyzer로 세부 혼잡도를 계산함.
         * - RouteCongestionAnalyzer.buildDetailedSections : guide 기반 구간 분해 및 중복 검사 담당 메서드임.
         *
         * [지역 변수명]
         * - detailedJson : pointIndex 0~4 원본 section(혼잡 2)과 guide 2건을 포함한 JSON 변수임.
         * - dto : parseDirectionsJson()이 반환한 DirectionsResponseDto 변수임.
         *
         * [동작 흐름]
         * - detailedJson -> parseDirectionsJson() -> RouteCongestionAnalyzer.buildDetailedSections() 실행
         *   ├── 첫 번째 guide(0->2, 1200m, 90초) -> 시속 48km/h 계산 -> 원활(1) 구간 생성
         *   ├── 두 번째 guide(2->4, 800m, 240초) -> 시속 12km/h 계산 -> 정체(3) 구간 생성
         *   └── 원본 section(0~4, 혼잡 2) -> 이미 분해된 범위와 겹침 감지 -> 추가 생략(총 2건 유지) 검증
         *
         * [검증 핵심]
         * - 세분화된 원활(초록) 구간 위에 원본 서행(주황) 구간이 덧칠되어 색상이 섞이는 회귀 버그를 막음.
         */
    }

    @Test
    @DisplayName("10. list·basic 동시 장애 폴백 시에도 권역/상급종합 분류가 유지되어야 한다")
    void testMergedBasicAndTotalOutageClassificationFallback() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testMergedBasicAndTotalOutageClassificationFallback() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testMergedBasicAndTotalOutageClassificationFallback() 메서드를 10번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testMergedBasicAndTotalOutageClassificationFallback() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testMergedBasicAndTotalOutageClassificationFallback : 마스터 API 장애 시 캐시 분류 복원력을 검증함.
     */
        try {
            Map<String, List<Map<String, String>>> initialData = Map.of(
                    "list", List.of(Map.of(
                            "hpid", "A2200001",
                            "dutyname", "연세대학교원주세브란스기독병원",
                            "dutyaddr", "강원특별자치도 원주시 일산로 20",
                            "wgs84lat", "37.31912",
                            "wgs84lon", "127.94561",
                            "phpid", "LEGACY_CODE_01"
                    )),
                    "basic", List.of(Map.of(
                            "hpid", "A2200001",
                            "dutyemclsname", "권역응급의료센터",
                            "dutytel3", "033-741-1119"
                    )),
                    "beds", List.of(Map.of("hpid", "A2200001", "hvec", "5"))
            );

            EmergencySnapshotDto initialSnapshot = emergencyDataService.mergeDatasetsIntoSnapshot(initialData);
            HospitalDto first = initialSnapshot.hospitals().getFirst();
            assertEquals("LEGACY_CODE_01", first.basic().get("phpid"));
            assertTrue(first.regional());
            assertEquals("tertiary", first.type().group());

            emergencyDataService.setCachedSnapshotForTest(initialSnapshot);

            EmergencySnapshotDto fallbackSnapshot = emergencyDataService.mergeDatasetsIntoSnapshot(Map.of(
                    "beds", List.of(Map.of("hpid", "A2200001", "hvec", "2"))
            ));
            assertEquals(1, fallbackSnapshot.totalCount());
            HospitalDto recovered = fallbackSnapshot.hospitals().getFirst();
            assertTrue(recovered.regional());
            assertEquals("tertiary", recovered.type().group());
            assertEquals("2", recovered.beds().get("hvec"));
        } finally {
            emergencyDataService.setCachedSnapshotForTest(null);
        }
        /*
         * [자바 문법]
         * - try { ... } finally { ... } : 테스트가 실패해도 finally가 실행되어 테스트 캐시를 꼭 비움.
         *
         * [자바/JUnit 내장 타입]
         * - Map<K, V>, List<E>, String (이름 변경 불가) : 초기·장애 데이터셋을 구성하는 표준 컬렉션·문자열임.
         *
         * [자바/JUnit 내장 메서드]
         * - Map.of(...), List.of(...) (이름 변경 불가) : 불변 테스트 입력 데이터셋을 생성함.
         * - List.get(0), Map.get(key) (이름 변경 불가) : 목록 첫 항목과 내부 맵 키 값을 꺼냄.
         * - assertEquals, assertTrue (이름 변경 불가) : 병합 결과와 장애 복원 결과가 같은지 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - EmergencySnapshotDto, HospitalDto : 스냅샷과 개별 병원 정보를 담는 DTO임.
         * - emergencyDataService.mergeDatasetsIntoSnapshot(data) : 마스터 누락 시 직전 캐시 메타정보를 승계함.
         * - emergencyDataService.setCachedSnapshotForTest(snap) : 테스트용 스냅샷 캐시를 채우거나 비움.
         *
         * [지역 변수명]
         * - initialData, initialSnapshot, first : 정상 3종 데이터셋, 초기 병합 스냅샷, 첫 번째 병원 DTO임.
         * - fallbackSnapshot, recovered : list·basic 없이 beds("2")만으로 복원된 스냅샷과 병원 DTO임.
         *
         * [동작 흐름]
         * - initialData(list+basic+beds) -> mergeDatasetsIntoSnapshot() -> regional=true, group="tertiary" 생성
         * - setCachedSnapshotForTest(initialSnapshot) -> 직전 병원 캐시(cachedHospitalById) 저장
         * - 장애 입력(beds="2"만 전달) -> mergeDatasetsIntoSnapshot()
         *   ├── 직전 캐시에서 ID·좌표·권역(true)·상급종합("tertiary") 승계 + 병상("2")만 최신화
         *   └── totalCount=1, regional=true, hvec="2" 검증 -> finally에서 캐시 null 초기화
         *
         * [검증 핵심]
         * - 마스터 API가 일시 중단돼도 기존 병원 등급·권역 정보가 유지되고 실시간 병상만 계속 갱신됨.
         */
    }

    @Test
    @DisplayName("11. 독립 분리된 BoundedTtlCache는 최대 엔트리 상한을 초과하지 않고 LRU 항목을 자동 퇴거해야 한다")
    void testBoundedCacheEvictsLeastRecentlyUsedEntries() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testBoundedCacheEvictsLeastRecentlyUsedEntries() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testBoundedCacheEvictsLeastRecentlyUsedEntries() 메서드를 11번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testBoundedCacheEvictsLeastRecentlyUsedEntries() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testBoundedCacheEvictsLeastRecentlyUsedEntries : 캐시 용량 초과 시 최장 미사용(LRU) 제거를 검증함.
     */
        BoundedTtlCache<String, String> cache = new BoundedTtlCache<>(2, 60L);
        cache.put("k1", "v1");
        cache.put("k2", "v2");
        assertEquals("v1", cache.get("k1"));
        cache.put("k3", "v3");

        assertEquals(2, cache.size());
        assertEquals("v1", cache.get("k1"));
        assertEquals("v3", cache.get("k3"));
        assertNull(cache.get("k2"));
        /*
         * [자바 문법]
         * - new BoundedTtlCache<>(2, 60L) : 다이아몬드 연산자(<>)로 타입을 생략하고 60L(long) TTL을 넘김.
         *
         * [자바/JUnit 내장 타입]
         * - String (java.lang.String, 이름 변경 불가) : 캐시의 키와 값 타입으로 쓰인 표준 문자열 클래스임.
         *
         * [자바/JUnit 내장 메서드]
         * - assertEquals, assertNull (이름 변경 불가) : 캐시 크기·조회값 일치 및 제거된 키의 null 반환을 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - BoundedTtlCache<K, V> (com.yonsei119.util) : 최대 개수 상한과 만료 시간(TTL)을 갖는 인메모리 캐시임.
         * - cache.put(k, v), cache.get(k), cache.size() : 항목 저장, 조회(최근 접근 갱신), 크기 반환 메서드임.
         *
         * [지역 변수명]
         * - cache : 최대 2개 저장, 유효시간 60초 설정으로 만든 BoundedTtlCache<String, String> 인스턴스임.
         *
         * [동작 흐름]
         * - put("k1"), put("k2") -> 최대 용량 2개 채움 (미사용 순서: k1 -> k2)
         * - get("k1") 호출 -> k1이 최근 사용 위치로 이동해 k2가 가장 오래 미사용 상태가 됨 (순서: k2 -> k1)
         * - put("k3") 호출 -> 용량 2 초과 감지 -> 가장 오래된 "k2" 자동 삭제 -> size=2, k1·k3 생존, k2=null 검증
         *
         * [검증 핵심]
         * - 요청이 몰려도 캐시가 최대 용량을 넘지 않으며 자주 쓰이는 키는 유지됨을 검증함.
         */
    }

    @Test
    @DisplayName("12. 응급실 핑퐁 방지: '불가능' 한글 공지 오판 버그가 차단되고 초과수용 병원보다 여유 병상 병원이 우선 추천되어야 한다")
    void testOptimalRecommendationAndKoreanNoticeBlocking() {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testOptimalRecommendationAndKoreanNoticeBlocking() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testOptimalRecommendationAndKoreanNoticeBlocking() 메서드를 12번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testOptimalRecommendationAndKoreanNoticeBlocking() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void (키워드) : 반환값이 없는 JUnit 5 테스트 메서드 선언임.
     *
     * [테스트 메서드명]
     * - testOptimalRecommendationAndKoreanNoticeBlocking : '불가능' 오탐 차단과 수용 최적 순위를 검증함.
     */
        assertTrue(recommendationScorer.isNoticeBlocking(Map.of("symblkmsg", "뇌출혈 수술 불가능 (전문의 부재)")));
        assertTrue(recommendationScorer.isNoticeBlocking(Map.of("symblkmsg", "일반 외상 가능하나 심근경색 시술 불가")));
        assertFalse(recommendationScorer.isNoticeBlocking(Map.of("symblkmsg", "소아응급 정상 진료 가능 (제한 없음)")));

        HospitalDto saturatedCloser = new HospitalDto(
                "H_SATURATED", "가깝지만포화병원", "강원 원주시", "033-000-0001", "033-000-0119",
                37.3210, 127.9050, false, HospitalClassifier.TYPE_TERTIARY,
                Map.of(), null, Map.of("hvec", "-5"),
                List.of(Map.of("symblkmsg", "응급실 정원 초과로 수용 불가능")),
                Map.of("mkioskty3", "Y")
        );
        HospitalDto availableSlightlyFarther = new HospitalDto(
                "H_AVAILABLE", "조금더걸리지만여유병원", "강원 원주시", "033-000-0002", "033-000-0229",
                37.3350, 127.9300, true, HospitalClassifier.TYPE_TERTIARY,
                Map.of(), null, Map.of("hvec", "8"),
                List.of(Map.of("symblkmsg", "응급실 정상 진료 가능")),
                Map.of("mkioskty3", "Y")
        );

        List<HospitalEtaRankDto> optimalRanks = naverDirectionsService.rankHospitalsByDrivingTime(
                List.of(saturatedCloser, availableSlightlyFarther),
                37.3190, 127.9012, 20.0, 5,
                true, true, true, false, false, "stroke", "optimal", "trafast"
        );
        assertEquals(1, optimalRanks.size(), "뇌출혈 수용 불가 공지가 뜬 포화 병원은 stroke 증상 필터에서 자동 제외되어야 합니다.");
        assertEquals("H_AVAILABLE", optimalRanks.getFirst().id());
        assertEquals("여유", optimalRanks.getFirst().availabilityStatus());
        assertFalse(optimalRanks.getFirst().hasBlockingNotice());

        List<HospitalEtaRankDto> generalOptimal = naverDirectionsService.rankHospitalsByDrivingTime(
                List.of(saturatedCloser, availableSlightlyFarther),
                37.3190, 127.9012, 20.0, 5,
                true, true, true, false, false, "all", "optimal", "trafast"
        );
        assertEquals(2, generalOptimal.size());
        assertEquals("H_AVAILABLE", generalOptimal.getFirst().id(), "수용 최적 모드에서는 초과수용(-5석) 병원 대신 여유(8석) 병원이 1위가 되어야 합니다.");
        assertEquals("초과수용", generalOptimal.get(1).availabilityStatus());
        assertTrue(generalOptimal.get(1).hasBlockingNotice());
        /*
         * [자바 문법]
         * - new HospitalDto(...) : 테스트용 병원 불변 레코드 객체 2개를 직접 생성함.
         * - 클래스명.상수 : HospitalClassifier.TYPE_TERTIARY 공용 상수를 인자로 전달함.
         *
         * [자바/JUnit 내장 타입]
         * - Map<K, V>, List<E>, String (이름 변경 불가) : 공지·병상 맵과 목록을 담는 표준 타입임.
         *
         * [자바/JUnit 내장 메서드]
         * - Map.of(...), List.of(...) (이름 변경 불가) : 테스트용 속성 맵과 병원 리스트를 생성함.
         * - List.size(), List.get(idx) (이름 변경 불가) : 추천 순위 리스트 크기와 1·2위 항목을 꺼냄.
         * - assertTrue, assertFalse, assertEquals (이름 변경 불가) : 실패 메시지를 담아 판정과 순위를 검증함.
         *
         * [프로젝트 내부 타입 및 메서드]
         * - HospitalDto, HospitalEtaRankDto : 병원 입력 데이터와 주행시간·추천 순위 결과를 담는 DTO임.
         * - HospitalClassifier.TYPE_TERTIARY : 상급종합병원 분류 상수임.
         * - recommendationScorer.isNoticeBlocking(notice) : '불가능' 안의 '가능' 오탐을 막고 차단 여부를 판정함.
         * - naverDirectionsService.rankHospitalsByDrivingTime(...) : 증상 필터·최적 모드별 병원 순위를 계산함.
         *
         * [지역 변수명]
         * - saturatedCloser : 가깝지만 병상 -5석(초과수용)과 수용 불가 공지가 있는 병원 DTO 변수임.
         * - availableSlightlyFarther : 조금 더 멀지만 병상 8석(여유)과 정상 진료 공지가 있는 병원 DTO 변수임.
         * - optimalRanks, generalOptimal : 각각 symptom="stroke"와 "all"일 때의 추천 순위 리스트 변수임.
         *
         * [동작 흐름]
         * - recommendationScorer.isNoticeBlocking() -> "불가능"·"불가"는 true, "정상 진료 가능"은 false 검증
         * - symptom="stroke", mode="optimal" -> rankHospitalsByDrivingTime()
         *   └── 포화 병원 차단 공지 감지(matchesSymptomPreset 탈락) -> 여유 병원(H_AVAILABLE) 1곳만 반환 검증
         * - symptom="all", mode="optimal" -> rankHospitalsByDrivingTime()
         *   └── 초과수용·차단 공지 감점 적용 -> 여유(8석) 1위, 초과수용(-5석) 2위 정렬 검증
         *
         * [검증 핵심]
         * - 거리만 가까워 포화 병원으로 재이송되는 응급실 핑퐁을 막고 한글 부정 공지 파싱 정확도를 보장함.
         */
    }

    @Test
    @DisplayName("13. 실제 내장 웹 서버에서 보안 헤더, 정적 리소스, GZIP 압축, ETag 304 재검증이 정상 동작해야 한다")
    void testRootStaticResourcesAndSecurityHeaders() throws Exception {
    /*
     * [JUnit 내장 어노테이션]
     * - @Test 정의 (출처: org.junit.jupiter.api.Test, 이름 변경 불가)
     *   · 역할 : JUnit 5 테스트 플랫폼이 독립적으로 실행하고 성공·실패를 검증할 테스트 메서드임을 표시하는 어노테이션임.
     * - @Test 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testRootStaticResourcesAndSecurityHeaders() 메서드
     *   · 작동 원리 : JUnit 5 플랫폼이 리플렉션으로 testRootStaticResourcesAndSecurityHeaders() 메서드를 13번 독립 테스트 단위로 실행함.
     *   · 비교 : @BeforeEach/@AfterEach는 매 테스트 전후 실행되며, @ParameterizedTest는 입력값을 바꿔 반복 실행함.
     * - @DisplayName 정의 (출처: org.junit.jupiter.api.DisplayName, 이름 변경 불가)
     *   · 역할 : IDE 테스트 실행 창과 빌드 리포트에 영어 메서드명 대신 읽기 쉬운 사용자 지정 테스트 제목을 표시해 주는 어노테이션임.
     * - @DisplayName("...") 현재 코드 적용
     *   · 적용 대상 : 바로 위 선언된 testRootStaticResourcesAndSecurityHeaders() 메서드
     *   · 작동 원리 : 영어 메서드명 대신 지정한 한글 문장을 IDE 테스트 트리와 Gradle 리포트 제목으로 출력함.
     *   · 비교 : 미지정 시 메서드명이 제목으로 쓰이며, @DisplayNameGeneration으로 클래스 단위 표기 규칙을 대체할 수 있음.
     *
     * [자바 문법]
     * - void ... throws Exception (키워드) : 반환값이 없으며 HTTP·스트림 예외 처리를 JUnit 실행기로 넘김.
     *
     * [테스트 메서드명]
     * - testRootStaticResourcesAndSecurityHeaders : 11개 경로, 보안 헤더, GZIP, ETag 304를 일괄 검증함.
     */
        try (HttpClient client = HttpClient.newHttpClient()) {
            for (String path : List.of(
                    "/",
                    "/index.html",
                    "/manifest.webmanifest",
                    "/sw.js",
                    "/css/style.css",
                    "/css/panels-toolbar.css",
                    "/js/app.js",
                    "/js/theme-init.js",
                    "/js/constants.js",
                    "/api/config",
                    "/api/health"
            )) {
                HttpRequest plainReq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                        .GET()
                        .build();
                HttpResponse<String> plainRes = client.send(plainReq, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                assertEquals(200, plainRes.statusCode(), path + " 요청이 HTTP 200을 반환해야 합니다.");
                assertFalse(plainRes.body().isBlank(), path + " 응답 본문이 비어 있지 않아야 합니다.");
                assertEquals("nosniff", plainRes.headers().firstValue("X-Content-Type-Options").orElse(""));
                assertEquals("SAMEORIGIN", plainRes.headers().firstValue("X-Frame-Options").orElse(""));
                if ("/manifest.webmanifest".equals(path)) {
                    assertTrue(
                            plainRes.headers().firstValue("Content-Type").orElse("").contains("application/manifest+json"),
                            "PWA 웹 매니페스트는 표준 application/manifest+json MIME 타입으로 서빙되어야 합니다."
                    );
                }

                HttpRequest gzipReq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                        .header("Accept-Encoding", "gzip, deflate, br")
                        .GET()
                        .build();
                HttpResponse<byte[]> gzipRes = client.send(gzipReq, HttpResponse.BodyHandlers.ofByteArray());
                assertEquals(200, gzipRes.statusCode());
                assertTrue(gzipRes.body().length > 0);

                String decodedBody;
                if ("gzip".equalsIgnoreCase(gzipRes.headers().firstValue("Content-Encoding").orElse(""))) {
                    try (GZIPInputStream gis = new GZIPInputStream(new ByteArrayInputStream(gzipRes.body()))) {
                        decodedBody = new String(gis.readAllBytes(), StandardCharsets.UTF_8);
                    }
                } else {
                    decodedBody = new String(gzipRes.body(), StandardCharsets.UTF_8);
                }

                if ("/".equals(path) || "/index.html".equals(path)) {
                    assertTrue(decodedBody.contains("<!DOCTYPE html>"));
                    assertTrue(decodedBody.contains("id=\"map\""));
                }
            }
            /*
             * [자바 문법]
             * - 향상된 for문(for (String path : ...)) : 11개 경로 문자열을 순서대로 꺼내 반복함.
             * - if / else, || (논리 OR) : 매니페스트 MIME 타입, gzip 인코딩 여부, HTML 경로 조건을 분기함.
             * - 배열.length (내장 속성) : byte[] 응답 본문 배열의 바이트 길이를 확인함.
             * - try (GZIPInputStream gis = ...) (try-with-resources) : 블록 종료 시 스트림을 자동 닫아 누수를 막음.
             *
             * [자바/JUnit 내장 타입]
             * - HttpClient, HttpRequest, HttpResponse<T> (java.net.http, 이름 변경 불가) : HTTP 요청·응답 표준 타입임.
             * - URI (java.net), List<E>, String, StandardCharsets (이름 변경 불가) : 주소·목록·문자셋 표준 API임.
             * - ByteArrayInputStream, GZIPInputStream (이름 변경 불가) : byte[] 응답의 GZIP 압축을 푸는 스트림임.
             *
             * [자바/JUnit 내장 메서드]
             * - HttpClient.newHttpClient(), List.of(...), URI.create(...) (이름 변경 불가) : 클라이언트·목록·URI 생성함.
             * - HttpRequest.newBuilder(...), header(), GET(), build() (이름 변경 불가) : GET 요청과 헤더를 조립함.
             * - client.send(...), BodyHandlers.ofString(...), ofByteArray() (이름 변경 불가) : 요청 전송 후 본문 수신함.
             * - statusCode(), body(), headers().firstValue(...), orElse("") (이름 변경 불가) : 상태·본문·헤더 꺼냄.
             * - gis.readAllBytes(), new String(bytes, charset) (이름 변경 불가) : 압축 해제 바이트를 문자열로 변환함.
             * - String.equals(), equalsIgnoreCase(), contains(), isBlank(), assertEquals, assertFalse, assertTrue
             *
             * [프로젝트 URL 생성 출처 및 라우팅]
             * - URL 조립("http://localhost:" + port + path) : @LocalServerPort로 주입된 랜덤 port에 경로를 붙임.
             * - 정적 파일 경로("/", "/index.html" 등 9종) : WebConfig가 정적 리소스 핸들러로 서빙함.
             * - API 경로("/api/config", "/api/health") : EmergencyApiController의 @RequestMapping("/api")와
             *   @GetMapping("/config")·@GetMapping("/health")가 합쳐진 경로로 라우팅됨.
             * - SecurityHeadersFilter : 모든 응답에 X-Content-Type-Options, X-Frame-Options 보안 헤더를 부여함.
             *
             * [지역 변수명]
             * - client, path : 재사용 HttpClient 객체와 반복문이 순회 중인 요청 경로 문자열임.
             * - plainReq, plainRes : 압축 헤더 없이 보낸 일반 GET 요청과 문자열 응답 객체임.
             * - gzipReq, gzipRes : Accept-Encoding 헤더를 붙여 보낸 요청과 byte[] 응답 객체임.
             * - decodedBody, gis : 압축 해제 또는 UTF-8 변환으로 복원한 본문 문자열과 GZIP 스트림 변수임.
             *
             * [동작 흐름]
             * - 11개 경로 순회 -> "http://localhost:" + port + path 로 일반 GET 요청 전송
             *   ├── 상태 200, 비공백 본문, SecurityHeadersFilter 보안 헤더(nosniff, SAMEORIGIN) 검증
             *   └── "/manifest.webmanifest" -> Content-Type에 "application/manifest+json" 포함 검증
             * - 동일 URL + "Accept-Encoding: gzip, deflate, br" 재요청 -> byte[] 응답 수신
             *   ├── Content-Encoding="gzip" -> GZIPInputStream으로 압축 해제 후 UTF-8 문자열 복원
             *   ├── 1024바이트 미만 비압축 응답 -> 바로 UTF-8 문자열 복원
             *   └── "/", "/index.html" -> "<!DOCTYPE html>" 및 "id=\"map\"" 포함 검증
             */

            HttpResponse<String> appJsRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/app.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            String etag = appJsRes.headers().firstValue("ETag").orElse("");
            assertFalse(etag.isBlank());

            HttpResponse<String> notModifiedRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/app.js"))
                            .header("If-None-Match", etag)
                            .GET()
                            .build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            assertEquals(304, notModifiedRes.statusCode());
        }
        /*
         * [자바/JUnit 내장 타입]
         * - HttpResponse<T>, HttpRequest, URI, StandardCharsets (이름 변경 불가) : ETag 조건부 요청 표준 타입임.
         *
         * [자바/JUnit 내장 메서드]
         * - HttpClient.send(), HttpRequest.newBuilder().header().GET().build(), URI.create() (이름 변경 불가)
         * - BodyHandlers.ofString(), headers().firstValue(), orElse(""), statusCode() (이름 변경 불가)
         * - String.isBlank(), assertFalse, assertEquals (이름 변경 불가) : ETag 존재 및 304 상태를 검증함.
         *
         * [프로젝트 내부 메서드 및 URL 출처]
         * - 요청 URL("http://localhost:" + port + "/js/app.js") : 랜덤 port와 WebConfig 정적 경로를 조합함.
         * - WebConfig.computeWeakMetadataEtag : 파일 크기와 수정 시각으로 Weak ETag(W/"...")를 생성함.
         *
         * [지역 변수명]
         * - appJsRes, etag : "/js/app.js" 최초 응답 객체와 헤더에서 꺼낸 Weak ETag 문자열 변수임.
         * - notModifiedRes : If-None-Match 헤더에 etag를 실어 재요청한 응답 객체 변수임.
         *
         * [동작 흐름]
         * - "http://localhost:" + port + "/js/app.js" -> 최초 GET 요청 전송
         *   └── WebConfig.computeWeakMetadataEtag가 생성한 ETag 헤더 수신 -> 비공백(assertFalse) 검증
         * - 동일 URL + "If-None-Match: <etag>" 헤더로 재요청 전송
         *   └── 파일 변경 없음 확인 -> 본문 재전송 없이 HTTP 304(Not Modified) 반환 검증
         *
         * [검증 핵심]
         * - 실제 내장 웹 서버에서 보안 헤더, 라우팅, PWA MIME, GZIP, Weak ETag 304 재검증이 모두 동작함.
         */
    }

    @Test
    @DisplayName("14. Java 27 런타임, 가상 스레드 활성화 및 통합 서비스명(yonsei119)을 검증한다")
    void testJava27VirtualThreadsAndUnifiedHealthService() throws Exception {
        assertTrue(Runtime.version().feature() >= 27, "Java 27 이상 런타임이어야 합니다");
        assertEquals(Boolean.TRUE, environment.getProperty("spring.threads.virtual.enabled", Boolean.class));
        assertEquals("yonsei119", environment.getProperty("spring.application.name"));

        var healthResponse = emergencyApiController.health();
        assertEquals(200, healthResponse.getStatusCode().value());
        Map<String, Object> healthBody = healthResponse.getBody();
        assertNotNull(healthBody);
        assertEquals("UP", healthBody.get("status"));
        assertEquals("yonsei119", healthBody.get("service"));
        assertTrue(String.valueOf(healthBody.get("javaVersion")).startsWith("27"));

        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpResponse<String> httpRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/health")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            assertEquals(200, httpRes.statusCode());
            assertTrue(httpRes.body().contains("\"service\":\"yonsei119\""));
        }
    }

    @Test
    @DisplayName("15. 콜드스타트 다크모드·WebGL GL 순서·서비스 워커·데드코드 정리가 실제 서빙 자산에 반영되어야 한다")
    void testDarkModeColdStartFixAndDeadCodeCleanupServedAssets() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            String indexHtml = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertTrue(indexHtml.contains("data-theme=\"dark\""));
            assertTrue(indexHtml.contains("js/theme-init.js"));
            assertTrue(indexHtml.contains("js/user-features.js"));
            assertTrue(indexHtml.contains("id=\"nanum-webfont-link\""));
            assertFalse(indexHtml.contains("id=\"bed-alert-toggle\""));
            assertFalse(indexHtml.contains("id=\"lang-select\""));
            assertFalse(indexHtml.contains("id=\"symptom-chips-bar\""));
            assertFalse(indexHtml.contains("id=\"quick-hospitals-bar\""));
            assertFalse(indexHtml.contains("onload=\"this.onload=null"));
            int sdkTagStart = indexHtml.indexOf("id=\"naver-maps-sdk\"");
            int sdkTagEnd = indexHtml.indexOf("</script>", sdkTagStart);
            assertTrue(sdkTagStart > 0 && sdkTagEnd > sdkTagStart);
            assertFalse(
                    indexHtml.substring(sdkTagStart, sdkTagEnd).contains("defer"),
                    "#naver-maps-sdk 스크립트는 GL 서브모듈 동기 로드를 위해 defer를 사용하면 안 됩니다."
            );

            String themeInitJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/theme-init.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertTrue(themeInitJs.contains("theme-color"));
            assertTrue(themeInitJs.contains("dark-mode"));
            assertTrue(themeInitJs.contains("nanum-webfont-link"));

            String userFeaturesJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/user-features.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertTrue(userFeaturesJs.contains("toggleHospitalSpeech"));
            assertTrue(userFeaturesJs.contains("stopHospitalSpeech"));
            assertFalse(userFeaturesJs.contains("recordRecentHospital"));
            assertFalse(userFeaturesJs.contains("renderQuickHospitalsBar"));
            assertFalse(userFeaturesJs.contains("toggleFavoriteHospital"));
            assertFalse(userFeaturesJs.contains("evaluateBedAvailabilityChanges"));
            assertFalse(userFeaturesJs.contains("SUPPORTED_LANGS"));
            assertFalse(userFeaturesJs.contains("initBedAlertControl"));
            assertFalse(userFeaturesJs.contains("initLanguageControl"));

            String swJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/sw.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertTrue(swJs.contains("yonsei119-pwa-v261124-r5"));
            assertTrue(swJs.contains("'/js/user-features.js'"));
            assertTrue(swJs.contains("isValidAssetResponse"));
            assertTrue(swJs.contains("pathname === '/api/config'"));

            String mapEngineJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/map-engine.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertTrue(mapEngineJs.contains("temporary2dFallback"));
            assertTrue(mapEngineJs.contains("isGLReady"));
            assertTrue(mapEngineJs.contains("else if (!state.map)"));
            int glCheckIdx = mapEngineJs.indexOf("if (naverMaps.glEnabled)");
            int glSupportedCallIdx = mapEngineJs.indexOf("naverMaps.Util?.glSupported", glCheckIdx);
            assertTrue(glCheckIdx >= 0 && glSupportedCallIdx > glCheckIdx);
            assertFalse(mapEngineJs.contains("_force2dFallback"));
            assertFalse(mapEngineJs.contains("state.markers"));

            String searchControlsJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/search-controls.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertTrue(searchControlsJs.contains("allSourcesUnavailable"));
            assertTrue(searchControlsJs.contains(".env"));

            String markersClusterJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/markers-cluster.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertFalse(markersClusterJs.contains("clearMarkers"));
            assertFalse(markersClusterJs.contains("state.markers"));

            String stateJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/state.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertFalse(stateJs.contains("markers:"));
        }
    }

    @Test
    @DisplayName("16. .env 설정 파일 로드(spring.config.import)로 NEMC·Naver 인증키가 정상 바인딩되어야 한다")
    void testDotEnvConfigImportBindsApiKeys(@TempDir Path tempDir) throws Exception {
        Path tempEnv = tempDir.resolve(".env");
        Files.writeString(
                tempEnv,
                "NEMC_API_SERVICE_KEY=test-nemc-key\nNAVER_MAP_CLIENT_SECRET=test-naver-secret\n",
                StandardCharsets.UTF_8
        );
        String importLocation = "optional:file:" + tempEnv.toAbsolutePath().toString().replace('\\', '/') + "[.properties]";

        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(Yonsei119Application.class)
                .properties(
                        "spring.main.web-application-type=none",
                        "yonsei119.nemc.auto-refresh-enabled=false",
                        "spring.config.import=" + importLocation
                )
                .run()) {
            Yonsei119Properties boundProps = context.getBean(Yonsei119Properties.class);
            assertEquals("test-nemc-key", boundProps.nemc().serviceKey());
            assertEquals("test-naver-secret", boundProps.naver().clientSecret());
        }
    }

    @Test
    @DisplayName("17. /api/hospitals 사전 직렬화 JSON + ETag 헤더 및 If-None-Match 304 Not Modified가 동작해야 한다")
    void testHospitalsSnapshotEtagAndNotModified() throws Exception {
        Map<String, List<Map<String, String>>> rawDatasets = Map.of(
                "list", List.of(
                        Map.of("hpid", "A2200001", "dutyname", "연세대학교원주세브란스기독병원", "wgs84lat", "37.31912", "wgs84lon", "127.94561", "dutyaddr", "강원특별자치도 원주시 일산로 20")
                ),
                "basic", List.of(Map.of("hpid", "A2200001", "dutyemclsname", "권역응급의료센터")),
                "beds", List.of(Map.of("hpid", "A2200001", "hvec", "5", "hvs01", "30")),
                "messages", List.of(),
                "severe", List.of(),
                "traumaList", List.of(),
                "traumaBasic", List.of()
        );
        try {
            EmergencySnapshotDto snapshot = emergencyDataService.mergeDatasetsIntoSnapshot(rawDatasets);
            emergencyDataService.setCachedSnapshotForTest(snapshot);

            try (HttpClient client = HttpClient.newHttpClient()) {
                HttpResponse<String> first = client.send(
                        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/hospitals?compact=true")).GET().build(),
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
                );
                assertEquals(200, first.statusCode());
                String etag = first.headers().firstValue("ETag").orElse("");
                assertTrue(etag.startsWith("W/\""), "ETag 형식이 W/\"...\" 이어야 합니다: " + etag);
                assertTrue(first.body().contains("\"totalCount\":1"));

                HttpResponse<String> second = client.send(
                        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/hospitals?compact=true"))
                                .header("If-None-Match", etag)
                                .GET()
                                .build(),
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
                );
                assertEquals(304, second.statusCode());
                assertEquals(etag, second.headers().firstValue("ETag").orElse(""));
                assertEquals("", second.body());
            }
        } finally {
            emergencyDataService.setCachedSnapshotForTest(null);
        }
    }

    @Test
    @DisplayName("18. 엄격한 CSP 헤더와 유료 네이버 대리 API IP 토큰 버킷 레이트 리미터(429)가 동작해야 한다")
    void testStrictCspHeaderAndRateLimiter() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpResponse<String> homeRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            String csp = homeRes.headers().firstValue("Content-Security-Policy").orElse("");
            assertTrue(csp.contains("worker-src 'self' blob:"), "CSP에 worker-src가 포함되어야 합니다: " + csp);
            assertTrue(csp.contains("script-src 'self'"), "CSP에 script-src 'self'가 포함되어야 합니다: " + csp);
            assertTrue(csp.contains("https://oapi.map.naver.com"));
            assertTrue(csp.contains("https://*.nelo.navercorp.com"));
            assertFalse(csp.contains("'unsafe-eval'"));

            SecurityHeadersFilter securityFilter = new SecurityHeadersFilter();
            MockHttpServletRequest httpReq = new MockHttpServletRequest("GET", "/");
            MockHttpServletResponse httpRes = new MockHttpServletResponse();
            securityFilter.doFilter(httpReq, httpRes, new MockFilterChain());
            String httpCsp = httpRes.getHeader("Content-Security-Policy");
            assertNotNull(httpCsp);
            assertEquals(SecurityHeadersFilter.LOCAL_HTTP_CONTENT_SECURITY_POLICY, httpCsp);
            assertTrue(httpCsp.contains("http://oapi.map.naver.com"));

            MockHttpServletRequest httpsReq = new MockHttpServletRequest("GET", "/");
            httpsReq.addHeader("X-Forwarded-Proto", "https");
            MockHttpServletResponse httpsRes = new MockHttpServletResponse();
            securityFilter.doFilter(httpsReq, httpsRes, new MockFilterChain());
            String httpsCsp = httpsRes.getHeader("Content-Security-Policy");
            assertNotNull(httpsCsp);
            assertEquals(SecurityHeadersFilter.CONTENT_SECURITY_POLICY, httpsCsp);
            assertFalse(httpsCsp.contains("http://oapi.map.naver.com"));
            assertFalse(httpsCsp.contains("'unsafe-eval'"));

            HttpResponse<String> geoRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/reverse-geocode?lat=37.5665&lng=126.9780")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            assertEquals(200, geoRes.statusCode());
            assertTrue(geoRes.headers().firstValue("X-RateLimit-Limit").isPresent());
            assertTrue(geoRes.headers().firstValue("X-RateLimit-Remaining").isPresent());
        }

        Yonsei119Properties limitedProps = new Yonsei119Properties(
                new Yonsei119Properties.Nemc("https://example.invalid", "", 180, 21600, 10000, false, 180000),
                new Yonsei119Properties.Naver("id", "style", "", "https://d5", "https://d15"),
                new Yonsei119Properties.DefaultOrigin(37.5665, 126.9780, "서울시청"),
                new Yonsei119Properties.Cors("*"),
                new Yonsei119Properties.RateLimit(true, 2, 1)
        );
        ApiRateLimitFilter filter = new ApiRateLimitFilter(limitedProps);
        for (int i = 0; i < 3; i++) {
            MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/directions");
            req.setRemoteAddr("198.51.100.42");
            MockHttpServletResponse res = new MockHttpServletResponse();
            filter.doFilter(req, res, new MockFilterChain());
            if (i < 2) {
                assertEquals(200, res.getStatus());
                assertEquals("2", res.getHeader("X-RateLimit-Limit"));
            } else {
                assertEquals(429, res.getStatus());
                assertNotNull(res.getHeader("Retry-After"));
                assertTrue(res.getContentAsString().contains("TOO_MANY_REQUESTS"));
            }
        }
    }

    @Test
    @DisplayName("19. Spring Boot Actuator /actuator/health 및 /actuator/metrics가 커스텀 지표를 노출해야 한다")
    void testActuatorHealthAndCustomMetrics() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpResponse<String> healthRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/actuator/health")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            assertEquals(200, healthRes.statusCode());
            assertTrue(healthRes.body().contains("\"UP\""));

            HttpResponse<String> metricsRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/actuator/metrics")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            assertEquals(200, metricsRes.statusCode());
            assertTrue(metricsRes.body().contains("yonsei119.hospitals.cached.count"));

            HttpResponse<String> customMetric = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/actuator/metrics/yonsei119.hospitals.cached.count")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            assertEquals(200, customMetric.statusCode());
            assertTrue(customMetric.body().contains("measurements"));
        }
    }
}
