import { createClient, type RedisClientType } from "redis";
import { logger } from "../logger.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// Matches y-protocols/awareness's own outdatedTimeout — a client's presence entry
// expires at roughly the same point the in-memory Awareness instance would consider
// it stale, keeping the two representations in sync.
const PRESENCE_TTL_SECONDS = 30;

const client: RedisClientType = createClient({ url: REDIS_URL });
client.on("error", (err) => logger.warn({ err }, "Redis client error"));

let connecting: Promise<void> | null = null;

/**
 * Presence (who's online, cursor position) is intentionally NOT in Postgres — it's
 * ephemeral, high-frequency data that belongs in Redis with a short TTL (Section 6).
 * This mirrors the in-memory y-protocols/awareness state that actually drives the
 * real-time broadcast (roomManager.ts) so presence is inspectable without an active
 * WebSocket connection to this specific instance, and degrades gracefully — a
 * broadcast never blocks on Redis being reachable.
 */
async function ensureConnected(): Promise<void> {
  if (client.isOpen) return;
  if (!connecting) {
    connecting = client.connect().then(
      () => undefined,
      (err) => {
        connecting = null;
        throw err;
      },
    );
  }
  await connecting;
}

export async function pingRedis(): Promise<boolean> {
  try {
    await ensureConnected();
    await client.ping();
    return true;
  } catch (err) {
    logger.warn({ err }, "Redis ping failed");
    return false;
  }
}

function presenceKey(documentId: string): string {
  return `presence:${documentId}`;
}

export async function mirrorPresence(documentId: string, clientId: number, state: unknown): Promise<void> {
  try {
    await ensureConnected();
    const key = presenceKey(documentId);
    await client.hSet(key, String(clientId), JSON.stringify(state));
    await client.expire(key, PRESENCE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, documentId, clientId }, "Failed to mirror presence into Redis");
  }
}

export async function removePresence(documentId: string, clientId: number): Promise<void> {
  try {
    await ensureConnected();
    await client.hDel(presenceKey(documentId), String(clientId));
  } catch (err) {
    logger.warn({ err, documentId, clientId }, "Failed to remove presence from Redis");
  }
}

export async function getPresenceSnapshot(documentId: string): Promise<Record<string, unknown>> {
  await ensureConnected();
  const raw = await client.hGetAll(presenceKey(documentId));
  const result: Record<string, unknown> = {};
  for (const [clientId, json] of Object.entries(raw)) {
    result[clientId] = JSON.parse(json);
  }
  return result;
}
