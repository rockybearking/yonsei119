package com.yonsei119;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;
/*
 * [자바 문법] package, import : 이 파일의 소속 폴더(com.yonsei119)를 선언하고, 스프링 부트가 미리 만들어 둔 도구들을 불러옴.
 * [자바/스프링/라이브러리 내장 도구(타입)] SpringApplication : 스프링 부트 웹 서버(내장 Tomcat)에 시동을 거는 공식 런처 클래스임 (이름 변경 불가).
 * [스프링/라이브러리 내장 어노테이션]
 * - @SpringBootApplication (출처: org.springframework.boot.autoconfigure) : 자동 설정 + 컴포넌트 스캔(@Component, @Service, @RestController 탐색)을 한 번에 켜는 핵심 스위치임.
 * - @ConfigurationPropertiesScan (출처: org.springframework.boot.context.properties) : application.yml 설정값을 자바 record(Yonsei119Properties) 상자에 자동 주입하도록 스캔함.
 * - @EnableScheduling (출처: org.springframework.scheduling.annotation) : 백그라운드 타이머(@Scheduled)가 주기적으로 공공데이터를 갱신할 수 있게 허용함 (형제 어노테이션: @EnableAsync, @EnableCaching).
 */

@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class Yonsei119Application {
/*
 * [스프링/라이브러리 내장 어노테이션] @SpringBootApplication, @ConfigurationPropertiesScan, @EnableScheduling : 서버의 3대 핵심 엔진(웹서버, 환경설정 바인딩, 자동 갱신 시계)을 장착함.
 * [자바 문법] public class : 어디서든 접근 가능한(public) 자바 설계도(class)를 선언하는 예약어임.
 * [내가 지은 이름] Yonsei119Application : 대문자로 시작하는 메인 클래스 이름임 (파일명 Yonsei119Application.java와 반드시 글자까지 같아야 함).
 * [핵심 원리 & 비유]
 * - '응급의료 관제 식당' 전체의 정문 전원 스위치임.
 * - 이 스위치가 켜지면 카운터(EmergencyApiController), 주방(EmergencyDataService, NaverDirectionsService), 식자재 구매팀(NmcOpenApiClient)이 자동으로 조립되어 영업을 시작함.
 */

    public static void main(String[] args) {
    /*
     * [자바 문법] public static void : 자바 가상머신(JVM)이 객체 생성 없이(static) 가장 먼저 찾아 실행하며, 반환값이 없는(void) 표준 시작점 문법임.
     * [자바/스프링/라이브러리 내장 도구(타입)] String[] : 실행 시 전달되는 문자열 배열 타입임 (이름 변경 불가).
     * [스프링/자바 내장 함수] main : 자바 프로그램의 시작 함수 이름으로 절대 다른 이름으로 바꿀 수 없음.
     * [내가 지은 이름] args : 터미널 실행 옵션(예: --server.port=9090)을 담아 두는 소문자 변수(상자) 이름임.
     */
        SpringApplication.run(Yonsei119Application.class, args);
        /*
         * [스프링/자바 내장 함수] SpringApplication.run(...) : 내장 Tomcat 웹 서버를 띄우고 모든 스프링 빈(Bean)을 메모리에 올리는 공식 시동 함수임 (이름 변경 불가).
         * [자바 문법] .class : Yonsei119Application 설계도 자체의 정보를 넘겨주는 자바 문법 키워드임.
         * [실제 작동 흐름 예시]
         *   JVM이 main(args) 호출
         *   └──> SpringApplication.run(...) 실행
         *        ├──> 1) application.yml 로드 -> Yonsei119Properties 생성
         *        ├──> 2) 내장 웹 서버 8080 포트 개방 (http://localhost:8080)
         *        └──> 3) EmergencyDataService.warmUpCacheOnStartup() 실행 (전국 응급실 사전 캐싱 시작)
         */
    }
}
