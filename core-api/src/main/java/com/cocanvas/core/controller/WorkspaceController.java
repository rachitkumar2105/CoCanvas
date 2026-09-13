package com.cocanvas.core.controller;

import com.cocanvas.core.dto.workspace.CreateWorkspaceRequest;
import com.cocanvas.core.dto.workspace.InviteMemberRequest;
import com.cocanvas.core.dto.workspace.WorkspaceResponse;
import com.cocanvas.core.security.CurrentUser;
import com.cocanvas.core.service.WorkspaceService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @GetMapping
    public List<WorkspaceResponse> list(@AuthenticationPrincipal CurrentUser user) {
        return workspaceService.listWorkspacesFor(user.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public WorkspaceResponse create(@AuthenticationPrincipal CurrentUser user,
                                     @Valid @RequestBody CreateWorkspaceRequest request) {
        return workspaceService.createWorkspace(user.id(), request);
    }

    @PostMapping("/{workspaceId}/members")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void inviteMember(@AuthenticationPrincipal CurrentUser user,
                              @PathVariable UUID workspaceId,
                              @Valid @RequestBody InviteMemberRequest request) {
        workspaceService.inviteMember(workspaceId, user.id(), request);
    }
}
