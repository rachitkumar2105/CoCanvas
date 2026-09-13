package com.cocanvas.core.security;

import java.util.UUID;

public record CurrentUser(UUID id, String email) {
}
