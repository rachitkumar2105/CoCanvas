package com.cocanvas.core.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "cocanvas.cors")
public record CorsProperties(List<String> allowedOrigins) {}
