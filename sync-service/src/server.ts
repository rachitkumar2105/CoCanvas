import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyCollabToken, CollabTokenError } from "./auth/collabToken.js";
import { addConnection, encodeFullAwarenessState, getOrCreateRoom, removeConnection, restoreLiveRoom, type Room } from "./rooms/roomManager.js";
import { handleMessage, sendSyncStep1 } from "./relay.js";
import { logger, docLogger } from "./logger.js";
import { pingRedis } from "./presence/redisPresence.js";

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-please-override-in-every-real-environment-32b";
const INTERNAL_SECRET = process.env.INTERNAL_SYNC_SECRET ?? "dev-only-internal-secret-override-in-every-real-environment";

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    // Section 12: check the dependency this service actually has (Redis, for
    // presence) rather than just returning a static "ok" — a real readiness signal.
    pingRedis().then((redisOk) => {
      res.writeHead(redisOk ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: redisOk ? "ok" : "degraded", service: "sync-service", redis: redisOk }));
    });
    return;
  }

  // Called only by the Core API (Section 7's restore endpoint), guarded by the same
  // shared secret the sync service itself presents when calling the Core API's
  // /internal/** — service-to-service trust in both directions, never a user JWT.
  const restoreMatch = req.method === "POST" && req.url?.match(/^\/internal\/documents\/([^/]+)\/restore$/);
  if (restoreMatch) {
    if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "FORBIDDEN" }));
      return;
    }

    const documentId = decodeURIComponent(restoreMatch[1]);
    const correlationId = (req.headers["x-correlation-id"] as string) || randomUUID();
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { state } = JSON.parse(body) as { state: string };
        const applied = restoreLiveRoom(documentId, new Uint8Array(Buffer.from(state, "base64")));
        docLogger(documentId).info({ correlationId, appliedToLiveSession: applied }, "restore applied");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ appliedToLiveSession: applied }));
      } catch (err) {
        docLogger(documentId).error({ correlationId, err }, "restore failed");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "BAD_REQUEST" }));
      }
    });
    return;
  }

  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (
  ws: WebSocket,
  documentId: string,
  role: ReturnType<typeof verifyCollabToken>["role"],
  documentType: ReturnType<typeof verifyCollabToken>["documentType"],
  correlationId: string
) => {
  const log = docLogger(documentId).child({ correlationId });

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
      log.error({ err }, "error persisting on disconnect");
    });
  });

  ws.on("error", (err) => {
    log.error({ err }, "websocket error");
  });

  getOrCreateRoom(documentId, documentType)
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
      log.error({ err }, "failed to join room");
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
  // A client that captured the Core API's X-Correlation-Id response header can carry
  // it forward here to trace a session across both services (Section 12); otherwise
  // each connection just gets its own.
  const correlationId = url.searchParams.get("correlationId") ?? randomUUID();

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
    wss.emit("connection", ws, documentId, claims.role, claims.documentType, correlationId);
  });
});

server.listen(port, () => {
  logger.info({ port }, "sync-service listening");
});
