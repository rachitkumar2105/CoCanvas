package com.cocanvas.core.repository;

import com.cocanvas.core.entity.Document;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentRepository extends JpaRepository<Document, UUID> {
  List<Document> findByWorkspaceId(UUID workspaceId);
}
