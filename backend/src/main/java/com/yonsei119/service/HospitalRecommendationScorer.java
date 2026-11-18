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
 * [패키지 및 임포트]
 * - com.yonsei119.service : 비즈니스 로직 및 도메인 평가 클래스들이 모인 패키지 선언임.
 * - package, import : 소속 패키지와 날짜·컬렉션·정규식·스프링·DTO 타입 사용을 선언함.
 *
 * [자바 표준 내장 타입 (이름 변경 불가)]
 * - Instant, LocalDateTime, ZoneId (java.time) : UTC 시각, 지역 일시, 시간대 타입임.
 * - DateTimeFormatter (java.time.format) : 날짜·시각 문자열 파싱 및 포맷 도구임.
 * - List, Locale, Map (java.util) : 목록, 로케일 규칙, 키-값 맵 인터페이스임.
 * - Pattern (java.util.regex) : 미리 컴파일된 정규표현식 패턴 객체 타입임.
 *
 * [프로젝트 내부 참조 타입]
 * - HospitalDto (com.yonsei119.dto) : 단일 응급실의 병상·공지·중증질환 정보를 담은 DTO임.
 */

@Component
public class HospitalRecommendationScorer {
/*
 * [스프링 내장 어노테이션]
 * - @Component 정의 (출처: org.springframework.stereotype.Component, 이름 변경 불가)
 *   · 역할 : 개발자가 작성한 클래스를 컴포넌트 스캔 대상에 포함해 스프링 싱글톤 빈으로 자동 생성·등록하는 범용 어노테이션임.
 * - @Component 현재 코드 적용
 *   · 적용 대상 : HospitalRecommendationScorer 클래스 — 병상·공지·증상·주행시간 기준 병원 추천 점수 평가 빈임.
 *   · 작동 원리 : 컴포넌트 스캔 시 클래스 메타데이터를 읽어 싱글톤 빈 1개를 등록하고 다른 빈 생성자 DI로 주입함.
 *   · 실행 시점 : 스프링 애플리케이션 부팅 및 ApplicationContext 초기화 단계에서 빈 생성과 의존성 주입이 완료됨.
 *   · 비교 : 서비스 계층 @Service, 저장소 @Repository, 웹 API @RestController는 기능상 동일하고 역할 의미만 다름.
 *
 * [자바 문법]
 * - public class : 외부 패키지에서도 접근 가능한 공개 클래스 선언부임.
 *
 * [클래스명]
 * - HospitalRecommendationScorer : 병상 여유도·차단 공지·증상 수용성·주행시간을 합산해 추천 점수를 계산함.
 *
 * [호출 경로]
 * - EmergencyApiController (GET /api/directions/rank) -> NaverDirectionsService.rankHospitalsByDrivingTime(...)
 *   └── 1차 후보 선별(candidatePreScore) 및 최종 점수 계산 시 HospitalRecommendationScorer 메서드를 호출함.
 *
 * [동작 흐름]
 * - 증상 필터링: matchesSymptomPreset -> 차단 공지 확인 -> 외상·중증질환·병상 3단계 검증
 * - 점수 평가: evaluate -> parseBedCount·classifyBedAvailabilityStatus -> hasActiveBlockingNotice
 *   └── 주행 소요 시간(분) + 병상·공지·권역센터 가중치 합산 -> Evaluation 레코드 반환
 */

    private static final ZoneId KST_ZONE = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter API_DTM_FORMAT = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");
    private static final Pattern BLOCKING_KEYWORD_PATTERN =
            Pattern.compile("(불가능|불가|차단|수용\\s*불가|진료\\s*불가|수술\\s*불가|시술\\s*불가|부재|중단|마감)");
    private static final Pattern POSITIVE_ONLY_PATTERN =
            Pattern.compile("(제한\\s*없음|정상\\s*진료|정상\\s*운영|(?<!불)가능|원활)");
    /*
     * [자바 문법]
     * - private static final : 클래스 내부에서만 공유되며 한 번 초기화 후 바꿀 수 없는 상수임.
     *
     * [상수명]
     * - KST_ZONE : 공지 시작·종료 시각을 한국 표준시(Asia/Seoul)로 해석하는 시간대 상수임.
     * - API_DTM_FORMAT : 공공데이터 14자리 일시 문자열(yyyyMMddHHmmss) 파싱 포맷터 상수임.
     * - BLOCKING_KEYWORD_PATTERN : 진료·수용 불가나 전문의 부재·중단 공지를 찾는 정규식 상수임.
     * - POSITIVE_ONLY_PATTERN : 차단 키워드가 없을 때 정상 운영 여부를 보조 확인하는 정규식 상수임.
     *
     * [자바/라이브러리 내장 타입 및 메서드 (이름 변경 불가)]
     * - ZoneId.of("Asia/Seoul") : IANA 표준 시간대 ID로 ZoneId 객체를 생성함.
     * - DateTimeFormatter.ofPattern("yyyyMMddHHmmss") : 연월일시분초 14자리 파서를 생성함.
     * - Pattern.compile(String regex) : 생성자가 private이므로 Pattern.compile() 정적 메서드로 정규식 객체를 생성함.
     *
     * [정규표현식 원리]
     * - \s* : 공백이 0개 이상임을 뜻하므로 "수용불가"와 "수용 불가"를 모두 일치시킴.
     * - (?<!불)가능 : "가능" 바로 앞 글자가 "불"이 아닐 때만 찾는 부정 후방 탐색 문법임.
     * - "불가능" 글자 안에도 "가능"이 들어 있어, 차단 패턴 우선 검사와 함께 써 오판을 막음.
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
     * [자바 문법]
     * - private static final, 제네릭 Map<String, SymptomRule>, new SymptomRule(...)
     *
     * [상수명]
     * - SYMPTOM_RULES : 7대 응급 증상 프리셋 키와 검사 규칙을 매핑한 불변 사전 상수임.
     *
     * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
     * - Map.of(k1, v1, ...) : 최대 10쌍까지 수정 불가 맵을 생성함(11쌍 이상은 Map.ofEntries 사용).
     * - List.of(...) : 수정 불가(Immutable) 리스트를 생성함.
     */

    public static Integer parseBedCount(String rawErBeds) {
    /*
     * [자바 문법]
     * - public static : 객체 생성 없이 클래스명으로 바로 호출 가능한 정적 메서드 선언임.
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - Integer (java.lang.Integer) : int와 달리 미보고 상태(null)를 표현할 수 있는 정수 래퍼임.
     * - String (java.lang.String) : 문자열 타입임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: parseBedCount
     * - rawErBeds : 공공데이터 API 원본 병상 수 문자열(예: "-4", "0", "5", "")임.
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
         * [자바 문법]
         * - if, return null, try { ... } catch (NumberFormatException ex)
         *
         * [지역 변수명]
         * - trimmed (앞뒤 공백 제거 문자열), ex (int 범위 초과 예외 객체)
         *
         * [자바/라이브러리 내장 타입 및 메서드 (이름 변경 불가)]
         * - NumberFormatException (java.lang) : 문자열을 숫자로 바꿀 수 없을 때 발생하는 예외임.
         * - .isBlank(), .trim() (String) : 공백 전용 문자열 검사 및 앞뒤 공백 제거를 수행함.
         * - .matches("^-?\\d+$") (String) : 선택적 '-' 기호 + 숫자 1개 이상인지 전체 일치 검사함.
         * - Integer.parseInt(String s) : 문자열을 int로 바꾼 뒤 Integer로 자동 변환(오토박싱)해 반환함.
         *
         * [동작 흐름]
         * - null 또는 공백 -> null(미보고) 즉시 반환
         * - 정수 정규식 불일치 또는 범위 초과 -> 0으로 왜곡하지 않고 null 반환
         * - Integer.parseInt 성공 -> "-4"(초과수용), "0"(만실), "5"(여유) 정수 반환
         */
    }

    public String classifyBedAvailabilityStatus(String rawErBeds) {
    /*
     * [자바 문법]
     * - public : 외부 서비스 및 테스트에서 호출 가능한 공개 인스턴스 메서드임.
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String, Integer
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: classifyBedAvailabilityStatus
     * - rawErBeds : 응급실 일반병상(hvec) 원본 문자열임.
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
         * [자바 문법]
         * - if, 비교 연산자(==, <, <=), return
         *
         * [지역 변수명]
         * - count (parseBedCount로 변환한 병상 수 또는 null)
         *
         * [동작 흐름]
         * - parseBedCount(rawErBeds) 호출 -> 정수 또는 null 추출
         *   ├── null -> "미보고" | < 0 -> "초과수용" | == 0 -> "만실"
         *   └── <= 2 -> "혼잡" | >= 3 -> "여유" 반환
         */
    }

    public boolean isNoticeBlocking(Map<String, String> messageItem) {
    /*
     * [자바 문법]
     * - public boolean, 제네릭 타입 Map<String, String>
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - Map (java.util.Map), String
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: isNoticeBlocking
     * - messageItem : 단일 응급실 공지 항목의 키-값 맵임.
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
         * [자바 문법]
         * - if, 논리합(||), return
         *
         * [지역 변수명]
         * - yon (차단 여부 코드 symoutdspyon 값), body (공지 본문 symblkmsg 값)
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .isEmpty() (Map, String) : 항목이 없거나 문자열 길이가 0이면 true를 반환함.
         * - .getOrDefault(Object key, String defaultVal) (Map) : 키가 없으면 기본값을 반환해 NPE를 막음.
         * - .trim(), .equals(Object) (String) : 공백 제거 및 문자열 내용 비교를 수행함.
         * - Pattern.matcher(CharSequence) : 문자열 탐색용 Matcher 객체를 생성함.
         * - Matcher.find() : 부분 일치 시 true를 반환함(형제 메서드 .matches()는 전체 일치 검사).
         *
         * [동작 흐름]
         * - 1단계: messageItem 비어 있음 -> false | symoutdspyon이 "차단" -> 즉시 true 반환
         * - 2단계: symblkmsg 비어 있음 -> false | BLOCKING_KEYWORD_PATTERN.find() 먼저 검사
         *   ├── 차단 키워드 일치 -> 즉시 true 반환
         *   └── POSITIVE_ONLY_PATTERN 일치 또는 중립 문구 -> false(비차단) 반환
         */
    }

    public boolean isMessageCurrentlyActive(Map<String, String> messageItem, long nowEpochMillis) {
    /*
     * [자바 문법]
     * - public boolean, 기본형 long
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - Map, Long
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: isMessageCurrentlyActive
     * - messageItem : 단일 공지 맵임.
     * - nowEpochMillis : 비교 기준 현재 UTC 밀리초(Epoch ms)임.
     */
        Long startMs = parseApiDateMillis(messageItem.get("symblksttdtm"));
        Long endMs = parseApiDateMillis(messageItem.get("symblkenddtm"));
        return (startMs == null || startMs <= nowEpochMillis)
                && (endMs == null || endMs > nowEpochMillis);
        /*
         * [자바 문법]
         * - 논리곱(&&), 논리합(||), 비교 연산자(<=, >), return
         *
         * [지역 변수명]
         * - startMs (공지 시작 일시 밀리초 또는 null), endMs (공지 종료 일시 밀리초 또는 null)
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - Map.get(Object key) : 키가 존재하지 않으면 null을 반환함.
         *
         * [동작 흐름]
         * - parseApiDateMillis로 시작(symblksttdtm)·종료(symblkenddtm) 시각 추출
         * - └── (시작 없음 || 시작 <= 현재) && (종료 없음 || 현재 < 종료) -> true 반환(만료 공지 제외)
         */
    }

    public boolean hasActiveBlockingNotice(HospitalDto hospital) {
    /*
     * [자바 문법]
     * - public boolean
     *
     * [프로젝트 내부 참조 타입]
     * - HospitalDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: hasActiveBlockingNotice
     * - hospital : 검사 대상 병원 DTO 객체임.
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
         * [자바 문법]
         * - long, 향상된 for(:), if, 논리곱(&&), 논리합(||), return
         *
         * [지역 변수명]
         * - now (현재 UTC 밀리초 타임스탬프), msg (순회 중인 단일 공지 맵)
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - Instant.now() (java.time.Instant) : 현재 UTC 시각 인스턴스를 반환함.
         * - .toEpochMilli() (Instant) : 1970-01-01T00:00:00Z 기준 경과 밀리초(long)를 반환함.
         * - .isEmpty() (List) : 공지 목록이 비어 있는지 확인함.
         *
         * [동작 흐름]
         * - hospital 또는 messages 비어 있음 -> false 즉시 반환
         * - messages 순회 -> isMessageCurrentlyActive(msg, now) && isNoticeBlocking(msg) 확인
         *   ├── 1건이라도 활성 차단 공지임 -> 즉시 true 반환
         *   └── 모두 비활성 또는 비차단 -> false 반환
         */
    }

    public boolean matchesSymptomPreset(HospitalDto hospital, String rawSymptomPreset) {
    /*
     * [자바 문법]
     * - public boolean
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String, Map, Locale
     *
     * [프로젝트 내부 참조 타입]
     * - HospitalDto
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: matchesSymptomPreset
     * - hospital : 검사 대상 병원 DTO 객체임.
     * - rawSymptomPreset : 사용자가 선택한 증상 프리셋 키 문자열임.
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
         * [자바 문법]
         * - if, continue(다음 반복으로 건너뜀), 향상된 for(:), +, 논리곱(&&), 논리합(||), return
         *
         * [지역 변수명]
         * - key, rule, now, msg, combined, kw, severe, mkKey, val, beds, bedKey, raw, count
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .isBlank(), .equalsIgnoreCase(String), .trim(), .equals(Object) (String)
         * - .contains(CharSequence), .startsWith(String) (String)
         * - .toLowerCase(Locale.ROOT), .toUpperCase(Locale.ROOT) (String) : OS 무관 일관 대소문자 변환함.
         * - Map.get(Object), Map.getOrDefault(Object, V) (Map), Instant.now().toEpochMilli() (Instant)
         *
         * [동작 흐름]
         * - 0단계: 공백·"all"·미등록 프리셋 키 -> 필터 없이 true 즉시 반환
         * - 1단계(차단 공지): 활성 차단 공지에 응급실 수용불가 또는 rule.blockKeywords() 포함 -> false
         * - 2단계(외상·중증): "trauma" 외상센터 정보 존재 또는 severe 값이 "Y"·"가능..." -> true
         * - 3단계(병상·장비): beds 값이 "Y" 또는 1 이상 양수 -> true, 모두 미충족 시 false 반환
         */
    }

    public Evaluation evaluate(HospitalDto hospital, int durationMinutes, String symptomPreset) {
    /*
     * [자바 문법]
     * - public, 기본형 int
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - String
     *
     * [프로젝트 내부 참조 타입]
     * - HospitalDto (입력 병원 DTO), Evaluation (HospitalRecommendationScorer 내부 공개 중첩 레코드)
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: evaluate
     * - hospital : 평가 대상 병원 DTO 객체임.
     * - durationMinutes : 실도로 또는 추정 주행 소요 시간(분)임.
     * - symptomPreset : 선택된 증상 프리셋 코드 또는 null임.
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
         * [자바 문법]
         * - 삼항 연산자(? :), if / else if / else, 복합 대입(+=, -=), new, return
         * - boolean, double, int : 기본형 지역 변수 타입임.
         *
         * [지역 변수명]
         * - rawErBeds, erCount, status, blocked, penaltyMinutes, reason, overflow, rule, finalScore
         *
         * [자바/라이브러리 내장 생성자 및 메서드 (이름 변경 불가)]
         * - new StringBuilder(), .append(...), .toString() : 가변 문자열 조합 버퍼를 생성·누적·반환함.
         * - .getOrDefault(...) (Map), .isBlank(), .equalsIgnoreCase(...), .trim(), .toLowerCase(Locale.ROOT)
         * - Math.abs(int), Math.min(double, double), Math.round(double) (java.lang.Math)
         *
         * [점수 산출 공식]
         * - 병상 가중치: 미보고 +6.0 | 초과 +(25.0+min(20.0, 초과*2.5)) | 만실 +18.0 | 혼잡 +3.0 | 여유 -min(2.5, 병상*0.25)
         * - 추가 가중치: 활성 차단 공지 +14.0분, 권역응급의료센터 -1.0분
         * - 최종 점수: round((durationMinutes + penaltyMinutes) * 10.0) / 10.0 (낮을수록 우선 추천)
         *
         * [동작 흐름]
         * - 1단계: hvec 파싱(parseBedCount) -> 상태 분류(classifyBedAvailabilityStatus) -> 차단 공지 확인
         * - 2단계: 병상 등급별 penaltyMinutes 가감 및 reason 문자열 누적
         *   ├── 차단 공지(+14분) 및 권역센터(-1분) 가중치 적용
         *   └── 유효 증상 프리셋 존재 시 reason에 수용 가능 라벨 추가
         * - 3단계: finalScore 소수 첫째 자리 반올림 -> new Evaluation(status, blocked, finalScore, reason) 반환
         */
    }

    private static Long parseApiDateMillis(String rawDtm) {
    /*
     * [자바 문법]
     * - private static
     *
     * [자바/라이브러리 내장 타입 (이름 변경 불가)]
     * - Long (java.lang.Long) : null 반환이 가능한 64비트 정수 래퍼 타입임.
     * - String (java.lang.String)
     *
     * [메서드명 및 매개변수명]
     * - 메서드명: parseApiDateMillis
     * - rawDtm : 공공데이터 공지 일시 14자리 문자열(예: "20261117183000")임.
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
         * [자바 문법]
         * - if, try { ... } catch (Exception ex), return null
         *
         * [지역 변수명]
         * - ldt (파싱된 KST 날짜·시각 객체), ex (날짜 파싱 실패 예외 객체)
         *
         * [자바/라이브러리 내장 메서드 (이름 변경 불가)]
         * - .trim(), .matches("^\\d{14}$") (String) : 정확히 14자리 숫자인지 정규식으로 검증함.
         * - LocalDateTime.parse(CharSequence, DateTimeFormatter) : 문자열을 LocalDateTime으로 파싱함.
         * - .atZone(ZoneId) (LocalDateTime) : 시간대 정보를 결합해 ZonedDateTime을 생성함.
         * - .toInstant().toEpochMilli() (ZonedDateTime) : UTC 밀리초(long)를 Long으로 변환해 반환함.
         *
         * [동작 흐름]
         * - rawDtm이 null이거나 14자리 숫자 정규식 불일치 -> null 즉시 반환
         * - LocalDateTime.parse(KST) -> ZonedDateTime(Asia/Seoul) -> Epoch 밀리초(Long) 반환(실패 시 null)
         */
    }

    private record SymptomRule(
            String label,
            List<String> bedKeys,
            List<String> severeKeys,
            List<String> blockKeywords
    ) {
    /*
     * [자바 문법]
     * - private record : Java 16+ 불변 데이터 전용 중첩 레코드 선언임.
     * - 생성자와 label(), bedKeys(), severeKeys(), blockKeywords(), equals·hashCode·toString을 자동 생성함.
     *
     * [중첩 레코드명 및 컴포넌트명]
     * - 레코드명: SymptomRule
     * - label (한글 증상 라벨), bedKeys (병상·장비 키), severeKeys (중증질환 키), blockKeywords (제외 키워드)
     */
    }

    public record Evaluation(
            String availabilityStatus,
            boolean hasBlockingNotice,
            double recommendationScore,
            String recommendationReason
    ) {
    /*
     * [자바 문법]
     * - public record : 외부 클래스와 단위 테스트에서도 참조 가능한 공개 불변 레코드 선언임.
     *
     * [중첩 레코드명 및 컴포넌트명]
     * - 레코드명: Evaluation
     * - availabilityStatus (병상 상태), hasBlockingNotice (차단 공지 여부)
     * - recommendationScore (추천 점수), recommendationReason (추천 근거 요약)
     */
    }
}
