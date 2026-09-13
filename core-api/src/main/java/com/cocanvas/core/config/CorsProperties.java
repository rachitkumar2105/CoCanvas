package com.cocanvas.core.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "cocanvas.cors")
public record CorsProperties(List<String> allowedOrigins) {
}
