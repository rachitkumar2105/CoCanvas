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
@Table(name = "document_permissions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@IdClass(DocumentPermission.Id.class)
public class DocumentPermission {

  @jakarta.persistence.Id
  @Column(name = "document_id")
  private UUID documentId;

  @jakarta.persistence.Id
  @Column(name = "user_id")
  private UUID userId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private DocumentRole role;

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
    private UUID documentId;
    private UUID userId;

    @Override
    public boolean equals(Object o) {
      if (this == o) return true;
      if (!(o instanceof Id id)) return false;
      return Objects.equals(documentId, id.documentId) && Objects.equals(userId, id.userId);
    }

    @Override
    public int hashCode() {
      return Objects.hash(documentId, userId);
    }
  }
}
