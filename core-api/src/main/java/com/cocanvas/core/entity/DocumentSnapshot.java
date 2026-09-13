package com.cocanvas.core.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "document_snapshots")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DocumentSnapshot {

  @Id @GeneratedValue private UUID id;

  @Column(name = "document_id", nullable = false)
  private UUID documentId;

  @Column(name = "yjs_state", nullable = false, columnDefinition = "bytea")
  private byte[] yjsState;

  @Column(name = "version_label")
  private String versionLabel;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }
}
