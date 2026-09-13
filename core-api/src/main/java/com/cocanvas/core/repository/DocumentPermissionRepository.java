package com.cocanvas.core.repository;

import com.cocanvas.core.entity.DocumentPermission;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentPermissionRepository
    extends JpaRepository<DocumentPermission, DocumentPermission.Id> {
  Optional<DocumentPermission> findByDocumentIdAndUserId(UUID documentId, UUID userId);

  List<DocumentPermission> findByDocumentId(UUID documentId);
}
