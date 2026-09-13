package com.cocanvas.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cocanvas.core.config.JwtProperties;
import com.cocanvas.core.security.JwtService;
import io.jsonwebtoken.JwtException;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

  private final JwtProperties properties =
      new JwtProperties("unit-test-signing-secret-at-least-32-bytes-long", 900, 1_209_600, 60);
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
    JwtProperties otherProperties =
        new JwtProperties("a-completely-different-signing-secret-32-bytes!", 900, 1_209_600, 60);
    JwtService otherService = new JwtService(otherProperties);

    String token = otherService.generateAccessToken(UUID.randomUUID(), "x@example.com");

    assertThatThrownBy(() -> jwtService.parseClaims(token)).isInstanceOf(JwtException.class);
  }

  @Test
  void rejectsGarbageToken() {
    assertThatThrownBy(() -> jwtService.parseClaims("not-a-jwt")).isInstanceOf(JwtException.class);
  }

  @Test
  void collabTokenEncodesDocumentIdRoleAndDocumentType() {
    UUID userId = UUID.randomUUID();
    UUID documentId = UUID.randomUUID();
    String token = jwtService.generateCollabToken(userId, documentId, "EDITOR", "WHITEBOARD", 60);

    var claims = jwtService.parseClaims(token);
    assertThat(claims.getSubject()).isEqualTo(userId.toString());
    assertThat(claims.get("documentId")).isEqualTo(documentId.toString());
    assertThat(claims.get("role")).isEqualTo("EDITOR");
    assertThat(claims.get("documentType")).isEqualTo("WHITEBOARD");
    assertThat(claims.get("type")).isEqualTo("collab");
  }
}
