package com.cocanvas.core.repository;

import com.cocanvas.core.entity.DocumentSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface DocumentSnapshotRepository extends JpaRepository<DocumentSnapshot, UUID> {
    Optional<DocumentSnapshot> findFirstByDocumentIdOrderByCreatedAtDesc(UUID documentId);
}
