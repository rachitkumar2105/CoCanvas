package com.cocanvas.core.dto.workspace;

import com.cocanvas.core.entity.Workspace;
import com.cocanvas.core.entity.WorkspaceRole;

import java.time.Instant;
import java.util.UUID;

public record WorkspaceResponse(
        UUID id,
        String name,
        UUID ownerId,
        WorkspaceRole myRole,
        Instant createdAt
) {
    public static WorkspaceResponse from(Workspace workspace, WorkspaceRole myRole) {
        return new WorkspaceResponse(workspace.getId(), workspace.getName(), workspace.getOwnerId(), myRole, workspace.getCreatedAt());
    }
}
