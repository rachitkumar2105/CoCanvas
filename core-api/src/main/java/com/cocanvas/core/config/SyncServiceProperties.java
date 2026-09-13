package com.cocanvas.core.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "cocanvas.sync-service")
public record SyncServiceProperties(String internalUrl) {
}
