package com.cocanvas.core.service;

import com.cocanvas.core.dto.auth.AuthResponse;
import com.cocanvas.core.dto.auth.LoginRequest;
import com.cocanvas.core.dto.auth.RegisterRequest;
import com.cocanvas.core.entity.User;
import com.cocanvas.core.exception.ConflictException;
import com.cocanvas.core.exception.UnauthorizedException;
import com.cocanvas.core.repository.UserRepository;
import com.cocanvas.core.security.JwtService;
import com.cocanvas.core.security.RefreshTokenService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokenService;

    public AuthService(UserRepository userRepository,
                        PasswordEncoder passwordEncoder,
                        JwtService jwtService,
                        RefreshTokenService refreshTokenService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.refreshTokenService = refreshTokenService;
    }

    public record AuthResult(AuthResponse response, String refreshToken) {
    }

    @Transactional
    public AuthResult register(RegisterRequest request) {
        if (userRepository.existsByEmailIgnoreCase(request.email())) {
            throw new ConflictException("An account with this email already exists");
        }

        User user = User.builder()
                .name(request.name())
                .email(request.email())
                .passwordHash(passwordEncoder.encode(request.password()))
                .build();
        user = userRepository.save(user);

        return buildAuthResult(user);
    }

    @Transactional
    public AuthResult login(LoginRequest request) {
        User user = userRepository.findByEmailIgnoreCase(request.email())
                .orElseThrow(() -> new UnauthorizedException("Invalid email or password"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new UnauthorizedException("Invalid email or password");
        }

        return buildAuthResult(user);
    }

    @Transactional
    public AuthResult refresh(String rawRefreshToken) {
        if (rawRefreshToken == null || rawRefreshToken.isBlank()) {
            throw new UnauthorizedException("Missing refresh token");
        }

        RefreshTokenService.RotationResult rotation = refreshTokenService.rotate(rawRefreshToken);
        User user = userRepository.findById(rotation.userId())
                .orElseThrow(() -> new UnauthorizedException("User no longer exists"));

        String accessToken = jwtService.generateAccessToken(user.getId(), user.getEmail());
        AuthResponse response = new AuthResponse(user.getId(), user.getName(), user.getEmail(), accessToken);
        return new AuthResult(response, rotation.rawToken());
    }

    public void logout(String rawRefreshToken) {
        if (rawRefreshToken != null && !rawRefreshToken.isBlank()) {
            refreshTokenService.revoke(rawRefreshToken);
        }
    }

    public long refreshTokenTtlSeconds() {
        return refreshTokenService.ttlSeconds();
    }

    private AuthResult buildAuthResult(User user) {
        String accessToken = jwtService.generateAccessToken(user.getId(), user.getEmail());
        String refreshToken = refreshTokenService.issue(user.getId());
        AuthResponse response = new AuthResponse(user.getId(), user.getName(), user.getEmail(), accessToken);
        return new AuthResult(response, refreshToken);
    }
}
