package com.cocanvas.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import com.cocanvas.core.entity.DocumentSnapshot;
import com.cocanvas.core.repository.DocumentSnapshotRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * SnapshotService.saveState must upsert a single auto-save row per document (Section 10 point 2 /
 * Section 11) rather than insert a new row on every debounce tick — otherwise document_snapshots
 * grows unboundedly for any long-lived, actively-edited document.
 */
@ExtendWith(MockitoExtension.class)
class SnapshotServiceTest {

  @Mock private DocumentSnapshotRepository repository;

  @Captor private ArgumentCaptor<DocumentSnapshot> savedCaptor;

  @Test
  void firstSaveCreatesANewAutoSaveRow() {
    UUID documentId = UUID.randomUUID();
    when(repository.findByDocumentIdAndVersionLabelIsNull(documentId)).thenReturn(Optional.empty());
    when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

    SnapshotService service = new SnapshotService(repository);
    byte[] state = {1, 2, 3};
    service.saveState(documentId, state);

    verify(repository).save(savedCaptor.capture());
    DocumentSnapshot saved = savedCaptor.getValue();
    assertThat(saved.getId()).isNull(); // a genuinely new row, not yet persisted
    assertThat(saved.getDocumentId()).isEqualTo(documentId);
    assertThat(saved.getVersionLabel()).isNull();
    assertThat(saved.getYjsState()).isEqualTo(state);
  }

  @Test
  void secondSaveUpdatesTheSameRowInsteadOfInsertingAnother() {
    UUID documentId = UUID.randomUUID();
    UUID existingRowId = UUID.randomUUID();
    DocumentSnapshot existing =
        DocumentSnapshot.builder()
            .id(existingRowId)
            .documentId(documentId)
            .yjsState(new byte[] {9, 9})
            .versionLabel(null)
            .build();

    when(repository.findByDocumentIdAndVersionLabelIsNull(documentId))
        .thenReturn(Optional.of(existing));
    when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

    SnapshotService service = new SnapshotService(repository);
    byte[] newState = {5, 6, 7};
    service.saveState(documentId, newState);

    verify(repository, times(1)).save(savedCaptor.capture());
    DocumentSnapshot saved = savedCaptor.getValue();
    // Same row (same id) — an UPDATE, not a new INSERT — is what keeps the table bounded.
    assertThat(saved.getId()).isEqualTo(existingRowId);
    assertThat(saved.getYjsState()).isEqualTo(newState);
  }

  @Test
  void getLatestStateOnlyEverReadsTheAutoSaveRowNeverANamedVersion() {
    UUID documentId = UUID.randomUUID();
    DocumentSnapshot autoSave =
        DocumentSnapshot.builder()
            .documentId(documentId)
            .yjsState(new byte[] {42})
            .versionLabel(null)
            .build();
    when(repository.findByDocumentIdAndVersionLabelIsNull(documentId))
        .thenReturn(Optional.of(autoSave));

    SnapshotService service = new SnapshotService(repository);
    Optional<byte[]> result = service.getLatestState(documentId);

    assertThat(result).contains(new byte[] {42});
    verify(repository, never()).findById(any());
  }
}
