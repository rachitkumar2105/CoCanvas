package com.cocanvas.core.controller;

import com.cocanvas.core.dto.internal.SnapshotStateRequest;
import com.cocanvas.core.dto.internal.SnapshotStateResponse;
import com.cocanvas.core.service.SnapshotService;
import jakarta.validation.Valid;
import java.util.Base64;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Called only by the sync service (Section 7's "(internal) snapshot hook"), never a browser —
 * guarded by InternalServiceAuthFilter's shared-secret check, not user JWTs. State is exchanged as
 * base64 since it's opaque Yjs binary state (bytea in Postgres).
 */
@RestController
@RequestMapping("/internal/documents/{documentId}/snapshot")
public class InternalSnapshotController {

  private final SnapshotService snapshotService;

  public InternalSnapshotController(SnapshotService snapshotService) {
    this.snapshotService = snapshotService;
  }

  @GetMapping
  public ResponseEntity<SnapshotStateResponse> getLatest(@PathVariable UUID documentId) {
    return snapshotService
        .getLatestState(documentId)
        .map(
            bytes ->
                ResponseEntity.ok(
                    new SnapshotStateResponse(Base64.getEncoder().encodeToString(bytes))))
        .orElseGet(() -> ResponseEntity.noContent().build());
  }

  @PostMapping
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void save(
      @PathVariable UUID documentId, @Valid @RequestBody SnapshotStateRequest request) {
    byte[] state = Base64.getDecoder().decode(request.state());
    snapshotService.saveState(documentId, state);
  }
}
