package com.yonsei119.util;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/*
 * [역할 및 실행 시점]
 * - 역할: 유통기한(TTL)과 최대 보관 개수(LRU)를 동시에 지켜 서버 메모리 초과(OOM)를 막는 공용 스마트 냉장고 캐시
 * - 실행 시점: 각 서비스·필터가 생성될 때 필요한 크기와 유효시간으로 인스턴스가 만들어지며, 읽기/쓰기 호출 시 동작함
 *
 * [전체 호출 및 데이터 흐름]
 * - 흐름:
 *   ├── get(key)          ──> ReentrantLock 잠금 ──> 항목 조회 ──> 만료 시 삭제 후 null / 유효 시 값 반환(최근 사용 순서 갱신)
 *   ├── put(key, value)   ──> 만료 항목 청소 ──> 새 항목 저장 ──> maxEntries 초과 시 가장 오래 안 쓴(LRU) 항목 자동 퇴거
 *   └── getOrCompute(...) ──> 유효 항목 있으면 즉시 반환 / 없으면 creator로 생성·저장 후 반환 (원자적 실행)
 *
 * [내장 / 자동생성 구분]
 * - Java 표준 내장: LinkedHashMap(`accessOrder = true`로 LRU 구현), ReentrantLock(가상 스레드 친화적 동기화), Supplier
 * - Java record 자동 생성: 내부 `CacheEntry<V>(value, expiresAtMs)` 불변 포장 레코드
 *
 * [사용처 및 IDE 추적 가이드]
 * - 실제 사용처 3곳:
 *   1) NaverDirectionsService (`routeCache`, `etaCache` — 60초 캐시)
 *   2) NaverGeocodingService (`reverseGeocodeCache`, `geocodeCache` — 600초 캐시)
 *   3) ApiRateLimitFilter (`buckets` — IP별 토큰 버킷 600초 보관)
 * - Java 호출 추적: 클래스명이나 메서드명 위에서 `Ctrl + Alt + H`
 */
public final class BoundedTtlCache<K, V> {

    private final int maxEntries;
    private final long ttlMillis;
    private final ReentrantLock lock = new ReentrantLock();
    private final LinkedHashMap<K, CacheEntry<V>> map;

    public BoundedTtlCache(int maxEntries, long ttlSeconds) {
        this.maxEntries = Math.max(1, maxEntries);
        this.ttlMillis = Math.max(1L, ttlSeconds) * 1000L;
        // [Java 내장 동작] 세 번째 인자 accessOrder=true 설정 시 get()으로 읽힌 항목이 맨 뒤(최신)로 이동하며,
        // removeEldestEntry가 true를 반환할 때 맨 앞(가장 오래 미사용) 항목이 자동으로 제거됨
        this.map = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, CacheEntry<V>> eldest) {
                return size() > BoundedTtlCache.this.maxEntries;
            }
        };
    }

    /** 키로 값을 조회하며, 없거나 유효시간(TTL)이 지났으면 `null`을 반환함 */
    public V get(K key) {
        long now = System.currentTimeMillis();
        lock.lock();
        try {
            CacheEntry<V> entry = map.get(key);
            if (entry == null) {
                return null;
            }
            if (now >= entry.expiresAtMs()) {
                map.remove(key);
                return null;
            }
            return entry.value();
        } finally {
            lock.unlock();
        }
    }

    /** 키-값 쌍에 만료 예정 시각을 붙여 저장하며, 가득 찼을 때는 만료분 정리 후 초과 시 LRU 항목을 밀어냄 */
    public void put(K key, V value) {
        long now = System.currentTimeMillis();
        long expiresAt = now + ttlMillis;
        lock.lock();
        try {
            if (map.size() >= maxEntries) {
                map.entrySet().removeIf(entry -> now >= entry.getValue().expiresAtMs());
            }
            map.put(key, new CacheEntry<>(value, expiresAt));
        } finally {
            lock.unlock();
        }
    }

    /** 캐시에 유효한 값이 있으면 반환하고, 없거나 만료됐으면 `creator`로 새로 만들어 저장한 뒤 반환함 */
    public V getOrCompute(K key, Supplier<? extends V> creator) {
        long now = System.currentTimeMillis();
        lock.lock();
        try {
            CacheEntry<V> entry = map.get(key);
            if (entry != null && now < entry.expiresAtMs()) {
                return entry.value();
            }
            if (entry != null) {
                map.remove(key);
            }
            if (map.size() >= maxEntries) {
                map.entrySet().removeIf(item -> now >= item.getValue().expiresAtMs());
            }
            V created = creator.get();
            map.put(key, new CacheEntry<>(created, now + ttlMillis));
            return created;
        } finally {
            lock.unlock();
        }
    }

    /** 현재 캐시 안에 보관 중인 항목 개수를 반환함 (단위 테스트 검증용) */
    public int size() {
        lock.lock();
        try {
            return map.size();
        } finally {
            lock.unlock();
        }
    }

    private record CacheEntry<V>(V value, long expiresAtMs) {
    }
}
