package com.cocanvas.core.service;

import com.cocanvas.core.entity.DocumentSnapshot;
import com.cocanvas.core.repository.DocumentSnapshotRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Backs the Yjs persistence hooks the sync service calls on WebSocket connect/disconnect
 * (Section 9/10): the sync service keeps document state in memory only, so this is what
 * makes a document survive a sync-service restart or a browser refresh.
 */
@Service
public class SnapshotService {

    private final DocumentSnapshotRepository documentSnapshotRepository;

    public SnapshotService(DocumentSnapshotRepository documentSnapshotRepository) {
        this.documentSnapshotRepository = documentSnapshotRepository;
    }

    @Transactional(readOnly = true)
    public Optional<byte[]> getLatestState(UUID documentId) {
        return documentSnapshotRepository.findFirstByDocumentIdOrderByCreatedAtDesc(documentId)
                .map(DocumentSnapshot::getYjsState);
    }

    @Transactional
    public void saveState(UUID documentId, byte[] yjsState) {
        DocumentSnapshot snapshot = DocumentSnapshot.builder()
                .documentId(documentId)
                .yjsState(yjsState)
                .build();
        documentSnapshotRepository.save(snapshot);
    }
}
