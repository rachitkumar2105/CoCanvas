import * as Y from "yjs";
import type { WebSocket } from "ws";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { fetchSnapshot, saveSnapshot } from "../persistence/coreApiClient.js";
import type { DocumentRole, DocumentType } from "../auth/collabToken.js";
import { getShapesMap } from "./shapes.js";
import { mirrorPresence, removePresence } from "../presence/redisPresence.js";
import { docLogger } from "../logger.js";

export const messageSync = 0;
export const messageAwareness = 1;

interface ConnMeta {
  role: DocumentRole;
  /** Awareness client IDs this connection has introduced — cleaned up on disconnect. */
  controlledAwarenessIds: Set<number>;
}

export interface Room {
  documentId: string;
  /** Fixed for the room's lifetime — set from whichever connection creates it (Section 5). */
  documentType: DocumentType;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, ConnMeta>;
  persistTimer: NodeJS.Timeout | null;
  /** Guards concurrent hydration so two near-simultaneous first connections don't race. */
  ready: Promise<void>;
}

// Debounce window for periodic snapshotting while a document stays active. The Core
// API upserts this into a single per-document "auto-save" row rather than growing a
// new one per tick (Section 10 point 2 / Section 11's compaction concern) — bounding
// storage is the Core API's job since it owns Postgres.
const PERSIST_DEBOUNCE_MS = 3000;

const rooms = new Map<string, Room>();

function isWebSocketOrigin(origin: unknown): origin is WebSocket {
  return typeof origin === "object" && origin !== null && typeof (origin as WebSocket).send === "function";
}

function sendTo(conn: WebSocket, payload: Uint8Array) {
  if (conn.readyState === conn.OPEN) {
    conn.send(payload);
  }
}

function broadcastUpdate(room: Room, update: Uint8Array, origin: WebSocket | null) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  encoding.writeVarUint(encoder, 2 /* messageYjsUpdate */);
  encoding.writeVarUint8Array(encoder, update);
  const payload = encoding.toUint8Array(encoder);

  for (const [conn] of room.conns) {
    if (conn !== origin) {
      sendTo(conn, payload);
    }
  }
}

function broadcastAwarenessUpdate(room: Room, changedClients: number[], origin: WebSocket | null) {
  if (changedClients.length === 0) {
    return;
  }
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedClients));
  const payload = encoding.toUint8Array(encoder);

  for (const [conn] of room.conns) {
    if (conn !== origin) {
      sendTo(conn, payload);
    }
  }
}

function schedulePersist(room: Room) {
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
  }
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    persistNow(room).catch((err) => {
      docLogger(room.documentId).error({ err }, "debounced persist failed");
    });
  }, PERSIST_DEBOUNCE_MS);
}

async function persistNow(room: Room): Promise<void> {
  const state = Y.encodeStateAsUpdate(room.doc);
  const startedAt = performance.now();
  await saveSnapshot(room.documentId, state);
  docLogger(room.documentId).info(
    { durationMs: Math.round(performance.now() - startedAt), bytes: state.byteLength },
    "snapshot persisted"
  );
}

export async function getOrCreateRoom(documentId: string, documentType: DocumentType): Promise<Room> {
  const existing = rooms.get(documentId);
  if (existing) {
    await existing.ready;
    return existing;
  }

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  // The Awareness constructor gives the server's own doc.clientID a local state of
  // `{}` — clear it so the server itself never shows up as a phantom participant.
  awareness.setLocalState(null);

  const room: Room = {
    documentId,
    documentType,
    doc,
    awareness,
    conns: new Map(),
    persistTimer: null,
    ready: Promise.resolve(),
  };

  room.ready = fetchSnapshot(documentId)
    .then((snapshot) => {
      if (snapshot) {
        Y.applyUpdate(doc, snapshot, "hydrate");
      }
    })
    .catch((err) => {
      docLogger(documentId).error({ err }, "failed to hydrate from snapshot");
    });

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    broadcastUpdate(room, update, isWebSocketOrigin(origin) ? origin : null);
    if (origin !== "hydrate") {
      schedulePersist(room);
    }
  });

  awareness.on(
    "update",
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const originConn = isWebSocketOrigin(origin) ? origin : null;
      if (originConn) {
        const meta = room.conns.get(originConn);
        if (meta) {
          for (const id of added) meta.controlledAwarenessIds.add(id);
          for (const id of removed) meta.controlledAwarenessIds.delete(id);
        }
      }
      broadcastAwarenessUpdate(room, [...added, ...updated, ...removed], originConn);

      // Mirror into Redis (Section 6: presence is ephemeral, short-TTL data, not a
      // durable table) — best-effort, never blocks the real-time broadcast above.
      for (const id of [...added, ...updated]) {
        const state = room.awareness.getStates().get(id);
        if (state) {
          void mirrorPresence(room.documentId, id, state);
        }
      }
      for (const id of removed) {
        void removePresence(room.documentId, id);
      }
    }
  );

  rooms.set(documentId, room);
  await room.ready;
  return room;
}

export function addConnection(room: Room, ws: WebSocket, role: DocumentRole): void {
  room.conns.set(ws, { role, controlledAwarenessIds: new Set() });
  docLogger(room.documentId).info({ role, activeConnections: room.conns.size }, "connection joined");
}

export async function removeConnection(room: Room, ws: WebSocket): Promise<void> {
  const meta = room.conns.get(ws);
  room.conns.delete(ws);
  docLogger(room.documentId).info({ activeConnections: room.conns.size }, "connection left");

  if (meta && meta.controlledAwarenessIds.size > 0) {
    awarenessProtocol.removeAwarenessStates(room.awareness, [...meta.controlledAwarenessIds], "connection closed");
  }

  if (room.conns.size === 0) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
    try {
      await persistNow(room);
    } catch (err) {
      docLogger(room.documentId).error({ err }, "final persist on last disconnect failed");
    }
    // Only tear down if nobody reconnected while the final persist was in flight.
    if (room.conns.size === 0) {
      room.doc.destroy();
      rooms.delete(room.documentId);
    }
  }
}

export function getConnRole(room: Room, ws: WebSocket): DocumentRole | undefined {
  return room.conns.get(ws)?.role;
}

export function applyAwarenessUpdate(room: Room, ws: WebSocket, update: Uint8Array): void {
  awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
}

/**
 * Applies a "restore to an earlier version" (Section 7's versions/{id}/restore) to
 * whichever room is currently live in memory for this document, if any. Plain
 * Y.applyUpdate can't express "go back" — CRDT merges are monotonic, so replaying an
 * old state's update onto a doc that has since diverged just no-ops. Instead this
 * expresses the restore as a genuine new edit (delete everything, insert the restored
 * content) that broadcasts and persists through the normal doc.on('update') path.
 *
 * Returns false if the document isn't currently loaded in memory — in that case the
 * Core API's own Postgres write is what future connections will hydrate from, and
 * there's nothing live to update here.
 */
export function restoreLiveRoom(documentId: string, restoredState: Uint8Array): boolean {
  const room = rooms.get(documentId);
  if (!room) {
    return false;
  }

  const temp = new Y.Doc();
  Y.applyUpdate(temp, restoredState);

  if (room.documentType === "WHITEBOARD") {
    const restoredShapes = getShapesMap(temp);
    room.doc.transact(() => {
      const shapes = getShapesMap(room.doc);
      shapes.clear();
      restoredShapes.forEach((shape, id) => shapes.set(id, shape));
    }, "restore");
  } else {
    const restoredText = temp.getText("body").toString();
    room.doc.transact(() => {
      const text = room.doc.getText("body");
      text.delete(0, text.length);
      text.insert(0, restoredText);
    }, "restore");
  }

  temp.destroy();
  return true;
}

/** Full current awareness snapshot, sent to a client right after it joins. */
export function encodeFullAwarenessState(room: Room): Uint8Array | null {
  const clientIds = [...room.awareness.getStates().keys()];
  if (clientIds.length === 0) {
    return null;
  }
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, clientIds));
  return encoding.toUint8Array(encoder);
}

export function _roomsForTesting() {
  return rooms;
}
