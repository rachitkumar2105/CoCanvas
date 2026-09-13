import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { verifyCollabToken, CollabTokenError } from "../src/auth/collabToken.js";

const SECRET = "unit-test-signing-secret-at-least-32-bytes-long";
const DOCUMENT_ID = "b794a622-8493-4127-adf9-2d9720649b9f";
const USER_ID = "16d113ca-1861-4005-acc1-d84b93cb74c0";

function makeToken(overrides: Record<string, unknown> = {}, opts: jwt.SignOptions = {}) {
  return jwt.sign(
    {
      documentId: DOCUMENT_ID,
      role: "EDITOR",
      documentType: "DOCUMENT",
      type: "collab",
      ...overrides,
    },
    SECRET,
    { subject: USER_ID, expiresIn: "60s", ...opts },
  );
}

describe("verifyCollabToken", () => {
  it("accepts a well-formed token scoped to the right document", () => {
    const token = makeToken();
    const claims = verifyCollabToken(token, DOCUMENT_ID, SECRET);
    expect(claims).toEqual({ userId: USER_ID, documentId: DOCUMENT_ID, role: "EDITOR", documentType: "DOCUMENT" });
  });

  it("accepts a WHITEBOARD-scoped token", () => {
    const token = makeToken({ documentType: "WHITEBOARD" });
    const claims = verifyCollabToken(token, DOCUMENT_ID, SECRET);
    expect(claims.documentType).toBe("WHITEBOARD");
  });

  it("rejects a token with a missing or invalid documentType", () => {
    const token = makeToken({ documentType: "SPREADSHEET" });
    expect(() => verifyCollabToken(token, DOCUMENT_ID, SECRET)).toThrow(/documentType/);
  });

  it("accepts tokens signed with HS256, HS384, or HS512 (Core API's key-length-dependent algorithm)", () => {
    for (const algorithm of ["HS256", "HS384", "HS512"] as const) {
      const token = makeToken({}, { algorithm });
      expect(() => verifyCollabToken(token, DOCUMENT_ID, SECRET)).not.toThrow();
    }
  });

  it("rejects a token signed with a different secret", () => {
    const token = makeToken({}, {});
    expect(() => verifyCollabToken(token, DOCUMENT_ID, "a-totally-different-secret-value")).toThrow(CollabTokenError);
  });

  it("rejects a token scoped to a different document", () => {
    const token = makeToken({ documentId: "some-other-document-id" });
    expect(() => verifyCollabToken(token, DOCUMENT_ID, SECRET)).toThrow(/not scoped to this document/);
  });

  it("rejects an access token (wrong type claim)", () => {
    const token = makeToken({ type: "access" });
    expect(() => verifyCollabToken(token, DOCUMENT_ID, SECRET)).toThrow(/Not a collab token/);
  });

  it("rejects a token with a missing or invalid role", () => {
    const token = makeToken({ role: "SUPERUSER" });
    expect(() => verifyCollabToken(token, DOCUMENT_ID, SECRET)).toThrow(/role/);
  });

  it("rejects an expired token", async () => {
    const token = makeToken({}, { expiresIn: "-1s" });
    expect(() => verifyCollabToken(token, DOCUMENT_ID, SECRET)).toThrow(CollabTokenError);
  });

  it("rejects garbage input", () => {
    expect(() => verifyCollabToken("not-a-jwt", DOCUMENT_ID, SECRET)).toThrow(CollabTokenError);
  });
});
