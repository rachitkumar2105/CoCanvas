import * as Y from "yjs";
import type { WebSocket } from "ws";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { fetchSnapshot, saveSnapshot } from "../persistence/coreApiClient.js";
import type { DocumentRole } from "../auth/collabToken.js";

export const messageSync = 0;
export const messageAwareness = 1;

interface ConnMeta {
  role: DocumentRole;
  /** Awareness client IDs this connection has introduced — cleaned up on disconnect. */
  controlledAwarenessIds: Set<number>;
}

export interface Room {
  documentId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, ConnMeta>;
  persistTimer: NodeJS.Timeout | null;
  /** Guards concurrent hydration so two near-simultaneous first connections don't race. */
  ready: Promise<void>;
}

// Debounce window for periodic snapshotting while a document stays active. Real
// compaction (collapsing the update log, not just re-snapshotting) is Phase 4 work
// (Section 10, point 2) — this alone is what makes "persists across a refresh" true.
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
      console.error(`[room ${room.documentId}] debounced persist failed:`, err);
    });
  }, PERSIST_DEBOUNCE_MS);
}

async function persistNow(room: Room): Promise<void> {
  const state = Y.encodeStateAsUpdate(room.doc);
  await saveSnapshot(room.documentId, state);
}

export async function getOrCreateRoom(documentId: string): Promise<Room> {
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
      console.error(`[room ${documentId}] failed to hydrate from snapshot:`, err);
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
    }
  );

  rooms.set(documentId, room);
  await room.ready;
  return room;
}

export function addConnection(room: Room, ws: WebSocket, role: DocumentRole): void {
  room.conns.set(ws, { role, controlledAwarenessIds: new Set() });
}

export async function removeConnection(room: Room, ws: WebSocket): Promise<void> {
  const meta = room.conns.get(ws);
  room.conns.delete(ws);

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
      console.error(`[room ${room.documentId}] final persist on last disconnect failed:`, err);
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
