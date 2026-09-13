package com.cocanvas.core.security;

import com.cocanvas.core.config.JwtProperties;
import com.cocanvas.core.entity.RefreshToken;
import com.cocanvas.core.exception.UnauthorizedException;
import com.cocanvas.core.repository.RefreshTokenRepository;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

/**
 * Opaque, rotated refresh tokens (Section 8): the raw value is only ever held by the
 * client in an httpOnly cookie — the database stores a hash, never the raw token.
 */
@Service
public class RefreshTokenService {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final RefreshTokenRepository refreshTokenRepository;
    private final JwtProperties jwtProperties;

    public RefreshTokenService(RefreshTokenRepository refreshTokenRepository, JwtProperties jwtProperties) {
        this.refreshTokenRepository = refreshTokenRepository;
        this.jwtProperties = jwtProperties;
    }

    public String issue(UUID userId) {
        String rawToken = generateRawToken();
        RefreshToken entity = RefreshToken.builder()
                .userId(userId)
                .tokenHash(hash(rawToken))
                .expiresAt(Instant.now().plusSeconds(jwtProperties.refreshTokenTtlSeconds()))
                .revoked(false)
                .build();
        refreshTokenRepository.save(entity);
        return rawToken;
    }

    /**
     * Validates the presented raw token, revokes it, and issues a replacement — rotation
     * on every use so a leaked, already-used token cannot be replayed.
     */
    public RotationResult rotate(String rawToken) {
        RefreshToken existing = refreshTokenRepository.findByTokenHash(hash(rawToken))
                .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));

        if (existing.isRevoked() || existing.getExpiresAt().isBefore(Instant.now())) {
            throw new UnauthorizedException("Refresh token expired or revoked");
        }

        existing.setRevoked(true);
        refreshTokenRepository.save(existing);

        String newRawToken = issue(existing.getUserId());
        return new RotationResult(existing.getUserId(), newRawToken);
    }

    public void revoke(String rawToken) {
        refreshTokenRepository.findByTokenHash(hash(rawToken))
                .ifPresent(token -> {
                    token.setRevoked(true);
                    refreshTokenRepository.save(token);
                });
    }

    public long ttlSeconds() {
        return jwtProperties.refreshTokenTtlSeconds();
    }

    private String generateRawToken() {
        byte[] bytes = new byte[64];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hash(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(rawToken.getBytes());
            return Base64.getEncoder().encodeToString(hashed);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    public record RotationResult(UUID userId, String rawToken) {
    }
}
