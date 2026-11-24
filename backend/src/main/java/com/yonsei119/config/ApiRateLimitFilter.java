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
 * [파일 역할]
 * 유료 네이버 클라우드 API(/api/directions, /api/directions/rank, /api/geocode, /api/reverse-geocode)를
 * 대리 호출하는 엔드포인트에 대해 클라이언트 IP 기반 토큰 버킷(Token Bucket) 요청률 제한을 적용합니다.
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
