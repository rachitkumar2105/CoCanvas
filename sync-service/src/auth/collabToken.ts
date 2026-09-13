import jwt from "jsonwebtoken";

export type DocumentRole = "OWNER" | "EDITOR" | "VIEWER";
export type DocumentType = "DOCUMENT" | "WHITEBOARD";

export interface CollabClaims {
  userId: string;
  documentId: string;
  role: DocumentRole;
  documentType: DocumentType;
}

export class CollabTokenError extends Error {}

/**
 * Verifies the short-lived, document-scoped token the Core API issues (Section 8) —
 * purely a signature + claims check, no callback to the Core API. The Core API signs
 * with jjwt's Keys.hmacShaKeyFor, which picks HS256/384/512 based on secret length, so
 * we accept any HMAC algorithm rather than pinning one.
 */
export function verifyCollabToken(token: string, expectedDocumentId: string, secret: string): CollabClaims {
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256", "HS384", "HS512"] });
    if (typeof decoded === "string") {
      throw new CollabTokenError("Malformed token payload");
    }
    payload = decoded;
  } catch (err) {
    throw new CollabTokenError(err instanceof Error ? err.message : "Invalid token");
  }

  if (payload.type !== "collab") {
    throw new CollabTokenError("Not a collab token");
  }
  if (payload.documentId !== expectedDocumentId) {
    throw new CollabTokenError("Token is not scoped to this document");
  }
  if (typeof payload.sub !== "string") {
    throw new CollabTokenError("Missing subject claim");
  }
  const role = payload.role;
  if (role !== "OWNER" && role !== "EDITOR" && role !== "VIEWER") {
    throw new CollabTokenError("Missing or invalid role claim");
  }
  const documentType = payload.documentType;
  if (documentType !== "DOCUMENT" && documentType !== "WHITEBOARD") {
    throw new CollabTokenError("Missing or invalid documentType claim");
  }

  return { userId: payload.sub, documentId: payload.documentId, role, documentType };
}
