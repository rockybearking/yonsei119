FROM eclipse-temurin:17-jdk AS builder
WORKDIR /workspace
# [Docker 내장 명령어 및 문법]
# - FROM <이미지> AS <별칭> : 기준 이미지를 고르고 빌드 단계 별칭을 붙이는 명령어임.
# - 형제 옵션 : CPU 아키텍처를 고르는 --platform=linux/amd64 등이 있음.
# - WORKDIR <경로> : 이후 명령이 실행될 컨테이너 내부 작업 폴더를 만드는 명령어임.
# - 비교 문법 : 다음 줄에서 경로가 초기화되는 RUN cd 대신 WORKDIR을 씀.
#
# [스테이지 및 경로명]
# - eclipse-temurin:17-jdk : Java 17 컴파일러(javac)가 포함된 빌드용 JDK 이미지임.
# - builder : 1단계 컴파일과 JAR 빌드를 맡는 스테이지 별칭임.
# - /workspace : 1단계 빌드 스테이지에서 쓰는 작업 폴더 경로임.

COPY gradlew gradlew.bat settings.gradle build.gradle ./
COPY gradle ./gradle
COPY backend/build.gradle ./backend/build.gradle
RUN chmod +x ./gradlew && ./gradlew :backend:dependencies --no-daemon
# [Docker 내장 명령어 및 CLI 옵션]
# - COPY <원본> <대상> : 호스트의 파일이나 폴더를 이미지 내부로 복사하는 명령어임.
# - 형제 명령어 : 압축 자동 해제와 URL 복사를 지원하는 ADD가 있으나 단순 복사는 COPY를 씀.
# - RUN <명령> : 이미지 빌드 중에 셸 명령을 실행해 결과를 레이어에 저장하는 명령어임.
# - chmod +x, && : 실행 권한을 주고 앞 명령이 성공할 때만 뒤 명령을 잇는 셸 문법임.
# - --no-daemon : 빌드가 끝나면 Gradle 백그라운드 프로세스를 바로 끄는 CLI 옵션임.
#
# [동작 흐름]
# - 1) Gradle 래퍼와 빌드 설정 파일만 먼저 복사함.
# - 2) :backend:dependencies 실행 -> 외부 라이브러리를 미리 받아 캐시 레이어를 만듦.
# - 3) 이후 코드만 바뀌면 캐시 레이어를 재사용 -> 의존성 재다운로드 없이 빠르게 재빌드함.

COPY frontend ./frontend
COPY backend/src ./backend/src
RUN ./gradlew :backend:bootJar --no-daemon -x test
# [Docker 내장 명령어 및 Gradle CLI 옵션]
# - COPY, RUN : 파일 복사와 빌드 명령 실행을 담당하는 Docker 내장 명령어임.
# - -x test : 빌드 속도를 높이기 위해 패키징 중 test 실행을 건너뛰는 Gradle 옵션임.
# - 형제 옵션 : 모든 태스크를 강제 재실행하는 --rerun-tasks, 오프라인 모드 --offline이 있음.
#
# [동작 흐름]
# - frontend/와 backend/src/ 복사 -> :backend:bootJar 실행함.
#   └── copyFrontendToStatic -> processResources -> bootJar 순서로 단일 JAR 빌드함.
# - 산출물 경로 : /workspace/backend/build/libs/yonsei119-backend.jar
# - 참고 : 테스트 검증은 이미지 빌드 전에 .\gradlew.bat checkAll로 미리 마침.

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /workspace/backend/build/libs/yonsei119-backend.jar /app/app.jar
# [Docker 내장 명령어 및 옵션]
# - FROM, WORKDIR : 실행 전용 2단계 이미지와 작업 폴더를 정하는 Docker 명령어임.
# - COPY --from=<별칭> : 앞선 빌드 스테이지에서 만든 결과물만 꺼내 복사하는 옵션임.
# - 비교 옵션 : 외부 공개 이미지 경로를 지정해 파일을 가져올 수도 있음.
#
# [스테이지 및 경로명]
# - eclipse-temurin:17-jre : 컴파일러를 빼고 실행기만 남긴 가벼운 Java 17 JRE 이미지임.
# - /app, /app/app.jar : 2단계 실행 컨테이너 작업 폴더와 최종 실행 JAR 경로임.
#
# [동작 흐름]
# - 1단계(builder)의 빌드 JAR -> COPY --from=builder로 복사 -> 2단계 /app/app.jar 배치함.
#   └── 소스 코드와 Gradle 캐시가 빠지므로 최종 배포 이미지 용량이 크게 줄어듦.

ENV PORT=8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -Dfile.encoding=UTF-8"
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -Dserver.port=${PORT:-8080} -jar /app/app.jar"]
# [Docker 내장 명령어 및 셸 문법]
# - ENV <키>=<값> : 이미지와 컨테이너 안에서 쓸 기본 환경변수를 정하는 명령어임.
# - 형제 명령어 : 이미지 빌드 중에만 유효한 ARG가 있음.
# - EXPOSE <포트> : 컨테이너가 열어 두는 네트워크 포트를 이미지 정보로 표시하는 명령어임.
# - ENTRYPOINT [...] : 컨테이너가 켜질 때 가장 먼저 실행할 명령을 배열로 적는 문법임.
# - 형제 명령어 : 실행 시 인자를 덮어쓰기 쉬운 CMD가 있음.
# - ${변수:-기본값} : 환경변수가 비어 있을 때 콜론 뒤 기본값을 대신 쓰는 셸 문법임.
#
# [환경변수명 및 JVM 옵션]
# - PORT=8080 : 기본 HTTP 포트 번호임 (클라우드 환경이 PORT를 주면 그 값을 우선 씀).
# - JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -Dfile.encoding=UTF-8" :
#   ├── MaxRAMPercentage=75.0 : 컨테이너 메모리의 75%로 힙을 제한해 메모리 초과 종료(OOM)를 막음.
#   └── -Dfile.encoding=UTF-8 : 자바 기본 문자 인코딩을 UTF-8로 고정함.
#
# [동작 흐름]
# - 컨테이너 시작 -> sh -c가 $JAVA_OPTS와 $PORT 환경변수를 치환해 java 프로세스 실행함.
# - 포트 전달 경로 : OS PORT -> -Dserver.port=${PORT:-8080} -> application.yml 재정의 -> Tomcat 바인딩.
#
# [실행 방법]
# - 이미지 빌드 : docker build -t yonsei119:latest .
# - 컨테이너 실행 : docker run --rm -p 8080:8080 --env-file .env yonsei119:latest
# - 접속 주소 : http://localhost:8080
