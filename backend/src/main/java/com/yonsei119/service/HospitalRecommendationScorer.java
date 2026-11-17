package com.yonsei119.service;

import com.yonsei119.dto.HospitalDto;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
/*
 * [자바 문법] package, import : '응급실 핑퐁(재이송) 방지'를 위해 주행시간(ETA) + 병상 여유도 + 긴급 차단 공지 + 증상별 수용성을 종합 평가하는 도메인 서비스 패키지 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)] LocalDateTime, ZoneId, DateTimeFormatter, Instant, Pattern, List, Map, Locale (이름 변경 불가)
 * [스프링/라이브러리 내장 어노테이션] @Component (출처: org.springframework.stereotype) : 스프링 컨테이너가 자동 생성·주입하는 평가 엔진 컴포넌트임.
 */

@Component
public class HospitalRecommendationScorer {
/*
 * [스프링/라이브러리 내장 어노테이션] @Component
 * [자바 문법] public class
 * [내가 지은 이름] HospitalRecommendationScorer : 병원 수용 가능성 평가·증상 프리셋 매칭·최적 추천 점수 산출 전담 클래스임.
 * [핵심 원리 & 구급 상황실 비유]
 * - 단순히 '거리만 가까운 병원'으로 갔다가 만실(-5석 초과수용)이거나 전문의 부재 공지가 떠서 회차(응급실 핑퐁)하는 비극을 막기 위해,
 * - 주행 소요시간(분)에 [병상 포화 페널티 + 긴급 차단 공지 페널티 - 여유 병상 보너스]를 합산한 '실질 수용 추천 점수'를 계산함.
 */

    private static final ZoneId KST_ZONE = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter API_DTM_FORMAT = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");
    private static final Pattern BLOCKING_KEYWORD_PATTERN =
            Pattern.compile("(불가능|불가|차단|수용\\s*불가|진료\\s*불가|수술\\s*불가|시술\\s*불가|부재|중단|마감)");
    private static final Pattern POSITIVE_ONLY_PATTERN =
            Pattern.compile("(제한\\s*없음|정상\\s*진료|정상\\s*운영|(?<!불)가능|원활)");
    /*
     * [자바 문법] private static final
     * [자바/스프링/라이브러리 내장 도구(타입)] Pattern, ZoneId, DateTimeFormatter (이름 변경 불가)
     * [내가 지은 이름] BLOCKING_KEYWORD_PATTERN, POSITIVE_ONLY_PATTERN
     * [버그 원천 차단 핵심 원리]
     * - 한국어에서 "불가능" 안에는 "가능"이라는 글자가 포함되어 있음.
     * - 따라서 부정형 후방탐색 `(?<!불)가능`을 사용하고, 차단 키워드(BLOCKING_KEYWORD_PATTERN)를 먼저 검사하여
     *   "뇌출혈 수술 불가능"이나 "일반 진료 가능하나 심근경색 시술 불가" 문구가 정상으로 오판되는 치명적 버그를 완벽히 막음.
     */

    private static final Map<String, SymptomRule> SYMPTOM_RULES = Map.of(
            "pediatric", new SymptomRule(
                    "소아응급",
                    List.of("hv28", "hv32", "hv33", "hv37", "hv15", "hv16"),
                    List.of("mkioskty10", "mkioskty12", "mkioskty14", "mkioskty15", "mkioskty27"),
                    List.of("소아", "영유아", "신생아")
            ),
            "stroke", new SymptomRule(
                    "뇌졸중·뇌출혈",
                    List.of("hv6", "hvcc"),
                    List.of("mkioskty2", "mkioskty3", "mkioskty4"),
                    List.of("뇌출혈", "뇌경색", "거미막하", "지주막하", "신경외과", "신경과")
            ),
            "cardiac", new SymptomRule(
                    "흉통·심근경색",
                    List.of("hv34", "hvccc"),
                    List.of("mkioskty1", "mkioskty5"),
                    List.of("심근경색", "관상동맥", "흉부대동맥", "대동맥", "심장내과")
            ),
            "trauma", new SymptomRule(
                    "중증외상",
                    List.of("hv60", "hv61", "hv9", "hv38", "hv39"),
                    List.of("mkioskty20", "mkioskty21"),
                    List.of("외상", "사지접합", "수족지접합")
            ),
            "obstetrics", new SymptomRule(
                    "산부인과·분만",
                    List.of("hv42"),
                    List.of("mkioskty16", "mkioskty17", "mkioskty18"),
                    List.of("분만", "산과", "부인과", "산부인과", "제왕절개")
            ),
            "burn", new SymptomRule(
                    "중증화상",
                    List.of("hv8", "hv43"),
                    List.of("mkioskty19"),
                    List.of("화상")
            ),
            "dialysis", new SymptomRule(
                    "응급투석",
                    List.of("hvcrrtayn"),
                    List.of("mkioskty22", "mkioskty23"),
                    List.of("투석", "혈액투석", "인공신장", "crrt")
            )
    );
    /*
     * [스프링/자바 내장 함수] Map.of(...), List.of(...) (이름 변경 불가)
     * [내가 지은 이름] SYMPTOM_RULES (프론트엔드 원터치 증상 필터 칩 7종과 1:1 대응하는 질환·병상·차단공지 매핑 사전)
     */

    public static Integer parseBedCount(String rawErBeds) {
    /*
     * [자바 문법] public static : 원본 문자열 병상 수("-4", "0", "7", "")를 부호 있는 정수(Integer) 또는 결측(null)으로 변환함.
     * [자바/스프링/라이브러리 내장 도구(타입)] Integer : null(미보고)을 표현할 수 있는 객체형 정수 래퍼 타입임 (기본형 int는 null 저장 불가).
     * [내가 지은 이름] parseBedCount, rawErBeds
     */
        if (rawErBeds == null || rawErBeds.isBlank()) {
            return null;
        }
        String trimmed = rawErBeds.trim();
        if (!trimmed.matches("^-?\\d+$")) {
            return null;
        }
        try {
            return Integer.parseInt(trimmed);
        } catch (NumberFormatException ex) {
            return null;
        }
        /*
         * [변환 예시] "-4" -> -4(초과수용), "0" -> 0(만실), "5" -> 5(여유), "" -> null(미보고)
         */
    }

    public String classifyBedAvailabilityStatus(String rawErBeds) {
    /*
     * [자바 문법] public : 응급실 일반병상(hvec) 문자열을 5단계 한글 신호등 상태로 분류함.
     * [내가 지은 이름] classifyBedAvailabilityStatus, rawErBeds
     */
        Integer count = parseBedCount(rawErBeds);
        if (count == null) {
            return "미보고";
        }
        if (count < 0) {
            return "초과수용";
        }
        if (count == 0) {
            return "만실";
        }
        if (count <= 2) {
            return "혼잡";
        }
        return "여유";
        /*
         * [병상 신호등 분류 기준표]
         *   count >= 3 : "여유" (초록) | 1~2 : "혼잡" (주황) | 0 : "만실" (빨강) | < 0 : "초과수용" (진빨강) | null : "미보고" (회색)
         */
    }

    public boolean isNoticeBlocking(Map<String, String> messageItem) {
    /*
     * [자바 문법] public boolean : 단일 공지 메시지 맵이 실제 '진료·수용 차단' 공지인지 정밀 판별함.
     * [내가 지은 이름] isNoticeBlocking, messageItem
     */
        if (messageItem == null || messageItem.isEmpty()) {
            return false;
        }
        String yon = messageItem.getOrDefault("symoutdspyon", "").trim();
        if ("차단".equals(yon)) {
            return true;
        }
        String body = messageItem.getOrDefault("symblkmsg", "").trim();
        if (body.isEmpty()) {
            return false;
        }
        if (BLOCKING_KEYWORD_PATTERN.matcher(body).find()) {
            return true;
        }
        if (POSITIVE_ONLY_PATTERN.matcher(body).find()) {
            return false;
        }
        return false;
        /*
         * [판별 결과 예시]
         * - "뇌출혈 수술 불가능 (전문의 부재)" -> BLOCKING_KEYWORD_PATTERN("불가능", "부재") 매칭 -> true 반환
         * - "응급실 정상 진료 가능 (제한 없음)" -> 차단어 없음 & POSITIVE_ONLY_PATTERN 매칭 -> false 반환
         */
    }

    public boolean isMessageCurrentlyActive(Map<String, String> messageItem, long nowEpochMillis) {
    /*
     * [자바 문법] public boolean, long : 공지 시작일시(symblksttdtm)와 종료일시(symblkenddtm)가 현재 시각에 유효한지 검사함.
     * [내가 지은 이름] isMessageCurrentlyActive, messageItem, nowEpochMillis
     */
        Long startMs = parseApiDateMillis(messageItem.get("symblksttdtm"));
        Long endMs = parseApiDateMillis(messageItem.get("symblkenddtm"));
        return (startMs == null || startMs <= nowEpochMillis)
                && (endMs == null || endMs > nowEpochMillis);
        /*
         * [핵심 원리] 이미 종료 시각이 지난 옛날 공지 때문에 병원이 억울하게 감점되지 않도록 현재 활성 공지만 걸러냄.
         */
    }

    public boolean hasActiveBlockingNotice(HospitalDto hospital) {
    /*
     * [자바 문법] public boolean : 해당 병원에 현재 유효한 응급/중증 차단 공지가 1건이라도 있는지 확인함.
     * [내가 지은 이름] hasActiveBlockingNotice, hospital
     */
        if (hospital == null || hospital.messages() == null || hospital.messages().isEmpty()) {
            return false;
        }
        long now = Instant.now().toEpochMilli();
        for (Map<String, String> msg : hospital.messages()) {
            if (isMessageCurrentlyActive(msg, now) && isNoticeBlocking(msg)) {
                return true;
            }
        }
        return false;
        /*
         * [스프링/자바 내장 함수] Instant.now().toEpochMilli() (현재 UTC 밀리초 타임스탬프, 이름 변경 불가)
         */
    }

    public boolean matchesSymptomPreset(HospitalDto hospital, String rawSymptomPreset) {
    /*
     * [자바 문법] public boolean : 사용자가 선택한 증상 프리셋(예: "stroke", "pediatric")을 해당 병원이 현재 수용 가능한지 교차 검증함.
     * [내가 지은 이름] matchesSymptomPreset, hospital, rawSymptomPreset
     */
        if (rawSymptomPreset == null || rawSymptomPreset.isBlank() || "all".equalsIgnoreCase(rawSymptomPreset.trim())) {
            return true;
        }
        String key = rawSymptomPreset.trim().toLowerCase(Locale.ROOT);
        SymptomRule rule = SYMPTOM_RULES.get(key);
        if (rule == null) {
            return true;
        }

        long now = Instant.now().toEpochMilli();
        if (hospital.messages() != null) {
            for (Map<String, String> msg : hospital.messages()) {
                if (!isMessageCurrentlyActive(msg, now) || !isNoticeBlocking(msg)) {
                    continue;
                }
                String combined = (msg.getOrDefault("symtypcodmag", "") + " "
                        + msg.getOrDefault("trtprtcodmag", "") + " "
                        + msg.getOrDefault("symblkmsg", "")).toLowerCase(Locale.ROOT);
                if (combined.contains("응급실") && (combined.contains("수용 불가")
                        || combined.contains("수용불가")
                        || combined.contains("진료 불가")
                        || combined.contains("진료불가")
                        || combined.contains("진료 중단"))) {
                    return false;
                }
                for (String kw : rule.blockKeywords()) {
                    if (combined.contains(kw.toLowerCase(Locale.ROOT))) {
                        return false;
                    }
                }
            }
        }

        if ("trauma".equals(key) && hospital.trauma() != null && !hospital.trauma().isEmpty()) {
            return true;
        }

        Map<String, String> severe = hospital.severe();
        if (severe != null) {
            for (String mkKey : rule.severeKeys()) {
                String val = severe.getOrDefault(mkKey, "").trim().toUpperCase(Locale.ROOT);
                if ("Y".equals(val) || val.startsWith("가능")) {
                    return true;
                }
            }
        }

        Map<String, String> beds = hospital.beds();
        if (beds != null) {
            for (String bedKey : rule.bedKeys()) {
                String raw = beds.getOrDefault(bedKey, "").trim().toUpperCase(Locale.ROOT);
                if ("Y".equals(raw)) {
                    return true;
                }
                Integer count = parseBedCount(raw);
                if (count != null && count > 0) {
                    return true;
                }
            }
        }
        return false;
        /*
         * [3중 교차 검증 흐름도 (예: 'stroke' 뇌졸중·뇌출혈 선택 시)]
         *   1단계: 활성 공지에 "뇌출혈/신경외과 불가·부재" 차단 문구가 있는가? ──(Yes)──> 즉시 제외(false)
         *   2단계: 28대 중증질환(mkioskty2/3/4) 중 'Y'가 있는가?               ──(Yes)──> 수용 가능(true)
         *   3단계: 신경외과/신경과 중환자실(hv6, hvcc) 가용 병상이 1석 이상인가? ──(Yes)──> 수용 가능(true)
         */
    }

    public Evaluation evaluate(HospitalDto hospital, int durationMinutes, String symptomPreset) {
    /*
     * [자바 문법] public, int : 주행 소요시간(분)과 병원 실시간 자원 상태를 결합해 최적 추천 점수(score)와 안내 사유를 계산함.
     * [내가 지은 이름] Evaluation(반환 레코드), evaluate(함수명), hospital, durationMinutes, symptomPreset
     */
        String rawErBeds = (hospital.beds() != null) ? hospital.beds().getOrDefault("hvec", "") : "";
        Integer erCount = parseBedCount(rawErBeds);
        String status = classifyBedAvailabilityStatus(rawErBeds);
        boolean blocked = hasActiveBlockingNotice(hospital);

        double penaltyMinutes = 0.0;
        StringBuilder reason = new StringBuilder();

        if (erCount == null) {
            penaltyMinutes += 6.0;
            reason.append("응급실 병상 미보고");
        } else if (erCount < 0) {
            int overflow = Math.abs(erCount);
            penaltyMinutes += 25.0 + Math.min(20.0, overflow * 2.5);
            reason.append("정원 초과수용(").append(overflow).append("석 포화)");
        } else if (erCount == 0) {
            penaltyMinutes += 18.0;
            reason.append("응급실 일반병상 만실(0석)");
        } else if (erCount <= 2) {
            penaltyMinutes += 3.0;
            reason.append("응급실 잔여 ").append(erCount).append("석(혼잡 임박)");
        } else {
            penaltyMinutes -= Math.min(2.5, erCount * 0.25);
            reason.append("응급실 ").append(erCount).append("석 여유");
        }

        if (blocked) {
            penaltyMinutes += 14.0;
            reason.append(" · 진료제한 공지 확인 필요");
        } else {
            reason.append(" · 차단 공지 없음");
        }

        if (hospital.regional()) {
            penaltyMinutes -= 1.0;
        }

        if (symptomPreset != null && !symptomPreset.isBlank() && !"all".equalsIgnoreCase(symptomPreset)) {
            SymptomRule rule = SYMPTOM_RULES.get(symptomPreset.trim().toLowerCase(Locale.ROOT));
            if (rule != null) {
                reason.append(" · ").append(rule.label()).append(" 수용 가능");
            }
        }

        double finalScore = Math.round((durationMinutes + penaltyMinutes) * 10.0) / 10.0;
        return new Evaluation(status, blocked, finalScore, reason.toString());
        /*
         * [수용 최적 추천 점수 계산 예시 ("응급실 핑퐁 방지" 핵심 공식)]
         * - 병원 A: 주행 8분 + 초과수용(-4석 -> 페널티 +35분) = 추천 점수 43.0점 (후순위로 밀림)
         * - 병원 B: 주행 12분 + 여유 6석(보너스 -1.5분) + 차단공지 없음 = 추천 점수 10.5점 (1위 최우선 추천)
         */
    }

    private static Long parseApiDateMillis(String rawDtm) {
    /*
     * [자바 문법] private static : 14자리 시각 문자열("20261117183000")을 KST 기준 Epoch 밀리초(Long)로 변환함.
     * [내가 지은 이름] parseApiDateMillis, rawDtm
     */
        if (rawDtm == null || !rawDtm.trim().matches("^\\d{14}$")) {
            return null;
        }
        try {
            LocalDateTime ldt = LocalDateTime.parse(rawDtm.trim(), API_DTM_FORMAT);
            return ldt.atZone(KST_ZONE).toInstant().toEpochMilli();
        } catch (Exception ex) {
            return null;
        }
        /*
         * [스프링/자바 내장 함수] LocalDateTime.parse(...), .atZone(KST_ZONE).toInstant().toEpochMilli() (이름 변경 불가)
         */
    }

    private record SymptomRule(
            String label,
            List<String> bedKeys,
            List<String> severeKeys,
            List<String> blockKeywords
    ) {
    /*
     * [자바 문법] private record
     * [내가 지은 이름] SymptomRule(증상 프리셋별 검사할 병상 키·28대 중증질환 키·공지 차단 키워드 묶음)
     */
    }

    public record Evaluation(
            String availabilityStatus,
            boolean hasBlockingNotice,
            double recommendationScore,
            String recommendationReason
    ) {
    /*
     * [자바 문법] public record
     * [내가 지은 이름] Evaluation(병원 1곳에 대한 수용 가능성 평가 결과 묶음)
     */
    }
}
