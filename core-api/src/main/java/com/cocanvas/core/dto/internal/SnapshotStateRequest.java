package com.cocanvas.core.dto.internal;

import jakarta.validation.constraints.NotBlank;

public record SnapshotStateRequest(
        @NotBlank String state
) {
}
