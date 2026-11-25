package com.yonsei119.service;

import com.yonsei119.dto.DirectionsResponseDto;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/*
 * [역할 및 실행 시점]
 * - 역할: 네이버 Directions API 응답의 공식 도로 구간(`section`) 혼잡도와 평균 시속을 왜곡 없이 그대로 추출하는 교통 분석기
 * - 실행 시점: 서버 부팅 시 @Component 싱글톤 빈으로 생성되며, NaverDirectionsService.parseDirectionsJson()에서 호출됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   NaverDirectionsService.parseDirectionsJson()
 *   ──> buildDetailedSections(sectionNode, guideNode)
 *       ├── 네이버 공식 `section` 배열 순회 (pointIndex, pointCount, distance, congestion, speed 1:1 보존!)
 *       │   · congestion 0 = 교통정보 없음(기본 파란 경로선 유지)
 *       │   · congestion 1 = 원활(초록) | 2 = 서행(주황) | 3 = 정체(빨강)
 *       └── 도로명(`name`)이 비어 있는 구간만 `guide` 안내 문구에서 도로명 보조 추출 ──> List<RouteSectionDto> 반환
 * - 핵심 버그 수정 원리:
 *   · 기존에는 교차로 회전 안내(`guide`) 소요시간으로 시속을 역산해 공식 혼잡도를 덮어썼기 때문에,
 *     실시간 교통 레이어(`교통` 버튼)와 경로 색상이 어긋나고 교통정보가 없는 도로(0)까지 정체(빨강)로 칠해지던 문제가 있었음.
 *   · 이제 네이버 공식 `section.congestion(0~3)`을 1:1 그대로 전달하여 네이버 지도 실시간 교통정보 색상과 완벽히 일치시킴!
 *
 * [내장 / 프레임워크 / 라이브러리 구분]
 * - Java 표준 내장: List, ArrayList, String, Math
 * - Spring 프레임워크: @Component
 * - 외부 라이브러리: Jackson 3(JsonNode)
 *
 * [사용처 및 IDE 추적 가이드]
 * - 호출처: NaverDirectionsService.parseDirectionsJson()
 * - 프론트엔드 연결부: frontend/js/directions-eta.js의 `buildRouteGeoJson()`, `drawRouteOnMap()`, `getCongestionStyle()`
 * - Java 호출 계층 추적: 메서드명 위에서 `Ctrl + Alt + H`
 */
@Component
public class RouteCongestionAnalyzer {

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 네이버 경로 JSON의 `section` 배열을 화면 렌더링용 `RouteSectionDto` 리스트로 변환함
     * - 흐름:
     *   sectionNode 배열 순회 ──> 유효 범위(pointIndex >= 0, pointCount > 0) 확인
     *   ├── congestion(0~3) 및 speed(km/h)는 네이버 공식 값을 그대로 유지
     *   └── 도로명(name)이 빈 문자열일 때만 resolveFallbackRoadName()으로 교차로 안내에서 이름 보완
     * - 사용처: NaverDirectionsService.parseDirectionsJson()
     */
    public List<DirectionsResponseDto.RouteSectionDto> buildDetailedSections(
            JsonNode sectionNode,
            JsonNode guideNode
    ) {
        List<DirectionsResponseDto.RouteSectionDto> sections = new ArrayList<>();
        if (sectionNode == null || !sectionNode.isArray()) {
            return sections;
        }

        for (JsonNode sec : sectionNode) {
            int pointIndex = sec.path("pointIndex").asInt(-1);
            int pointCount = sec.path("pointCount").asInt(0);
            if (pointIndex < 0 || pointCount <= 0) {
                continue;
            }

            int secDistance = Math.max(0, sec.path("distance").asInt(0));
            String secName = sec.path("name").asString("").trim();
            int rawCongestion = sec.path("congestion").asInt(0);
            int congestion = (rawCongestion >= 0 && rawCongestion <= 3) ? rawCongestion : 0;
            int speed = Math.max(0, sec.path("speed").asInt(0));

            String resolvedName = secName.isEmpty()
                    ? resolveFallbackRoadName(guideNode, pointIndex, pointCount)
                    : secName;

            sections.add(new DirectionsResponseDto.RouteSectionDto(
                    pointIndex,
                    pointCount,
                    secDistance,
                    resolvedName,
                    congestion,
                    speed
            ));
        }

        return sections;
    }

    /** 공식 `section.name`이 비어 있을 때만 해당 구간과 겹치는 `guide` 문구에서 보조 구간명을 추출함 */
    private static String resolveFallbackRoadName(JsonNode guideNode, int startIdx, int pointCount) {
        if (guideNode != null && guideNode.isArray()) {
            int endIdx = startIdx + pointCount - 1;
            for (JsonNode g : guideNode) {
                int gIdx = g.path("pointIndex").asInt(-1);
                if (gIdx < startIdx || gIdx > endIdx) {
                    continue;
                }
                String instructions = g.path("instructions").asString("").trim();
                String extracted = extractLabelFromInstructions(instructions);
                if (!extracted.isEmpty()) {
                    return extracted;
                }
            }
        }
        return "주행 구간";
    }

    private static String extractLabelFromInstructions(String instructions) {
        if (instructions == null || instructions.isEmpty()) {
            return "";
        }
        int fromPos = instructions.indexOf("에서 ");
        if (fromPos > 0) {
            return instructions.substring(0, fromPos).trim();
        }
        int q1 = instructions.indexOf('\'');
        int q2 = q1 >= 0 ? instructions.indexOf('\'', q1 + 1) : -1;
        if (q1 >= 0 && q2 > q1 + 1) {
            String quoted = instructions.substring(q1 + 1, q2).trim();
            int commaIdx = quoted.indexOf(',');
            return commaIdx > 0 ? quoted.substring(0, commaIdx).trim() : quoted;
        }
        return "";
    }
}
