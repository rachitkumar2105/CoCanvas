import express from "express";

/**
 * Placeholder entry point for the Realtime Sync Service (Section 4/9 of the blueprint).
 * Phase 2 replaces this with the Yjs + y-websocket relay, collab-token verification
 * (auth/), per-document Yjs room state (rooms/), debounced snapshot persistence
 * (persistence/), and Redis-backed presence (presence/).
 */
const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "sync-service", phase: "1-placeholder" });
});

app.listen(port, () => {
  console.log(`sync-service placeholder listening on :${port}`);
});
