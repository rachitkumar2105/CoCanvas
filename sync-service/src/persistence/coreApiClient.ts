const CORE_API_INTERNAL_URL = process.env.CORE_API_INTERNAL_URL ?? "http://localhost:8080";
const INTERNAL_SECRET =
  process.env.INTERNAL_SYNC_SECRET ?? "dev-only-internal-secret-override-in-every-real-environment";

/**
 * The sync service never talks to Postgres directly (Section 4's architecture split) —
 * it calls back into the Core API's /internal/** endpoints, authenticated with a shared
 * secret rather than a user JWT (this is service-to-service trust, not user identity).
 */
export async function fetchSnapshot(documentId: string): Promise<Uint8Array | null> {
  const res = await fetch(`${CORE_API_INTERNAL_URL}/internal/documents/${documentId}/snapshot`, {
    headers: { "X-Internal-Secret": INTERNAL_SECRET },
  });

  if (res.status === 204) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`fetchSnapshot(${documentId}) failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { state: string };
  return new Uint8Array(Buffer.from(body.state, "base64"));
}

export async function saveSnapshot(documentId: string, state: Uint8Array): Promise<void> {
  const res = await fetch(`${CORE_API_INTERNAL_URL}/internal/documents/${documentId}/snapshot`, {
    method: "POST",
    headers: {
      "X-Internal-Secret": INTERNAL_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: Buffer.from(state).toString("base64") }),
  });

  if (!res.ok) {
    throw new Error(`saveSnapshot(${documentId}) failed: ${res.status} ${await res.text()}`);
  }
}
