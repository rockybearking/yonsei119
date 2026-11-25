# ==============================================================================
# [역할 및 실행 시점]
# - 역할: 프론트엔드(HTML/CSS/JS)와 백엔드(Spring Boot 4.2 + Java 27)를 하나의 실행 파일(app.jar)로 포장하는 배포 조리실
# - 실행 시점: Render 클라우드 배포 시 또는 로컬 `docker build` 실행 시 2단계(Multi-stage)로 동작함
#
# [전체 빌드 및 기동 흐름]
# - 1단계(builder: JDK 27)
#   ├── Gradle 설정 복사 ──> `:backend:dependencies` 실행 (라이브러리 캐시 레이어 생성)
#   └── frontend/ + backend/src 복사 ──> `:backend:bootJar` 실행 (정적 파일 합본 yonsei119.jar 생성)
# - 2단계(런타임: 경량 JRE 27)
#   ├── builder에서 완성된 yonsei119.jar만 `/app/app.jar`로 복사 (이미지 용량 최소화)
#   └── 컨테이너 시작 시 `java $JAVA_OPTS -Dserver.port=${PORT:-8080} -jar /app/app.jar` 실행
#
# [사용처 및 IDE 추적 가이드]
# - 사용처: render.yaml의 `dockerfilePath: ./Dockerfile`에서 참조하여 Render 무료 플랜 컨테이너를 빌드·기동함
# - 로컬 실행 예시:
#   1) 빌드: `docker build -t yonsei119:latest .`
#   2) 실행: `docker run --rm -p 8080:8080 --env-file .env yonsei119:latest`
# ==============================================================================

# [1단계: 빌드 전용 JDK 27 스테이지] (Docker 내장 명령어: FROM, WORKDIR)
FROM eclipse-temurin:27.0.1.1_4-jdk AS builder
WORKDIR /workspace

# [의존성 캐시 레이어] 빌드 설정이 안 바뀌면 라이브러리 다운로드를 건너뛰어 재배포 속도를 단축함
COPY gradlew gradlew.bat settings.gradle build.gradle ./
COPY gradle ./gradle
COPY backend/build.gradle ./backend/build.gradle
RUN chmod +x ./gradlew && ./gradlew :backend:dependencies --no-daemon

# [단일 실행 JAR 패키징] backend/build.gradle의 copyFrontendToStatic 작업이 frontend/를 JAR 내부 static/으로 함께 복사함
COPY frontend ./frontend
COPY backend/src ./backend/src
RUN ./gradlew :backend:bootJar --no-daemon -x test

# [2단계: 실행 전용 경량 JRE 27 스테이지] 소스·컴파일러 없이 가벼운 JRE만 남겨 콜드스타트 부팅 속도를 높임
FROM eclipse-temurin:27.0.1.1_4-jre
WORKDIR /app
COPY --from=builder /workspace/backend/build/libs/yonsei119.jar /app/app.jar

# [런타임 환경변수 및 진입점] Render가 주입하는 PORT(기본 10000) 또는 로컬 기본값(8080)으로 내장 Tomcat 포트 개방
ENV PORT=8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -Dfile.encoding=UTF-8"
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -Dserver.port=${PORT:-8080} -jar /app/app.jar"]
