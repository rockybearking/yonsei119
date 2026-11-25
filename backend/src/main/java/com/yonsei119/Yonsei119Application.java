package com.yonsei119;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/*
 * [역할 및 실행 시점]
 * - 역할: 연세 119 백엔드 서버 전체의 전원을 켜고 내장 웹 서버(Tomcat)와 백그라운드 타이머를 가동하는 총지배인 클래스
 * - 실행 시점: `.\gradlew.bat bootRun` 또는 `java -jar app.jar` 명령 실행 시 JVM이 가장 먼저 `main()` 메서드를 호출함
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   JVM 시작 ──> Yonsei119Application.main() ──> SpringApplication.run()
 *   ├── 1) @ConfigurationPropertiesScan ──> application.yml·환경변수를 Yonsei119Properties 레코드에 바인딩
 *   ├── 2) @SpringBootApplication       ──> config·controller·service 하위 빈 자동 스캔 및 의존성 조립(DI)
 *   ├── 3) 내장 Tomcat 포트 개방         ──> 정적 프론트엔드(HTML/CSS/JS) 및 `/api/**` 엔드포인트 서빙 시작
 *   └── 4) @EnableScheduling + ApplicationReadyEvent
 *       ├── EmergencyDataService.warmUpCacheOnStartup() 실행 (초기 7종 공공데이터 백그라운드 적재)
 *       └── EmergencyDataService.scheduledBackgroundRefresh() 실행 (60초 주기 실시간 병상·공지 자동 갱신)
 *
 * [내장 / 프레임워크 구분]
 * - Java 표준 내장: String[] (커맨드라인 인자 배열), main() (Java 25+ 간결 시그니처 `static void main`)
 * - Spring 프레임워크: @SpringBootApplication, @ConfigurationPropertiesScan, @EnableScheduling, SpringApplication.run()
 *
 * [사용처 및 IDE 추적 가이드]
 * - 로컬 서버 실행: IntelliJ에서 클래스 옆 초록색 ▶ 버튼 클릭 또는 터미널에서 `.\gradlew.bat bootRun`
 * - 테스트 연결처: Yonsei119BackendTests, Yonsei119PlaywrightE2ETests (@SpringBootTest가 이 설정을 자동 감지해 부팅함)
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class Yonsei119Application {

    static void main(String[] args) {
        // [스프링 내부 동작] 설정 로드 -> 싱글톤 빈 생성 -> Tomcat 웹 서버 기동 -> ApplicationReadyEvent 발행까지 일괄 수행함
        SpringApplication.run(Yonsei119Application.class, args);
    }
}
