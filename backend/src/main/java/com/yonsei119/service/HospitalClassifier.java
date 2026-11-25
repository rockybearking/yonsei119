package com.yonsei119.service;

import com.yonsei119.dto.HospitalTypeDto;
import org.springframework.stereotype.Component;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/*
 * [역할 및 실행 시점]
 * - 역할: 병원 이름·주소·분류코드를 대조해 상급종합병원·권역응급의료센터·의료원·일반기관으로 분류해 주는 등급 판정관
 * - 실행 시점: 서버 부팅 시 @Component 싱글톤 빈으로 생성되며, EmergencyDataService가 스냅샷을 병합할 때 병원마다 호출됨
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   EmergencyDataService.mergeDatasetsIntoSnapshot()
 *   ├── 1) isRegional(fields) ──> `dutyemclsname`에 "권역응급의료센터" 포함 여부 반환 (`boolean`)
 *   └── 2) classify(fields, rawName)
 *       ├── 1순위: `dutydivnam`에 "상급종합" 포함 OR 보건복지부 제5기 상급종합병원 47개소 명단+지역 일치 ──> `TYPE_TERTIARY`
 *       ├── 2순위: 병원명에 "의료원" 포함 ──> `TYPE_MEDICAL`
 *       └── 3순위: 그 외 응급의료기관 ──> `TYPE_OTHER`
 *   - 특징: 권역응급 여부(`regional`)와 종별(`type`)을 분리 판정하여, '상급종합이면서 권역응급인 병원'(예: 원주세브란스기독병원)이
 *           프론트엔드의 두 체크박스 필터 모두에서 누락되지 않도록 설계됨!
 *
 * [내장 / 프레임워크 / 자동생성 구분]
 * - Java 표준 내장: Normalizer(전각->반각 NFKC 정규화), Pattern(사전 컴파일 정규식), Map.ofEntries, List.of
 * - Spring 프레임워크: @Component
 * - 프로젝트 DTO / record: HospitalTypeDto, 내부 TertiaryRule 레코드
 *
 * [사용처 및 IDE 추적 가이드]
 * - 호출처: EmergencyDataService.mergeDatasetsIntoSnapshot(), Yonsei119BackendTests(Test 1, Test 12)
 * - 프론트엔드 연결부: frontend/js/markers-cluster.js의 `visualGroup()`, `matchesFilters()`, frontend/index.html의 `#filter-*` 체크박스
 * - Java 호출 추적: 메서드명 위에서 `Ctrl + Alt + H`
 */
@Component
public class HospitalClassifier {

    public static final HospitalTypeDto TYPE_TERTIARY =
            new HospitalTypeDto("tertiary", "상급종합병원", "#d34458", 1);
    public static final HospitalTypeDto TYPE_MEDICAL =
            new HospitalTypeDto("medical", "의료원", "#2879ce", 2);
    public static final HospitalTypeDto TYPE_OTHER =
            new HospitalTypeDto("other", "일반·기타 응급의료기관", "#738295", 3);

    private static final Pattern NORMALIZE_STRIP_PATTERN = Pattern.compile("[\\s·()（）\\[\\]-]");

    /** 타 지역의 동명이인 일반병원이 상급종합병원으로 오분류되지 않도록 주소 앞 시·도를 대조하는 15개 정규식 맵 */
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

    /** 보건복지부 제5기(2024~2026) 지정 전국 47개 상급종합병원 공식 명단 (NEMC XML에서 '종합병원'으로 내려오는 한계 보완) */
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

    /** 공백·괄호·가운뎃점·하이픈을 제거하고 반각 소문자로 통일해 병원명 표기 차이에도 일관되게 비교함 */
    public static String normalizeName(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        String nfkc = Normalizer.normalize(value, Normalizer.Form.NFKC);
        return NORMALIZE_STRIP_PATTERN.matcher(nfkc).replaceAll("").toLowerCase(Locale.ROOT);
    }

    /** 기관 기본정보(`dutyemclsname`)에 '권역응급의료센터'가 포함되어 있는지 판별함 */
    public boolean isRegional(Map<String, String> fields) {
        if (fields == null) {
            return false;
        }
        String emclsName = fields.getOrDefault("dutyemclsname", "");
        return emclsName.contains("권역응급의료센터");
    }

    /** 병원을 상급종합병원(`tertiary`) -> 의료원(`medical`) -> 일반·기타(`other`) 3단계 우선순위로 분류함 */
    public HospitalTypeDto classify(Map<String, String> fields, String rawName) {
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
    }

    private record TertiaryRule(
            String region,
            List<String> aliases
    ) {
    }
}
