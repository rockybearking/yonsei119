FROM eclipse-temurin:17-jdk AS builder
WORKDIR /workspace
# [Docker 내장 명령어] FROM (베이스 이미지 선택), WORKDIR (작업 폴더 지정)
# [내가 지은 이름] builder (1단계 빌드 전용 임시 조리실 별칭), /workspace (컨테이너 내부 빌드 폴더)
# [핵심 원리] 소스코드를 컴파일할 때만 무거운 JDK 17 이미지를 쓰고, 완성된 JAR만 2단계 가벼운 JRE로 옮기는 멀티스테이지 빌드임.

COPY gradlew gradlew.bat settings.gradle build.gradle ./
COPY gradle ./gradle
COPY backend/build.gradle ./backend/build.gradle
RUN chmod +x ./gradlew && ./gradlew :backend:dependencies --no-daemon
# [Docker 내장 명령어] COPY (호스트 파일 복사), RUN (컨테이너 빌드 중 셸 명령어 실행)
# [핵심 원리] 소스코드보다 자주 안 바뀌는 설정 파일(build.gradle)만 먼저 복사해 라이브러리를 받아 두면,
# 다음 배포 때 코드만 고쳤을 경우 수백 MB 라이브러리 재다운로드를 건너뛰는 Docker 레이어 캐싱이 작동함.

COPY frontend ./frontend
COPY backend/src ./backend/src
RUN ./gradlew :backend:bootJar --no-daemon -x test
# [핵심 원리 & 변환 결과]
# - frontend/(모듈화된 HTML/CSS/JS/PWA)와 backend/src(Java 서버 코드)를 복사해 단일 JAR로 패키징함.
# - 생성 결과물: /workspace/backend/build/libs/yonsei119-backend.jar

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /workspace/backend/build/libs/yonsei119-backend.jar /app/app.jar
# [Docker 내장 옵션] COPY --from=builder (1단계 조리실에서 완성된 도시락 app.jar 하나만 2단계 배달 차량으로 옮김)
# [핵심 원리] 컴파일러가 제거된 경량 JRE 17 런타임 이미지를 사용하여 클라우드 메모리 점유율과 공격 표면을 줄임.

ENV PORT=8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -Dfile.encoding=UTF-8"
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -Dserver.port=${PORT:-8080} -jar /app/app.jar"]
# [Docker 내장 명령어] ENV (환경변수 기본값), EXPOSE (문서용 개방 포트 표시), ENTRYPOINT (컨테이너 시작 시 실행할 메인 명령어)
# [내가 지은 이름] /app/app.jar, JAVA_OPTS
# [실제 실행 명령어 예시]
#   Render 클라우드가 PORT=10000을 주입한 경우:
#   └──> java -XX:MaxRAMPercentage=75.0 -Dfile.encoding=UTF-8 -Dserver.port=10000 -jar /app/app.jar
