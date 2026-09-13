package com.cocanvas.core.repository;

import com.cocanvas.core.entity.DocumentSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentSnapshotRepository extends JpaRepository<DocumentSnapshot, UUID> {

  /**
   * The single, continuously-upserted auto-save row a document hydrates from (Section 10, point 2).
   */
  Optional<DocumentSnapshot> findByDocumentIdAndVersionLabelIsNull(UUID documentId);

  /** User-visible, permanently-kept version history (Section 7's GET .../versions). */
  List<DocumentSnapshot> findByDocumentIdAndVersionLabelIsNotNullOrderByCreatedAtDesc(
      UUID documentId);
}
