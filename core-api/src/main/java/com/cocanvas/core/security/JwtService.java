package com.cocanvas.core.security;

import com.cocanvas.core.config.JwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

/**
 * Issues and verifies the access token used by the frontend, and the short-lived document-scoped
 * "collab token" the sync service verifies independently on WebSocket connect (Section 8) — no
 * database round trip on that hot path.
 */
@Service
public class JwtService {

  private final SecretKey signingKey;
  private final JwtProperties properties;

  public JwtService(JwtProperties properties) {
    this.properties = properties;
    this.signingKey = Keys.hmacShaKeyFor(properties.secret().getBytes());
  }

  public String generateAccessToken(UUID userId, String email) {
    Instant now = Instant.now();
    return Jwts.builder()
        .subject(userId.toString())
        .claim("email", email)
        .claim("type", "access")
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plusSeconds(properties.accessTokenTtlSeconds())))
        .signWith(signingKey)
        .compact();
  }

  /**
   * Encodes (userId, documentId, role, documentType, exp) so the sync service can authorize a
   * WebSocket session — and pick the right shared Yjs type for the document (Y.Text for DOCUMENT,
   * Y.Map for WHITEBOARD, Section 5) — without calling back into the Core API on every message.
   */
  public String generateCollabToken(
      UUID userId, UUID documentId, String role, String documentType, long ttlSeconds) {
    Instant now = Instant.now();
    return Jwts.builder()
        .subject(userId.toString())
        .claim("documentId", documentId.toString())
        .claim("role", role)
        .claim("documentType", documentType)
        .claim("type", "collab")
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plusSeconds(ttlSeconds)))
        .signWith(signingKey)
        .compact();
  }

  public Claims parseClaims(String token) {
    try {
      return Jwts.parser().verifyWith(signingKey).build().parseSignedClaims(token).getPayload();
    } catch (JwtException | IllegalArgumentException e) {
      throw new JwtException("Invalid or expired token", e);
    }
  }

  public UUID extractUserId(String token) {
    return UUID.fromString(parseClaims(token).getSubject());
  }
}
