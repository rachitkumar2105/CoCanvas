package com.cocanvas.core.integration;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * application-test.yml sets very high rate limits so the rest of the suite (which
 * registers/logs in many users across shared Spring contexts) never trips the limiter
 * incidentally. This test overrides that back down to a real, low limit — the
 * different property values give it a distinct Spring context cache key, so it gets
 * its own fresh RateLimiter bean rather than sharing (and tripping) the one other
 * test classes use.
 */
@TestPropertySource(properties = {
        "cocanvas.rate-limit.register-max-requests=5",
        "cocanvas.rate-limit.register-window-seconds=60"
})
class RateLimitIntegrationTest extends AbstractIntegrationTest {

    @Test
    void repeatedRegistrationAttemptsFromTheSameClientGetRateLimited() throws Exception {
        // The register rule allows 5/60s per IP (MockMvc requests all share the same
        // synthetic remote address), so the 6th distinct attempt should be rejected
        // before it ever reaches the controller — regardless of whether the payload
        // itself would otherwise succeed or fail validation.
        for (int i = 0; i < 5; i++) {
            String body = """
                    {"name":"RateLimit","email":"ratelimit-%d@example.com","password":"correct-horse-battery"}
                    """.formatted(i);
            mockMvc.perform(post("/api/auth/register").contentType("application/json").content(body))
                    .andExpect(status().isCreated());
        }

        String sixthAttempt = """
                {"name":"RateLimit","email":"ratelimit-6@example.com","password":"correct-horse-battery"}
                """;
        mockMvc.perform(post("/api/auth/register").contentType("application/json").content(sixthAttempt))
                .andExpect(status().isTooManyRequests());
    }
}
