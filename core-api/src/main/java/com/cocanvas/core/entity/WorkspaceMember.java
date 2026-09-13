package com.cocanvas.core.entity;

import jakarta.persistence.*;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "workspace_members")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@IdClass(WorkspaceMember.Id.class)
public class WorkspaceMember {

  @jakarta.persistence.Id
  @Column(name = "workspace_id")
  private UUID workspaceId;

  @jakarta.persistence.Id
  @Column(name = "user_id")
  private UUID userId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private WorkspaceRole role;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }

  @Getter
  @Setter
  @NoArgsConstructor
  @AllArgsConstructor
  public static class Id implements Serializable {
    private UUID workspaceId;
    private UUID userId;

    @Override
    public boolean equals(Object o) {
      if (this == o) return true;
      if (!(o instanceof Id id)) return false;
      return Objects.equals(workspaceId, id.workspaceId) && Objects.equals(userId, id.userId);
    }

    @Override
    public int hashCode() {
      return Objects.hash(workspaceId, userId);
    }
  }
}
