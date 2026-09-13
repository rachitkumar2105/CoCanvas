package com.cocanvas.core.dto.document;

import com.cocanvas.core.entity.DocumentRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record ShareDocumentRequest(
        @NotBlank @Email String email,
        @NotNull DocumentRole role
) {
}
