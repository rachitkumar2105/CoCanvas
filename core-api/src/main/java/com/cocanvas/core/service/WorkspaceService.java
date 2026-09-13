package com.cocanvas.core.service;

import com.cocanvas.core.dto.workspace.CreateWorkspaceRequest;
import com.cocanvas.core.dto.workspace.InviteMemberRequest;
import com.cocanvas.core.dto.workspace.WorkspaceResponse;
import com.cocanvas.core.entity.User;
import com.cocanvas.core.entity.Workspace;
import com.cocanvas.core.entity.WorkspaceMember;
import com.cocanvas.core.entity.WorkspaceRole;
import com.cocanvas.core.exception.ConflictException;
import com.cocanvas.core.exception.ForbiddenException;
import com.cocanvas.core.exception.ResourceNotFoundException;
import com.cocanvas.core.repository.UserRepository;
import com.cocanvas.core.repository.WorkspaceMemberRepository;
import com.cocanvas.core.repository.WorkspaceRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkspaceService {

  private final WorkspaceRepository workspaceRepository;
  private final WorkspaceMemberRepository workspaceMemberRepository;
  private final UserRepository userRepository;

  public WorkspaceService(
      WorkspaceRepository workspaceRepository,
      WorkspaceMemberRepository workspaceMemberRepository,
      UserRepository userRepository) {
    this.workspaceRepository = workspaceRepository;
    this.workspaceMemberRepository = workspaceMemberRepository;
    this.userRepository = userRepository;
  }

  @Transactional
  public WorkspaceResponse createWorkspace(UUID ownerId, CreateWorkspaceRequest request) {
    Workspace workspace = Workspace.builder().ownerId(ownerId).name(request.name()).build();
    workspace = workspaceRepository.save(workspace);

    WorkspaceMember membership =
        WorkspaceMember.builder()
            .workspaceId(workspace.getId())
            .userId(ownerId)
            .role(WorkspaceRole.OWNER)
            .build();
    workspaceMemberRepository.save(membership);

    return WorkspaceResponse.from(workspace, WorkspaceRole.OWNER);
  }

  @Transactional(readOnly = true)
  public List<WorkspaceResponse> listWorkspacesFor(UUID userId) {
    return workspaceMemberRepository.findByUserId(userId).stream()
        .map(
            membership -> {
              Workspace workspace =
                  workspaceRepository
                      .findById(membership.getWorkspaceId())
                      .orElseThrow(() -> new ResourceNotFoundException("Workspace not found"));
              return WorkspaceResponse.from(workspace, membership.getRole());
            })
        .toList();
  }

  @Transactional(readOnly = true)
  public Workspace getWorkspaceOrThrow(UUID workspaceId) {
    return workspaceRepository
        .findById(workspaceId)
        .orElseThrow(() -> new ResourceNotFoundException("Workspace not found"));
  }

  @Transactional(readOnly = true)
  public WorkspaceRole requireMembership(UUID workspaceId, UUID userId) {
    return workspaceMemberRepository
        .findByWorkspaceIdAndUserId(workspaceId, userId)
        .map(WorkspaceMember::getRole)
        .orElseThrow(() -> new ForbiddenException("You are not a member of this workspace"));
  }

  @Transactional
  public void inviteMember(UUID workspaceId, UUID requesterId, InviteMemberRequest request) {
    WorkspaceRole requesterRole = requireMembership(workspaceId, requesterId);
    if (requesterRole != WorkspaceRole.OWNER) {
      throw new ForbiddenException("Only the workspace owner can invite members");
    }

    User invitee =
        userRepository
            .findByEmailIgnoreCase(request.email())
            .orElseThrow(
                () -> new ResourceNotFoundException("No user found with email " + request.email()));

    if (workspaceMemberRepository.existsByWorkspaceIdAndUserId(workspaceId, invitee.getId())) {
      throw new ConflictException("User is already a member of this workspace");
    }

    WorkspaceMember membership =
        WorkspaceMember.builder()
            .workspaceId(workspaceId)
            .userId(invitee.getId())
            .role(request.role())
            .build();
    workspaceMemberRepository.save(membership);
  }
}
