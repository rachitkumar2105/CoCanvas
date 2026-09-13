package com.cocanvas.core.controller;

import com.cocanvas.core.dto.auth.AuthResponse;
import com.cocanvas.core.dto.auth.LoginRequest;
import com.cocanvas.core.dto.auth.RegisterRequest;
import com.cocanvas.core.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

  private static final String REFRESH_COOKIE_NAME = "refresh_token";
  private static final String REFRESH_COOKIE_PATH = "/api/auth";

  private final AuthService authService;

  public AuthController(AuthService authService) {
    this.authService = authService;
  }

  @PostMapping("/register")
  public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
    AuthService.AuthResult result = authService.register(request);
    return withRefreshCookie(result.refreshToken(), HttpStatus.CREATED).body(result.response());
  }

  @PostMapping("/login")
  public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
    AuthService.AuthResult result = authService.login(request);
    return withRefreshCookie(result.refreshToken(), HttpStatus.OK).body(result.response());
  }

  @PostMapping("/refresh")
  public ResponseEntity<AuthResponse> refresh(HttpServletRequest request) {
    String rawRefreshToken = extractCookie(request, REFRESH_COOKIE_NAME);
    AuthService.AuthResult result = authService.refresh(rawRefreshToken);
    return withRefreshCookie(result.refreshToken(), HttpStatus.OK).body(result.response());
  }

  @PostMapping("/logout")
  public ResponseEntity<Void> logout(HttpServletRequest request) {
    String rawRefreshToken = extractCookie(request, REFRESH_COOKIE_NAME);
    authService.logout(rawRefreshToken);

    ResponseCookie expired =
        ResponseCookie.from(REFRESH_COOKIE_NAME, "")
            .httpOnly(true)
            .secure(true)
            .sameSite("Strict")
            .path(REFRESH_COOKIE_PATH)
            .maxAge(0)
            .build();

    return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, expired.toString()).build();
  }

  private ResponseEntity.BodyBuilder withRefreshCookie(String rawRefreshToken, HttpStatus status) {
    ResponseCookie cookie =
        ResponseCookie.from(REFRESH_COOKIE_NAME, rawRefreshToken)
            .httpOnly(true)
            .secure(true)
            .sameSite("Strict")
            .path(REFRESH_COOKIE_PATH)
            .maxAge(authService.refreshTokenTtlSeconds())
            .build();
    return ResponseEntity.status(status).header(HttpHeaders.SET_COOKIE, cookie.toString());
  }

  private String extractCookie(HttpServletRequest request, String name) {
    if (request.getCookies() == null) {
      return null;
    }
    for (var cookie : request.getCookies()) {
      if (cookie.getName().equals(name)) {
        return cookie.getValue();
      }
    }
    return null;
  }
}
