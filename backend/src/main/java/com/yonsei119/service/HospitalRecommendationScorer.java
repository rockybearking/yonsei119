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
 * [역할 및 실행 시점]
 * - 역할: 병원의 실시간 가용 병상·응급실 차단 공지·중증질환 수용 여부를 종합 심사해 '응급실 핑퐁(재이송)' 위험을 줄이는 추천 심사관
 * - 실행 시점: 서버 부팅 시 @Component 싱글톤 빈으로 생성되며, `/api/directions/rank` 추천 순위 산출 시 호출됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   NaverDirectionsService.rankHospitalsByDrivingTime()
 *   ├── 1단계(증상 필터): matchesSymptomPreset()
 *   │   └── 활성 차단 공지(isMessageCurrentlyActive && isNoticeBlocking) 확인 ──> 외상·중증질환·병상 수용 가능 여부 판정
 *   └── 2단계(추천 점수): evaluate(hospital, durationMinutes, symptomPreset)
 *       ├── parseBedCount() / classifyBedAvailabilityStatus() [미보고·초과수용(음수)·만실(0)·혼잡(1~2)·여유(3+)]
 *       ├── hasActiveBlockingNotice() [단순 안내·가능·제한없음 공지와 실제 진료불가·중단 공지를 정밀 구분!]
 *       └── 실도로 시간(분) + 페널티/보너스 가중치 합산 ──> Evaluation 레코드 반환 (점수가 낮을수록 우선 추천)
 *
 * [내장 / 프레임워크 / 자동생성 구분]
 * - Java 표준 내장: Instant, LocalDateTime, ZoneId, DateTimeFormatter, Pattern, Map, List, Integer
 * - Spring 프레임워크: @Component
 * - Java record 자동 생성: 내부 SymptomRule, Evaluation 레코드의 생성자 및 Getter 자동 생성
 *
 * [사용처 및 IDE 추적 가이드]
 * - 주요 호출처: NaverDirectionsService(rankHospitalsByDrivingTime, candidatePreScore), Yonsei119BackendTests(Test 12)
 * - 프론트엔드 대칭 로직: frontend/js/utils.js의 `isNoticeBlocking()`, `getBedTrafficInfo()`와 동일한 도메인 규칙 공유
 * - Java 호출 계층 추적: 메서드명 위에서 `Ctrl + Alt + H`
 */
@Component
public class HospitalRecommendationScorer {

    private static final ZoneId KST_ZONE = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter API_DTM_FORMAT = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

    /** '제한 없음', '연령제한없음' 등 긍정 문구가 '제한' 키워드에 오탐되지 않도록 먼저 제거하는 정규식 */
    private static final Pattern UNRESTRICTED_PHRASE_PATTERN = Pattern.compile("제한\\s*없음");

    /** 실제 수용·진료·수술 불가, 전문의 부재, 장비 고장·점검, 병상 포화 등 차단성 공지 본문을 탐지하는 정규식 */
    private static final Pattern BLOCKING_KEYWORD_PATTERN = Pattern.compile(
            "(불가능|불가|차단|수용\\s*불가|진료\\s*불가|수술\\s*불가|시술\\s*불가|부재|중단|마감|제한|어려움|어렵|고장|점검|포화|금지|휴진)"
    );

    private static final Pattern INTEGER_PATTERN = Pattern.compile("^-?\\d+$");
    private static final Pattern API_DTM_14_PATTERN = Pattern.compile("^\\d{14}$");

    /** 7대 응급 증상 프리셋별 확인 대상 병상 코드·중증질환 코드·공지 제외 키워드 규칙 사전 */
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
     * [역할 및 데이터 흐름]
     * - 역할: 병상 문자열("-4", "0", "5", "")을 미보고(null)와 정수로 정확히 분리 파싱함
     * - 도메인 규칙: 음수("-4")는 정원 초과수용 상태이므로 절대 0이나 양수로 바꾸지 않고 -4 그대로 반환함!
     * - 사용처: classifyBedAvailabilityStatus(), matchesSymptomPreset(), evaluate(), NaverDirectionsService
     */
    public static Integer parseBedCount(String rawErBeds) {
        if (rawErBeds == null || rawErBeds.isBlank()) {
            return null;
        }
        String trimmed = rawErBeds.trim();
        if (!INTEGER_PATTERN.matcher(trimmed).matches()) {
            return null;
        }
        try {
            return Integer.parseInt(trimmed);
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 응급실 일반병상(hvec) 원시값을 5단계 한글 상태("미보고" | "초과수용" | "만실" | "혼잡" | "여유")로 분류함
     * - 사용처: evaluate()
     */
    public String classifyBedAvailabilityStatus(String rawErBeds) {
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
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 응급실 실시간 메시지 1건이 실제 '진료·수용 차단 공지'인지 판별함
     * - 공공데이터 실측 반영 핵심:
     *   · NEMC `getEmrrmSrsillDissMsgInqire` 실제 응답에서는 "정상 진료 가능", "제한 없음", "사전 문의 바랍니다" 같은
     *     일반 안내 메시지까지도 모든 행에 `<symOutDspYon>차단</symOutDspYon>` 코드가 일괄로 붙어 내려옴!
     *   · 따라서 `symblkmsg`(공지 본문)가 존재할 때는 본문에서 '제한 없음'을 먼저 제외한 뒤 실제 차단 키워드(불가·부재·중단·제한·점검·포화 등)를
     *     검사하여, 진료 가능한 병원이 억울하게 감점되거나 '불가능'으로 뒤집히는 오탐 버그를 방지함.
     * - 흐름:
     *   messageItem 확인 ──> symblkmsg 본문 존재 시 '제한 없음' 제거 후 BLOCKING_KEYWORD_PATTERN 매칭
     *   ├── 차단 키워드 발견 ──> true (실제 진료·수용 제한 공지)
     *   └── 단순 가능·문의 안내 ──> false (비차단 안내 공지)
     * - 사용처: hasActiveBlockingNotice(), matchesSymptomPreset(), Yonsei119BackendTests
     */
    public boolean isNoticeBlocking(Map<String, String> messageItem) {
        if (messageItem == null || messageItem.isEmpty()) {
            return false;
        }
        String body = messageItem.getOrDefault("symblkmsg", "").trim();
        if (!body.isEmpty()) {
            String sanitized = UNRESTRICTED_PHRASE_PATTERN.matcher(body).replaceAll("");
            return BLOCKING_KEYWORD_PATTERN.matcher(sanitized).find();
        }
        String yon = messageItem.getOrDefault("symoutdspyon", "").trim();
        return "차단".equals(yon);
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 공지의 시작일시(symblksttdtm)와 종료일시(symblkenddtm)를 KST 기준으로 비교해 현재 유효한 공지인지 확인함
     * - 사용처: hasActiveBlockingNotice(), matchesSymptomPreset()
     */
    public boolean isMessageCurrentlyActive(Map<String, String> messageItem, long nowEpochMillis) {
        Long startMs = parseApiDateMillis(messageItem.get("symblksttdtm"));
        Long endMs = parseApiDateMillis(messageItem.get("symblkenddtm"));
        return (startMs == null || startMs <= nowEpochMillis)
                && (endMs == null || endMs > nowEpochMillis);
    }

    /*
     * [역할 및 사용처]
     * - 역할: 병원이 보유한 공지 중 현재 시각 기준 유효하면서 실제 차단 키워드를 포함한 공지가 1건이라도 있는지 확인함
     * - 사용처: evaluate()
     */
    public boolean hasActiveBlockingNotice(HospitalDto hospital) {
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
    }

    /*
     * [역할 및 데이터 흐름]
     * - 역할: 특정 증상 프리셋(뇌졸중·심근경색·소아응급 등) 요청 시 해당 질환 수용이 가능한 병원만 통과시킴
     * - 흐름:
     *   1단계: 활성 차단 공지에 해당 진료과/증상 불가 문구가 있으면 즉시 제외(false)
     *   2단계: 중증외상('trauma') 요청 시 권역외상센터 지정 병원이면 통과(true)
     *   3단계: 28대 중증질환(mkioskty*) 값이 'Y'/'가능'이거나 관련 병상·장비가 1석 이상이면 통과(true)
     * - 사용처: NaverDirectionsService.rankHospitalsByDrivingTime()
     */
    public boolean matchesSymptomPreset(HospitalDto hospital, String rawSymptomPreset) {
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
    }

    /*
     * [역할 및 점수 공식]
     * - 역할: 실도로 소요 시간(분)에 병상 포화도·차단 공지·권역센터 가중치를 더해 추천 점수를 계산함 (낮을수록 상위 추천)
     * - 가중치 규칙:
     *   ├── 초과수용(음수): +(25.0 + min(20.0, 초과병상수 * 2.5))분 페널티
     *   ├── 만실(0석): +18.0분 페널티 | 미보고: +6.0분 페널티 | 혼잡(1~2석): +3.0분 페널티
     *   ├── 여유(3석+): -min(2.5, 병상수 * 0.25)분 보너스
     *   └── 활성 차단 공지: +14.0분 페널티 | 권역응급의료센터: -1.0분 보너스
     * - 사용처: NaverDirectionsService(rankHospitalsByDrivingTime, candidatePreScore)
     */
    public Evaluation evaluate(HospitalDto hospital, int durationMinutes, String symptomPreset) {
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
    }

    private static Long parseApiDateMillis(String rawDtm) {
        if (rawDtm == null) {
            return null;
        }
        String trimmed = rawDtm.trim();
        if (!API_DTM_14_PATTERN.matcher(trimmed).matches()) {
            return null;
        }
        try {
            LocalDateTime ldt = LocalDateTime.parse(trimmed, API_DTM_FORMAT);
            return ldt.atZone(KST_ZONE).toInstant().toEpochMilli();
        } catch (Exception ex) {
            return null;
        }
    }

    private record SymptomRule(
            String label,
            List<String> bedKeys,
            List<String> severeKeys,
            List<String> blockKeywords
    ) {
    }

    /** 병원 1곳의 병상 상태·차단 공지 유무·최종 추천 점수·사유 문구를 담는 불변 결과 레코드 */
    public record Evaluation(
            String availabilityStatus,
            boolean hasBlockingNotice,
            double recommendationScore,
            String recommendationReason
    ) {
    }
}
