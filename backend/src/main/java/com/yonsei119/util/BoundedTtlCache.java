package com.yonsei119.util;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
/*
 * [자바 문법] package, import : 여러 서비스(경로 탐색, 지오코딩 등)가 공통으로 재사용하는 유틸리티 패키지(com.yonsei119.util) 선언임.
 * [자바/스프링/라이브러리 내장 도구(타입)]
 * - LinkedHashMap : 넣은 순서 또는 최근 조회 순서(accessOrder=true)를 기억하는 자바 표준 해시맵임 (이름 변경 불가 / 형제 타입: HashMap, TreeMap, ConcurrentHashMap).
 * - Map : 키(Key)와 값(Value) 쌍을 다루는 표준 인터페이스임 (이름 변경 불가).
 * - ReentrantLock : 여러 스레드가 동시에 캐시를 읽고 쓸 때 줄을 세워 충돌을 막아주는 명시적 잠금장치임 (이름 변경 불가).
 */

public final class BoundedTtlCache<K, V> {
/*
 * [자바 문법] public final class, 제네릭(<K, V>) : 다른 클래스가 임의로 상속해 변조할 수 없고(final), 어떤 키 타입(K)과 값 타입(V)이든 담을 수 있는 범용 설계도임.
 * [내가 지은 이름] BoundedTtlCache : 최대 보관 개수 제한(Bounded LRU)과 유통기한(TTL: Time-To-Live)을 동시에 지키는 인메모리 캐시 클래스 이름임.
 * [핵심 원리 & 비유]
 * - 주방의 '최대 칸 수가 정해진 온장고'와 같음.
 * - 1) 유통기한(ttlMillis)이 지난 음식은 손님에게 절대 내주지 않고 즉시 폐기함.
 * - 2) 온장고가 꽉 차면(maxEntries 초과) 가장 오랫동안 아무도 찾지 않은(Least Recently Used) 오래된 음식부터 자동으로 비워 클라우드 서버 메모리 폭발(OOM)을 막음.
 */

    private final int maxEntries;
    private final long ttlMillis;
    private final ReentrantLock lock = new ReentrantLock();
    private final LinkedHashMap<K, CacheEntry<V>> map;
    /*
     * [자바 문법] private final, int, long, new
     * [자바/스프링/라이브러리 내장 도구(타입)] ReentrantLock, LinkedHashMap (이름 변경 불가)
     * [내가 지은 이름] maxEntries(최대 저장 개수), ttlMillis(유효시간 밀리초), lock(동기화 자물쇠), map(실제 데이터 보관함)
     */

    public BoundedTtlCache(int maxEntries, long ttlSeconds) {
    /*
     * [자바 문법] public BoundedTtlCache(...) : 온장고의 최대 칸 수(maxEntries)와 유지 시간(ttlSeconds)을 받아 초기화하는 생성자임.
     * [내가 지은 이름] maxEntries, ttlSeconds
     */
        this.maxEntries = Math.max(1, maxEntries);
        this.ttlMillis = Math.max(1L, ttlSeconds) * 1000L;
        this.map = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, CacheEntry<V>> eldest) {
                return size() > BoundedTtlCache.this.maxEntries;
            }
        };
        /*
         * [자바 문법] 익명 내부 클래스(new LinkedHashMap<>(...) { ... }) : LinkedHashMap의 removeEldestEntry 메서드만 살짝 고쳐서 LRU 자동 퇴거 기능을 켬.
         * [스프링/자바 내장 함수] Math.max(...), size(), removeEldestEntry(...) (이름 변경 불가)
         * [핵심 원리] 세 번째 인자 `true`가 바로 '입력 순서' 대신 '최근 조회 순서(Access-Order)'로 줄을 다시 세우는 스위치임.
         */
    }

    public V get(K key) {
    /*
     * [자바 문법] public V : 키(key)로 캐시를 조회하여 값(V)을 꺼내 주고, 없거나 만료되었으면 null을 돌려주는 메서드임.
     * [내가 지은 이름] get(함수명), key(조회할 열쇠 변수명)
     */
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
        /*
         * [자바 문법] try { ... } finally { lock.unlock(); } : 중간에 return으로 빠져나가더라도 자물쇠(lock)가 100% 풀리도록 보장하는 필수 안전 패턴임.
         * [스프링/자바 내장 함수] System.currentTimeMillis(), lock.lock(), lock.unlock(), map.get(...), map.remove(...) (이름 변경 불가)
         */
    }

    public void put(K key, V value) {
    /*
     * [자바 문법] public void : 새 결과를 만료 예정 시각과 함께 포장해 캐시에 저장하는 메서드임.
     * [내가 지은 이름] put(함수명), key(열쇠), value(보관할 데이터)
     */
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
        /*
         * [자바 문법] 람다 표현식(entry -> ...) : 조건에 맞는 만료 항목들을 한 줄로 걸러내 삭제함.
         * [스프링/자바 내장 함수] map.entrySet().removeIf(...), map.put(...) (이름 변경 불가)
         * [핵심 원리] 새 데이터를 넣기 직전에 유통기한이 지난 항목들을 먼저 청소해 두면, 아직 쓸 만한 인기 데이터가 억울하게 밀려나는 일을 방지함.
         */
    }

    public int size() {
    /*
     * [자바 문법] public int : 현재 캐시 안에 보관 중인 항목 개수를 정수로 반환함 (단위 테스트 검증 등에 활용).
     * [내가 지은 이름] size
     */
        lock.lock();
        try {
            return map.size();
        } finally {
            lock.unlock();
        }
        /*
         * [스프링/자바 내장 함수] map.size() (이름 변경 불가)
         */
    }

    private record CacheEntry<V>(V value, long expiresAtMs) {
    /*
     * [자바 문법] private record : 이 파일 내부에서만 쓰는 불변 포장지 레코드임.
     * [내가 지은 이름] CacheEntry(대문자 레코드명) / value(실제 데이터), expiresAtMs(폐기 시각 밀리초)
     */
    }
}
