package com.cocanvas.core.security;

import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.Map;

/**
 * A plain sliding-window counter per key — correct under concurrent access (each key's
 * deque is only ever touched inside a lock on itself) and memory-bounded (a key's deque
 * never holds more than maxRequests timestamps). No external dependency: the mechanism
 * here is simple enough that pulling in a library (Bucket4j et al.) would just be
 * indirection over the same three lines of logic.
 */
@Component
public class RateLimiter {

    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    public boolean tryAcquire(String key, int maxRequests, long windowMillis) {
        long now = System.currentTimeMillis();
        Deque<Long> timestamps = hits.computeIfAbsent(key, k -> new ArrayDeque<>());

        synchronized (timestamps) {
            while (!timestamps.isEmpty() && now - timestamps.peekFirst() > windowMillis) {
                timestamps.pollFirst();
            }
            if (timestamps.size() >= maxRequests) {
                return false;
            }
            timestamps.addLast(now);
        }

        maybeEvictStaleKeys(now);
        return true;
    }

    /**
     * Without this, `hits` would grow forever as new IPs/users show up — a random 1-in-500
     * cleanup on the hot path is cheap and keeps memory bounded without a background thread.
     */
    private void maybeEvictStaleKeys(long now) {
        if (ThreadLocalRandom.current().nextInt(500) != 0) {
            return;
        }
        hits.entrySet().removeIf(entry -> {
            Deque<Long> timestamps = entry.getValue();
            synchronized (timestamps) {
                return timestamps.isEmpty() || now - timestamps.peekLast() > 300_000;
            }
        });
    }
}
