package com.cocanvas.core.dto.auth;

import java.util.UUID;

public record AuthResponse(
        UUID userId,
        String name,
        String email,
        String accessToken
) {
}
