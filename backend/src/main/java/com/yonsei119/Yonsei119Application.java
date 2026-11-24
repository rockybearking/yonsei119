package com.yonsei119;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;
/*
 * [자바 문법]
 * - package : Yonsei119Application.java가 속한 패키지 경로(com.yonsei119)를 선언하는 예약어임.
 * - import : 다른 패키지의 스프링 부트 런처와 설정 도구를 짧은 이름으로 불러오는 예약어임.
 *
 * [패키지명]
 * - com.yonsei119 : 백엔드 프로젝트의 최상위 루트 패키지명임 (하위 config, controller, dto, service, util 패키지 기준점).
 *
 * [스프링 내장 타입 (이름 변경 불가)]
 * - SpringApplication (출처: org.springframework.boot 패키지) : 내장 Tomcat 웹 서버를 띄우고 스프링 애플리케이션을 실행하는 공식 런처 클래스임.
 */

@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class Yonsei119Application {
/*
 * [스프링 내장 어노테이션]
 * - @SpringBootApplication 정의 (출처: org.springframework.boot.autoconfigure.SpringBootApplication, 이름 변경 불가)
 *   · 역할 : 스프링 부트의 핵심 설정 3가지(@SpringBootConfiguration, @EnableAutoConfiguration, @ComponentScan)를 한 번에 켜 주는 메인 시작 어노테이션임.
 * - @SpringBootApplication 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 Yonsei119Application 클래스
 *   · 작동 원리 : com.yonsei119와 하위 패키지를 스캔해 빈을 등록하고 자동 설정과 내장 Tomcat 웹 서버를 구성함.
 *   · 비교 : @SpringBootConfiguration, @EnableAutoConfiguration, @ComponentScan 3개를 따로 적용해 대체 가능함.
 * - @ConfigurationPropertiesScan 정의 (출처: org.springframework.boot.context.properties.ConfigurationPropertiesScan, 이름 변경 불가)
 *   · 역할 : 하위 패키지에서 @ConfigurationProperties가 붙은 설정 클래스·레코드를 자동 탐색해 스프링 빈으로 등록하는 어노테이션임.
 * - @ConfigurationPropertiesScan 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 Yonsei119Application 클래스
 *   · 작동 원리 : com.yonsei119 하위에서 @ConfigurationProperties가 붙은 Yonsei119Properties를 찾아 빈으로 등록함.
 *   · 비교 : 클래스 1개만 지정하는 @EnableConfigurationProperties나 단일 값 주입용 @Value("${키}")가 있음.
 * - @EnableScheduling 정의 (출처: org.springframework.scheduling.annotation.EnableScheduling, 이름 변경 불가)
 *   · 역할 : 스프링 애플리케이션에서 @Scheduled가 붙은 주기적 백그라운드 작업 실행 기능을 활성화하는 어노테이션임.
 * - @EnableScheduling 현재 코드 적용
 *   · 적용 대상 : 바로 위 선언된 Yonsei119Application 클래스
 *   · 작동 원리 : 스케줄러 후처리기를 등록해 EmergencyDataService.scheduledBackgroundRefresh()의 @Scheduled 타이머를 연결함.
 *   · 비교 : 비동기 실행을 켜는 @EnableAsync, 스프링 캐시 추상화를 켜는 @EnableCaching이 있음.
 *
 * [자바 문법]
 * - public : 다른 패키지나 JVM 등 외부 어디에서나 접근 가능한 공개 제어자임.
 * - class : 객체의 구조와 동작을 정의하는 클래스 선언 예약어임 (중괄호 { ... } 로 본문을 감쌈).
 *
 * [클래스명]
 * - Yonsei119Application : 스프링 부트 애플리케이션의 메인 시작 클래스명임 (파일명 Yonsei119Application.java와 일치해야 함).
 *
 * [동작 흐름]
 * - 호출 출처 : .\gradlew.bat bootRun 또는 java -jar yonsei119.jar 실행 시 JVM이 메인 클래스로 로드함.
 * - 흐름 :
 *   1) @SpringBootApplication·@ConfigurationPropertiesScan·@EnableScheduling 해석 ──> com.yonsei119 하위 스캔
 *      ├── config : Yonsei119Properties, WebConfig, SecurityHeadersFilter 등록
 *      ├── controller : EmergencyApiController 등록
 *      └── service : EmergencyDataService 등 서비스 빈 등록 및 @Scheduled 연결
 * - 전달 대상 : 내부 Yonsei119Application.main(String[] args) 메서드가 JVM에 의해 즉시 호출되어 서버 기동을 시작함.
 */

    static void main(String[] args) {
    /*
     * [자바 문법]
     * - public : JVM이 외부에서 제약 없이 main(String[] args) 메서드를 호출하도록 공개함.
     * - static : 객체를 new로 만들지 않고 클래스 이름으로 바로 호출할 수 있는 정적 메서드 예약어임.
     * - void : 실행이 끝난 뒤 호출한 쪽으로 돌려주는 반환값이 없음을 뜻함.
     *
     * [자바 표준 내장 타입 및 메서드 (이름 변경 불가)]
     * - String (출처: java.lang 패키지) : 문자열 표준 클래스임 (String[] 은 문자열 배열 타입).
     * - main : JVM이 자바 프로그램 실행 시작점으로 약속해 둔 고정 메서드명임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : main (JVM 표준 규약으로 이름 변경 불가).
     * - 매개변수명 : args (커맨드라인 실행 인자, 예: --server.port=9090 등을 담는 String[] 배열).
     */
        SpringApplication.run(Yonsei119Application.class, args);
        /*
         * [자바 문법]
         * - Yonsei119Application.class : 클래스 자체의 메타정보(Class 리터럴)를 인자로 넘기는 자바 문법임.
         *
         * [스프링 내장 메서드 (이름 변경 불가)]
         * - SpringApplication.run(Class<?> primarySource, String... args) (출처: org.springframework.boot 패키지)
         *   · 역할 : 설정 파일 읽기, 스프링 컨테이너 초기화, 내장 웹 서버 실행을 수행하는 정적 메서드임.
         *
         * [동작 흐름]
         * - 호출 출처 : JVM이 프로그램 시작 시 main(String[] args)를 호출함.
         * - 흐름 :
         *   1) SpringApplication.run(...) 실행 ──> application.yml·.env 로드 ──> Yonsei119Properties 빈 생성
         *   2) WebConfig·SecurityHeadersFilter·EmergencyApiController·서비스 빈 의존성 주입 조립
         *   3) 내장 Tomcat 웹 서버 실행 ──> server.port(기본 8080) 개방 및 HTTP 수신 대기
         *   4) ApplicationReadyEvent 발행 ──> EmergencyDataService.warmUpCacheOnStartup() 백그라운드 캐싱 시작
         * - 반환값 : ConfigurableApplicationContext를 반환하나 변수에 받지 않으며, 웹 서버가 종료 전까지 프로세스를 유지함.
         */
    }
}
