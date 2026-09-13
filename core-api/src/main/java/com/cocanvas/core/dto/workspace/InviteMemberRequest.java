package com.cocanvas.core.dto.workspace;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import com.cocanvas.core.entity.WorkspaceRole;

public record InviteMemberRequest(
        @NotBlank @Email String email,
        @NotNull WorkspaceRole role
) {
}
