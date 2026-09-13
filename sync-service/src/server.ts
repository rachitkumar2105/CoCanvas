import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { verifyCollabToken, CollabTokenError } from "./auth/collabToken.js";
import {
  addConnection,
  applyAwarenessUpdate,
  encodeFullAwarenessState,
  getOrCreateRoom,
  messageAwareness,
  messageSync,
  removeConnection,
  type Room,
} from "./rooms/roomManager.js";

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-please-override-in-every-real-environment-32b";

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "sync-service" }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

function sendSyncStep1(ws: WebSocket, room: Room) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  ws.send(encoding.toUint8Array(encoder));
}

function handleMessage(room: Room, ws: WebSocket, data: Buffer) {
  const decoder = decoding.createDecoder(new Uint8Array(data));
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case messageSync: {
      const encoder = encoding.createEncoder();
      // TODO(Phase 4, Section 10 point 3): reject write-carrying sub-messages
      // (syncStep2 / update) from VIEWER-role connections here. Deferred so Phase 2
      // stayed scoped to single-client sync + persistence, per the build roadmap.
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder));
      }
      break;
    }
    case messageAwareness: {
      const update = decoding.readVarUint8Array(decoder);
      applyAwarenessUpdate(room, ws, update);
      break;
    }
    default:
      break;
  }
}

wss.on("connection", (ws: WebSocket, documentId: string, role: ReturnType<typeof verifyCollabToken>["role"]) => {
  // getOrCreateRoom is async (it may hydrate from the Core API), but a client sends
  // its first sync message the instant the connection opens — attaching `message`/
  // `close` listeners only after that await resolves would lose whatever arrives in
  // between. So the listeners go on synchronously, and anything that arrives before
  // the room is ready is queued and replayed once it is.
  let room: Room | null = null;
  const pending: Buffer[] = [];

  ws.on("message", (data: Buffer) => {
    if (!room) {
      pending.push(data);
      return;
    }
    handleMessage(room, ws, data);
  });

  ws.on("close", () => {
    if (!room) {
      return;
    }
    removeConnection(room, ws).catch((err) => {
      console.error(`[document ${documentId}] error persisting on disconnect:`, err);
    });
  });

  ws.on("error", (err) => {
    console.error(`[document ${documentId}] websocket error:`, err);
  });

  getOrCreateRoom(documentId)
    .then((r) => {
      room = r;
      addConnection(room, ws, role);
      sendSyncStep1(ws, room);
      const awarenessState = encodeFullAwarenessState(room);
      if (awarenessState) {
        ws.send(awarenessState);
      }
      for (const data of pending) {
        handleMessage(room, ws, data);
      }
      pending.length = 0;
    })
    .catch((err) => {
      console.error(`[document ${documentId}] failed to join room:`, err);
      ws.close(1011, "Failed to join document room");
    });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://internal");
  const match = url.pathname.match(/^\/sync\/([^/]+)$/);
  const token = url.searchParams.get("token");

  if (!match || !token) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const documentId = decodeURIComponent(match[1]);

  let claims;
  try {
    claims = verifyCollabToken(token, documentId, JWT_SECRET);
  } catch (err) {
    const message = err instanceof CollabTokenError ? err.message : "Unauthorized";
    socket.write(`HTTP/1.1 401 Unauthorized\r\n\r\n${message}`);
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, documentId, claims.role);
  });
});

server.listen(port, () => {
  console.log(`sync-service listening on :${port}`);
});
