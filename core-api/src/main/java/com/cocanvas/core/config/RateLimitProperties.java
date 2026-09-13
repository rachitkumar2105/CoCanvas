package com.cocanvas.core.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "cocanvas.rate-limit")
public record RateLimitProperties(
        int registerMaxRequests,
        long registerWindowSeconds,
        int loginMaxRequests,
        long loginWindowSeconds,
        int documentCreateMaxRequests,
        long documentCreateWindowSeconds
) {
}
