import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyCollabToken, CollabTokenError } from "./auth/collabToken.js";
import {
  addConnection,
  encodeFullAwarenessState,
  getOrCreateRoom,
  removeConnection,
  restoreLiveRoom,
  type Room,
} from "./rooms/roomManager.js";
import { handleMessage, sendSyncStep1 } from "./relay.js";
import { logger, docLogger } from "./logger.js";
import { pingRedis } from "./presence/redisPresence.js";
import { isAllowedOrigin } from "./security/originCheck.js";
import { MessageRateLimiter } from "./security/messageRateLimiter.js";
import { flushAllRooms } from "./rooms/roomManager.js";

// Section 12's backpressure concern: caps on both message size (the ws library enforces
// maxPayload itself, terminating the connection on an oversized frame) and message rate
// per connection (below), so one fast or buggy client can't degrade a shared room for
// everyone else in it.
const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_MESSAGES_PER_SECOND = 50;

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-please-override-in-every-real-environment-32b";
const INTERNAL_SECRET =
  process.env.INTERNAL_SYNC_SECRET ?? "dev-only-internal-secret-override-in-every-real-environment";

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

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

/**
 * Ping/pong heartbeat (Section 1's presence-cleanup gap): a client that vanishes
 * without a clean close — closed laptop, dead WiFi — never fires a `close` event on
 * its own, so its cursor/presence would otherwise stay visible to collaborators
 * indefinitely. Every connection gets pinged on this interval; a missed pong marks it
 * dead and the next tick terminates it, which *does* fire `close` and runs the normal
 * presence-cleanup path.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

type HeartbeatWebSocket = WebSocket & { isAlive?: boolean };

wss.on(
  "connection",
  (
    ws: WebSocket,
    documentId: string,
    role: ReturnType<typeof verifyCollabToken>["role"],
    documentType: ReturnType<typeof verifyCollabToken>["documentType"],
    correlationId: string,
  ) => {
    const log = docLogger(documentId).child({ correlationId });

    // getOrCreateRoom is async (it may hydrate from the Core API), but a client sends
    // its first sync message the instant the connection opens — attaching `message`/
    // `close` listeners only after that await resolves would lose whatever arrives in
    // between. So the listeners go on synchronously, and anything that arrives before
    // the room is ready is queued and replayed once it is.
    let room: Room | null = null;
    const pending: Buffer[] = [];
    const rateLimiter = new MessageRateLimiter(MAX_MESSAGES_PER_SECOND, 1000);

    (ws as HeartbeatWebSocket).isAlive = true;
    ws.on("pong", () => {
      (ws as HeartbeatWebSocket).isAlive = true;
    });

    ws.on("message", (data: Buffer) => {
      // Section 12's backpressure concern: an unbounded fast (or buggy) client shouldn't
      // be able to degrade the room for everyone else in it — silently drop, rather than
      // close the connection, since a transient burst shouldn't cost a full reconnect.
      if (!rateLimiter.tryConsume()) {
        log.warn("message rate limit exceeded, dropping message");
        return;
      }
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
  },
);

server.on("upgrade", (req, socket, head) => {
  // An unchecked Origin lets any website open a WS connection using a victim's own
  // browser session (Section 5's security checklist). A real browser always sends
  // Origin on the handshake; a missing one means a non-browser client (our own
  // scripts, server-to-server), which this check doesn't apply to.
  if (!isAllowedOrigin(req.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

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

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    const ws = client as HeartbeatWebSocket;
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

server.listen(port, () => {
  logger.info({ port }, "sync-service listening");
});

/**
 * Section 12's reliability story: a routine restart/redeploy shouldn't silently lose
 * the last few seconds of edits sitting behind a debounce timer. Stop accepting new
 * work, flush every live room's current state to the Core API, then exit — rather than
 * letting the process die mid-debounce.
 */
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down, flushing pending snapshots");

  clearInterval(heartbeatInterval);
  server.close();
  wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));

  try {
    await flushAllRooms();
    logger.info("all pending snapshots flushed");
  } catch (err) {
    logger.error({ err }, "error flushing snapshots during shutdown");
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
