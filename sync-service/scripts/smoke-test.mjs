#!/usr/bin/env node
/**
 * Combined end-to-end smoke test across both services (Section 16: "a combined job
 * running the convergence test against both services running together"). Run against
 * a live docker-compose stack (or any Core API + sync service pair) — CI's
 * combined-integration job runs this after `docker compose up`.
 *
 * Exercises: register -> workspace -> document -> collab-token -> real Yjs WebSocket
 * client -> write -> disconnect -> reconnect -> content persisted -> VIEWER write
 * rejected at the relay. Exits non-zero with a clear message on any failure.
 */
import WebSocket from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const CORE_API_URL = process.env.CORE_API_URL ?? "http://localhost:8080";
const SYNC_SERVICE_URL = process.env.SYNC_SERVICE_URL ?? "http://localhost:4000";
const SYNC_SERVICE_WS_URL = process.env.SYNC_SERVICE_WS_URL ?? "ws://localhost:4000";

const messageSync = 0;

function log(step) {
  console.log(`[smoke-test] ${step}`);
}

function fail(step, detail) {
  console.error(`[smoke-test] FAILED at: ${step}`);
  if (detail) console.error(detail);
  process.exit(1);
}

async function waitForHealth(url, name, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`waiting for ${name} to become healthy at ${url}`);
}

async function api(method, path, token, body) {
  const res = await fetch(`${CORE_API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text}`);
  }
  return json;
}

/** A minimal real Yjs client speaking the sync protocol over WebSocket. */
function connectClient(documentId, token) {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const ws = new WebSocket(`${SYNC_SERVICE_WS_URL}/sync/${documentId}?token=${token}`);
    let settled = false;

    function send(encoder) {
      if (ws.readyState === ws.OPEN) ws.send(encoding.toUint8Array(encoder));
    }

    ws.on("open", () => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, messageSync);
      syncProtocol.writeSyncStep1(e, doc);
      send(e);
    });

    ws.on("message", (data) => {
      const d = decoding.createDecoder(new Uint8Array(data));
      const t = decoding.readVarUint(d);
      if (t === messageSync) {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, messageSync);
        syncProtocol.readSyncMessage(d, e, doc, "server");
        if (encoding.length(e) > 1) send(e);
      }
      if (!settled) {
        settled = true;
        resolve({ doc, ws, send });
      }
    });

    ws.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("WebSocket handshake timed out"));
      }
    }, 5000);
  });
}

function writeText(client, text) {
  return new Promise((resolve) => {
    client.doc.on("update", function handler(update, origin) {
      if (origin === "server") return;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, messageSync);
      syncProtocol.writeUpdate(e, update);
      client.send(e);
      client.doc.off("update", handler);
      setTimeout(resolve, 300); // give the relay a moment to process/broadcast/persist
    });
    client.doc.getText("body").insert(0, text);
  });
}

async function main() {
  log("waiting for core-api health");
  await waitForHealth(`${CORE_API_URL}/actuator/health`, "core-api");
  log("waiting for sync-service health");
  await waitForHealth(`${SYNC_SERVICE_URL}/healthz`, "sync-service");

  const suffix = Date.now();
  log("registering owner + viewer");
  const owner = await api("POST", "/api/auth/register", null, {
    name: "Smoke Owner",
    email: `smoke-owner-${suffix}@example.com`,
    password: "correct-horse-battery",
  });
  const viewer = await api("POST", "/api/auth/register", null, {
    name: "Smoke Viewer",
    email: `smoke-viewer-${suffix}@example.com`,
    password: "correct-horse-battery",
  });

  log("creating workspace + document");
  const workspace = await api("POST", "/api/workspaces", owner.accessToken, { name: "Smoke Workspace" });
  const document = await api("POST", `/api/workspaces/${workspace.id}/documents`, owner.accessToken, {
    title: "Smoke Document",
    type: "DOCUMENT",
  });

  await api("POST", `/api/documents/${document.id}/share`, owner.accessToken, {
    email: viewer.email,
    role: "VIEWER",
  });

  log("connecting owner over WebSocket and writing content");
  const ownerCollab = await api("POST", `/api/documents/${document.id}/collab-token`, owner.accessToken);
  const ownerClient = await connectClient(document.id, ownerCollab.token);
  await writeText(ownerClient, "Hello from the combined smoke test");
  const writtenText = ownerClient.doc.getText("body").toString();
  if (writtenText !== "Hello from the combined smoke test") {
    fail("owner write", `expected written text, got: ${JSON.stringify(writtenText)}`);
  }
  ownerClient.ws.close();
  await new Promise((r) => setTimeout(r, 500)); // let the relay persist on disconnect

  log("reconnecting as a fresh client and verifying content persisted");
  const ownerCollab2 = await api("POST", `/api/documents/${document.id}/collab-token`, owner.accessToken);
  const reconnected = await connectClient(document.id, ownerCollab2.token);
  await new Promise((r) => setTimeout(r, 500));
  const persistedText = reconnected.doc.getText("body").toString();
  if (persistedText !== "Hello from the combined smoke test") {
    fail("persistence check", `expected persisted text, got: ${JSON.stringify(persistedText)}`);
  }

  log("verifying a VIEWER's write is rejected at the relay");
  const viewerCollab = await api("POST", `/api/documents/${document.id}/collab-token`, viewer.accessToken);
  const viewerClient = await connectClient(document.id, viewerCollab.token);
  await new Promise((r) => setTimeout(r, 300));

  const scratch = new Y.Doc();
  scratch.getText("body").insert(0, "FORGED VIEWER WRITE");
  const forgedUpdate = Y.encodeStateAsUpdate(scratch);
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, messageSync);
  syncProtocol.writeUpdate(e, forgedUpdate);
  viewerClient.send(e);
  await new Promise((r) => setTimeout(r, 500));

  const finalText = reconnected.doc.getText("body").toString();
  if (finalText.includes("FORGED")) {
    fail("VIEWER write enforcement", `viewer's forged write was applied: ${JSON.stringify(finalText)}`);
  }

  reconnected.ws.close();
  viewerClient.ws.close();

  log("ALL CHECKS PASSED");
  process.exit(0);
}

main().catch((err) => fail("unhandled error", err.stack ?? String(err)));
