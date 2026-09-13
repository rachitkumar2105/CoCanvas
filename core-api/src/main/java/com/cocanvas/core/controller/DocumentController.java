package com.cocanvas.core.controller;

import com.cocanvas.core.dto.document.CollabTokenResponse;
import com.cocanvas.core.dto.document.CreateDocumentRequest;
import com.cocanvas.core.dto.document.DocumentResponse;
import com.cocanvas.core.dto.document.ShareDocumentRequest;
import com.cocanvas.core.dto.document.UpdateDocumentRequest;
import com.cocanvas.core.security.CurrentUser;
import com.cocanvas.core.service.DocumentService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class DocumentController {

  private final DocumentService documentService;

  public DocumentController(DocumentService documentService) {
    this.documentService = documentService;
  }

  @GetMapping("/api/workspaces/{workspaceId}/documents")
  public List<DocumentResponse> listInWorkspace(
      @AuthenticationPrincipal CurrentUser user, @PathVariable UUID workspaceId) {
    return documentService.listByWorkspace(workspaceId, user.id());
  }

  @PostMapping("/api/workspaces/{workspaceId}/documents")
  @ResponseStatus(HttpStatus.CREATED)
  public DocumentResponse create(
      @AuthenticationPrincipal CurrentUser user,
      @PathVariable UUID workspaceId,
      @Valid @RequestBody CreateDocumentRequest request) {
    return documentService.createDocument(workspaceId, user.id(), request);
  }

  @GetMapping("/api/documents/{documentId}")
  public DocumentResponse get(
      @AuthenticationPrincipal CurrentUser user, @PathVariable UUID documentId) {
    return documentService.getDocument(documentId, user.id());
  }

  @PatchMapping("/api/documents/{documentId}")
  public DocumentResponse update(
      @AuthenticationPrincipal CurrentUser user,
      @PathVariable UUID documentId,
      @Valid @RequestBody UpdateDocumentRequest request) {
    return documentService.updateDocument(documentId, user.id(), request);
  }

  @PostMapping("/api/documents/{documentId}/share")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void share(
      @AuthenticationPrincipal CurrentUser user,
      @PathVariable UUID documentId,
      @Valid @RequestBody ShareDocumentRequest request) {
    documentService.shareDocument(documentId, user.id(), request);
  }

  @PostMapping("/api/documents/{documentId}/collab-token")
  public CollabTokenResponse collabToken(
      @AuthenticationPrincipal CurrentUser user, @PathVariable UUID documentId) {
    return documentService.issueCollabToken(documentId, user.id());
  }
}
