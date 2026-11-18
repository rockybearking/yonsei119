package com.yonsei119.service;

import com.yonsei119.dto.DirectionsResponseDto;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;
/*
 * [패키지 및 임포트]
 * - com.yonsei119.service : 서비스 계층 클래스들을 묶어 관리하는 패키지 선언임.
 * - package, import : RouteCongestionAnalyzer 클래스의 소속 패키지와 외부 패키지 타입 사용을 선언하는 예약어임.
 *
 * [자바/라이브러리 내장 타입 (이름 변경 불가)]
 * - JsonNode (tools.jackson.databind) : Spring Boot 4 내장 Jackson 3의 JSON 트리 노드 타입임.
 * - List, ArrayList (java.util) : 순서 있는 목록 인터페이스와 동적 배열 구현체임.
 *
 * [프로젝트 내부 참조 타입]
 * - DirectionsResponseDto (com.yonsei119.dto) : 길찾기 응답과 RouteSectionDto를 담은 DTO 레코드임.
 */

@Component
public class RouteCongestionAnalyzer {
/*
 * [스프링 내장 어노테이션]
 * - @Component 정의 (출처: org.springframework.stereotype.Component, 이름 변경 불가)
 *   · 역할 : 개발자가 작성한 클래스를 컴포넌트 스캔 대상에 포함해 스프링 싱글톤 빈으로 자동 생성·등록하는 범용 어노테이션임.
 * - @Component 현재 코드 적용
 *   · 적용 대상 : RouteCongestionAnalyzer 클래스 — 도로 구간별 평균 시속과 혼잡도를 계산하는 분석기 빈임.
 *   · 작동 원리 : 컴포넌트 스캔 시 클래스 메타데이터를 읽어 싱글톤 빈 1개를 등록하고 다른 빈 생성자 DI로 주입함.
 *   · 실행 시점 : 스프링 애플리케이션 부팅 및 ApplicationContext 초기화 단계에서 빈 생성과 의존성 주입이 완료됨.
 *   · 비교 : 서비스 계층 @Service, 저장소 @Repository, 웹 API @RestController는 기능상 동일하고 역할 의미만 다름.
 *
 * [자바 문법]
 * - public class : 다른 패키지에서도 접근 가능한 공개 클래스 선언부임.
 *
 * [클래스명]
 * - RouteCongestionAnalyzer : 도로 구간별 평균 시속을 계산해 혼잡도와 도로명 라벨을 산출하는 분석기임.
 *
 * [호출 경로]
 * - EmergencyApiController (GET /api/directions) -> NaverDirectionsService.getDrivingRoute(...)
 *   └── parseDirectionsJson(...) -> congestionAnalyzer.buildDetailedSections(...) 호출로 실행됨.
 *
 * [동작 흐름]
 * - 1단계: 원본 JSON의 section 배열 파싱 -> rawSections 목록 수집
 * - 2단계: guide 배열의 거리·시간 역산 -> 구간별 평균 시속(km/h) 계산
 * - 3단계: 고속도로 여부 판별 -> 속도 기준 혼잡도 코드(1: 원활, 2: 서행, 3: 정체) 분류
 * - 4단계: 겹치지 않는 원본 서행·정체(>= 2) 구간 보완 -> 최종 구간 리스트 반환
 */

    public List<DirectionsResponseDto.RouteSectionDto> buildDetailedSections(
            JsonNode sectionNode,
            JsonNode guideNode
    ) {
    /*
     * [자바 문법]
     * - public : 다른 패키지에서도 호출 가능한 접근 제어자임.
     * - List<DirectionsResponseDto.RouteSectionDto> : 반환 리스트 원소를 RouteSectionDto로 제한한 제네릭임.
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - List (java.util), JsonNode (tools.jackson.databind)
     *
     * [프로젝트 내부 참조 타입]
     * - DirectionsResponseDto.RouteSectionDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: buildDetailedSections
     * - sectionNode : 네이버 응답의 "section" 배열 노드임.
     * - guideNode : 네이버 응답의 "guide" 배열 노드임.
     */
        List<DirectionsResponseDto.RouteSectionDto> rawSections = new ArrayList<>();
        if (sectionNode != null && sectionNode.isArray()) {
            for (JsonNode sec : sectionNode) {
                int pointIndex = sec.path("pointIndex").asInt(0);
                int pointCount = sec.path("pointCount").asInt(0);
                int secDistance = sec.path("distance").asInt(0);
                String secName = sec.path("name").asString("").trim();
                int congestion = sec.path("congestion").asInt(0);
                int speed = sec.path("speed").asInt(0);
                if (pointCount > 0 && pointIndex >= 0) {
                    rawSections.add(new DirectionsResponseDto.RouteSectionDto(
                            pointIndex, pointCount, secDistance, secName, congestion, speed
                    ));
                }
            }
        }

        List<DirectionsResponseDto.RouteSectionDto> detailed = new ArrayList<>();
        boolean hasValidGuideTiming = false;

        if (guideNode != null && guideNode.isArray()) {
            int prevIdx = 0;
            for (JsonNode g : guideNode) {
                int toIdx = g.path("pointIndex").asInt(-1);
                int distMeters = g.path("distance").asInt(0);
                long durMs = g.path("duration").asLong(0L);
                int guideType = g.path("type").asInt(0);
                String instructions = g.path("instructions").asString("").trim();

                if (toIdx > prevIdx && distMeters > 0 && durMs > 0) {
                    hasValidGuideTiming = true;
                    int pointCount = toIdx - prevIdx;
                    double speedExact = (distMeters / 1000.0) / (durMs / 3_600_000.0);
                    int speedKmh = Math.max(1, (int) Math.round(speedExact));

                    int midIdx = prevIdx + (pointCount / 2);
                    DirectionsResponseDto.RouteSectionDto matchedSec = findOverlappingSection(rawSections, midIdx);
                    String secRoadName = matchedSec != null ? matchedSec.name() : "";

                    boolean expressway = isExpresswaySegment(secRoadName, instructions, guideType, speedKmh);
                    int congestion = classifyCongestionBySpeed(speedKmh, expressway);

                    if (matchedSec != null && matchedSec.congestion() > congestion && speedKmh < 35) {
                        congestion = matchedSec.congestion();
                    }

                    String label = resolveSegmentLabel(secRoadName, instructions);
                    detailed.add(new DirectionsResponseDto.RouteSectionDto(
                            prevIdx, pointCount, distMeters, label, congestion, speedKmh
                    ));
                    prevIdx = toIdx;
                } else if (toIdx > prevIdx) {
                    prevIdx = toIdx;
                }
            }
        }

        if (!hasValidGuideTiming) {
            return rawSections;
        }

        for (DirectionsResponseDto.RouteSectionDto raw : rawSections) {
            if (raw.congestion() >= 2 && !hasOverlappingDetailedSection(detailed, raw)) {
                detailed.add(raw);
            }
        }
        return detailed;
        /*
         * [자바 문법]
         * - int, long, double, boolean : 기본형 변수 타입 선언임.
         * - 0L, 3_600_000.0 : long 리터럴과 자릿수 구분 밑줄을 쓴 실수 리터럴임.
         * - if / else if, 향상된 for(:), 삼항 연산자(? :), (int) 강제 형변환
         * - new ArrayList<>() : 다이아몬드 연산자로 좌변 제네릭 타입을 컴파일러가 추론함.
         *
         * [지역 변수명]
         * - rawSections, sec, pointIndex, pointCount, secDistance, secName, congestion, speed
         * - detailed, hasValidGuideTiming, prevIdx, g, toIdx, distMeters, durMs, guideType
         * - instructions, speedExact, speedKmh, midIdx, matchedSec, secRoadName, expressway, label, raw
         *
         * [프로젝트 내부 생성자]
         * - new DirectionsResponseDto.RouteSectionDto(...) : 구간 혼잡도 DTO 레코드 생성자임.
         *
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - new ArrayList<>() : 빈 동적 배열 리스트를 생성함.
         * - .isArray() (JsonNode) : 대상 JsonNode가 JSON 배열인지 boolean으로 반환함.
         * - .path("키") (JsonNode) : 키가 없어도 MissingNode를 반환해 NullPointerException을 막음.
         * - .get("키") (JsonNode 비교) : 키가 없을 때 null을 반환하므로 연쇄 호출 시 예외 위험이 있음.
         * - .asInt(기본값), .asLong(기본값), .asString(기본값) (JsonNode) : 실패 시 기본값을 반환함.
         * - .trim() (String), .add(요소) (List) : 공백을 제거하거나 리스트 끝에 요소를 추가함.
         * - Math.round(double), Math.max(int, int) (java.lang.Math) : 반올림 및 최소 1km/h 보정함.
         *
         * [동작 흐름]
         * - 1단계: sectionNode 순회 -> pointCount > 0이고 pointIndex >= 0인 유효 구간만 rawSections에 적재
         * - 2단계: guideNode 순회 -> toIdx > prevIdx && distMeters > 0 && durMs > 0 확인
         *   ├── 평균 시속 계산: (distMeters / 1000.0) / (durMs / 3_600_000.0) -> speedKmh 반올림
         *   ├── 중앙 점(midIdx)으로 findOverlappingSection 호출 -> 고속도로 판별 -> 혼잡도 분류
         *   └── speedKmh < 35이면서 원본 혼잡도가 더 높으면 원본 혼잡도 채택 -> detailed에 추가
         * - 3단계: 유효한 guide 타이밍 없음 -> rawSections 즉시 반환
         * - 4단계: 겹치지 않는 congestion >= 2 원본 구간 보완 추가 -> detailed 반환
         */
    }

    private static boolean hasOverlappingDetailedSection(
            List<DirectionsResponseDto.RouteSectionDto> detailed,
            DirectionsResponseDto.RouteSectionDto candidate
    ) {
    /*
     * [자바 문법]
     * - private static boolean : 클래스 내부 전용 정적 논리 메서드 선언임.
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - List (java.util)
     *
     * [프로젝트 내부 참조 타입]
     * - DirectionsResponseDto.RouteSectionDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: hasOverlappingDetailedSection
     * - detailed : 이미 세분화된 구간 리스트임.
     * - candidate : 추가 여부를 판별할 원본 구간 객체임.
     */
        int candStart = candidate.pointIndex();
        int candEnd = candStart + candidate.pointCount();
        for (DirectionsResponseDto.RouteSectionDto det : detailed) {
            int detStart = det.pointIndex();
            int detEnd = detStart + det.pointCount();
            if (Math.max(candStart, detStart) < Math.min(candEnd, detEnd)) {
                return true;
            }
        }
        return false;
        /*
         * [자바 문법]
         * - int, for (:), if, return
         *
         * [지역 변수명]
         * - candStart, candEnd, det, detStart, detEnd
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - Math.max(int, int), Math.min(int, int) (java.lang.Math) : 두 정수의 최댓값·최솟값을 반환함.
         *
         * [동작 흐름]
         * - 두 구간 [candStart, candEnd]와 [detStart, detEnd] 범위 비교
         *   ├── Math.max(candStart, detStart) < Math.min(candEnd, detEnd) -> 겹침(true) 반환
         *   └── 모든 구간과 겹치지 않음 -> false 반환
         */
    }

    private static DirectionsResponseDto.RouteSectionDto findOverlappingSection(
            List<DirectionsResponseDto.RouteSectionDto> rawSections,
            int targetIdx
    ) {
    /*
     * [자바 문법]
     * - private static, int
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - List (java.util)
     *
     * [프로젝트 내부 참조 타입]
     * - DirectionsResponseDto.RouteSectionDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: findOverlappingSection
     * - rawSections : 원본 도로 구간 목록임.
     * - targetIdx : 찾을 경로 폴리라인 중앙 점 인덱스임.
     */
        for (DirectionsResponseDto.RouteSectionDto sec : rawSections) {
            int start = sec.pointIndex();
            int end = start + sec.pointCount();
            if (targetIdx >= start && targetIdx <= end) {
                return sec;
            }
        }
        return null;
        /*
         * [자바 문법]
         * - for (:), if, 비교 연산자(>=, <=), 논리곱(&&), return null
         *
         * [지역 변수명]
         * - sec, start, end
         *
         * [동작 흐름]
         * - rawSections 순회 -> targetIdx >= start && targetIdx <= end 검사
         *   ├── 범위 일치 구간 발견 -> 일치한 RouteSectionDto 객체 즉시 반환
         *   └── 일치 구간 없음 -> null 반환
         */
    }

    private static boolean isExpresswaySegment(
            String sectionName,
            String instructions,
            int guideType,
            int speedKmh
    ) {
    /*
     * [자바 문법]
     * - private static boolean, int
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String (java.lang.String)
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: isExpresswaySegment
     * - sectionName (원본 도로명), instructions (안내 문구), guideType (안내 코드), speedKmh (평균 시속)
     */
        if (speedKmh >= 68 || (guideType >= 50 && guideType <= 53)) {
            return true;
        }
        String combined = sectionName + " " + instructions;
        return combined.contains("고속도로")
                || combined.contains("순환선")
                || combined.contains("고속화")
                || combined.contains("올림픽대로")
                || combined.contains("강변북로")
                || combined.contains("동부간선")
                || combined.contains("서부간선")
                || combined.contains("북부간선")
                || combined.contains("내부순환")
                || combined.contains("분당수서")
                || combined.contains("톨게이트")
                || combined.contains("분기점");
        /*
         * [자바 문법]
         * - if, 논리합(||), 논리곱(&&), 문자열 결합(+), return
         *
         * [지역 변수명]
         * - combined
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .contains(CharSequence) (String) : 문자열 안에 특정 단어가 포함되어 있는지 판별함.
         *
         * [동작 흐름]
         * - speedKmh >= 68 또는 guideType이 50~53(고속도로 진출입) -> 즉시 true 반환
         * - └── 아니면 sectionName + " " + instructions에서 고속도로 키워드 포함 여부 반환
         */
    }

    public static int classifyCongestionBySpeed(int speedKmh, boolean expressway) {
    /*
     * [자바 문법]
     * - public static int, boolean
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: classifyCongestionBySpeed
     * - speedKmh : 구간 평균 시속(km/h)임.
     * - expressway : 고속도로·도시고속화도로 여부임.
     */
        if (expressway) {
            if (speedKmh < 40) {
                return 3;
            }
            if (speedKmh < 70) {
                return 2;
            }
            return 1;
        }
        if (speedKmh < 16) {
            return 3;
        }
        if (speedKmh < 30) {
            return 2;
        }
        return 1;
        /*
         * [자바 문법]
         * - if, 비교 연산자(<), return
         *
         * [동작 흐름]
         * - expressway == true (고속도로) -> < 40 정체(3) | < 70 서행(2) | >= 70 원활(1)
         * - expressway == false (일반도로) -> < 16 정체(3) | < 30 서행(2) | >= 30 원활(1)
         */
    }

    private static String resolveSegmentLabel(String sectionName, String instructions) {
    /*
     * [자바 문법]
     * - private static
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String (java.lang.String)
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: resolveSegmentLabel
     * - sectionName : 원본 section 도로명임.
     * - instructions : 교차로 안내 문구임.
     */
        String fromIdxName = "";
        int fromPos = instructions.indexOf("에서 ");
        if (fromPos > 0) {
            fromIdxName = instructions.substring(0, fromPos).trim();
        }

        String quotedName = "";
        int q1 = instructions.indexOf('\'');
        int q2 = q1 >= 0 ? instructions.indexOf('\'', q1 + 1) : -1;
        if (q1 >= 0 && q2 > q1 + 1) {
            quotedName = instructions.substring(q1 + 1, q2).trim();
            int commaIdx = quotedName.indexOf(',');
            if (commaIdx > 0) {
                quotedName = quotedName.substring(0, commaIdx).trim();
            }
        }

        if (!sectionName.isEmpty()) {
            if (!fromIdxName.isEmpty() && !fromIdxName.equals(sectionName)) {
                return sectionName + "·" + fromIdxName;
            }
            return sectionName;
        }
        if (!fromIdxName.isEmpty() && !quotedName.isEmpty() && !quotedName.startsWith(fromIdxName)) {
            return fromIdxName + "→" + quotedName;
        }
        if (!fromIdxName.isEmpty()) {
            return fromIdxName;
        }
        if (!quotedName.isEmpty()) {
            return quotedName;
        }
        if (instructions.contains("목적지")) {
            return "병원 진입 구간";
        }
        return "주행 구간";
        /*
         * [자바 문법]
         * - int, char 리터럴('\''), if, 삼항 연산자(? :), 논리 부정 연산자, return
         *
         * [지역 변수명]
         * - fromIdxName, fromPos, quotedName, q1, q2, commaIdx
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .indexOf(String/int), .indexOf(int, int) (String) : 첫 위치를 찾으며 없으면 -1을 반환함.
         * - .substring(int beginIndex, int endIndex) (String) : 시작 이상 끝 미만 부분 문자열을 자름.
         * - .trim(), .isEmpty(), .equals(Object), .startsWith(String), .contains(CharSequence) (String)
         *
         * [동작 흐름]
         * - 1단계: instructions에서 "에서 " 앞(fromIdxName)과 작은따옴표 안 방면명(quotedName) 추출
         * - 2단계: sectionName 있음 -> fromIdxName과 다르면 "도로명·교차로명", 같으면 sectionName 반환
         * - 3단계: sectionName 없음 -> fromIdxName→quotedName -> fromIdxName -> quotedName 순으로 반환
         * - 4단계: 추출값 모두 없음 -> "목적지" 포함 시 "병원 진입 구간", 그 외 "주행 구간" 반환
         */
    }
}
