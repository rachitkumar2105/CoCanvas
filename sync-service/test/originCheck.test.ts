import { describe, expect, it, beforeEach, vi } from "vitest";

describe("isAllowedOrigin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows an origin on the allow-list", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000,https://cocanvas.example.com";
    const { isAllowedOrigin } = await import("../src/security/originCheck.js");
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://cocanvas.example.com")).toBe(true);
  });

  it("rejects an origin not on the allow-list", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000";
    const { isAllowedOrigin } = await import("../src/security/originCheck.js");
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
  });

  it("allows a missing Origin header (non-browser clients: scripts, server-to-server)", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000";
    const { isAllowedOrigin } = await import("../src/security/originCheck.js");
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin(null)).toBe(true);
  });

  it("falls back to the localhost default when CORS_ALLOWED_ORIGINS is unset", async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    const { isAllowedOrigin } = await import("../src/security/originCheck.js");
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
  });
});
