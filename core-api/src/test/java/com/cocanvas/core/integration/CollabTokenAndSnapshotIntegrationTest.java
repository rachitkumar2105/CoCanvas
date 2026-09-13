package com.cocanvas.core.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Base64;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class CollabTokenAndSnapshotIntegrationTest extends AbstractIntegrationTest {

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

    @Test
    void issuesCollabTokenOnlyToUsersWithDocumentAccess() throws Exception {
        String ownerToken = registerAndGetAccessToken("Owner", "collab-owner@example.com");
        String strangerToken = registerAndGetAccessToken("Stranger", "collab-stranger@example.com");
        WorkspaceAndDoc doc = createWorkspaceAndDocument(ownerToken);

        MvcResult result = mockMvc.perform(post("/api/documents/" + doc.documentId() + "/collab-token")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.expiresInSeconds").value(60))
                .andReturn();

        String token = objectMapper.readTree(result.getResponse().getContentAsString()).get("token").asText();
        String[] parts = token.split("\\.");
        JsonNode claims = objectMapper.readTree(Base64.getUrlDecoder().decode(parts[1]));
        assert claims.get("documentId").asText().equals(doc.documentId());
        assert claims.get("role").asText().equals("OWNER");
        assert claims.get("documentType").asText().equals("DOCUMENT");
        assert claims.get("type").asText().equals("collab");

        mockMvc.perform(post("/api/documents/" + doc.documentId() + "/collab-token")
                        .header("Authorization", "Bearer " + strangerToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void internalSnapshotEndpoints_requireSharedSecret_andRoundTripState() throws Exception {
        String ownerToken = registerAndGetAccessToken("Owner", "snap-owner@example.com");
        WorkspaceAndDoc doc = createWorkspaceAndDocument(ownerToken);

        // No secret header -> forbidden, even with a valid user access token
        mockMvc.perform(get("/internal/documents/" + doc.documentId() + "/snapshot")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isForbidden());

        // Wrong secret -> forbidden
        mockMvc.perform(get("/internal/documents/" + doc.documentId() + "/snapshot")
                        .header("X-Internal-Secret", "wrong-secret"))
                .andExpect(status().isForbidden());

        // No snapshot yet -> 204
        mockMvc.perform(get("/internal/documents/" + doc.documentId() + "/snapshot")
                        .header("X-Internal-Secret", INTERNAL_SECRET))
                .andExpect(status().isNoContent());

        String encodedState = Base64.getEncoder().encodeToString("fake-yjs-state-bytes".getBytes());

        mockMvc.perform(post("/internal/documents/" + doc.documentId() + "/snapshot")
                        .header("X-Internal-Secret", INTERNAL_SECRET)
                        .contentType("application/json")
                        .content("{\"state\":\"" + encodedState + "\"}"))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/internal/documents/" + doc.documentId() + "/snapshot")
                        .header("X-Internal-Secret", INTERNAL_SECRET))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value(encodedState));
    }
}
