package com.cocanvas.core.service;

import com.cocanvas.core.entity.DocumentSnapshot;
import com.cocanvas.core.repository.DocumentSnapshotRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Backs the Yjs persistence hooks the sync service calls on WebSocket connect/disconnect (Section
 * 9/10): the sync service keeps document state in memory only, so this is what makes a document
 * survive a sync-service restart or a browser refresh.
 *
 * <p>The "current state" a document hydrates from is one continuously-upserted row per document
 * (version_label IS NULL) rather than a new row every few seconds of activity — otherwise
 * document_snapshots would be the fastest-growing, unboundedly-growing table in the system (Section
 * 10 point 2 / Section 11's compaction concern). Named, permanent version history (VersionService)
 * is a separate, much slower-growing set of rows.
 */
@Service
public class SnapshotService {

  private final DocumentSnapshotRepository documentSnapshotRepository;

  public SnapshotService(DocumentSnapshotRepository documentSnapshotRepository) {
    this.documentSnapshotRepository = documentSnapshotRepository;
  }

  @Transactional(readOnly = true)
  public Optional<byte[]> getLatestState(UUID documentId) {
    return documentSnapshotRepository
        .findByDocumentIdAndVersionLabelIsNull(documentId)
        .map(DocumentSnapshot::getYjsState);
  }

  @Transactional
  public void saveState(UUID documentId, byte[] yjsState) {
    DocumentSnapshot autoSave =
        documentSnapshotRepository
            .findByDocumentIdAndVersionLabelIsNull(documentId)
            .orElseGet(() -> DocumentSnapshot.builder().documentId(documentId).build());
    autoSave.setYjsState(yjsState);
    documentSnapshotRepository.save(autoSave);
  }
}
