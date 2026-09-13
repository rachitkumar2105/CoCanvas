package com.cocanvas.core.security;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimiterTest {

    @Test
    void allowsUpToTheLimitWithinTheWindow() {
        RateLimiter limiter = new RateLimiter();
        for (int i = 0; i < 5; i++) {
            assertThat(limiter.tryAcquire("key", 5, 60_000)).isTrue();
        }
        assertThat(limiter.tryAcquire("key", 5, 60_000)).isFalse();
    }

    @Test
    void tracksDifferentKeysIndependently() {
        RateLimiter limiter = new RateLimiter();
        for (int i = 0; i < 3; i++) {
            assertThat(limiter.tryAcquire("alice", 3, 60_000)).isTrue();
        }
        assertThat(limiter.tryAcquire("alice", 3, 60_000)).isFalse();
        // Bob's own bucket is untouched by Alice exhausting hers.
        assertThat(limiter.tryAcquire("bob", 3, 60_000)).isTrue();
    }

    @Test
    void allowsRequestsAgainOnceTheWindowSlidesPast() throws InterruptedException {
        RateLimiter limiter = new RateLimiter();
        long windowMillis = 100;
        assertThat(limiter.tryAcquire("key", 1, windowMillis)).isTrue();
        assertThat(limiter.tryAcquire("key", 1, windowMillis)).isFalse();

        Thread.sleep(windowMillis + 50);

        assertThat(limiter.tryAcquire("key", 1, windowMillis)).isTrue();
    }

    @Test
    void isSafeUnderConcurrentAccessAndNeverExceedsTheLimit() throws InterruptedException {
        RateLimiter limiter = new RateLimiter();
        int threads = 50;
        int maxRequests = 20;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger granted = new AtomicInteger();

        for (int i = 0; i < threads; i++) {
            pool.submit(() -> {
                ready.countDown();
                try {
                    go.await();
                } catch (InterruptedException ignored) {
                }
                if (limiter.tryAcquire("shared", maxRequests, 60_000)) {
                    granted.incrementAndGet();
                }
            });
        }

        ready.await();
        go.countDown();
        pool.shutdown();
        assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

        assertThat(granted.get()).isEqualTo(maxRequests);
    }
}
