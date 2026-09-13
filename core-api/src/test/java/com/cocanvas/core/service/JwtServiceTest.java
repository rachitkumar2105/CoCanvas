package com.cocanvas.core.service;

import com.cocanvas.core.config.JwtProperties;
import com.cocanvas.core.security.JwtService;
import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    private final JwtProperties properties = new JwtProperties(
            "unit-test-signing-secret-at-least-32-bytes-long", 900, 1_209_600);
    private final JwtService jwtService = new JwtService(properties);

    @Test
    void generatesTokenThatRoundTripsToTheSameUserId() {
        UUID userId = UUID.randomUUID();
        String token = jwtService.generateAccessToken(userId, "someone@example.com");

        assertThat(jwtService.extractUserId(token)).isEqualTo(userId);
        assertThat(jwtService.parseClaims(token).get("email")).isEqualTo("someone@example.com");
    }

    @Test
    void rejectsTokenSignedWithADifferentSecret() {
        JwtProperties otherProperties = new JwtProperties(
                "a-completely-different-signing-secret-32-bytes!", 900, 1_209_600);
        JwtService otherService = new JwtService(otherProperties);

        String token = otherService.generateAccessToken(UUID.randomUUID(), "x@example.com");

        assertThatThrownBy(() -> jwtService.parseClaims(token)).isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsGarbageToken() {
        assertThatThrownBy(() -> jwtService.parseClaims("not-a-jwt")).isInstanceOf(JwtException.class);
    }
}
