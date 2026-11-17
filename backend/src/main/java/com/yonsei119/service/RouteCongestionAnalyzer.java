package com.yonsei119.service;

import com.yonsei119.dto.DirectionsResponseDto;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;
/*
 * [자바 문법] package, import : 주행 경로의 교차로(guide) 소요 시간으로부터 구간별 실주행 속도와 혼잡도(원활·서행·정체)를 세밀하게 분해하는 독립 분석기 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - JsonNode (출처: tools.jackson.databind) : Spring Boot 4 내장 Jackson 3 JSON 트리 탐색 객체임 (이름 변경 불가).
 * - List, ArrayList : 자바 표준 순서 목록 타입임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @Component (출처: org.springframework.stereotype) : NaverDirectionsService와 병렬로 분리된 독립 스프링 빈으로 등록함.
 */

@Component
public class RouteCongestionAnalyzer {
/*
 * [스프링/라이브러리 내장 어노테이션] @Component
 * [자바 문법] public class
 * [내가 지은 이름] RouteCongestionAnalyzer : 도로 구간별 혼잡도 정밀 보정 및 도로명 라벨 추출 전담 분석기임.
 * [핵심 원리 & 교통방송 비유]
 * - 네이버 원본 응답의 section 배열은 큰 도로 하나를 통째로 뭉뚱그려 내려보내는 경우가 많음.
 * - 이 분석기는 교차로 안내(guide) 배열의 거리(m)와 시간(ms)으로 구간 평균 시속(km/h)을 역산하고,
 *   고속도로(40/70km/h 기준)인지 일반도로(16/30km/h 기준)인지 구분하여 초록(원활)·주황(서행)·빨강(정체) 색상을 정밀하게 쪼개 줌.
 */

    public List<DirectionsResponseDto.RouteSectionDto> buildDetailedSections(
            JsonNode sectionNode,
            JsonNode guideNode
    ) {
    /*
     * [자바 문법] public : 원본 section JSON 노드와 guide JSON 노드를 받아 세분화된 RouteSectionDto 리스트를 반환함.
     * [자바/스프링/라이브러리 내장 도구(타입)] List<...>, JsonNode (이름 변경 불가)
     * [내가 지은 이름] buildDetailedSections(함수명), sectionNode, guideNode
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
         * [스프링/자바 내장 함수] JsonNode.path(키) : 키가 없어도 NullPointerException 없이 안전하게 MissingNode를 반환함 (형제 함수: .get(키)는 없으면 null 반환).
         * [정밀 분해 변환 예시]
         *   원본 section: [서원대로 전체 2000m, 서행(2)]
         *   + guide 타이밍 역산:
         *     ├── 구간 0~2 (1200m, 90초 = 48km/h) ──> 원활(1, 초록색 유지)
         *     └── 구간 2~4 (800m, 240초 = 12km/h) ──> 정체(3, 빨간색 경고)
         *   (이미 분해된 구간 위에 원본 section을 중복 덧칠하지 않아 원활 초록 구간이 서행으로 오염되지 않음.)
         */
    }

    private static boolean hasOverlappingDetailedSection(
            List<DirectionsResponseDto.RouteSectionDto> detailed,
            DirectionsResponseDto.RouteSectionDto candidate
    ) {
    /*
     * [자바 문법] private static boolean : 후보 구간이 이미 세분화된 구간과 좌표 인덱스상 겹치는지 검사함.
     * [내가 지은 이름] hasOverlappingDetailedSection, detailed, candidate
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
         * [수학 원리] 두 선분 [candStart, candEnd]와 [detStart, detEnd]의 교집합 길이가 0보다 크면 겹침(true)으로 판정함.
         */
    }

    private static DirectionsResponseDto.RouteSectionDto findOverlappingSection(
            List<DirectionsResponseDto.RouteSectionDto> rawSections,
            int targetIdx
    ) {
    /*
     * [자바 문법] private static : 특정 폴리라인 점 번호(targetIdx)를 감싸고 있는 원본 도로 구간을 찾아 도로명을 가져옴.
     * [내가 지은 이름] findOverlappingSection, rawSections, targetIdx
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
         * [자바 문법] return null : 일치하는 원본 구간이 없으면 null을 반환함.
         */
    }

    private static boolean isExpresswaySegment(
            String sectionName,
            String instructions,
            int guideType,
            int speedKmh
    ) {
    /*
     * [자바 문법] private static boolean : 도로명·안내코드·평균속도를 종합해 고속도로/도시고속화도로 구간인지 판별함.
     * [내가 지은 이름] isExpresswaySegment, sectionName, instructions, guideType, speedKmh
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
         * [핵심 원리] 고속도로는 시속 50km/h라도 평소보다 막히는 '서행'인 반면, 시내 일반도로는 시속 50km/h면 매우 '원활'이므로 기준표를 분리해야 정확함.
         */
    }

    public static int classifyCongestionBySpeed(int speedKmh, boolean expressway) {
    /*
     * [자바 문법] public static int : 평균 시속(speedKmh)을 혼잡도 코드(1: 원활, 2: 서행, 3: 정체)로 변환함.
     * [내가 지은 이름] classifyCongestionBySpeed, speedKmh, expressway
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
         * [속도 기준표 요약]
         * - 고속도로 : 40 미만=정체(3), 40~69=서행(2), 70 이상=원활(1)
         * - 일반도로 : 16 미만=정체(3), 16~29=서행(2), 30 이상=원활(1)
         */
    }

    private static String resolveSegmentLabel(String sectionName, String instructions) {
    /*
     * [자바 문법] private static : 교차로 안내 문구("일산로에서 '원주세브란스' 방면 우회전")에서 핵심 도로·교차로 이름만 깔끔히 뽑아냄.
     * [내가 지은 이름] resolveSegmentLabel, sectionName, instructions
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
         * [스프링/자바 내장 함수] .indexOf(...), .substring(시작, 끝), .startsWith(...) (이름 변경 불가)
         */
    }
}
