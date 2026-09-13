package com.cocanvas.core.security;

import com.cocanvas.core.config.InternalProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Guards /internal/** (called only by the sync service, never a browser) with a shared
 * secret rather than a user JWT — this is service-to-service trust, not user identity.
 */
@Component
public class InternalServiceAuthFilter extends OncePerRequestFilter {

    private static final String HEADER = "X-Internal-Secret";
    private static final String PATH_PREFIX = "/internal/";

    private final InternalProperties internalProperties;

    public InternalServiceAuthFilter(InternalProperties internalProperties) {
        this.internalProperties = internalProperties;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                     @NonNull HttpServletResponse response,
                                     @NonNull FilterChain filterChain) throws ServletException, IOException {
        if (request.getRequestURI().startsWith(PATH_PREFIX)) {
            String provided = request.getHeader(HEADER);
            if (provided == null || !provided.equals(internalProperties.syncServiceSecret())) {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":\"FORBIDDEN\",\"message\":\"Invalid or missing internal service secret\"}");
                return;
            }
        }
        filterChain.doFilter(request, response);
    }
}
