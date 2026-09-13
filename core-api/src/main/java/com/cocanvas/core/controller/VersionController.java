package com.cocanvas.core.controller;

import com.cocanvas.core.dto.document.CreateVersionRequest;
import com.cocanvas.core.dto.document.VersionResponse;
import com.cocanvas.core.security.CurrentUser;
import com.cocanvas.core.service.VersionService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/documents/{documentId}/versions")
public class VersionController {

    private final VersionService versionService;

    public VersionController(VersionService versionService) {
        this.versionService = versionService;
    }

    @GetMapping
    public List<VersionResponse> list(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID documentId) {
        return versionService.listVersions(documentId, user.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public VersionResponse create(@AuthenticationPrincipal CurrentUser user,
                                   @PathVariable UUID documentId,
                                   @Valid @RequestBody CreateVersionRequest request) {
        return versionService.createVersion(documentId, user.id(), request);
    }

    @PostMapping("/{versionId}/restore")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void restore(@AuthenticationPrincipal CurrentUser user,
                         @PathVariable UUID documentId,
                         @PathVariable UUID versionId) {
        versionService.restoreVersion(documentId, user.id(), versionId);
    }
}
