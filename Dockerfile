# ==============================================================================
# [1. 역할 및 실행 시점]
# - 역할 : 프론트엔드와 백엔드를 단일 실행 파일(`app.jar`)로 묶어 띄우는 컨테이너 조리실
# - 실행 시점 : Render 배포 또는 로컬 `docker build` 실행 시 2단계(Multi-stage)로 동작함
#
# [2. 전체 빌드 및 실행 흐름 (시퀀스 다이어그램)]
#
#    [Docker Engine]             [Stage 1: JDK 27]            [Stage 2: JRE 27]
#           |                            |                            |
#           |-- 1. COPY gradle + deps -->|                            |  의존성 캐시 레이어 생성
#           |-- 2. gradlew bootJar ----->|                            |  프론트 합본 yonsei119.jar 빌드
#           |                            |-- 3. COPY yonsei119.jar -->|  실행 전용 경량 JRE로만 복사
#           |-- 4. java -jar app.jar ----|--------------------------->|  컨테이너 포트 개방 및 기동
#           v                            v                            v
#
# [3. 사용된 Docker 표준 내장 명령어]
#   ㄴ FROM       : 베이스 이미지 지정 (JDK 27 빌드용 / JRE 27 실행용 분리)
#   ㄴ WORKDIR    : 컨테이너 내부 작업 디렉터리 설정
#   ㄴ COPY       : 호스트 파일 또는 이전 스테이지 산출물 복사
#   ㄴ RUN        : 이미지 빌드 중 셸 명령 실행
#   ㄴ ENV/EXPOSE : 런타임 기본 환경변수 및 문서화 포트 선언
#   ㄴ ENTRYPOINT : 컨테이너 시작 시 실행할 메인 프로세스 지정
#
# [4. 실제 사용처]
#   ㄴ render.yaml          : `dockerfilePath: ./Dockerfile`에서 참조
#   ㄴ backend/build.gradle : `archiveFileName = 'yonsei119.jar'` 산출물 이름 일치
# ==============================================================================

FROM eclipse-temurin:27.0.1.1_4-jdk AS builder
WORKDIR /workspace

COPY gradlew gradlew.bat settings.gradle build.gradle ./
COPY gradle ./gradle
COPY backend/build.gradle ./backend/build.gradle
RUN chmod +x ./gradlew && ./gradlew :backend:dependencies --no-daemon

COPY frontend ./frontend
COPY backend/src ./backend/src
RUN ./gradlew :backend:bootJar --no-daemon -x test

FROM eclipse-temurin:27.0.1.1_4-jre
WORKDIR /app
COPY --from=builder /workspace/backend/build/libs/yonsei119.jar /app/app.jar

ENV PORT=8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -Dfile.encoding=UTF-8"
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -Dserver.port=${PORT:-8080} -jar /app/app.jar"]
