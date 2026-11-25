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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 백엔드 전체 로직(종별 분류, 음수 병상 무손실 파싱, 7종 병합, 네이버 경로·페리 차단,
 *          실시간 공지 오탐 방지, Render 콜드스타트 헬스체크, 보안·캐시·429)을 검증하는 통합 테스트
 * - 실행 시점 : IntelliJ 실행(Run) 버튼 또는 `.\gradlew.bat checkAll --no-daemon` 시 JUnit 5가 구동함
 *
 * [2. 전체 테스트 흐름 (시퀀스 다이어그램)]
 *
 *    [JUnit 5 Runner]          [@SpringBootTest Server]      [Beans / HTTP Endpoints]
 *            |                             |                             |
 *            |-- 1. start RANDOM_PORT ---->|                             |  전체 빈 · 내장 Tomcat 기동
 *            |-- 2. run Test 1 .. 19 ------|---------------------------->|  분류 · 파싱 · 병합 · 보안 검증
 *            |<-- 3. all assertions pass --|-----------------------------|  전 항목 통과 시 빌드 성공
 *            v                             v                             v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크)]
 * - Java 표준 내장
 *   ㄴ HttpClient / URI : 실제 내장 웹 서버 종단간 HTTP 요청·응답 검증 클래스
 *   ㄴ GZIPInputStream  : GZIP 압축 응답 복원 검증 스트림 클래스
 *   ㄴ Files / Path     : 임시 `.env` 설정 파일 바인딩 검증 클래스
 *   ㄴ List / Map       : `getFirst()`, `Map.ofEntries()` 등 표준 내장 컬렉션
 * - Spring Boot Test / JUnit 5 프레임워크
 *   ㄴ @SpringBootTest / @LocalServerPort / @Autowired : 통합 컨텍스트 및 포트 주입
 *   ㄴ @Test / @DisplayName / Assertions               : 단위·통합 단언 검증 도구
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
     * [검증 목적 및 흐름]
     * - 목적: 상급종합병원·권역응급의료센터·의료원·일반기관 4종 분류 및 상급종합+권역 이중 태그 인식을 검증함
     * - 흐름:
     *   원주세브란스기독병원 입력 -> classify() == "tertiary" & isRegional() == true
     *   원주의료원 입력           -> classify() == "medical"
     *   원주성지병원 입력         -> classify() == "other"
     * - 검증 대상: HospitalClassifier.classify(), HospitalClassifier.isRegional()
     */
    @Test
    @DisplayName("1. 상급종합병원 / 권역응급의료센터 / 의료원 / 일반·기타 종별 분류가 정확히 동작해야 한다")
    void testHospitalClassification() {
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: NEMC XML 파싱 시 음수 병상(`-4`, 정원 초과 수용)과 미보고 빈 값(`""`)을 `0`으로 왜곡하지 않고 원형 그대로 보존하는지 검증함
     * - 흐름: sampleXml -> NmcOpenApiClient.parseXmlResponse() -> hvec="-4", hv28="", hvoxyayn="N1" 일치 확인
     * - 검증 대상: NmcOpenApiClient.parseXmlResponse()
     */
    @Test
    @DisplayName("2. XML 파싱 시 음수 병상 값(초과수용)과 미보고 빈 값을 0으로 왜곡하지 않고 그대로 보존해야 한다")
    void testXmlParsingPreservesOverflowAndBlankValues() {
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 공공데이터포털 Encoding/Decoding 인증키 이중 인코딩 방지와 Cold(마스터 4종)/Hot(실시간 3종) 분리를 검증함
     * - 검증 대상: NmcOpenApiClient.ensureUrlEncodedServiceKey(), COLD_ENDPOINTS, HOT_ENDPOINTS, ENDPOINTS
     */
    @Test
    @DisplayName("3. 공공데이터포털 인증키 이중 인코딩 방지 및 Hot(3종)/Cold(4종) 오퍼레이션 분리가 정확해야 한다")
    void testServiceKeyEncodingAndHotColdSplit() {
        String encoded = "dummy%2Ftest%2BserviceKey1234567890abcdef%3D%3D";
        String decoded = "dummy/test+serviceKey1234567890abcdef==";

        assertEquals(encoded, NmcOpenApiClient.ensureUrlEncodedServiceKey(encoded));
        assertEquals(encoded, NmcOpenApiClient.ensureUrlEncodedServiceKey(decoded));

        assertEquals(4, NmcOpenApiClient.COLD_ENDPOINTS.size());
        assertEquals(3, NmcOpenApiClient.HOT_ENDPOINTS.size());
        assertEquals(7, NmcOpenApiClient.ENDPOINTS.size());
        assertTrue(NmcOpenApiClient.HOT_ENDPOINTS.containsKey("beds"));
        assertTrue(NmcOpenApiClient.COLD_ENDPOINTS.containsKey("list"));
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 7종 데이터셋 hpid 병합, 한국 밖 오류 좌표(0.0, 0.0) 필터링, 경량 목록(`?compact=true` 필수 병상·당직 연락처 보존 + 장문 제거) 및 단건 상세 무손실 보존을 검증함
     * - 흐름:
     *   rawDatasets(7종) -> mergeDatasetsIntoSnapshot()
     *   ㄴ getHospitals(false, true)     -> hvec="-2"·hv1·hvdnm 등 필수 태그 유지, dutyetc·hv999_unused 제거
     *   ㄴ getHospitalDetail("A2200001") -> dutyetc·hv999_unused 100% 보존, 미존재 ID=404, 형식 오류=400
     * - 검증 대상: EmergencyDataService.mergeDatasetsIntoSnapshot(), EmergencyApiController.getHospitals(), getHospitalDetail()
     */
    @Test
    @DisplayName("4. 7개 데이터셋 교차 병합, 경량 목록(?compact=true) 필수 태그 보존 및 개별 상세(/api/hospitals/{hpid}) 분리가 정확해야 한다")
    void testDatasetCrossMergeAndCompactDetailSeparation() {
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
                            Map.ofEntries(
                                    Map.entry("hpid", "A2200001"),
                                    Map.entry("hvec", "-2"),
                                    Map.entry("hvs01", "30"),
                                    Map.entry("hv13", "1"),
                                    Map.entry("hvs46", "4"),
                                    Map.entry("hv1", "033-741-0119"),
                                    Map.entry("hv5", "Y"),
                                    Map.entry("hv7", "N"),
                                    Map.entry("hv10", "Y"),
                                    Map.entry("hv11", "Y"),
                                    Map.entry("hv12", "033-741-0120"),
                                    Map.entry("hvdnm", "김응급"),
                                    Map.entry("hv999_unused", "raw")
                            )
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
            assertEquals("033-741-0119", compactHospital.beds().get("hv1"));
            assertEquals("김응급", compactHospital.beds().get("hvdnm"));
            assertEquals("Y", compactHospital.beds().get("hv10"));
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 네이버 Directions JSON 응답의 거리·시간·택시비 환산 및 공식 구간 혼잡도(section.congestion) 추출을 검증함
     * - 검증 대상: NaverDirectionsService.parseDirectionsJson(), RouteCongestionAnalyzer.buildDetailedSections()
     */
    @Test
    @DisplayName("5. 네이버 Directions 5 / 15 JSON 응답 파싱이 정확히 수행되어야 한다")
    void testNaverDirectionsJsonParsing() {
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 공공데이터포털 장애(빈 응답 또는 resultCode != 00) 시 `success=false`를 반환해 정상 캐시 오염을 막는지 검증함
     * - 검증 대상: NmcOpenApiClient.parseXmlResponse()
     */
    @Test
    @DisplayName("6. XML 비정상 응답(에러 코드 또는 빈 문자열) 시 success=false가 반환되어야 한다")
    void testXmlParsingDetectsFailureResponses() {
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 다중 경로 옵션(빠른길·무료우선) 비교 목록과 NaverGeocodingService의 역지오코딩·지오코딩 파싱을 검증함
     * - 검증 대상: NaverDirectionsService.parseDirectionsJson(), NaverGeocodingService.parseReverseGeocodeJson(), parseGeocodeJson()
     */
    @Test
    @DisplayName("7. 네이버 다중 옵션 파싱 및 분리된 NaverGeocodingService 역지오코딩·지오코딩 파싱이 정확히 동작해야 한다")
    void testMultiOptionAndGeocodingParsing() {
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: `/api/config`가 공개용 Client ID·다크 스타일 ID·기본 출발지 좌표만 반환하고 Secret Key는 노출하지 않는지 검증함
     * - 검증 대상: EmergencyApiController.getConfig(), FrontendConfigDto
     */
    @Test
    @DisplayName("8. /api/config 엔드포인트는 공개 Client ID와 기본 출발 좌표를 반환하고 시크릿은 노출하지 않아야 한다")
    void configEndpointExposesPublicClientIdOnly() {
        var response = emergencyApiController.getConfig();
        FrontendConfigDto body = response.getBody();
        assertNotNull(body);
        assertNotNull(body.naverClientId());
        assertNotNull(body.naverDarkStyleId());
        assertTrue(body.defaultLat() > 33.0 && body.defaultLat() < 39.0);
        assertTrue(body.defaultLng() > 124.0 && body.defaultLng() < 132.0);
        assertFalse(body.defaultLabel().isBlank());
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적:
     *   1) 네이버 지도 교통정보 레이어와 경로 색상이 100% 일치하도록, `guide` 평균속도 추정으로 혼잡도를 임의 변조하지 않고
     *      공식 `section.congestion`(0=미수집, 1=원활, 2=서행, 3=정체)을 1:1 그대로 보존하는지 검증함
     *   2) 실제 네이버 지도 웹서비스와 동일하게 해상 페리 항로(`guide.type == 48/49`, 예: 울릉군보건의료원)가 포함된 경우
     *      가짜 도서 도로 경로를 그리지 않고 `FERRY_ROUTE_UNSUPPORTED_CODE(-304)`로 차단하는지 검증함
     * - 검증 대상: RouteCongestionAnalyzer.buildDetailedSections(), NaverDirectionsService.parseDirectionsJson()
     */
    @Test
    @DisplayName("9. 네이버 공식 section 혼잡도(0~3)가 1:1 보존되고 울릉도 등 해상 페리 항로는 경로 미제공(-304)으로 차단되어야 한다")
    void testOfficialSectionCongestionAndUlleungdoFerryBlock() {
        String officialSectionJson = """
                {
                  "code": 0,
                  "message": "ok",
                  "route": {
                    "trafast": [
                      {
                        "summary": { "distance": 3200, "duration": 240000, "tollFare": 0, "taxiFare": 5800, "fuelPrice": 420 },
                        "path": [
                          [127.90, 37.31], [127.91, 37.31], [127.92, 37.31], [127.93, 37.31], [127.94, 37.31]
                        ],
                        "section": [
                          { "pointIndex": 0, "pointCount": 3, "distance": 2000, "name": "서원대로", "congestion": 2, "speed": 22 },
                          { "pointIndex": 2, "pointCount": 3, "distance": 1200, "name": "이면도로", "congestion": 0, "speed": 0 }
                        ],
                        "guide": [
                          { "pointIndex": 2, "distance": 1200, "duration": 90000, "type": 1, "instructions": "서원대로 직진" },
                          { "pointIndex": 4, "distance": 2000, "duration": 240000, "type": 88, "instructions": "목적지 도착" }
                        ]
                      }
                    ]
                  }
                }
                """;

        DirectionsResponseDto dto = naverDirectionsService.parseDirectionsJson(
                officialSectionJson, "directions5", "Directions 5", "trafast", "실시간 빠른길"
        );
        assertEquals(0, dto.code());
        assertEquals(2, dto.sections().size(), "guide 속도 추정으로 구간을 쪼개거나 덮어쓰지 않고 공식 section만 유지해야 합니다.");
        assertEquals(2, dto.sections().getFirst().congestion());
        assertEquals(22, dto.sections().getFirst().speed());
        assertEquals(0, dto.sections().get(1).congestion(), "교통정보 미수집 구간(congestion=0)도 원형 그대로 유지되어야 합니다.");

        String ulleungdoFerryJson = """
                {
                  "code": 0,
                  "message": "길찾기를 성공하였습니다.",
                  "route": {
                    "trafast": [
                      {
                        "summary": { "distance": 295000, "duration": 21600000, "tollFare": 9200, "taxiFare": 0, "fuelPrice": 28000 },
                        "path": [
                          [129.3650, 36.6980], [130.9056, 37.4844], [130.9072, 37.4860]
                        ],
                        "section": [
                          { "pointIndex": 1, "pointCount": 2, "distance": 850, "name": "울릉순환로", "congestion": 0, "speed": 30 }
                        ],
                        "guide": [
                          { "pointIndex": 0, "distance": 210000, "duration": 18000000, "type": 48, "instructions": "울릉항 방면 항로 진입" },
                          { "pointIndex": 1, "distance": 850, "duration": 90000, "type": 49, "instructions": "항로 출구" },
                          { "pointIndex": 2, "distance": 0, "duration": 0, "type": 88, "instructions": "울릉군보건의료원 도착" }
                        ]
                      }
                    ]
                  }
                }
                """;

        DirectionsResponseDto ferryBlockedDto = naverDirectionsService.parseDirectionsJson(
                ulleungdoFerryJson, "directions5", "Directions 5", "trafast", "실시간 빠른길"
        );
        assertEquals(NaverDirectionsService.FERRY_ROUTE_UNSUPPORTED_CODE, ferryBlockedDto.code());
        assertTrue(ferryBlockedDto.path().isEmpty(), "해상 페리 도서 경로는 실제 네이버 지도처럼 경로 좌표를 비워야 합니다.");
        assertTrue(ferryBlockedDto.sections().isEmpty());
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 마스터 API(`list`·`basic`) 일시 장애 시에도 직전 캐시에서 종별(`tertiary`)·권역(`regional=true`) 정보를 복원하고 실시간 병상(`beds`)만 최신화하는지 검증함
     * - 검증 대상: EmergencyDataService.mergeDatasetsIntoSnapshot()
     */
    @Test
    @DisplayName("10. list·basic 동시 장애 폴백 시에도 권역/상급종합 분류가 유지되어야 한다")
    void testMergedBasicAndTotalOutageClassificationFallback() {
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: BoundedTtlCache가 최대 용량(maxEntries) 초과 시 가장 오래 사용하지 않은(LRU) 항목을 자동 퇴거하는지 검증함
     * - 검증 대상: BoundedTtlCache.put(), get(), size()
     */
    @Test
    @DisplayName("11. 독립 분리된 BoundedTtlCache는 최대 엔트리 상한을 초과하지 않고 LRU 항목을 자동 퇴거해야 한다")
    void testBoundedCacheEvictsLeastRecentlyUsedEntries() {
        BoundedTtlCache<String, String> cache = new BoundedTtlCache<>(2, 60L);
        cache.put("k1", "v1");
        cache.put("k2", "v2");
        assertEquals("v1", cache.get("k1"));
        cache.put("k3", "v3");

        assertEquals(2, cache.size());
        assertEquals("v1", cache.get("k1"));
        assertEquals("v3", cache.get("k3"));
        assertNull(cache.get("k2"));
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적:
     *   1) 실시간 NEMC 응급메시지의 기본 태그(`symoutdspyon="차단"`) 때문에 정상 안내문("제한 없음", "정규시간에만 가능(문의바랍니다)")이
     *      진료 불가로 오탐되지 않고, 실제 불가능·제한 문구만 정확히 차단(`true`)으로 판정되는지 검증함
     *   2) 수용 최적 추천 모드(`optimal`)에서 초과수용(`-5석`) 포화 병원 대신 여유(`8석`) 병원이 1위로 추천되는지 검증함
     * - 검증 대상: HospitalRecommendationScorer.isNoticeBlocking(), NaverDirectionsService.rankHospitalsByDrivingTime()
     */
    @Test
    @DisplayName("12. 응급실 핑퐁 방지: 실시간 NEMC 공지('제한 없음'·symoutdspyon) 오탐이 방지되고 여유 병상 병원이 우선 추천되어야 한다")
    void testOptimalRecommendationAndKoreanNoticeBlocking() {
        assertTrue(recommendationScorer.isNoticeBlocking(Map.of("symblkmsg", "뇌출혈 수술 불가능 (전문의 부재)")));
        assertTrue(recommendationScorer.isNoticeBlocking(Map.of("symblkmsg", "일반 외상 가능하나 심근경색 시술 불가")));
        assertTrue(recommendationScorer.isNoticeBlocking(Map.of("symoutdspyon", "차단", "symblkmsg", "야간 소아내시경 제한")));
        assertFalse(recommendationScorer.isNoticeBlocking(Map.of("symblkmsg", "소아응급 정상 진료 가능 (제한 없음)")));
        assertFalse(recommendationScorer.isNoticeBlocking(Map.of("symoutdspyon", "차단", "symblkmsg", "소아응급 정상 진료 가능 (제한 없음)")));
        assertFalse(recommendationScorer.isNoticeBlocking(Map.of("symoutdspyon", "차단", "symblkmsg", "정규시간에만 가능(문의바랍니다)")));

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
                List.of(Map.of("symoutdspyon", "차단", "symblkmsg", "응급실 정상 진료 가능 (제한 없음)")),
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 내장 웹 서버의 11개 정적/API 경로 서빙, 보안 헤더, GZIP 압축 복원, 정적 자산 Weak ETag 304 응답을 종단간 검증함
     * - 검증 대상: WebConfig, SecurityHeadersFilter, EmergencyApiController
     */
    @Test
    @DisplayName("13. 실제 내장 웹 서버에서 보안 헤더, 정적 리소스, GZIP 압축, ETag 304 재검증이 정상 동작해야 한다")
    void testRootStaticResourcesAndSecurityHeaders() throws Exception {
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
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: Java 27 런타임, 가상 스레드 활성화, 그리고 Render 무료 플랜 콜드스타트 시 초기 캐시 적재 전까지
     *         `/api/health`가 `503 WARMING_UP`을 반환(Render 자체 로딩 화면 유지)하다가 적재 완료 즉시 `200 UP`으로 전환되는지 검증함
     * - 검증 대상: EmergencyApiController.health(), EmergencyDataService.isReadyForTraffic()
     */
    @Test
    @DisplayName("14. Java 27 런타임, 가상 스레드 활성화 및 Render 콜드스타트 헬스체크(503 WARMING_UP -> 200 UP)를 검증한다")
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

        Yonsei119Properties warmupProps = new Yonsei119Properties(
                new Yonsei119Properties.Nemc("https://example.invalid", "dummy-service-key", 60, 21600, 10000, true, 60000),
                new Yonsei119Properties.Naver("id", "style", "", "https://d5", "https://d15"),
                new Yonsei119Properties.DefaultOrigin(37.5665, 126.9780, "서울시청"),
                new Yonsei119Properties.Cors("*"),
                new Yonsei119Properties.RateLimit(true, 60, 1)
        );
        EmergencyDataService warmupService = new EmergencyDataService(nmcOpenApiClient, hospitalClassifier, warmupProps);
        try {
            warmupService.setInitialWarmupCompletedForTest(false);
            EmergencyApiController warmupController = new EmergencyApiController(
                    warmupProps, warmupService, naverDirectionsService, naverGeocodingService
            );
            var warmingRes = warmupController.health();
            assertEquals(503, warmingRes.getStatusCode().value(), "초기 캐시 워밍업 중에는 Render 로딩 화면 유지를 위해 503을 반환해야 합니다.");
            Map<String, Object> warmingBody = warmingRes.getBody();
            assertNotNull(warmingBody);
            assertEquals("WARMING_UP", warmingBody.get("status"));
            assertEquals(Boolean.FALSE, warmingBody.get("ready"));

            warmupService.setInitialWarmupCompletedForTest(true);
            var readyRes = warmupController.health();
            assertEquals(200, readyRes.getStatusCode().value(), "초기 캐시 워밍업 완료 직후에는 200 UP을 반환해야 합니다.");
            Map<String, Object> readyBody = readyRes.getBody();
            assertNotNull(readyBody);
            assertEquals("UP", readyBody.get("status"));
            assertEquals(Boolean.TRUE, readyBody.get("ready"));
        } finally {
            warmupService.shutdown();
        }

        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpResponse<String> httpRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/health")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            assertEquals(200, httpRes.statusCode());
            assertTrue(httpRes.body().contains("\"service\":\"yonsei119\""));
        }
    }

    /*
     * [검증 목적 및 흐름]
     * - 목적: 프론트엔드 정적 자산(`index.html`, `sw.js`, `constants.js`, `directions-eta.js` 등)에
     *         기본 반경 50km, 콜드스타트 비가로채기 서비스워커(`r3`), 60초 자동 동기화, 네이버 교통색상·페리 차단이 반영되었는지 검증함
     */
    @Test
    @DisplayName("15. 기본 반경 50km·Render 콜드스타트 서비스 워커(r3)·교통색상 일치·데드코드 정리가 서빙 자산에 반영되어야 한다")
    void testDarkModeColdStartFixAndDeadCodeCleanupServedAssets() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            String indexHtml = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            Matcher htmlComments = Pattern.compile("<!--([\\s\\S]*?)-->").matcher(indexHtml);
            while (htmlComments.find()) {
                assertFalse(
                        htmlComments.group(1).contains("--"),
                        "HTML 주석(<!-- ... -->) 내부에 '--'가 있으면 주석이 중간에 깨지므로 허용하지 않습니다."
                );
            }
            assertTrue(indexHtml.contains("data-theme=\"dark\""));
            assertTrue(indexHtml.contains("js/theme-init.js"));
            assertTrue(indexHtml.contains("js/user-features.js"));
            assertTrue(indexHtml.contains("id=\"nanum-webfont-link\""));
            assertTrue(indexHtml.contains("<option value=\"50\" selected>"));
            assertTrue(indexHtml.contains("현재 50 km"));
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

            String constantsJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/constants.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertTrue(constantsJs.contains("DEFAULT_RADIUS_KM = '50'"));
            assertTrue(constantsJs.contains("AUTO_REFRESH_INTERVAL_MS = 60000"));

            String directionsEtaJs = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/js/directions-eta.js")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            ).body();
            assertTrue(directionsEtaJs.contains("FERRY_ROUTE_UNSUPPORTED_CODE = -304"));
            assertTrue(directionsEtaJs.contains("buildCttMatchedSectionFeatures"));
            assertTrue(directionsEtaJs.contains("#27c441"));
            assertTrue(directionsEtaJs.contains("#ff8d00"));
            assertTrue(directionsEtaJs.contains("#ff3b30"));

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
            assertFalse(userFeaturesJs.contains("toggleHospitalSpeech"));
            assertFalse(userFeaturesJs.contains("stopHospitalSpeech"));
            assertTrue(userFeaturesJs.contains("resolveUniversityHospitalLogo"));
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
            assertTrue(swJs.contains("yonsei119-pwa-v261125-r5"));
            assertTrue(swJs.contains("networkFirstNavigation"));
            assertTrue(swJs.contains("'/js/user-features.js'"));
            assertTrue(swJs.contains("isValidAssetResponse"));
            assertTrue(swJs.contains("pathname === '/api/config'"));

            HttpResponse<byte[]> yonseiLogoRes = client.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/Assets/universities/yonsei.svg")).GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray()
            );
            assertEquals(200, yonseiLogoRes.statusCode());
            assertTrue(yonseiLogoRes.body().length > 1000);

            for (String code : List.of("cha", "hallym", "konyang", "gachon", "cku")) {
                assertTrue(userFeaturesJs.contains("file: '" + code + ".svg'"));
                HttpResponse<String> svgRes = client.send(
                        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/Assets/universities/" + code + ".svg")).GET().build(),
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
                );
                assertEquals(200, svgRes.statusCode(), code + ".svg 정적 서빙이 200이어야 합니다.");
                assertTrue(svgRes.body().contains("<svg"), code + ".svg 벡터 본문이 유효해야 합니다.");

                HttpResponse<byte[]> oldPngRes = client.send(
                        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/Assets/universities/" + code + ".png")).GET().build(),
                        HttpResponse.BodyHandlers.ofByteArray()
                );
                assertEquals(404, oldPngRes.statusCode(), "기존 저해상도 " + code + ".png는 제거되어야 합니다.");
            }

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
            assertTrue(searchControlsJs.contains("startAutoRefreshLoop"));
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

    /*
     * [검증 목적 및 흐름]
     * - 목적: 로컬 `.env` 파일(`spring.config.import`)에 작성한 NEMC·Naver 인증키가 `Yonsei119Properties` 레코드에 정상 바인딩되는지 검증함
     */
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

    /*
     * [검증 목적 및 흐름]
     * - 목적: `/api/hospitals?compact=true`의 사전 직렬화 UTF-8 바이트 응답과 `If-None-Match` 조건부 요청 시 `304 Not Modified` 무본문 응답을 검증함
     */
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

    /*
     * [검증 목적 및 흐름]
     * - 목적: HTTP/HTTPS 환경별 CSP 보안 헤더 분리 적용과 유료 네이버 API 프록시의 IP당 분당 요청 상한(`429 Too Many Requests`)을 검증함
     */
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
                new Yonsei119Properties.Nemc("https://example.invalid", "", 60, 21600, 10000, false, 60000),
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

    /*
     * [검증 목적 및 흐름]
     * - 목적: Spring Boot Actuator의 `/actuator/health` 및 커스텀 캐시 병원 수 지표(`yonsei119.hospitals.cached.count`) 노출을 검증함
     */
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
