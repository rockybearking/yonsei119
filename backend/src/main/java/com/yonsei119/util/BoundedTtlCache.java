package com.yonsei119.util;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
/*
 * [자바 문법]
 * - package : 여러 서비스가 함께 쓰는 유틸리티 패키지(com.yonsei119.util) 선언문임.
 * - import : 순서 유지 맵(LinkedHashMap), 맵 인터페이스(Map), 스레드 잠금 도구(ReentrantLock)를 가져오는 선언문임.
 *
 * [패키지명]
 * - com.yonsei119.util : 캐시와 지리 좌표 계산 등 공통 도구를 모아 둔 패키지명임.
 *
 * [자바 표준 내장 타입 (이름 변경 불가)]
 * - LinkedHashMap (출처: java.util 패키지) : 삽입 순서나 최근 사용 순서(accessOrder=true)를 유지하는 해시맵 구현체임.
 *   · 형제 비교 : 순서 없는 HashMap, 정렬되는 TreeMap, 동시성용 ConcurrentHashMap이 있음.
 * - Map (출처: java.util 패키지) : 키-값 쌍 컬렉션의 최상위 인터페이스임 (내부 중첩 인터페이스 Map.Entry 포함).
 * - ReentrantLock (출처: java.util.concurrent.locks 패키지) : 여러 스레드가 동시에 접근할 때 한 번에 하나씩 차례대로 통과시키는 잠금 클래스임.
 */

public final class BoundedTtlCache<K, V> {
/*
 * [자바 문법]
 * - public final class : 외부에서 쓰되 다른 클래스가 상속(extends)해 내부 동작을 바꾸지 못하게 막은 클래스 선언임.
 * - <K, V> (제네릭 타입) : 키 타입(K)과 값 타입(V)을 쓸 때 정해 여러 DTO 캐시에 재사용할 수 있게 함.
 *
 * [클래스명]
 * - BoundedTtlCache : 최대 개수 제한(LRU)과 유효 시간 만료(TTL)를 함께 지키며 스레드 안전한 메모리 캐시 클래스명임.
 *
 * [동작 흐름]
 * - 호출 출처 : NaverDirectionsService(routeCache·etaCache) 및 NaverGeocodingService(reverseGeocodeCache·geocodeCache)가 사용함.
 * - 흐름 :
 *   ├── get(key) ──> 만료 시각 확인 ──> 만료 시 삭제 후 null / 유효 시 값 V 반환
 *   └── put(key, value) ──> 만료 항목 먼저 정리 ──> 저장 후 maxEntries 초과 시 가장 오래 안 쓴 항목 삭제
 * - 반환값 : 캐시 적중 시 저장된 값 V, 미스·만료 시 null을 반환하며 메모리 크기를 maxEntries 이하로 유지함.
 */

    private final int maxEntries;
    private final long ttlMillis;
    private final ReentrantLock lock = new ReentrantLock();
    private final LinkedHashMap<K, CacheEntry<V>> map;
    /*
     * [자바 문법]
     * - private final : 클래스 안에서만 쓰며 처음 한 번 정해진 뒤 바꿀 수 없는 불변 필드 선언임.
     * - int (32비트 정수 기본형), long (64비트 정수 기본형).
     * - new ReentrantLock() : 필드 선언 자리에서 바로 락 객체를 만듦.
     * - <K, CacheEntry<V>> : 키 타입 K와 내부 값 포장 타입 CacheEntry<V>를 연결한 중첩 제네릭 지정임.
     *
     * [자바 표준 내장 타입 및 생성자 (이름 변경 불가)]
     * - ReentrantLock, new ReentrantLock(), LinkedHashMap (출처: java.util, java.util.concurrent.locks 패키지).
     *
     * [필드명 (멤버 변수)]
     * - maxEntries : 캐시에 최대 몇 개까지 담아 둘지 정한 개수 상한값.
     * - ttlMillis : 각 항목이 유효한 시간 길이(밀리초 단위).
     * - lock : 여러 스레드가 동시에 get/put/size를 부를 때 데이터가 꼬이지 않게 막는 잠금 객체.
     * - map : 최근 사용 순서(LRU)로 자동 정렬되는 내부 LinkedHashMap 저장소.
     */

    public BoundedTtlCache(int maxEntries, long ttlSeconds) {
    /*
     * [자바 문법]
     * - public BoundedTtlCache(...) : 최대 보관 개수와 초 단위 유효 시간을 받아 캐시를 초기화하는 생성자임.
     *
     * [생성자 및 매개변수명]
     * - 생성자명 : BoundedTtlCache.
     * - 매개변수명 : maxEntries(최대 항목 수), ttlSeconds(유효 시간 초 단위).
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
         * [자바 내장 어노테이션]
         * - @Override 정의 (출처: java.lang.Override, 이름 변경 불가)
         *   · 역할 : 부모 클래스나 인터페이스의 메서드를 재정의할 때 이름·매개변수·반환 타입이 일치하는지 컴파일러가 검사하게 하는 어노테이션임.
         * - @Override 현재 코드 적용
         *   · 적용 대상 : 바로 위 선언된 LinkedHashMap 익명 클래스의 removeEldestEntry(Map.Entry<K, CacheEntry<V>> eldest) 메서드
         *   · 작동 원리 : 부모 LinkedHashMap.removeEldestEntry() 시그니처와 일치하는지 컴파일 시 검사해 put() 후 자동 축출 콜백이 안전히 동작하게 함.
         *   · 비교 : @Deprecated(사용 중단 표시), @SuppressWarnings(컴파일 경고 억제), @FunctionalInterface가 있음.
         *
         * [자바 문법]
         * - this. : BoundedTtlCache 인스턴스의 멤버 필드를 가리키는 참조임.
         * - 1L, 1000L (long 리터럴), 0.75f (float 리터럴), * (곱셈), > (크다 비교).
         * - new LinkedHashMap<>(16, 0.75f, true) { ... } : LinkedHashMap을 즉석 상속해 메서드 1개만 바꾼 익명 클래스임.
         * - BoundedTtlCache.this.maxEntries : 익명 클래스 안에서 바깥 클래스의 maxEntries 필드를 가리키는 문법임.
         *
         * [자바 표준 내장 타입, 생성자 및 메서드 (이름 변경 불가)]
         * - Math.max(int, int) / Math.max(long, long) (출처: java.lang 패키지) : 0 이하가 들어와도 최소 1개·1초를 보장함.
         * - new LinkedHashMap<>(16, 0.75f, true) : 초기 용량 16, 부하율 0.75f, 접근 순서 유지(accessOrder=true) 생성자임.
         * - Map.Entry<K, V> (출처: java.util 패키지) : 맵 안의 키-값 한 쌍을 나타내는 인터페이스임.
         * - removeEldestEntry(...) (출처: java.util.LinkedHashMap) : put() 직후 호출되며 true면 가장 오래 안 쓴 항목을 지움.
         * - size() : 현재 맵에 들어 있는 항목 개수를 반환함.
         *
         * [동작 흐름]
         * - 호출 출처 : 서비스 초기화 시 new BoundedTtlCache<>(256, 60L) 형태로 호출됨.
         * - 흐름 : maxEntries(최소 1)·ttlMillis(최소 1000L) 계산 ──> accessOrder=true 익명 LinkedHashMap 생성 ──> this.map 저장.
         * - 전달 대상 : 생성된 map이 이후 get() 시 항목 순서를 갱신하고 put() 시 용량 초과분 자동 삭제를 담당함.
         */
    }

    public V get(K key) {
    /*
     * [자바 문법]
     * - public V : 키로 데이터를 찾아 제네릭 타입 V 값(없거나 만료면 null)을 돌려주는 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : get.
     * - 매개변수명 : key (찾으려는 캐시 키).
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
         * [자바 문법]
         * - long : 현재 시각(밀리초)을 담는 기본형임.
         * - try { ... } finally { lock.unlock(); } : 중간에 return이나 예외가 나도 무조건 잠금을 풀도록 보장하는 블록임.
         * - if, ==, >=, null, return : 조건 검사, null 비교, 시각 이상 비교, 메서드 반환문임.
         *
         * [자바 표준 내장 메서드 (이름 변경 불가)]
         * - System.currentTimeMillis() (출처: java.lang 패키지) : 1970년 기준 현재 시각을 밀리초 단위로 반환함.
         * - lock.lock(), lock.unlock() (출처: java.util.concurrent.locks 패키지) : 다른 스레드 접근을 막는 잠금·해제 메서드임.
         * - map.get(key) (출처: java.util 패키지) : 키로 항목을 찾고 최근 사용 순서(accessOrder=true)를 맨 뒤로 갱신함.
         * - map.remove(key) (출처: java.util 패키지) : TTL이 지난 만료 항목을 맵에서 지움.
         *
         * [프로젝트 내부 호출 메서드]
         * - entry.expiresAtMs(), entry.value() : 내부 record CacheEntry<V>의 필드 값을 읽는 조회 메서드임.
         *
         * [지역 변수명]
         * - now : 조회 시작 시각(밀리초) 변수.
         * - entry : map.get(key)로 꺼낸 CacheEntry<V> 참조 변수.
         *
         * [동작 흐름]
         * - 호출 출처 : NaverDirectionsService·NaverGeocodingService가 외부 API 호출 전 캐시 확인 시 호출함.
         * - 흐름 :
         *   1) 현재 시각 측정 ──> lock.lock() 잠금 진입 ──> map.get(key) 조회
         *   ├── entry == null ──> null 반환
         *   ├── now >= entry.expiresAtMs() (만료) ──> map.remove(key) 삭제 후 null 반환
         *   └── 유효 ──> entry.value() 반환 (finally에서 항상 lock.unlock() 실행)
         * - 전달 대상 : 유효한 값 V 또는 미스·만료를 알리는 null을 호출 서비스로 반환함.
         */
    }

    public void put(K key, V value) {
    /*
     * [자바 문법]
     * - public void : 반환값 없이 캐시 항목을 저장하는 공개 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : put.
     * - 매개변수명 : key(저장할 키), value(저장할 값).
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
         * [자바 문법]
         * - long, + : 현재 시각에 ttlMillis를 더해 만료 예정 시각을 계산함.
         * - try { ... } finally { lock.unlock(); } : 잠금 획득 후 반드시 해제하는 안전 블록임.
         * - if, >= : 캐시가 가득 찼는지 검사하는 조건문임.
         * - entry -> ... (람다식) : 삭제 조건(Predicate)을 짧게 전달하는 함수형 표현식임.
         * - new CacheEntry<>(value, expiresAt) : 다이아몬드 연산자(<>)로 내부 record 객체를 만듦.
         *
         * [자바 표준 내장 메서드 (이름 변경 불가)]
         * - System.currentTimeMillis(), lock.lock(), lock.unlock().
         * - map.size(), map.entrySet() (출처: java.util 패키지) : 현재 항목 수 및 전체 키-값 쌍 집합 뷰를 반환함.
         * - Collection.removeIf(Predicate) (출처: java.util 패키지) : 조건에 맞는 만료 항목을 순회 중 안전하게 지움.
         * - Map.Entry.getValue() (출처: java.util 패키지) : 엔트리에 들어 있는 값 객체를 꺼냄.
         * - map.put(K key, V value) (출처: java.util 패키지) : 항목을 저장하며 최대 크기 초과 시 가장 오래된 항목을 지움.
         *
         * [프로젝트 내부 생성자 및 호출 메서드]
         * - new CacheEntry<>(value, expiresAt) : 값과 만료 시각을 묶어 저장하는 내부 record 생성자임.
         * - entry.getValue().expiresAtMs() : CacheEntry<V>에서 만료 시각을 읽는 record 조회 메서드임.
         *
         * [지역 변수명]
         * - now : 저장 시점 밀리초 타임스탬프.
         * - expiresAt : 만료 기준 밀리초 시각(now + ttlMillis).
         * - entry : removeIf 람다 안에서 각 엔트리를 가리키는 변수.
         *
         * [동작 흐름]
         * - 호출 출처 : 외부 API 조회 성공 후 응답 DTO를 캐시에 저장할 때 호출함.
         * - 흐름 :
         *   1) now·expiresAt 계산 ──> lock.lock() 잠금 진입
         *   2) map.size() >= maxEntries면 만료 항목 일괄 삭제 (유효한 최근 항목 보호)
         *   3) map.put(key, new CacheEntry<>(...)) 저장 ──> 초과 시 가장 오래 안 쓴 1개 삭제 ──> lock.unlock()
         * - 반환값 : 반환값 없음 (갱신된 항목이 이후 get(key) 조회에 반영됨).
         */
    }

    public int size() {
    /*
     * [자바 문법]
     * - public int : 현재 저장된 항목 개수를 정수로 돌려주는 공개 메서드 선언임.
     *
     * [메서드명 및 매개변수명]
     * - 메서드명 : size (매개변수 없음).
     */
        lock.lock();
        try {
            return map.size();
        } finally {
            lock.unlock();
        }
        /*
         * [자바 문법]
         * - try { ... } finally { lock.unlock(); }, return : 잠금 보호 아래 크기를 읽고 잠금을 반납함.
         *
         * [자바 표준 내장 메서드 (이름 변경 불가)]
         * - lock.lock(), lock.unlock(), map.size().
         *
         * [동작 흐름]
         * - 호출 출처 : 단위 테스트(Yonsei119BackendTests 등)에서 캐시 보관 개수를 확인할 때 호출함.
         * - 흐름 : lock.lock() ──> map.size() 읽기 ──> finally lock.unlock() ──> int 개수 반환.
         * - 반환값 : 현재 캐시 내 항목 개수(int)를 호출한 쪽으로 돌려줌.
         */
    }

    private record CacheEntry<V>(V value, long expiresAtMs) {
    /*
     * [자바 문법]
     * - private record : BoundedTtlCache 클래스 내부에서만 쓰는 불변 중첩 record 선언임.
     * - <V>, long : 제네릭 값 타입과 만료 시각 기본형 선언임.
     *
     * [내부 레코드명 및 필드명]
     * - 레코드명 : CacheEntry<V>.
     * - 필드명 : value(저장된 실제 데이터 V), expiresAtMs(만료 기준 밀리초 시각 long).
     */
    }
}
