package com.cocanvas.core.repository;

import com.cocanvas.core.entity.WorkspaceMember;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkspaceMemberRepository
    extends JpaRepository<WorkspaceMember, WorkspaceMember.Id> {
  List<WorkspaceMember> findByUserId(UUID userId);

  List<WorkspaceMember> findByWorkspaceId(UUID workspaceId);

  Optional<WorkspaceMember> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);

  boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
}
