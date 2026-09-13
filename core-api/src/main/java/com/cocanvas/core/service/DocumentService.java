package com.cocanvas.core.service;

import com.cocanvas.core.config.JwtProperties;
import com.cocanvas.core.dto.document.CollabTokenResponse;
import com.cocanvas.core.dto.document.CreateDocumentRequest;
import com.cocanvas.core.dto.document.DocumentResponse;
import com.cocanvas.core.dto.document.ShareDocumentRequest;
import com.cocanvas.core.dto.document.UpdateDocumentRequest;
import com.cocanvas.core.entity.Document;
import com.cocanvas.core.entity.DocumentPermission;
import com.cocanvas.core.entity.DocumentRole;
import com.cocanvas.core.entity.User;
import com.cocanvas.core.exception.ForbiddenException;
import com.cocanvas.core.exception.ResourceNotFoundException;
import com.cocanvas.core.repository.DocumentPermissionRepository;
import com.cocanvas.core.repository.DocumentRepository;
import com.cocanvas.core.repository.UserRepository;
import com.cocanvas.core.security.JwtService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class DocumentService {

    private final DocumentRepository documentRepository;
    private final DocumentPermissionRepository documentPermissionRepository;
    private final UserRepository userRepository;
    private final WorkspaceService workspaceService;
    private final JwtService jwtService;
    private final JwtProperties jwtProperties;

    public DocumentService(DocumentRepository documentRepository,
                            DocumentPermissionRepository documentPermissionRepository,
                            UserRepository userRepository,
                            WorkspaceService workspaceService,
                            JwtService jwtService,
                            JwtProperties jwtProperties) {
        this.documentRepository = documentRepository;
        this.documentPermissionRepository = documentPermissionRepository;
        this.userRepository = userRepository;
        this.workspaceService = workspaceService;
        this.jwtService = jwtService;
        this.jwtProperties = jwtProperties;
    }

    @Transactional
    public DocumentResponse createDocument(UUID workspaceId, UUID creatorId, CreateDocumentRequest request) {
        workspaceService.requireMembership(workspaceId, creatorId);

        Document document = Document.builder()
                .workspaceId(workspaceId)
                .title(request.title())
                .type(request.type())
                .createdBy(creatorId)
                .build();
        document = documentRepository.save(document);

        DocumentPermission ownerPermission = DocumentPermission.builder()
                .documentId(document.getId())
                .userId(creatorId)
                .role(DocumentRole.OWNER)
                .build();
        documentPermissionRepository.save(ownerPermission);

        return DocumentResponse.from(document, DocumentRole.OWNER);
    }

    @Transactional(readOnly = true)
    public List<DocumentResponse> listByWorkspace(UUID workspaceId, UUID userId) {
        workspaceService.requireMembership(workspaceId, userId);

        return documentRepository.findByWorkspaceId(workspaceId).stream()
                .map(document -> {
                    DocumentRole myRole = documentPermissionRepository
                            .findByDocumentIdAndUserId(document.getId(), userId)
                            .map(DocumentPermission::getRole)
                            .orElse(null);
                    return DocumentResponse.from(document, myRole);
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public DocumentResponse getDocument(UUID documentId, UUID userId) {
        Document document = getDocumentOrThrow(documentId);
        DocumentRole role = requireDocumentRole(documentId, userId);
        return DocumentResponse.from(document, role);
    }

    @Transactional
    public DocumentResponse updateDocument(UUID documentId, UUID userId, UpdateDocumentRequest request) {
        Document document = getDocumentOrThrow(documentId);
        DocumentRole role = requireDocumentRole(documentId, userId);
        if (!role.canWrite()) {
            throw new ForbiddenException("Viewers cannot modify this document");
        }

        document.setTitle(request.title());
        document = documentRepository.save(document);
        return DocumentResponse.from(document, role);
    }

    @Transactional
    public void shareDocument(UUID documentId, UUID requesterId, ShareDocumentRequest request) {
        getDocumentOrThrow(documentId);
        DocumentRole requesterRole = requireDocumentRole(documentId, requesterId);
        if (!requesterRole.canManagePermissions()) {
            throw new ForbiddenException("Only the document owner can change sharing");
        }

        User target = userRepository.findByEmailIgnoreCase(request.email())
                .orElseThrow(() -> new ResourceNotFoundException("No user found with email " + request.email()));

        Optional<DocumentPermission> existing = documentPermissionRepository
                .findByDocumentIdAndUserId(documentId, target.getId());

        DocumentPermission permission = existing.orElseGet(() -> DocumentPermission.builder()
                .documentId(documentId)
                .userId(target.getId())
                .build());
        permission.setRole(request.role());
        documentPermissionRepository.save(permission);
    }

    /**
     * Section 8's handoff: the client already holds a valid access token; this exchanges
     * it for a short-lived, document-scoped token the sync service can verify by itself
     * on WebSocket connect, with no callback to the Core API per message.
     */
    @Transactional(readOnly = true)
    public CollabTokenResponse issueCollabToken(UUID documentId, UUID userId) {
        Document document = getDocumentOrThrow(documentId);
        DocumentRole role = requireDocumentRole(documentId, userId);
        long ttl = jwtProperties.collabTokenTtlSeconds();
        String token = jwtService.generateCollabToken(userId, documentId, role.name(), document.getType().name(), ttl);
        return new CollabTokenResponse(token, ttl);
    }

    @Transactional(readOnly = true)
    public Document getDocumentOrThrow(UUID documentId) {
        return documentRepository.findById(documentId)
                .orElseThrow(() -> new ResourceNotFoundException("Document not found"));
    }

    @Transactional(readOnly = true)
    public DocumentRole requireDocumentRole(UUID documentId, UUID userId) {
        return documentPermissionRepository.findByDocumentIdAndUserId(documentId, userId)
                .map(DocumentPermission::getRole)
                .orElseThrow(() -> new ForbiddenException("You do not have access to this document"));
    }
}
