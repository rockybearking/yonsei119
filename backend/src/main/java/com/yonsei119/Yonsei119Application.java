package com.yonsei119;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 연세 119 백엔드 서버의 전원을 켜고 내장 웹 서버(Tomcat)와
 *          실시간 자동 갱신 타이머를 가동하는 총지배인 클래스
 * - 실행 시점 : `.\gradlew.bat bootRun` 또는 `java -jar yonsei119.jar` 실행 시
 *              JVM이 가장 먼저 `main()` 메서드를 호출함
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *    [JVM Runtime]      [Yonsei119Application]      [SpringApplication]       [EmergencyDataService]
 *          |                       |                         |                           |
 *          |-- 1. main(args) ----->|                         |                           |  서버 프로세스 시작
 *          |                       |-- 2. run(App.class) --->|                           |  스프링 부트 기동
 *          |                       |                         |-- 3. bind YAML + Tomcat   |  설정 바인딩 및 포트 개방
 *          |                       |                         |-- 4. warmUpCache() ------>|  초기 7종 공공데이터 적재
 *          |                       |                         |-- 5. @Scheduled(60s) ---->|  60초 실시간 자동 갱신 예약
 *          v                       v                         v                           v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ class            : 자바 클래스를 선언하는 문법 키워드
 *   ㄴ static void main : 프로그램 시작점 메서드 (Java 25+ 간결 시그니처)
 *   ㄴ String[]         : 실행 시 전달된 명령줄 인자를 담는 문자열 배열 타입
 * - Spring 프레임워크
 *   ㄴ @SpringBootApplication       : 자동 설정 · 빈 스캔을 묶은 핵심 어노테이션
 *   ㄴ @ConfigurationPropertiesScan : `Yonsei119Properties` 설정 레코드 자동 등록
 *   ㄴ @EnableScheduling            : `@Scheduled` 백그라운드 주기 실행 활성화
 *   ㄴ SpringApplication.run()      : 스프링 컨테이너와 웹 서버를 띄우는 정적 메서드
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 빌드 및 배포 연결처
 *   ㄴ backend/build.gradle             : `mainClass = 'com.yonsei119.Yonsei119Application'`
 *   ㄴ Yonsei119BackendTests.java       : `@SpringBootTest` 기동 기준점
 *   ㄴ Yonsei119PlaywrightE2ETests.java : 브라우저 통합 테스트 서버 기동 기준점
 * - 실행 방법
 *   ㄴ 로컬 실행 : IntelliJ 초록색 실행(Run) 버튼 또는 `.\gradlew.bat bootRun`
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class Yonsei119Application {

    static void main(String[] args) {
        // 설정 바인딩 -> 싱글톤 빈 조립 -> 내장 Tomcat 기동 -> 초기 캐시 워밍업까지 일괄 수행함
        SpringApplication.run(Yonsei119Application.class, args);
    }
}
