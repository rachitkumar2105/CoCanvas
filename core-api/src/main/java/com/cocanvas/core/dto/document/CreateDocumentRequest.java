package com.cocanvas.core.dto.document;

import com.cocanvas.core.entity.DocumentType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateDocumentRequest(
        @NotBlank @Size(max = 255) String title,
        @NotNull DocumentType type
) {
}
