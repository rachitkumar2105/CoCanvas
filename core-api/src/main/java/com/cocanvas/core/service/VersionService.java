package com.cocanvas.core.service;

import com.cocanvas.core.dto.document.CreateVersionRequest;
import com.cocanvas.core.dto.document.VersionResponse;
import com.cocanvas.core.entity.DocumentRole;
import com.cocanvas.core.entity.DocumentSnapshot;
import com.cocanvas.core.exception.ConflictException;
import com.cocanvas.core.exception.ForbiddenException;
import com.cocanvas.core.exception.ResourceNotFoundException;
import com.cocanvas.core.repository.DocumentSnapshotRepository;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Version history (Section 7's GET/POST .../versions, Section 3's Tier 2 feature): named,
 * permanently-kept snapshots distinct from the single continuously-upserted auto-save row
 * SnapshotService manages.
 */
@Service
public class VersionService {

  private final DocumentSnapshotRepository documentSnapshotRepository;
  private final DocumentService documentService;
  private final SyncServiceClient syncServiceClient;
  private final MeterRegistry meterRegistry;

  public VersionService(
      DocumentSnapshotRepository documentSnapshotRepository,
      DocumentService documentService,
      SyncServiceClient syncServiceClient,
      MeterRegistry meterRegistry) {
    this.documentSnapshotRepository = documentSnapshotRepository;
    this.documentService = documentService;
    this.syncServiceClient = syncServiceClient;
    this.meterRegistry = meterRegistry;
  }

  @Transactional(readOnly = true)
  public List<VersionResponse> listVersions(UUID documentId, UUID userId) {
    documentService.requireDocumentRole(documentId, userId);
    return documentSnapshotRepository
        .findByDocumentIdAndVersionLabelIsNotNullOrderByCreatedAtDesc(documentId)
        .stream()
        .map(VersionResponse::from)
        .toList();
  }

  @Transactional
  public VersionResponse createVersion(UUID documentId, UUID userId, CreateVersionRequest request) {
    DocumentRole role = documentService.requireDocumentRole(documentId, userId);
    if (!role.canWrite()) {
      throw new ForbiddenException("Viewers cannot save a version");
    }

    DocumentSnapshot currentState =
        documentSnapshotRepository
            .findByDocumentIdAndVersionLabelIsNull(documentId)
            .orElseThrow(
                () -> new ConflictException("Nothing to save yet — the document has no content"));

    String label =
        (request.label() == null || request.label().isBlank()) ? "Snapshot" : request.label();
    DocumentSnapshot version =
        DocumentSnapshot.builder()
            .documentId(documentId)
            .yjsState(currentState.getYjsState())
            .versionLabel(label)
            .build();
    version = documentSnapshotRepository.save(version);

    return VersionResponse.from(version);
  }

  @Transactional
  public void restoreVersion(UUID documentId, UUID userId, UUID versionId) {
    DocumentRole role = documentService.requireDocumentRole(documentId, userId);
    if (!role.canWrite()) {
      throw new ForbiddenException("Viewers cannot restore a version");
    }

    DocumentSnapshot version =
        documentSnapshotRepository
            .findById(versionId)
            .filter(v -> v.getDocumentId().equals(documentId))
            .orElseThrow(() -> new ResourceNotFoundException("Version not found"));

    DocumentSnapshot autoSave =
        documentSnapshotRepository
            .findByDocumentIdAndVersionLabelIsNull(documentId)
            .orElseGet(() -> DocumentSnapshot.builder().documentId(documentId).build());
    autoSave.setYjsState(version.getYjsState());
    documentSnapshotRepository.save(autoSave);

    // Best-effort: makes the restore visible immediately to anyone currently live in
    // the document. If nobody's connected (or the sync service is down), the Postgres
    // write above is what the next connection hydrates from regardless.
    syncServiceClient.pushRestoredState(documentId, version.getYjsState());
    meterRegistry.counter("cocanvas.versions.restored").increment();
  }
}
