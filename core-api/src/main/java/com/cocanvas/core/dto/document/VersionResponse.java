package com.cocanvas.core.dto.document;

import com.cocanvas.core.entity.DocumentSnapshot;

import java.time.Instant;
import java.util.UUID;

public record VersionResponse(
        UUID id,
        UUID documentId,
        String label,
        Instant createdAt
) {
    public static VersionResponse from(DocumentSnapshot snapshot) {
        return new VersionResponse(snapshot.getId(), snapshot.getDocumentId(), snapshot.getVersionLabel(), snapshot.getCreatedAt());
    }
}
