package com.yonsei119.util;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/*
 * [1. 역할 및 실행 시점]
 * - 역할 : 유효시간(TTL)과 최대 저장 개수(LRU)를 동시에 지켜 메모리 누수(OOM)를 막는
 *          공용 스마트 냉장고 인메모리 캐시 클래스
 * - 실행 시점 : 각 서비스·필터 초기화 시 생성되며, `get` / `put` / `getOrCompute` 호출 시 동작함
 *
 * [2. 전체 호출 및 데이터 흐름 (시퀀스 다이어그램)]
 *
 *       [Service / Filter]             [BoundedTtlCache]           [LinkedHashMap (LRU)]
 *                |                             |                             |
 *                |-- 1. get(k) / put(k, v) --->|                             |  캐시 조회 또는 저장 요청
 *                |                             |-- 2. ReentrantLock.lock()   |  가상 스레드 안전 동기화
 *                |                             |-- 3. check TTL & order ---->|  만료 확인 및 최근 사용 갱신
 *           +----+-----------------------------+-----------------------------+------------------------+
 *           | [opt : size() > maxEntries]                                                             |  최대 보관 용량 초과 시
 *           |    |                             |                             |-- removeEldestEntry()  |  가장 오래 안 쓴(LRU) 항목 삭제
 *           +----+-----------------------------+-----------------------------+------------------------+
 *                |<-- 4. valid value or null --|                             |  잠금 해제 후 결과 반환
 *                v                             v                             v
 *
 * [3. 사용된 요소 구분 (표준 내장)]
 * - Java 표준 내장
 *   ㄴ record                   : 내부 `CacheEntry<V>(value, expiresAtMs)` 선언 키워드 (자동생성)
 *   ㄴ LinkedHashMap            : `accessOrder = true`로 LRU 순서를 자동 관리하는 표준 내장 클래스
 *   ㄴ Map.Entry                : 가장 오래된 항목 검사(`removeEldestEntry`)에 쓰이는 표준 인터페이스
 *   ㄴ ReentrantLock            : 가상 스레드 고정(Pinning) 없이 안전하게 동기화하는 잠금 클래스
 *   ㄴ Supplier                 : 캐시 미스 시 새 값을 지연 생성하는 표준 함수형 인터페이스
 *   ㄴ System.currentTimeMillis : 만료 여부를 비교하는 표준 내장 현재 시각 메서드
 *
 * [4. 실제 사용처 (호출 위치) 및 IDE 추적 가이드]
 * - 백엔드 사용처
 *   ㄴ NaverDirectionsService.java : `routeCache`(256개), `etaCache`(512개) 60초 캐시
 *   ㄴ NaverGeocodingService.java  : `reverseGeocodeCache`, `geocodeCache` 600초 캐시
 *   ㄴ ApiRateLimitFilter.java     : `buckets` IP별 요청 제한 버킷 600초 캐시
 *   ㄴ Yonsei119BackendTests.java  : Test 11 LRU 자동 퇴거 검증
 * - IntelliJ 추적 단축키
 *   ㄴ 호출 계층 보기 : `BoundedTtlCache` 위에서 `Ctrl + Alt + H`
 */
public final class BoundedTtlCache<K, V> {

    private final int maxEntries;
    private final long ttlMillis;
    private final ReentrantLock lock = new ReentrantLock();
    private final LinkedHashMap<K, CacheEntry<V>> map;

    public BoundedTtlCache(int maxEntries, long ttlSeconds) {
        this.maxEntries = Math.max(1, maxEntries);
        this.ttlMillis = Math.max(1L, ttlSeconds) * 1000L;
        // [Java 표준 내장 동작] 세 번째 인자 accessOrder=true 설정 시 get()으로 읽힌 항목이 맨 뒤(최신)로 이동하며,
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
