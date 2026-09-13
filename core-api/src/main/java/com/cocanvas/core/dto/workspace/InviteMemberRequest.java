package com.cocanvas.core.dto.workspace;

import com.cocanvas.core.entity.WorkspaceRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record InviteMemberRequest(@NotBlank @Email String email, @NotNull WorkspaceRole role) {}
