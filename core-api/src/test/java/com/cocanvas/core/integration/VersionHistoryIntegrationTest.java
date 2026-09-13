package com.cocanvas.core.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Base64;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class VersionHistoryIntegrationTest extends AbstractIntegrationTest {

    private static final String INTERNAL_SECRET = "test-only-internal-secret";
    private final ObjectMapper objectMapper = new ObjectMapper();

    private String registerAndGetAccessToken(String name, String email) throws Exception {
        String body = """
                {"name":"%s","email":"%s","password":"correct-horse-battery"}
                """.formatted(name, email);
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("accessToken").asText();
    }

    private record WorkspaceAndDoc(String workspaceId, String documentId) {
    }

    private WorkspaceAndDoc createWorkspaceAndDocument(String accessToken) throws Exception {
        MvcResult wsResult = mockMvc.perform(post("/api/workspaces")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType("application/json")
                        .content("{\"name\":\"Team\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String workspaceId = objectMapper.readTree(wsResult.getResponse().getContentAsString()).get("id").asText();

        MvcResult docResult = mockMvc.perform(post("/api/workspaces/" + workspaceId + "/documents")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType("application/json")
                        .content("{\"title\":\"Doc\",\"type\":\"DOCUMENT\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String documentId = objectMapper.readTree(docResult.getResponse().getContentAsString()).get("id").asText();
        return new WorkspaceAndDoc(workspaceId, documentId);
    }

    private void writeAutoSaveState(String documentId, String content) throws Exception {
        String encoded = Base64.getEncoder().encodeToString(content.getBytes());
        mockMvc.perform(post("/internal/documents/" + documentId + "/snapshot")
                        .header("X-Internal-Secret", INTERNAL_SECRET)
                        .contentType("application/json")
                        .content("{\"state\":\"" + encoded + "\"}"))
                .andExpect(status().isNoContent());
    }

    @Test
    void cannotSaveAVersionBeforeTheDocumentHasAnyContent() throws Exception {
        String ownerToken = registerAndGetAccessToken("Owner", "ver-empty@example.com");
        WorkspaceAndDoc doc = createWorkspaceAndDocument(ownerToken);

        mockMvc.perform(post("/api/documents/" + doc.documentId() + "/versions")
                        .header("Authorization", "Bearer " + ownerToken)
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isConflict());
    }

    @Test
    void ownerCanSaveListAndRestoreAVersion_viewerCannotSaveOrRestore() throws Exception {
        String ownerToken = registerAndGetAccessToken("Owner", "ver-owner@example.com");
        String viewerToken = registerAndGetAccessToken("Viewer", "ver-viewer@example.com");
        WorkspaceAndDoc doc = createWorkspaceAndDocument(ownerToken);

        mockMvc.perform(post("/api/documents/" + doc.documentId() + "/share")
                        .header("Authorization", "Bearer " + ownerToken)
                        .contentType("application/json")
                        .content("{\"email\":\"ver-viewer@example.com\",\"role\":\"VIEWER\"}"))
                .andExpect(status().isNoContent());

        writeAutoSaveState(doc.documentId(), "first draft");

        // Viewer cannot save a version
        mockMvc.perform(post("/api/documents/" + doc.documentId() + "/versions")
                        .header("Authorization", "Bearer " + viewerToken)
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isForbidden());

        MvcResult v1Result = mockMvc.perform(post("/api/documents/" + doc.documentId() + "/versions")
                        .header("Authorization", "Bearer " + ownerToken)
                        .contentType("application/json")
                        .content("{\"label\":\"First draft\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.label").value("First draft"))
                .andReturn();
        String v1Id = objectMapper.readTree(v1Result.getResponse().getContentAsString()).get("id").asText();

        writeAutoSaveState(doc.documentId(), "second draft, much longer");

        mockMvc.perform(post("/api/documents/" + doc.documentId() + "/versions")
                        .header("Authorization", "Bearer " + ownerToken)
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.label").value("Snapshot")); // default label when none given

        // Viewer CAN see the version history (read-only), just not create/restore
        mockMvc.perform(get("/api/documents/" + doc.documentId() + "/versions")
                        .header("Authorization", "Bearer " + viewerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", org.hamcrest.Matchers.hasSize(2)))
                .andExpect(jsonPath("$[0].label").value("Snapshot")) // newest first
                .andExpect(jsonPath("$[1].label").value("First draft"));

        // Viewer cannot restore
        mockMvc.perform(post("/api/documents/" + doc.documentId() + "/versions/" + v1Id + "/restore")
                        .header("Authorization", "Bearer " + viewerToken))
                .andExpect(status().isForbidden());

        // Owner restores the first draft — best-effort push to a (nonexistent, in this
        // test) sync service must not fail the request.
        mockMvc.perform(post("/api/documents/" + doc.documentId() + "/versions/" + v1Id + "/restore")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isNoContent());

        // The auto-save row now reflects the restored ("first draft") content.
        mockMvc.perform(get("/internal/documents/" + doc.documentId() + "/snapshot")
                        .header("X-Internal-Secret", INTERNAL_SECRET))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value(Base64.getEncoder().encodeToString("first draft".getBytes())));

        // Restoring never deletes the version history itself.
        mockMvc.perform(get("/api/documents/" + doc.documentId() + "/versions")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", org.hamcrest.Matchers.hasSize(2)));
    }

    @Test
    void restoringAnUnknownOrForeignVersionIdReturnsNotFound() throws Exception {
        String ownerToken = registerAndGetAccessToken("Owner", "ver-notfound@example.com");
        WorkspaceAndDoc docA = createWorkspaceAndDocument(ownerToken);
        WorkspaceAndDoc docB = createWorkspaceAndDocument(ownerToken);

        writeAutoSaveState(docA.documentId(), "doc a content");
        MvcResult versionResult = mockMvc.perform(post("/api/documents/" + docA.documentId() + "/versions")
                        .header("Authorization", "Bearer " + ownerToken)
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isCreated())
                .andReturn();
        String versionIdFromDocA = objectMapper.readTree(versionResult.getResponse().getContentAsString()).get("id").asText();

        // A version that belongs to a different document cannot be used to restore this one.
        mockMvc.perform(post("/api/documents/" + docB.documentId() + "/versions/" + versionIdFromDocA + "/restore")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/documents/" + docA.documentId() + "/versions/" + java.util.UUID.randomUUID() + "/restore")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isNotFound());
    }
}
