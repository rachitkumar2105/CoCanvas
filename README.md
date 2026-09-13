# CoCanvas

Real-time collaborative document & whiteboard platform — a polyglot system pairing a Java
Spring Boot core API with a Node.js real-time sync service built on Yjs CRDTs. Full design
rationale lives in the original blueprint (architecture, data model, auth, CRDT approach,
scaling plan, security checklist, phased roadmap).

## Build status

This repo is being built phase-by-phase per the blueprint's roadmap (Section 18). Do not
assume anything beyond what's listed as done below actually works.

- [x] **Phase 1 — Core API skeleton**: Postgres + Flyway schema, JWT auth with rotated
      httpOnly refresh cookies, workspaces, document metadata CRUD, per-document RBAC
      (OWNER/EDITOR/VIEWER). Covered by integration tests (Testcontainers) and unit tests.
- [x] **Phase 2 — Sync Service skeleton**: Yjs sync-protocol relay over WebSocket
      (`sync-service/`), collab-token verification, and document persistence via the
      Core API's `/internal/**` endpoints (shared-secret auth, not user JWTs). Verified
      end-to-end through the real `docker compose` stack: editing a document, killing the
      sync-service container, and reconnecting reproduces the exact prior content.
      Covered by Vitest unit tests (token verification, snapshot client, room hydration
      /broadcast/debounce). Live broadcast between concurrently-connected clients already
      works as a side effect of the relay design, though presence/cursors and the
      convergence test are still Phase 3.
- [x] **Phase 3 — Multi-client sync + presence**: awareness protocol wired into the relay
      (`y-protocols/awareness`) — presence updates broadcast to other connections, a
      newly-joining client gets the full current presence snapshot, and a disconnecting
      client's presence is removed for everyone else. Verified live against the real
      server (3 concurrent WS clients), not just unit tests. The convergence test
      (Section 10 / Section 21 — "the single highest-value, most defensible artifact")
      is in `sync-service/test/convergence.test.ts`: 5 simulated clients apply randomized,
      overlapping, delayed/reordered edits to the same shared text, and every replica's
      serialized state is asserted byte-identical afterward, plus dedicated cases for
      out-of-order delivery and same-position concurrent inserts. Rendering live cursors
      in a UI is frontend work (Phase 6) — the relay/protocol side is what's built here.
- [x] **Phase 4 — Snapshotting + version history + write-permission enforcement.**
      VIEWER-write enforcement lives at the relay (`sync-service/src/relay.ts`): a
      VIEWER's own reads are still served, but any message that would mutate the doc is
      dropped before it reaches the shared `Y.Doc` — verified both via unit tests and by
      forging a raw write over the WebSocket protocol against the real running relay and
      confirming it's silently rejected. `document_snapshots`' auto-save row is now
      upserted in place per document (`SnapshotService`) instead of growing one row per
      debounce tick — confirmed at the database level that repeated saves keep exactly
      one auto-save row. Version history is real: `POST/GET .../versions` and
      `.../versions/{id}/restore`, RBAC'd the same way as everything else (VIEWERs can
      read history, not create or restore). Restoring doesn't just rewrite Postgres — the
      Core API best-effort-pushes the restored content into any *live* sync-service
      session too (`SyncServiceClient` → sync-service's own `/internal/.../restore`), so
      someone currently viewing the document sees the restore happen in real time rather
      than only on their next reconnect. Verified live end-to-end through the real
      `docker compose` stack, including catching and fixing a real bug along the way
      (Java's `HttpClient` defaulting to HTTP/2 against a plain HTTP/1.1 Node server,
      which failed silently as "received no bytes" until pinned to HTTP/1.1).
- [ ] **Phase 5 — Whiteboard mode.**
- [ ] **Phase 6 — Redis presence, rate limiting, observability, Docker Compose, CI,
      deployment.** `frontend/` is currently just a folder scaffold — see its README.

Never claim a later phase or a Tier 3 feature (Section 3) as done until it's actually built
and tested.

## Repository layout

```
core-api/       Java 21 + Spring Boot 3 — auth, workspaces, document metadata, permissions
sync-service/   Node.js + TypeScript — Yjs relay, collab-token auth, snapshot persistence
frontend/       React/Next.js shell (Phase 1 follow-up / Phase 5-6)
docker-compose.yml
```

## Running the full stack

```bash
docker compose up --build
```

Brings up Postgres, Redis, the Core API (`:8080`), and the sync service (`:4000`).
`frontend/` isn't wired in yet — see its own README.

### Running each service locally (without Docker)

Core API — requires Java 21 and Maven:

```bash
docker compose up postgres -d
cd core-api
mvn spring-boot:run
```

Sync service — requires Node 20+, and the Core API running (for snapshot persistence):

```bash
cd sync-service
npm install
npm run dev
```

### Running tests

```bash
cd core-api && mvn test        # Testcontainers spins up a real Postgres — Docker must be running
cd sync-service && npm test    # Vitest, no external services needed
```

## API surface

Core API:

| Method & Path | Purpose |
|---|---|
| `POST /api/auth/register` | Create an account |
| `POST /api/auth/login` | Verify credentials, issue access token + refresh cookie |
| `POST /api/auth/refresh` | Rotate refresh token, issue new access token |
| `POST /api/auth/logout` | Revoke refresh token |
| `GET/POST /api/workspaces` | List / create workspaces |
| `POST /api/workspaces/{id}/members` | Invite a member (owner only) |
| `GET/POST /api/workspaces/{id}/documents` | List / create documents in a workspace |
| `GET /api/documents/{id}` | Fetch a document (requires a permission entry) |
| `PATCH /api/documents/{id}` | Rename a document (OWNER/EDITOR only) |
| `POST /api/documents/{id}/share` | Set a user's document role (OWNER only) |
| `POST /api/documents/{id}/collab-token` | Exchange the access token for a 60s document-scoped token the sync service verifies independently (Section 8) |
| `GET /api/documents/{id}/versions` | List saved versions (any role with access) |
| `POST /api/documents/{id}/versions` | Save the current state as a named version (OWNER/EDITOR; 409 if the document has no content yet) |
| `POST /api/documents/{id}/versions/{versionId}/restore` | Restore a version — updates Postgres and best-effort-pushes into any live session (OWNER/EDITOR) |
| `GET/POST /internal/documents/{id}/snapshot` | Sync-service-only, guarded by `X-Internal-Secret` — read/write the current auto-save Yjs state |

Sync service:

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Health check |
| `WS /sync/{documentId}?token=<collab-token>` | Yjs sync-protocol + awareness relay for one document |
| `POST /internal/documents/{id}/restore` | Core-API-only, guarded by `X-Internal-Secret` — pushes a restored version into the live in-memory session if the document is currently loaded |

See the blueprint's Section 7 for the full target surface (e.g. Section 14's share modal
UI, which is frontend work).

## How the sync service actually works

- The frontend (once built) calls `POST /api/documents/{id}/collab-token` before opening a
  WebSocket, then connects to `ws://sync-service/sync/{id}?token=<that token>`.
- The sync service verifies the token's signature and `documentId` claim itself — no
  callback to the Core API on that hot path (Section 8).
- Each document gets an in-memory `Y.Doc` ("room") plus a `y-protocols/awareness` instance
  for presence. On first use the doc hydrates from the Core API's
  `/internal/documents/{id}/snapshot` (falling back to an empty doc); edits broadcast to
  other connections on the same document and debounce-persist back to the same endpoint
  every 3s of activity, plus immediately when the last connection disconnects.
- Presence (cursor position, name, color — whatever the frontend puts in its local
  awareness state) works the same way: a connection's awareness update broadcasts to
  everyone else in the room, a newly-joining connection gets the full current snapshot of
  everyone already present, and a disconnecting connection's presence is explicitly
  removed for the others rather than left stale.
- `/internal/**` is authenticated with a shared secret (`INTERNAL_SYNC_SECRET`) in both
  directions — sync service → Core API for snapshots, Core API → sync service for
  restore pushes — never a user JWT, since this is service-to-service trust.
- A VIEWER's messages are still processed for reads (they get synced content, see
  presence, everything Section 3 says a viewer should see) but any message that would
  mutate the doc is dropped at the relay (`sync-service/src/relay.ts`) before it ever
  reaches the shared `Y.Doc` — enforced independently of whatever the frontend's UI
  happens to allow.
- Not yet done: real update-log compaction (collapsing Yjs's own internal structure, as
  opposed to the Postgres-row compaction Phase 4 already does) — Section 10 point 2,
  still open for a later phase if a long-lived, extremely active document's in-memory
  size ever actually becomes a problem.
