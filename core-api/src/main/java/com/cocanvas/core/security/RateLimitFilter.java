package com.cocanvas.core.security;

import com.cocanvas.core.config.RateLimitProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.regex.Pattern;
import org.springframework.lang.NonNull;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Rate limiting on auth and document-creation endpoints (Section 3 Tier 2 / Section 13's security
 * checklist). Registered explicitly via SecurityConfig's addFilterAfter(..., JwtAuthFilter.class) —
 * after authentication runs, so a per-user limit (document creation) can key off the authenticated
 * principal rather than falling back to IP for every rule.
 */
public class RateLimitFilter extends OncePerRequestFilter {

  private static final Pattern DOCUMENT_CREATE_PATH =
      Pattern.compile("^/api/workspaces/[^/]+/documents$");

  private record Rule(String name, int maxRequests, long windowMillis, boolean perUser) {}

  private final RateLimiter rateLimiter;
  private final RateLimitProperties properties;

  public RateLimitFilter(RateLimiter rateLimiter, RateLimitProperties properties) {
    this.rateLimiter = rateLimiter;
    this.properties = properties;
  }

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain filterChain)
      throws ServletException, IOException {
    Rule rule = resolveRule(request.getMethod(), request.getRequestURI());

    if (rule != null) {
      String key = rule.name() + ":" + (rule.perUser() ? currentUserKey(request) : ipKey(request));
      if (!rateLimiter.tryAcquire(key, rule.maxRequests(), rule.windowMillis())) {
        response.setStatus(429);
        response.setContentType("application/json");
        response
            .getWriter()
            .write(
                "{\"error\":\"RATE_LIMITED\",\"message\":\"Too many requests — try again in a moment\"}");
        return;
      }
    }

    filterChain.doFilter(request, response);
  }

  private Rule resolveRule(String method, String path) {
    if (!"POST".equals(method)) {
      return null;
    }
    if ("/api/auth/register".equals(path)) {
      return new Rule(
          "register",
          properties.registerMaxRequests(),
          properties.registerWindowSeconds() * 1000,
          false);
    }
    if ("/api/auth/login".equals(path)) {
      return new Rule(
          "login", properties.loginMaxRequests(), properties.loginWindowSeconds() * 1000, false);
    }
    if (DOCUMENT_CREATE_PATH.matcher(path).matches()) {
      return new Rule(
          "doc-create",
          properties.documentCreateMaxRequests(),
          properties.documentCreateWindowSeconds() * 1000,
          true);
    }
    return null;
  }

  private String currentUserKey(HttpServletRequest request) {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth != null && auth.getPrincipal() instanceof CurrentUser currentUser) {
      return "user:" + currentUser.id();
    }
    return ipKey(request);
  }

  private String ipKey(HttpServletRequest request) {
    return "ip:" + request.getRemoteAddr();
  }
}
