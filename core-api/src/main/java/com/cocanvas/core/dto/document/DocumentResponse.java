package com.cocanvas.core.dto.document;

import com.cocanvas.core.entity.Document;
import com.cocanvas.core.entity.DocumentRole;
import com.cocanvas.core.entity.DocumentType;

import java.time.Instant;
import java.util.UUID;

public record DocumentResponse(
        UUID id,
        UUID workspaceId,
        String title,
        DocumentType type,
        UUID createdBy,
        DocumentRole myRole,
        Instant createdAt,
        Instant updatedAt
) {
    public static DocumentResponse from(Document document, DocumentRole myRole) {
        return new DocumentResponse(
                document.getId(),
                document.getWorkspaceId(),
                document.getTitle(),
                document.getType(),
                document.getCreatedBy(),
                myRole,
                document.getCreatedAt(),
                document.getUpdatedAt()
        );
    }
}
