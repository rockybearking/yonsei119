package com.yonsei119.config;

import com.yonsei119.util.BoundedTtlCache;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.jspecify.annotations.NonNull;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 유료 네이버 API를 대리 호출하는 4개 경로에 IP당 분당 호출 상한을 거는 번호표 기계 필터
 * - 실행 시점 : `SecurityHeadersFilter` 직후(`HIGHEST_PRECEDENCE + 20`)에 실행됨
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [Client]                  [ApiRateLimitFilter]                [TokenBucket]      [ApiController]
 *           |                               |                               |                   |
 *           |-- 1. GET /api/... ----------->|                               |                   |  API 요청 진입
 *      +----+-------------------------------+-------------------------------+-------------------+---------+
 *      | [alt : free path (/hospitals, /health, /config)]                                                 |  무제한 공개 경로
 *      |    |                               |-- 2a. doFilter() -------------|------------------>|         |  토큰 차감 없이 즉시 통과
 *      +----+-------------------------------+-------------------------------+-------------------+---------+
 *      | [else : paid proxy (/directions*, /geocode*)]                                                    |  유료 네이버 대리 호출 4종
 *      |    |                               |-- 2b. tryConsume(ip) -------->|                   |         |  IP별 분당 토큰 1개 차감 시도
 *      |    |                               |<-- 3b. allowed / retrySec ----|                   |         |  남은 토큰 또는 대기 초 반환
 *      |    |                               |-- 4a. [allowed] doFilter() ---|------------------>|         |  토큰 보유 시 정상 통과
 *      |    |<-- 4b. [exhausted] 429 JSON --|                               |                   |         |  초과 시 Retry-After 반환
 *      +----+-------------------------------+-------------------------------+-------------------+---------+
 *           v                               v                               v                   v
 *
 * [3. 사용된 요소 구분 (표준 내장 / 프레임워크 / 외부 라이브러리)]
 * - Java 표준 내장
 *   ㄴ record           : `ConsumptionResult` 내부 결과 레코드 선언 키워드 (자동생성)
 *   ㄴ synchronized     : 동일 IP 동시 요청 시 토큰 차감 경합을 막는 동기화 키워드
 *   ㄴ Set / Set.of()   : 대상 경로 4개를 O(1)로 검사하는 표준 내장 불변 집합
 *   ㄴ System.nanoTime  : 경과 시간 비례 토큰 충전을 계산하는 표준 내장 정밀 시각 메서드
 *   ㄴ Math             : `min`, `max`, `floor`, `ceil` 수학 계산 표준 내장 클래스
 *   ㄴ StandardCharsets : UTF-8 응답 인코딩 상수 제공 클래스
 * - Spring 프레임워크
 *   ㄴ @Component / @Order / @Autowired : 빈 등록 · 순서 지정 · 생성자 의존성 주입 어노테이션
 *   ㄴ OncePerRequestFilter             : 요청당 1회 실행을 보장하는 서블릿 필터 추상 클래스
 *   ㄴ ObjectProvider                   : 선택적 빈(`MeterRegistry`)을 안전하게 조회하는 인터페이스
 * - 프로젝트 내부 타입
 *   ㄴ BoundedTtlCache     : 최대 4,096개 · 10분 유휴 자동 퇴거 인메모리 LRU 캐시
 *   ㄴ Yonsei119Properties : 분당 허용량(`rate-limit`) 설정 레코드
 * - 외부 라이브러리
 *   ㄴ Micrometer (`MeterRegistry`) : 429 차단 횟수 메트릭 기록 라이브러리
 *   ㄴ Jakarta Servlet              : `HttpServletRequest`, `HttpServletResponse`, `FilterChain`
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 설정 및 검증 연결처
 *   ㄴ backend/src/main/resources/application.yml : `yonsei119.rate-limit.*`
 *   ㄴ Yonsei119BackendTests.java                 : Test 18 토큰 소진 시 HTTP 429 검증
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class ApiRateLimitFilter extends OncePerRequestFilter {

    private static final Set<String> RATE_LIMITED_PATHS = Set.of(
            "/api/directions",
            "/api/directions/rank",
            "/api/geocode",
            "/api/reverse-geocode"
    );

    private static final int MAX_BUCKET_ENTRIES = 4096;
    private static final long BUCKET_IDLE_TTL_SECONDS = 600L;

    private final Yonsei119Properties properties;
    private final MeterRegistry meterRegistry;
    private final BoundedTtlCache<String, TokenBucket> buckets =
            new BoundedTtlCache<>(MAX_BUCKET_ENTRIES, BUCKET_IDLE_TTL_SECONDS);

    public ApiRateLimitFilter(Yonsei119Properties properties) {
        this(properties, null);
    }

    @Autowired
    public ApiRateLimitFilter(
            Yonsei119Properties properties,
            ObjectProvider<MeterRegistry> meterRegistryProvider
    ) {
        this.properties = properties;
        this.meterRegistry = meterRegistryProvider != null ? meterRegistryProvider.getIfAvailable() : null;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {
        Yonsei119Properties.RateLimit rateLimit = properties.rateLimit();
        if (rateLimit == null || !rateLimit.enabled() || !"GET".equalsIgnoreCase(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }

        String path = extractNormalizedPath(request);
        if (!RATE_LIMITED_PATHS.contains(path)) {
            filterChain.doFilter(request, response);
            return;
        }

        int capacity = rateLimit.effectiveCapacity();
        int refillPerMinute = rateLimit.effectiveRefillPerMinute();
        String clientIp = extractClientIp(request);

        TokenBucket bucket = buckets.getOrCompute(clientIp, () -> new TokenBucket(capacity));
        ConsumptionResult result = bucket.tryConsume(capacity, refillPerMinute, System.nanoTime());

        response.setHeader("X-RateLimit-Limit", String.valueOf(capacity));
        response.setHeader("X-RateLimit-Remaining", String.valueOf(result.remaining()));

        if (!result.allowed()) {
            if (meterRegistry != null) {
                meterRegistry.counter("yonsei119.ratelimit.requests", "outcome", "rejected").increment();
            }
            response.setHeader("Retry-After", String.valueOf(result.retryAfterSeconds()));
            response.setStatus(429);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE + ";charset=UTF-8");
            response.getWriter().write(
                    "{\"code\":429,\"error\":\"TOO_MANY_REQUESTS\","
                            + "\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.\","
                            + "\"retryAfterSeconds\":" + result.retryAfterSeconds() + "}"
            );
            return;
        }

        filterChain.doFilter(request, response);
    }

    private static String extractNormalizedPath(HttpServletRequest request) {
        String uri = request.getRequestURI();
        if (uri == null) {
            return "";
        }
        String contextPath = request.getContextPath();
        if (contextPath != null && !contextPath.isEmpty() && uri.startsWith(contextPath)) {
            return uri.substring(contextPath.length());
        }
        return uri;
    }

    /** 클라우드 리버스 프록시의 `X-Forwarded-For` 첫 번째 실제 클라이언트 IP를 우선 추출함 */
    private static String extractClientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        String rawIp = null;
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            int commaIdx = forwardedFor.indexOf(',');
            rawIp = commaIdx >= 0 ? forwardedFor.substring(0, commaIdx).trim() : forwardedFor.trim();
        }
        if (rawIp == null || rawIp.isEmpty()) {
            rawIp = request.getRemoteAddr();
        }
        if (rawIp == null || rawIp.isBlank()) {
            return "unknown";
        }
        String trimmed = rawIp.trim();
        return trimmed.length() > 64 ? trimmed.substring(0, 64) : trimmed;
    }

    private record ConsumptionResult(boolean allowed, int remaining, long retryAfterSeconds) {
    }

    /** 경과 시간(ns)에 비례해 토큰을 연속 보충하고 요청마다 1개씩 차감하는 버킷 클래스 */
    private static final class TokenBucket {
        private double tokens;
        private long lastRefillNanos;

        private TokenBucket(int capacity) {
            this.tokens = capacity;
            this.lastRefillNanos = System.nanoTime();
        }

        private synchronized ConsumptionResult tryConsume(int capacity, int refillPerMinute, long nowNanos) {
            long elapsedNanos = Math.max(0L, nowNanos - lastRefillNanos);
            double tokensPerNano = Math.max(1, refillPerMinute) / 60_000_000_000.0d;
            double replenished = elapsedNanos * tokensPerNano;
            if (replenished > 0.0d) {
                tokens = Math.min(capacity, tokens + replenished);
                lastRefillNanos = nowNanos;
            }

            if (tokens >= 1.0d) {
                tokens -= 1.0d;
                return new ConsumptionResult(true, (int) Math.floor(tokens), 0L);
            }

            double missingTokens = 1.0d - tokens;
            double secondsPerToken = 60.0d / Math.max(1, refillPerMinute);
            long retryAfter = Math.max(1L, (long) Math.ceil(missingTokens * secondsPerToken));
            return new ConsumptionResult(false, 0, retryAfter);
        }
    }
}
