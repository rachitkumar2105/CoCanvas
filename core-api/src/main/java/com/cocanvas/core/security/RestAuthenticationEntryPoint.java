package com.cocanvas.core.security;

import com.cocanvas.core.exception.ErrorResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Without this, Spring Security's default handling for an unauthenticated request to a
 * protected endpoint returns 403 — misleading for a stateless JWT API, where "you didn't
 * send a valid token" should be 401, not "you're logged in but not allowed" (403).
 */
@Component
public class RestAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                          AuthenticationException authException) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        ErrorResponse body = ErrorResponse.of(401, "UNAUTHORIZED", "Authentication is required to access this resource");
        objectMapper.writeValue(response.getWriter(), body);
    }
}
