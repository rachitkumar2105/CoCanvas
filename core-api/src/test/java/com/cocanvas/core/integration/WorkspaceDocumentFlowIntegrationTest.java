package com.cocanvas.core.integration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

class WorkspaceDocumentFlowIntegrationTest extends AbstractIntegrationTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  private String registerAndGetAccessToken(String name, String email) throws Exception {
    String body =
        """
                {"name":"%s","email":"%s","password":"correct-horse-battery"}
                """
            .formatted(name, email);
    MvcResult result =
        mockMvc
            .perform(post("/api/auth/register").contentType("application/json").content(body))
            .andExpect(status().isCreated())
            .andReturn();
    JsonNode json = objectMapper.readTree(result.getResponse().getContentAsString());
    return json.get("accessToken").asText();
  }

  @Test
  void ownerCanCreateWorkspaceAndDocument_editorCanEdit_viewerCannot() throws Exception {
    String ownerToken = registerAndGetAccessToken("Owner", "owner@example.com");
    String editorToken = registerAndGetAccessToken("Editor", "editor@example.com");
    String viewerToken = registerAndGetAccessToken("Viewer", "viewer@example.com");
    String strangerToken = registerAndGetAccessToken("Stranger", "stranger@example.com");

    MvcResult wsResult =
        mockMvc
            .perform(
                post("/api/workspaces")
                    .header("Authorization", "Bearer " + ownerToken)
                    .contentType("application/json")
                    .content("{\"name\":\"Product Team\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.myRole").value("OWNER"))
            .andReturn();
    String workspaceId =
        objectMapper.readTree(wsResult.getResponse().getContentAsString()).get("id").asText();

    // A non-member cannot create documents in the workspace
    mockMvc
        .perform(
            post("/api/workspaces/" + workspaceId + "/documents")
                .header("Authorization", "Bearer " + strangerToken)
                .contentType("application/json")
                .content("{\"title\":\"Q3 Plan\",\"type\":\"DOCUMENT\"}"))
        .andExpect(status().isForbidden());

    MvcResult docResult =
        mockMvc
            .perform(
                post("/api/workspaces/" + workspaceId + "/documents")
                    .header("Authorization", "Bearer " + ownerToken)
                    .contentType("application/json")
                    .content("{\"title\":\"Q3 Plan\",\"type\":\"DOCUMENT\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.myRole").value("OWNER"))
            .andReturn();
    String documentId =
        objectMapper.readTree(docResult.getResponse().getContentAsString()).get("id").asText();

    // Share as EDITOR and VIEWER
    mockMvc
        .perform(
            post("/api/documents/" + documentId + "/share")
                .header("Authorization", "Bearer " + ownerToken)
                .contentType("application/json")
                .content("{\"email\":\"editor@example.com\",\"role\":\"EDITOR\"}"))
        .andExpect(status().isNoContent());
    mockMvc
        .perform(
            post("/api/documents/" + documentId + "/share")
                .header("Authorization", "Bearer " + ownerToken)
                .contentType("application/json")
                .content("{\"email\":\"viewer@example.com\",\"role\":\"VIEWER\"}"))
        .andExpect(status().isNoContent());

    // Editor can rename the document
    mockMvc
        .perform(
            patch("/api/documents/" + documentId)
                .header("Authorization", "Bearer " + editorToken)
                .contentType("application/json")
                .content("{\"title\":\"Q3 Plan (Updated)\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("Q3 Plan (Updated)"));

    // Viewer cannot rename the document
    mockMvc
        .perform(
            patch("/api/documents/" + documentId)
                .header("Authorization", "Bearer " + viewerToken)
                .contentType("application/json")
                .content("{\"title\":\"Hijacked\"}"))
        .andExpect(status().isForbidden());

    // Viewer cannot manage sharing
    mockMvc
        .perform(
            post("/api/documents/" + documentId + "/share")
                .header("Authorization", "Bearer " + viewerToken)
                .contentType("application/json")
                .content("{\"email\":\"stranger@example.com\",\"role\":\"EDITOR\"}"))
        .andExpect(status().isForbidden());

    // A user with no permission entry cannot even read the document
    mockMvc
        .perform(
            get("/api/documents/" + documentId).header("Authorization", "Bearer " + strangerToken))
        .andExpect(status().isForbidden());

    // Viewer can still read it
    mockMvc
        .perform(
            get("/api/documents/" + documentId).header("Authorization", "Bearer " + viewerToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.myRole").value("VIEWER"));
  }
}
