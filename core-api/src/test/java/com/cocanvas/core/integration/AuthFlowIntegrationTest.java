package com.cocanvas.core.integration;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;

class AuthFlowIntegrationTest extends AbstractIntegrationTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void registerLoginRefreshLogout_fullLifecycle() throws Exception {
    String email = "alice@example.com";
    String registerBody =
        """
                {"name":"Alice","email":"%s","password":"correct-horse-battery"}
                """
            .formatted(email);

    var registerResult =
        mockMvc
            .perform(
                post("/api/auth/register").contentType("application/json").content(registerBody))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.email").value(email))
            .andExpect(jsonPath("$.accessToken").isNotEmpty())
            .andExpect(cookie().exists("refresh_token"))
            .andExpect(cookie().httpOnly("refresh_token", true))
            .andReturn();

    Cookie refreshCookie = registerResult.getResponse().getCookie("refresh_token");

    // Duplicate registration is rejected
    mockMvc
        .perform(post("/api/auth/register").contentType("application/json").content(registerBody))
        .andExpect(status().isConflict());

    // Login with correct credentials works
    String loginBody =
        """
                {"email":"%s","password":"correct-horse-battery"}
                """
            .formatted(email);
    mockMvc
        .perform(post("/api/auth/login").contentType("application/json").content(loginBody))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accessToken").isNotEmpty());

    // Login with wrong password is rejected
    String badLoginBody =
        """
                {"email":"%s","password":"wrong-password"}
                """
            .formatted(email);
    mockMvc
        .perform(post("/api/auth/login").contentType("application/json").content(badLoginBody))
        .andExpect(status().isUnauthorized());

    // Refresh rotates the token and returns a new access token
    var refreshResult =
        mockMvc
            .perform(post("/api/auth/refresh").cookie(refreshCookie))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.accessToken").isNotEmpty())
            .andExpect(cookie().exists("refresh_token"))
            .andReturn();

    Cookie rotatedCookie = refreshResult.getResponse().getCookie("refresh_token");
    JsonNode originalJson =
        objectMapper.readTree(registerResult.getResponse().getContentAsString());
    JsonNode rotatedJson = objectMapper.readTree(refreshResult.getResponse().getContentAsString());
    assert !originalJson
        .get("accessToken")
        .asText()
        .equals(rotatedJson.get("accessToken").asText());
    assert !refreshCookie.getValue().equals(rotatedCookie.getValue());

    // The original (now-rotated-away) refresh token can no longer be used
    mockMvc
        .perform(post("/api/auth/refresh").cookie(refreshCookie))
        .andExpect(status().isUnauthorized());

    // Logout revokes the current refresh token
    mockMvc
        .perform(post("/api/auth/logout").cookie(rotatedCookie))
        .andExpect(status().isNoContent());

    mockMvc
        .perform(post("/api/auth/refresh").cookie(rotatedCookie))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void protectedEndpoint_rejectsMissingOrInvalidToken() throws Exception {
    mockMvc.perform(get("/api/workspaces")).andExpect(status().isUnauthorized());

    mockMvc
        .perform(get("/api/workspaces").header("Authorization", "Bearer not-a-real-token"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void register_rejectsInvalidPayload() throws Exception {
    mockMvc
        .perform(
            post("/api/auth/register")
                .contentType("application/json")
                .content("{\"name\":\"\",\"email\":\"not-an-email\",\"password\":\"short\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("VALIDATION_ERROR"));
  }
}
