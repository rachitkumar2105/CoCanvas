package com.cocanvas.core.dto.document;

import jakarta.validation.constraints.Size;

public record CreateVersionRequest(
        @Size(max = 255) String label
) {
}
