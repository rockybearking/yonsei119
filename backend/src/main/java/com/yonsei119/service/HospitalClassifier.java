package com.yonsei119.service;

import com.yonsei119.dto.HospitalTypeDto;
import org.springframework.stereotype.Component;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
/*
 * [자바 문법]
 * - package : HospitalClassifier.java 파일이 속한 패키지 경로를 선언함.
 * - import : 다른 패키지의 DTO와 자바 표준 도구를 짧은 이름으로 불러옴.
 *
 * [패키지명]
 * - com.yonsei119.service : 병원 종별 판별 등 백엔드 서비스 클래스들이 모인 패키지임.
 *
 * [자바/스프링/라이브러리 내장 타입]
 * - Normalizer (java.text) : NFKC 정규화로 전각 기호·괄호를 반각 문자로 통일하는 클래스임.
 * - List, Map, Locale : 목록·사전 인터페이스와 로케일 영향 차단용 기준 상수 타입임.
 * - Pattern (java.util.regex) : 정규표현식을 미리 컴파일해 검색 속도를 높이는 클래스임.
 *
 * [프로젝트 내부 타입]
 * - HospitalTypeDto (com.yonsei119.dto) : 종별 코드, 이름, 색상, 우선순위를 담는 프로젝트 DTO 레코드임.
 */

@Component
public class HospitalClassifier {
/*
 * [스프링 내장 어노테이션]
 * - @Component 정의 (출처: org.springframework.stereotype.Component, 이름 변경 불가)
 *   · 역할 : 개발자가 작성한 클래스를 컴포넌트 스캔 대상에 포함해 스프링 싱글톤 빈으로 자동 생성·등록하는 범용 어노테이션임.
 * - @Component 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 HospitalClassifier 클래스
 *   · 작동 원리 : 컴포넌트 스캔 대상이 되어 서버 부팅 시 스프링 컨테이너가 HospitalClassifier 싱글톤 빈 1개를 생성·관리함.
 *   · 실행 시점 : 스프링 애플리케이션 컨텍스트 초기화(부팅) 시점임.
 *   · 비교 : @Service(비즈니스), @Repository(DB), @RestController(API)와 같은 빈 등록 계열임.
 *
 * [자바 문법]
 * - public class : 다른 패키지에서도 접근 가능한 공개 클래스를 선언함.
 *
 * [클래스명]
 * - HospitalClassifier : 제5기(2024~2026) 상급종합병원 47개소 명단과 분류 코드를 대조해 병원 종별을 판별함.
 *
 * [동작 흐름]
 * - 1) 상위 병합 서비스 -> isRegional(fields) ──> 권역응급의료센터 여부(boolean) 반환
 * - 2) 이어서 호출 -> classify(fields, rawName) ──> TYPE_TERTIARY / TYPE_MEDICAL / TYPE_OTHER 반환
 */

    public static final HospitalTypeDto TYPE_TERTIARY =
            new HospitalTypeDto("tertiary", "상급종합병원", "#d34458", 1);
    public static final HospitalTypeDto TYPE_MEDICAL =
            new HospitalTypeDto("medical", "의료원", "#2879ce", 2);
    public static final HospitalTypeDto TYPE_OTHER =
            new HospitalTypeDto("other", "일반·기타 응급의료기관", "#738295", 3);
    /*
     * [자바 문법]
     * - public static final : 외부에서도 읽을 수 있으며 값을 바꿀 수 없는 정적 상수 선언임.
     * - new : 불변 레코드 인스턴스를 힙 메모리에 생성하는 연산자임.
     *
     * [프로젝트 내부 타입 및 생성자]
     * - HospitalTypeDto (com.yonsei119.dto) : 영문 그룹, 라벨, HEX 색상, 정렬 순위를 담는 DTO 레코드임.
     * - new HospitalTypeDto(group, label, accent, priority) : 3대 종별 상수 값을 초기화하는 레코드 생성자임.
     *
     * [상수명]
     * - TYPE_TERTIARY : 상급종합병원 결과 상수("tertiary", "#d34458", 우선순위 1)임.
     * - TYPE_MEDICAL : 의료원 결과 상수("medical", "#2879ce", 우선순위 2)임.
     * - TYPE_OTHER : 일반·기타 응급의료기관 결과 상수("other", "#738295", 우선순위 3)임.
     */

    private static final Pattern NORMALIZE_STRIP_PATTERN = Pattern.compile("[\\s·()（）\\[\\]-]");
    /*
     * [자바 문법]
     * - private static final : 클래스 내부에서만 공유하는 정적 불변 패턴 상수 선언임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Pattern (java.util.regex.Pattern) : 사전에 컴파일된 정규표현식 패턴 객체 타입임.
     *
     * [자바/스프링 내장 메서드]
     * - Pattern.compile(정규식) : 공백·가운뎃점·괄호·하이픈 제거 패턴을 로딩 시 1회만 컴파일함.
     *   - 장점 : 호출마다 String.replaceAll()로 정규식을 매번 다시 컴파일하는 비용을 없앰.
     *
     * [상수명]
     * - NORMALIZE_STRIP_PATTERN : 병원명 비교 전 특수기호와 공백을 한꺼번에 지우는 정규식 상수임.
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
     * [자바 문법]
     * - private static final : 클래스 내부 전용 정적 불변 상수 맵 선언임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, Pattern>, Map.Entry, Pattern.
     *
     * [자바/스프링 내장 메서드]
     * - Map.ofEntries(...) / Map.entry(키, 값) : 11쌍 이상(15개)의 불변 맵을 만드는 Java 9+ 팩토리임.
     *   - 비교 : Map.of()는 최대 10쌍까지만 지원하므로 11쌍 이상일 때 Map.ofEntries()를 씀.
     * - Pattern.compile(정규식) : ^서울, ^(충북|충청북도) 등 시·도 시작 주소 정규식을 컴파일함.
     *
     * [상수명]
     * - REGION_PREFIX : 타 지역 동명이인 병원 오분류를 막으려 주소 앞 시·도를 검사하는 15개 패턴 맵임.
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
     * [자바 문법]
     * - private static final / new : 클래스 내부에서 공유하는 불변 목록과 레코드 생성 구문임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - List (java.util.List) : 순서를 유지하는 목록 인터페이스임.
     *
     * [자바/스프링 내장 메서드]
     * - List.of(...) : 수정이 불가능한 불변 리스트를 생성하는 정적 팩토리 메서드임.
     *
     * [프로젝트 내부 타입 및 생성자]
     * - TertiaryRule : HospitalClassifier 클래스 하단에 직접 정의한 중첩 레코드 타입임.
     * - new TertiaryRule(region, aliases) : 시·도 약칭과 허용 병원명·별칭 목록을 묶어 생성함.
     *
     * [상수명]
     * - TERTIARY_2024_2026 : 보건복지부 제5기(2024~2026) 상급종합병원 47개소 권역·명칭 목록임.
     *   - 목적 : 공공데이터 dutyDivNam이 "종합병원"으로 내려와도 상급종합병원으로 정확히 식별함.
     */

    public static String normalizeName(String value) {
    /*
     * [자바 문법]
     * - public static : 객체 생성 없이 외부에서도 호출 가능한 정적 문자열 정규화 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String.
     *
     * [메서드명 및 매개변수명]
     * - normalizeName : 병원명 비교 전 전각 기호·공백·괄호·하이픈을 빼고 소문자로 통일함.
     * - value : 정규화할 원본 병원명 문자열 매개변수임.
     */
        if (value == null || value.isBlank()) {
            return "";
        }
        String nfkc = Normalizer.normalize(value, Normalizer.Form.NFKC);
        return NORMALIZE_STRIP_PATTERN.matcher(nfkc).replaceAll("").toLowerCase(Locale.ROOT);
        /*
         * [자바 문법]
         * - if / == null / || / return : null이나 공백만 들어오면 빈 문자열 ""을 즉시 반환함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Normalizer, Normalizer.Form, Locale, String.
         *
         * [자바/스프링 내장 메서드]
         * - String.isBlank() : 빈 문자열 또는 공백만으로 이루어진 입력인지 판별함.
         * - Normalizer.normalize(문자열, Normalizer.Form.NFKC) : 전각 괄호·영숫자를 반각 문자로 통일함.
         * - Pattern.matcher(문자열).replaceAll("") : 컴파일된 정규식으로 공백·괄호·기호를 지움.
         * - String.toLowerCase(Locale.ROOT) : 실행 환경 로케일 영향을 배제하고 소문자로 변환함.
         *
         * [지역 변수명]
         * - nfkc : Normalizer.Form.NFKC 정규화가 끝난 중간 문자열 변수임.
         *
         * [데이터 변환 예시]
         * - 입력: "연세대학교 원주세브란스기독병원（권역）" -> 출력: "연세대학교원주세브란스기독병원권역"
         */
    }

    public boolean isRegional(Map<String, String> fields) {
    /*
     * [자바 문법]
     * - public boolean : 참/거짓 논리값(boolean)을 반환하는 공개 인스턴스 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, String>.
     *
     * [메서드명 및 매개변수명]
     * - isRegional : 기관 기본정보 맵에서 "권역응급의료센터" 지정 여부를 판별하는 메서드임.
     * - fields : 소문자 XML 태그 키로 병합된 기관 기본정보 맵 매개변수임.
     */
        if (fields == null) {
            return false;
        }
        String emclsName = fields.getOrDefault("dutyemclsname", "");
        return emclsName.contains("권역응급의료센터");
        /*
         * [자바 문법]
         * - if (fields == null) / return : 입력 맵이 null이면 즉시 false를 반환함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - String, Map.
         *
         * [자바/스프링 내장 메서드]
         * - Map.getOrDefault(키, "") : 키가 없을 때 null 대신 빈 문자열 ""를 기본값으로 반환함.
         * - String.contains("권역응급의료센터") : "권역응급의료센터" 문구 포함 여부를 검사함 (형제: startsWith, equals).
         *
         * [지역 변수명]
         * - emclsName : dutyemclsname 태그에서 꺼낸 응급의료기관 분류명 문자열임.
         *
         * [동작 흐름]
         * - fields.getOrDefault("dutyemclsname", "") -> "권역응급의료센터" 포함 시 true 반환
         *   └── 상급종합이면서 권역응급인 기관도 두 필터에 모두 잡히도록 classify()와 분리 판별함
         */
    }

    public HospitalTypeDto classify(Map<String, String> fields, String rawName) {
    /*
     * [자바 문법]
     * - public : 외부 서비스에서 호출 가능한 공개 인스턴스 메서드임.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - Map<String, String>, String.
     *
     * [프로젝트 내부 타입]
     * - HospitalTypeDto (com.yonsei119.dto) : 반환 타입인 프로젝트 종별 분류 DTO 레코드임.
     *
     * [메서드명 및 매개변수명]
     * - classify : 기본정보 맵과 병원명을 우선순위로 검사해 3대 종별 상수 중 하나를 반환함.
     * - fields : 소문자 XML 태그 키로 병합된 기관 기본정보 맵 매개변수임.
     * - rawName : 별도 추출한 원본 병원명(null이면 fields의 dutyname 사용).
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
         * [자바 문법]
         * - ?: / != null / boolean / 람다 / || / && / if / return : 3단계 우선순위로 종별을 분기함.
         *
         * [자바/스프링/라이브러리 내장 타입]
         * - Map, String, Pattern.
         *
         * [자바/스프링 내장 메서드]
         * - Map.of() : 입력 맵이 null이어도 예외 없이 조회하도록 빈 불변 맵을 제공함.
         * - Map.getOrDefault(키, "") / String.trim() / isEmpty() / contains(...) : 맵 조회와 공백·포함 검사임.
         * - Collection.stream().anyMatch(조건) : 요소 중 하나라도 조건에 맞으면 즉시 true를 내고 멈춤.
         * - Pattern.matcher(문자열).find() : 주소 앞머리가 컴파일된 시·도 정규식 패턴과 맞는지 찾음.
         *
         * [프로젝트 내부 타입]
         * - HospitalTypeDto (com.yonsei119.dto) : TYPE_TERTIARY·TYPE_MEDICAL·TYPE_OTHER의 DTO 타입임.
         *
         * [지역 변수명]
         * - safeFields / name / address / divNam : null 방어 맵, 정규화 이름, 주소, 종별명 문자열임.
         * - explicitlyDesignated / inOfficialList : XML 직접 표기 여부와 47개 고시 명단 일치 여부임.
         * - rule, regionPattern, regionMatches, alias : 스트림 검사 중 규칙 1건·지역·별칭을 검증하는 변수임.
         *
         * [동작 흐름]
         * - 1순위 : dutydivnam에 "상급종합" 포함 또는 47개 고시 명단 일치 -> TYPE_TERTIARY 반환
         * - 2순위 : 정규화 이름에 "의료원" 포함 ──> TYPE_MEDICAL 반환
         * - 3순위 : 1·2순위 조건 미해당 나머지 기관 ──> TYPE_OTHER 반환
         */
    }

    private record TertiaryRule(
            String region,
            List<String> aliases
    ) {
    /*
     * [자바 문법]
     * - private record : 클래스 내부 전용 불변 레코드로 생성자와 region(), aliases()가 자동 생성됨.
     *
     * [자바/스프링/라이브러리 내장 타입]
     * - String, List<String>.
     *
     * [중첩 레코드명 및 컴포넌트명]
     * - TertiaryRule : 상급종합병원 권역과 공식명·별칭 목록 규칙 1건을 담는 중첩 레코드임.
     * - region : REGION_PREFIX 맵의 키와 1:1로 짝지어지는 시·도 약칭 컴포넌트임.
     * - aliases : TertiaryRule 규칙 대상 병원의 공식 이름과 허용 별칭 목록 컴포넌트임.
     */
    }
}
