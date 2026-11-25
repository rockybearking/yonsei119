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
 * [역할 및 실행 시점]
 * - 역할: 유료 네이버 클라우드 API를 대리 호출하는 길찾기·지오코딩 4개 경로에 IP별 호출 횟수 제한을 거는 번호표 기계 필터
 * - 실행 시점: SecurityHeadersFilter 다음 순서(`HIGHEST_PRECEDENCE + 20`)로 동작하며, 대상 API 4종에 GET 요청이 올 때만 토큰을 차감함
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   HTTP 요청 진입 ──> doFilterInternal()
 *   ├── 일반 정적 파일 또는 `/api/hospitals`, `/api/health`, `/api/config` ──> 제한 없이 즉시 통과!
 *   └── 유료 대리 호출 4종(`/api/directions`, `/api/directions/rank`, `/api/geocode`, `/api/reverse-geocode`)
 *       ──> 클라이언트 IP 추출(`X-Forwarded-For` 우선) ──> IP별 TokenBucket 조회(최대 4096개, 10분 유휴 시 자동 정리)
 *           ├── 남은 토큰 >= 1 ──> 토큰 1개 차감 + `X-RateLimit-Remaining` 헤더 기록 후 컨트롤러로 통과
 *           └── 토큰 소진(0)   ──> HTTP 429 Too Many Requests + `Retry-After` 초 안내 JSON 즉시 반환
 *
 * [내장 / 프레임워크 / 프로젝트 유틸 구분]
 * - Java 표준 내장: Set, System.nanoTime(), Math, StandardCharsets
 * - Spring / Servlet: @Component, @Order, OncePerRequestFilter, MediaType, HttpServletRequest/Response
 * - 프로젝트 내부 유틸: BoundedTtlCache (메모리 누수 없이 오래 안 쓴 IP 버킷을 자동 삭제)
 *
 * [사용처 및 IDE 추적 가이드]
 * - 설정 연결: application.yml의 `yonsei119.rate-limit.*` -> Yonsei119Properties.RateLimit
 * - 테스트 검증처: Yonsei119BackendTests (토큰 소진 시 429 응답 및 헤더 검증)
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

    /** Render 등 클라우드 프록시가 전달하는 `X-Forwarded-For`의 첫 번째 실제 클라이언트 IP를 우선 추출함 */
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

    /** 경과 시간(나노초)에 비례해 토큰을 연속 충전하고 요청당 1개씩 차감하는 토큰 버킷 상태 객체 */
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
