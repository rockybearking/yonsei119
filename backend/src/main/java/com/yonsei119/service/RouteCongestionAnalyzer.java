package com.yonsei119.service;

import com.yonsei119.dto.DirectionsResponseDto;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 네이버 Directions API 응답의 주요 도로 요약 구간(`section`) 혼잡도와
 *          평균 시속(`speed`)을 인위적 변조 없이 1:1 그대로 추출하는 교통 파서 컴포넌트
 * - 실행 시점 : 서버 시작 시 `@Component` 싱글톤 빈으로 생성되며,
 *              `NaverDirectionsService.parseDirectionsJson()`에서 호출됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [NaverDirectionsService]          [RouteCongestionAnalyzer]           [RouteSectionDto]
 *                   |                                 |                               |
 *                   |-- 1. buildDetailedSections() -->|                               |  네이버 공식 section 파싱
 *              +----+---------------------------------+-------------------------------+----------+
 *              | [loop : each item in section[]]                                                 |  주요 도로 구간 순회
 *              |    |                                 |-- 2. keep congestion(0..3)    |          |  공식 혼잡도 · 시속 원형 보존
 *              |    |                                 |-- 3. new RouteSectionDto() -->|          |  도로명 비었을 때만 보조 추출
 *              +----+---------------------------------+-------------------------------+----------+
 *                   |<-- 4. List<RouteSectionDto> ----|                               |  구간 요약 리스트 반환
 *                   v                                 v                               v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ String           : 도로명 · 회전 안내 문자열을 다루는 표준 내장 클래스
 *   ㄴ int / Math.max() : 구간 시작 정점 · 개수 · 거리 · 속도를 다루는 기본형 및 수학 메서드
 *   ㄴ List / ArrayList : 파싱된 구간 DTO 목록을 담는 표준 내장 컬렉션
 * - Spring 프레임워크
 *   ㄴ @Component      : 스프링 빈 자동 등록 어노테이션
 * - 프로젝트 내부 타입
 *   ㄴ DirectionsResponseDto.RouteSectionDto : 구간 정보 전달용 중첩 record
 * - 외부 라이브러리
 *   ㄴ Jackson (`JsonNode`) : 네이버 경로 JSON 트리를 탐색하는 노드 클래스
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ NaverDirectionsService.java : `parseDirectionsJson()`
 *   ㄴ Yonsei119BackendTests.java  : Test 5 · Test 9 공식 구간 보존 검증
 * - 프론트엔드 연결처
 *   ㄴ frontend/js/directions-eta.js : 상세 시트 도로 요약 칩 및 초기/2D 폴백 경로선 표시
 *      (WebGL 지도 경로선은 네이버 실시간 `CTT + RTS` 링크를 직접 매칭하여 1:1 일치시킴)
 */
@Component
public class RouteCongestionAnalyzer {

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 네이버 경로 JSON의 `section` 배열을 화면 렌더링용 `RouteSectionDto` 리스트로 변환함
     * - 흐름:
     *   sectionNode 배열 순회 -> 유효 범위(pointIndex >= 0, pointCount > 0) 확인
     *   ㄴ congestion(0~3) 및 speed(km/h)는 네이버 공식 값을 그대로 유지
     *   ㄴ 도로명(name)이 빈 문자열일 때만 resolveFallbackRoadName()으로 교차로 안내에서 이름 보완
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
