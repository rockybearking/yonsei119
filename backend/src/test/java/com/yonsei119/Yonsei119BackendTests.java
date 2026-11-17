package com.yonsei119;

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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
/*
 * [자바 문법] package, import, import static : 백엔드 전체 도메인·API·보안·정적 서빙 무결성을 자동 검증하는 JUnit 5 통합 테스트 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - HttpClient, HttpRequest, HttpResponse, GZIPInputStream : 실제 내장 웹 서버에 HTTP/GZIP 요청을 날려 검증하는 표준 도구임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @SpringBootTest (출처: org.springframework.boot.test.context) : 실제 운영과 똑같은 스프링 컨테이너와 랜덤 포트 내장 Tomcat을 띄워 통합 검증함.
 * - @Test, @DisplayName (출처: org.junit.jupiter.api) : 개별 자동화 검증 시나리오와 한글 테스트 제목을 지정함 (형제: @BeforeEach, @AfterEach, @ParameterizedTest).
 * - @Autowired, @LocalServerPort : 테스트에 필요한 스프링 빈과 열린 포트 번호를 자동 주입받음.
 * [스프링/자바 내장 함수] assertEquals, assertTrue, assertFalse, assertNotNull, assertNull : 예상 결과와 실제 결과가 일치하는지 단언(Assert)하는 JUnit 내장 검증 함수임.
 */

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "yonsei119.nemc.auto-refresh-enabled=false",
                "yonsei119.naver.client-secret="
        }
)
class Yonsei119BackendTests {
/*
 * [스프링/라이브러리 내장 어노테이션] @SpringBootTest(webEnvironment = RANDOM_PORT, properties = {...}) :
 *   포트 충돌을 피하기 위해 빈 포트를 자동 배정하고, 테스트 중 외부 공공데이터/네이버 유료 트래픽이 소모되지 않도록 임시 설정으로 격리함.
 * [자바 문법] class (JUnit 5 테스트 클래스는 public 생략 가능)
 * [내가 지은 이름] Yonsei119BackendTests : 연세 119 백엔드 통합 자동화 검증 스위트 클래스명임.
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
    /*
     * [스프링/라이브러리 내장 어노테이션] @LocalServerPort, @Autowired
     * [내가 지은 이름] port(할당된 테스트 포트 번호), hospitalClassifier ~ emergencyApiController(검증 대상 싱글톤 빈 상자들)
     */

    @Test
    @DisplayName("1. 상급종합병원 / 권역응급의료센터 / 의료원 / 일반·기타 종별 분류가 정확히 동작해야 한다")
    void testHospitalClassification() {
    /*
     * [스프링/라이브러리 내장 어노테이션] @Test, @DisplayName
     * [내가 지은 이름] testHospitalClassification : 제5기 상급종합병원 47개소 및 종별 분류 정확도 검증 테스트임.
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
         * [검증 핵심] 원주세브란스기독병원이 상급종합병원이자 동시에 권역응급의료센터(regional=true)로 이중 인식되는지 확인함.
         */
    }

    @Test
    @DisplayName("2. XML 파싱 시 음수 병상 값(초과수용)과 미보고 빈 값을 0으로 왜곡하지 않고 그대로 보존해야 한다")
    void testXmlParsingPreservesOverflowAndBlankValues() {
    /*
     * [내가 지은 이름] testXmlParsingPreservesOverflowAndBlankValues : 응급의료 도메인 무결성 핵심 검증 테스트임.
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

        Map<String, String> item = parsed.items().get(0);
        assertEquals("A2200001", item.get("hpid"));
        assertEquals("-4", item.get("hvec"));
        assertEquals("30", item.get("hvs01"));
        assertEquals("", item.get("hv28"));
        assertEquals("N1", item.get("hvoxyayn"));
        /*
         * [자바 15+ 문법] 텍스트 블록(""" ... """) : 여러 줄의 XML·JSON 샘플을 이스케이프(\n, \") 없이 깔끔하게 작성할 수 있음.
         */
    }

    @Test
    @DisplayName("3. 공공데이터포털 인증키 이중 인코딩 방지 및 Hot(3종)/Cold(4종) 오퍼레이션 분리가 정확해야 한다")
    void testServiceKeyEncodingAndHotColdSplit() {
    /*
     * [내가 지은 이름] testServiceKeyEncodingAndHotColdSplit : 인증키 인코딩 방어 및 Hot/Cold 이원화 구조 검증 테스트임.
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
         * [검증 핵심] Cold 4종 + Hot 3종 = 총 7종 엔드포인트가 누락이나 중복 없이 정확히 분리되어 있는지 단언함.
         */
    }

    @Test
    @DisplayName("4. 7개 데이터셋 교차 병합, 경량 목록(?compact=true) 및 개별 상세(/api/hospitals/{hpid}) 분리가 정확해야 한다")
    void testDatasetCrossMergeAndCompactDetailSeparation() {
    /*
     * [내가 지은 이름] testDatasetCrossMergeAndCompactDetailSeparation : 7종 병합 + 목록 경량화 vs 상세 원본 분리 검증임.
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
            HospitalDto compactHospital = compactSnap.hospitals().get(0);
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
         * [핵심 검증] 목록 API(?compact=true)는 가볍게 필수 필드만 내려주고, 상세 API(/api/hospitals/A2200001)는 모든 원본 필드를 온전히 반환함을 입증함.
         */
    }

    @Test
    @DisplayName("5. 네이버 Directions 5 / 15 JSON 응답 파싱이 정확히 수행되어야 한다")
    void testNaverDirectionsJsonParsing() {
    /*
     * [내가 지은 이름] testNaverDirectionsJsonParsing : 경로 폴리라인·요금·혼잡 구간 파싱 검증 테스트임.
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
        assertEquals("서원대로", dto.sections().get(0).name());
        assertEquals(2, dto.sections().get(0).congestion());
        assertEquals("일산로", dto.sections().get(1).name());
        assertEquals(3, dto.sections().get(1).congestion());
        assertFalse(dto.guidePrompts().isEmpty());
        /*
         * [핵심 검증] 거리(m -> km), 시간(ms -> 한글 문자열), 구간별 혼잡도가 손실 없이 파싱되는지 확인함.
         */
    }

    @Test
    @DisplayName("6. XML 비정상 응답(에러 코드 또는 빈 문자열) 시 success=false가 반환되어야 한다")
    void testXmlParsingDetectsFailureResponses() {
    /*
     * [내가 지은 이름] testXmlParsingDetectsFailureResponses : 공공데이터 에러 응답 감지 검증임.
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
         * [핵심 검증] resultCode가 "00"이 아닐 때 정상 빈 데이터로 착각하지 않고 즉시 폴백 스위치를 작동시킴.
         */
    }

    @Test
    @DisplayName("7. 네이버 다중 옵션 파싱 및 분리된 NaverGeocodingService 역지오코딩·지오코딩 파싱이 정확히 동작해야 한다")
    void testMultiOptionAndGeocodingParsing() {
    /*
     * [내가 지은 이름] testMultiOptionAndGeocodingParsing : 4대 옵션 대안 카드 및 지오코딩 파서 검증임.
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
        assertEquals("trafast", dto.alternatives().get(0).option());
        assertEquals(1200, dto.alternatives().get(0).tollFare());
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
        assertEquals(37.2808750, geoItems.get(0).lat(), 0.0001);
        assertEquals(127.9009998, geoItems.get(0).lng(), 0.0001);
        /*
         * [핵심 검증] NaverGeocodingService 분리 이후에도 역지오코딩과 지오코딩 파싱이 동일하게 동작함을 검증함.
         */
    }

    @Test
    @DisplayName("8. /api/config 엔드포인트는 공개 Client ID와 기본 출발 좌표를 반환하고 시크릿은 노출하지 않아야 한다")
    void configEndpointExposesPublicClientIdOnly() {
    /*
     * [내가 지은 이름] configEndpointExposesPublicClientIdOnly : 공개 설정 보안 검증 테스트임.
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
         * [보안 검증] FrontendConfigDto에 clientSecret 필드가 아예 없으며 유효한 공개 설정만 반환됨을 확인함.
         */
    }

    @Test
    @DisplayName("9. RouteCongestionAnalyzer 세부 구간 생성 시 이미 분해된 영역 위에 원본 section이 중복 추가되지 않아야 한다")
    void testDetailedSectionsDoNotDuplicateCongestionSegments() {
    /*
     * [내가 지은 이름] testDetailedSectionsDoNotDuplicateCongestionSegments : 혼잡도 중복 덧칠 방지 회귀 테스트임.
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
        assertEquals(1, dto.sections().get(0).congestion());
        assertEquals(3, dto.sections().get(1).congestion());
        /*
         * [핵심 검증] 48km/h 원활 구간(1)과 12km/h 정체 구간(3)이 정확히 2개로만 분해됨.
         */
    }

    @Test
    @DisplayName("10. list·basic 동시 장애 폴백 시에도 권역/상급종합 분류가 유지되어야 한다")
    void testMergedBasicAndTotalOutageClassificationFallback() {
    /*
     * [내가 지은 이름] testMergedBasicAndTotalOutageClassificationFallback : 부분·전체 장애 복원력 테스트임.
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
            HospitalDto first = initialSnapshot.hospitals().get(0);
            assertEquals("LEGACY_CODE_01", first.basic().get("phpid"));
            assertTrue(first.regional());
            assertEquals("tertiary", first.type().group());

            emergencyDataService.setCachedSnapshotForTest(initialSnapshot);

            EmergencySnapshotDto fallbackSnapshot = emergencyDataService.mergeDatasetsIntoSnapshot(Map.of(
                    "beds", List.of(Map.of("hpid", "A2200001", "hvec", "2"))
            ));
            assertEquals(1, fallbackSnapshot.totalCount());
            HospitalDto recovered = fallbackSnapshot.hospitals().get(0);
            assertTrue(recovered.regional());
            assertEquals("tertiary", recovered.type().group());
            assertEquals("2", recovered.beds().get("hvec"));
        } finally {
            emergencyDataService.setCachedSnapshotForTest(null);
        }
        /*
         * [핵심 검증] 마스터 API가 일시 중단되어도 직전 스냅샷의 권역/상급종합 등급을 잃지 않고 실시간 병상만 최신화함.
         */
    }

    @Test
    @DisplayName("11. 독립 분리된 BoundedTtlCache는 최대 엔트리 상한을 초과하지 않고 LRU 항목을 자동 퇴거해야 한다")
    void testBoundedCacheEvictsLeastRecentlyUsedEntries() {
    /*
     * [내가 지은 이름] testBoundedCacheEvictsLeastRecentlyUsedEntries : 유틸 패키지 BoundedTtlCache LRU 검증임.
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
         * [핵심 검증] 최근 조회된 k1은 살아남고 가장 오래된 k2가 정확히 퇴거됨.
         */
    }

    @Test
    @DisplayName("12. 응급실 핑퐁 방지: '불가능' 한글 공지 오판 버그가 차단되고 초과수용 병원보다 여유 병상 병원이 우선 추천되어야 한다")
    void testOptimalRecommendationAndKoreanNoticeBlocking() {
    /*
     * [내가 지은 이름] testOptimalRecommendationAndKoreanNoticeBlocking :
     *   한국어 '불가능'(내부에 '가능' 문자열 포함) 공지 감지 및 다차원 수용 최적 추천 순위 검증임.
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
        assertEquals("H_AVAILABLE", optimalRanks.get(0).id());
        assertEquals("여유", optimalRanks.get(0).availabilityStatus());
        assertFalse(optimalRanks.get(0).hasBlockingNotice());

        List<HospitalEtaRankDto> generalOptimal = naverDirectionsService.rankHospitalsByDrivingTime(
                List.of(saturatedCloser, availableSlightlyFarther),
                37.3190, 127.9012, 20.0, 5,
                true, true, true, false, false, "all", "optimal", "trafast"
        );
        assertEquals(2, generalOptimal.size());
        assertEquals("H_AVAILABLE", generalOptimal.get(0).id(), "수용 최적 모드에서는 초과수용(-5석) 병원 대신 여유(8석) 병원이 1위가 되어야 합니다.");
        assertEquals("초과수용", generalOptimal.get(1).availabilityStatus());
        assertTrue(generalOptimal.get(1).hasBlockingNotice());
        /*
         * [핵심 검증] 직선거리가 더 가까워도 초과수용(-5석) + 차단 공지 병원은 후순위로 밀리고, 즉시 처치 가능한 병원이 1위로 추천됨을 수학적으로 검증함.
         */
    }

    @Test
    @DisplayName("13. 실제 내장 웹 서버에서 보안 헤더, 정적 리소스, GZIP 압축, ETag 304 재검증이 정상 동작해야 한다")
    void testRootStaticResourcesAndSecurityHeaders() throws Exception {
    /*
     * [내가 지은 이름] testRootStaticResourcesAndSecurityHeaders : HTTP 서버 응답·보안 헤더·ETag 통합 검증임.
     */
        HttpClient client = HttpClient.newHttpClient();

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
        /*
         * [핵심 검증] SecurityHeadersFilter의 보안 헤더 부착 + GZIP 압축 해제 무결성 + Weak ETag 304 Not Modified가 모두 통과해야 함.
         */
    }
}
