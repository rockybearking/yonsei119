package com.yonsei119.service;

import com.yonsei119.dto.HospitalTypeDto;
import org.springframework.stereotype.Component;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
/*
 * [자바 문법] package, import : 병원 종별(권역·상급종합·의료원·일반) 자동 분류 비즈니스 로직 패키지 선언 및 문자열 정규화 도구 불러오기임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - Normalizer : 전각 괄호（, ）등을 표준 반각 문자로 통일해 주는 자바 표준 텍스트 정규화 도구임 (이름 변경 불가).
 * - Pattern, List, Map, Locale : 정규표현식 및 다국어 무관 소문자 변환용 내장 도구임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @Component (출처: org.springframework.stereotype) : 스프링 컨테이너가 부팅 시 이 분류기 객체를 딱 1개(Singleton) 만들어 필요한 서비스에 자동 주입하게 함.
 */

@Component
public class HospitalClassifier {
/*
 * [스프링/라이브러리 내장 어노테이션] @Component
 * [자바 문법] public class
 * [내가 지은 이름] HospitalClassifier : 보건복지부 제5기(2024~2026) 상급종합병원 47개소 고시 명단과 공공데이터 분류 코드를 대조하는 판별기 클래스 이름임.
 * [핵심 원리 & 비유]
 * - 식자재가 들어오면 특등급(상급종합/권역응급), 공공등급(의료원), 일반등급(기타) 스티커를 정확히 붙여 주는 '품질 등급 선별기'임.
 */

    public static final HospitalTypeDto TYPE_TERTIARY =
            new HospitalTypeDto("tertiary", "상급종합병원", "#d34458", 1);
    public static final HospitalTypeDto TYPE_MEDICAL =
            new HospitalTypeDto("medical", "의료원", "#2879ce", 2);
    public static final HospitalTypeDto TYPE_OTHER =
            new HospitalTypeDto("other", "일반·기타 응급의료기관", "#738295", 3);
    /*
     * [자바 문법] public static final, new : 서버 전체에서 공유하며 절대 변하지 않는 3대 종별 결과 상수 객체임.
     * [내가 지은 이름] HospitalTypeDto(대문자 타입명) / TYPE_TERTIARY, TYPE_MEDICAL, TYPE_OTHER(대문자 상수명 관례)
     */

    private static final Pattern NORMALIZE_STRIP_PATTERN = Pattern.compile("[\\s·()（）\\[\\]-]");
    /*
     * [자바/스프링/라이브러리 내장 도구(타입)] Pattern (이름 변경 불가)
     * [스프링/자바 내장 함수] Pattern.compile(...) : 정규표현식을 미리 한 번만 컴파일해 두어 수백 개 병원 이름 비교 속도를 높임.
     * [내가 지은 이름] NORMALIZE_STRIP_PATTERN (공백, 가운뎃점, 괄호, 대괄호, 하이픈 제거용 패턴 상수)
     */

    private static final Map<String, Pattern> REGION_PREFIX = Map.ofEntries(
            Map.entry("서울", Pattern.compile("^서울")),
            Map.entry("인천", Pattern.compile("^인천")),
            Map.entry("경기", Pattern.compile("^경기")),
            Map.entry("강원", Pattern.compile("^강원")),
            Map.entry("충북", Pattern.compile("^(충북|충청북도)")),
            Map.entry("충남", Pattern.compile("^(충남|충청남도)")),
            Map.entry("대전", Pattern.compile("^대전")),
            Map.entry("전북", Pattern.compile("^(전북|전라북도)")),
            Map.entry("광주", Pattern.compile("^광주")),
            Map.entry("전남", Pattern.compile("^(전남|전라남도)")),
            Map.entry("대구", Pattern.compile("^대구")),
            Map.entry("경북", Pattern.compile("^(경북|경상북도)")),
            Map.entry("부산", Pattern.compile("^부산")),
            Map.entry("경남", Pattern.compile("^(경남|경상남도)")),
            Map.entry("울산", Pattern.compile("^울산"))
    );
    /*
     * [스프링/자바 내장 함수] Map.ofEntries(...), Map.entry(...) : 10개 이상의 불변 키-값 쌍을 안전하게 등록하는 내장 함수임 (10개 이하일 때 쓰는 형제 함수: Map.of(...)).
     * [내가 지은 이름] REGION_PREFIX (타 지역의 동명이인 중소병원이 상급종합병원으로 오분류되는 것을 막는 시·도 주소 접두어 사전)
     */

    private static final List<TertiaryRule> TERTIARY_2024_2026 = List.of(
            new TertiaryRule("서울", List.of("강북삼성병원")),
            new TertiaryRule("서울", List.of("건국대학교병원")),
            new TertiaryRule("서울", List.of("경희대학교병원")),
            new TertiaryRule("서울", List.of("고려대학교의과대학부속구로병원", "고려대학교구로병원")),
            new TertiaryRule("서울", List.of("삼성서울병원")),
            new TertiaryRule("서울", List.of("서울대학교병원")),
            new TertiaryRule("서울", List.of("강남세브란스병원")),
            new TertiaryRule("서울", List.of("연세대학교의과대학세브란스병원", "신촌세브란스병원")),
            new TertiaryRule("서울", List.of("이화여자대학교의과대학부속목동병원", "이화여자대학교목동병원", "이대목동병원")),
            new TertiaryRule("서울", List.of("서울아산병원")),
            new TertiaryRule("서울", List.of("중앙대학교병원")),
            new TertiaryRule("서울", List.of("고려대학교의과대학부속병원", "고려대학교안암병원", "고대안암병원")),
            new TertiaryRule("서울", List.of("가톨릭대학교서울성모병원", "서울성모병원")),
            new TertiaryRule("서울", List.of("한양대학교병원")),
            new TertiaryRule("인천", List.of("가톨릭대학교인천성모병원", "인천성모병원")),
            new TertiaryRule("경기", List.of("순천향대학교부속부천병원", "순천향대학교부천병원")),
            new TertiaryRule("인천", List.of("길병원")),
            new TertiaryRule("인천", List.of("인하대학교의과대학부속병원", "인하대학교병원")),
            new TertiaryRule("경기", List.of("가톨릭대학교성빈센트병원", "성빈센트병원")),
            new TertiaryRule("경기", List.of("고려대학교의과대학부속안산병원", "고려대학교안산병원")),
            new TertiaryRule("경기", List.of("분당서울대학교병원")),
            new TertiaryRule("경기", List.of("아주대학교병원")),
            new TertiaryRule("경기", List.of("한림대학교성심병원")),
            new TertiaryRule("강원", List.of("강릉아산병원")),
            new TertiaryRule("강원", List.of("연세대학교원주세브란스기독병원", "원주세브란스기독병원")),
            new TertiaryRule("충북", List.of("충북대학교병원")),
            new TertiaryRule("충남", List.of("단국대학교의과대학부속병원", "단국대학교병원")),
            new TertiaryRule("대전", List.of("충남대학교병원")),
            new TertiaryRule("대전", List.of("건양대학교병원")),
            new TertiaryRule("전북", List.of("원광대학교병원")),
            new TertiaryRule("전북", List.of("전북대학교병원")),
            new TertiaryRule("광주", List.of("전남대학교병원")),
            new TertiaryRule("광주", List.of("조선대학교병원")),
            new TertiaryRule("전남", List.of("화순전남대학교병원")),
            new TertiaryRule("대구", List.of("경북대학교병원")),
            new TertiaryRule("대구", List.of("계명대학교동산병원")),
            new TertiaryRule("대구", List.of("대구가톨릭대학교병원")),
            new TertiaryRule("대구", List.of("영남대학교병원")),
            new TertiaryRule("대구", List.of("칠곡경북대학교병원")),
            new TertiaryRule("부산", List.of("고신대학교복음병원")),
            new TertiaryRule("부산", List.of("동아대학교병원")),
            new TertiaryRule("부산", List.of("부산대학교병원")),
            new TertiaryRule("경남", List.of("양산부산대학교병원")),
            new TertiaryRule("부산", List.of("인제대학교부산백병원", "부산백병원")),
            new TertiaryRule("울산", List.of("울산대학교병원")),
            new TertiaryRule("경남", List.of("경상국립대학교병원")),
            new TertiaryRule("경남", List.of("삼성창원병원"))
    );
    /*
     * [스프링/자바 내장 함수] List.of(...) : 수정 불가능한 불변 리스트를 생성함 (이름 변경 불가).
     * [내가 지은 이름] TERTIARY_2024_2026 (보건복지부 공식 지정 제5기 상급종합병원 47개소 전체 명단)
     * [핵심 원리] 공공데이터 XML에서 간혹 dutyDivNam이 '종합병원'으로 잘못 기재된 상급종합병원까지 누락 없이 100% 정확히 식별함.
     */

    public static String normalizeName(String value) {
    /*
     * [자바 문법] public static : 병원명 비교 전 특수기호·공백을 제거한 순수 비교용 문자열을 반환하는 정적 함수임.
     * [자바/스프링/라이브러리 내장 도구(타입)] String (이름 변경 불가)
     * [내가 지은 이름] normalizeName(함수명), value(원본 병원명)
     */
        if (value == null || value.isBlank()) {
            return "";
        }
        String nfkc = Normalizer.normalize(value, Normalizer.Form.NFKC);
        return NORMALIZE_STRIP_PATTERN.matcher(nfkc).replaceAll("").toLowerCase(Locale.ROOT);
        /*
         * [스프링/자바 내장 함수] Normalizer.normalize(...), .matcher(...).replaceAll(""), .toLowerCase(Locale.ROOT) (이름 변경 불가)
         * [문자열 변환 예시]
         *   입력: "연세대학교 원주세브란스기독병원（권역）"
         *   └──> 출력: "연세대학교원주세브란스기독병원권역"
         */
    }

    public boolean isRegional(Map<String, String> fields) {
    /*
     * [자바 문법] public boolean : 해당 기관이 '권역응급의료센터'인지 참/거짓으로 판별함.
     * [자바/스프링/라이브러리 내장 도구(타입)] Map<String, String> (이름 변경 불가)
     * [내가 지은 이름] isRegional(함수명), fields(소문자 태그 키로 병합된 기관 기본정보 맵)
     */
        if (fields == null) {
            return false;
        }
        String emclsName = fields.getOrDefault("dutyemclsname", "");
        return emclsName.contains("권역응급의료센터");
        /*
         * [스프링/자바 내장 함수] .getOrDefault(키, 기본값), .contains(...) (형제 함수: .startsWith(...), .endsWith(...), .equals(...))
         * [핵심 원리] 원주세브란스기독병원처럼 '상급종합병원'이면서 동시에 '권역응급의료센터'인 기관이 양쪽 필터 모두에서 검색되도록 별도 boolean 플래그로 분리했음.
         */
    }

    public HospitalTypeDto classify(Map<String, String> fields, String rawName) {
    /*
     * [자바 문법] public
     * [내가 지은 이름] HospitalTypeDto(반환 타입명) / classify(함수명), fields(기본정보 맵), rawName(원본 병원명)
     */
        Map<String, String> safeFields = fields != null ? fields : Map.of();
        String name = normalizeName(rawName != null ? rawName : safeFields.getOrDefault("dutyname", ""));
        String address = safeFields.getOrDefault("dutyaddr", "").trim();
        String divNam = safeFields.getOrDefault("dutydivnam", "");

        boolean explicitlyDesignated = divNam.contains("상급종합");
        boolean inOfficialList = TERTIARY_2024_2026.stream().anyMatch(rule -> {
            Pattern regionPattern = REGION_PREFIX.get(rule.region());
            boolean regionMatches = address.isEmpty()
                    || (regionPattern != null && regionPattern.matcher(address).find());
            return regionMatches && rule.aliases().stream()
                    .anyMatch(alias -> name.contains(normalizeName(alias)));
        });

        if (explicitlyDesignated || inOfficialList) {
            return TYPE_TERTIARY;
        }
        if (name.contains("의료원")) {
            return TYPE_MEDICAL;
        }
        return TYPE_OTHER;
        /*
         * [스프링/자바 내장 함수] .stream().anyMatch(...) : 리스트 안의 규칙 중 단 하나라도 조건을 만족하면 즉시 true를 반환함 (형제 함수: .allMatch(...), .noneMatch(...), .filter(...)).
         * [분류 우선순위 흐름도]
         *   병원 입력 ──> 1순위: 상급종합 코드 또는 47개 고시 명단 일치? ──(Yes)──> TYPE_TERTIARY ("상급종합병원")
         *            └──> 2순위: 기관명에 "의료원" 포함?              ──(Yes)──> TYPE_MEDICAL  ("의료원")
         *            └──> 3순위: 그 외 모든 지역응급의료센터/기관       ────────> TYPE_OTHER    ("일반·기타 응급의료기관")
         */
    }

    private record TertiaryRule(
            String region,
            List<String> aliases
    ) {
    /*
     * [자바 문법] private record : 이 클래스 안에서만 쓰는 상급종합병원 권역+별칭 매칭 규칙 레코드임.
     * [내가 지은 이름] TertiaryRule(대문자 타입명) / region(시·도 약칭), aliases(공식명 및 약칭 목록)
     */
    }
}
