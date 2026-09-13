package com.cocanvas.core.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "cocanvas.internal")
public record InternalProperties(String syncServiceSecret) {}
