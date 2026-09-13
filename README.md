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
- [~] **Phase 5 — Whiteboard mode: backend/protocol only, by deliberate scope decision.**
      Its literal "done" criterion ("two tabs can draw on the same whiteboard live")
      is a UI feature, and no frontend exists yet (that's explicitly Phase 6 scope) —
      building one now would mean bootstrapping a whole Next.js + canvas-library app in
      one uncontrolled jump, so this phase stops at what the backend actually owns:
      - A whiteboard's shared Yjs type is a top-level `Y.Map` keyed by shape id
        (`sync-service/src/rooms/shapes.ts`) rather than the `Y.Text` documents use —
        documented there, including the real limitation that a shape is replaced
        atomically rather than merged property-by-property.
      - The collab-token now carries a `documentType` claim (`DOCUMENT`/`WHITEBOARD`)
        so the sync service knows which shared type a room uses, threaded through
        `getOrCreateRoom` and stored on the `Room` for its lifetime.
      - Restore (Phase 4's feature) is type-aware: `restoreLiveRoom` swaps between the
        text-replace and shape-map-replace paths depending on `room.documentType`.
      - VIEWER-write enforcement (Phase 4) already worked for whiteboards for free,
        since it operates on the generic Yjs sync protocol, not on Y.Text specifically
        — verified by forging a shape write as a VIEWER against a real running relay.
      - A convergence test for shapes (`sync-service/test/convergence.test.ts`) mirrors
        the text one: concurrent shape creation, concurrent edits to the *same* shape,
        a delete-vs-edit race, and a larger randomized multi-client scenario, all
        asserting byte-identical final state across every replica.
      - Verified live end-to-end: created a WHITEBOARD document, drew shapes from a
        real WS client, killed the sync-service process outright and reconnected
        (shapes survived), saved a version, diverged further, and watched a live
        connection's shapes actually change in real time when that version was restored.
      What's genuinely not built: the canvas UI itself (shape rendering, drag/draw
      interactions, a library like tldraw or Fabric.js) — that's Phase 6 territory once
      the frontend exists at all.
- [x] **Phase 6 — Redis presence, rate limiting, observability, CI, deployment.**
      - **Redis-backed presence** (`sync-service/src/presence/redisPresence.ts`): every
        awareness update mirrors into a Redis hash (`presence:{documentId}`, 30s TTL,
        matching y-protocols/awareness's own staleness window) alongside the in-memory
        broadcast that actually drives real-time delivery — best-effort, never blocks on
        Redis being reachable. Verified live: connected a real client, confirmed its
        state landed in Redis with the right TTL, disconnected, confirmed it was removed.
      - **Rate limiting** (`RateLimiter` + `RateLimitFilter`, Core API): a hand-rolled
        sliding-window counter — simple enough that a library would just be indirection —
        on `/api/auth/register` (5/60s), `/api/auth/login` (10/60s, per IP), and document
        creation (30/60s, per authenticated user). Verified live: the 11th login attempt
        within a minute gets a real 429. Concurrency-tested (50 threads hammering one key
        never grants more than the limit). Limits are configurable
        (`cocanvas.rate-limit.*`); the test suite runs with very high limits so ordinary
        functional tests don't trip it, except `RateLimitIntegrationTest`, which
        deliberately overrides them back down in its own isolated Spring context.
      - **Correlation IDs** (`CorrelationIdFilter`, Core API): every request gets an
        `X-Correlation-Id` (generated or client-supplied), in MDC for the console log
        pattern and echoed back in the response. `SyncServiceClient`'s restore push
        carries it forward as a header, and the sync service's structured logs include
        it — a session is traceable across both services, not just within one.
      - **Structured logging** (`sync-service/src/logger.ts`, pino): connection
        join/leave with a running count, snapshot-persist duration and byte size, and
        every error, all as JSON instead of scattered `console.log` lines.
      - **Metrics**: Micrometer + Prometheus on the Core API (`/actuator/prometheus`,
        `permitAll` like health/info since a scraper has no user JWT to present) —
        Spring Boot's auto-instrumented HTTP/JVM/datasource metrics plus three custom
        counters (`cocanvas.auth.login.failures`, `cocanvas.document.creations` tagged
        by type, `cocanvas.versions.restored`). Along the way, learned the hard way that
        Prometheus's naming convention treats a trailing `created`/`count`/`total` in a
        counter name as a reserved OpenMetrics suffix and silently strips the rest
        (`cocanvas.documents.created` exported as bare `cocanvas_documents_total`) —
        renamed to `cocanvas.document.creations` and confirmed the fix live.
      - **Combined CI** (`.github/workflows/combined-integration-ci.yml`): Section 16
        explicitly asks for "a combined job running the convergence test against both
        services running together" — `sync-service/scripts/smoke-test.mjs` automates
        the exact manual flow used to verify every phase of this build (register →
        workspace → document → real WebSocket client → write → disconnect → reconnect →
        content persisted → VIEWER write rejected) against a real `docker compose up`
        stack, and the CI job runs it on every push/PR. Verified locally first, including
        that it actually fails with a clear message against a broken stack, before
        trusting it in CI.
      - **Deployment**: see the section below — Render/Railway or a single VM, per
        Section 16; not actually deployed from here since that needs an external
        platform account this environment doesn't have.
      `frontend/` was still just a folder scaffold at the end of this phase — it was
      never actually in Phase 6's own roadmap text (Section 16 defines "all four
      services" as Core API, sync service, Postgres, Redis).
- [~] **Frontend — document editor UI, by deliberate scope decision.** Section 21's own
      honesty note is explicit: no frontend existed, so nobody could actually open a
      browser and use CoCanvas — every phase above was verified at the protocol/API
      level. This pass builds a real Next.js (App Router, TypeScript) UI covering the
      document editor only, not the whiteboard, per Section 22's explicit permission to
      ship a working document-only editor rather than a half-working doc-plus-whiteboard
      one:
      - Auth pages (register/login/logout), silent session restore on load via the
        httpOnly refresh cookie and `/api/auth/refresh` (no token in `localStorage`).
      - Workspace list + create, workspace member invites; document list + create
        within a workspace.
      - The collaborative editor itself, hand-bound to the Sync Service's actual
        `Y.Text("body")` field rather than routed through TipTap's rich-text
        `Y.XmlFragment` model — see `frontend/README.md` for why: the backend's
        relay/persistence/restore logic (Phases 2-4, already tested) all operate on
        that flat text field, and wiring in a rich editor would create a second,
        disconnected shared type where version restore would silently do nothing
        visible.
      - A hand-rolled Yjs WebSocket provider (`useCollabProvider.ts`), not
        `y-websocket` — the collab-token handoff (Section 8) needs a *fresh*
        60-second-TTL token fetched from the Core API on every reconnect, which
        `y-websocket`'s fixed-connection-params model doesn't support.
      - Presence (avatars + Saved/Connecting/Reconnecting status), share modal
        (OWNER/EDITOR/VIEWER), and a version history panel (save/list/restore) whose
        restore is live — the relay's broadcast pushes the restored content into every
        open tab, not just the one that clicked Restore.
      - Verified live end-to-end in a real browser against the full `docker compose`
        stack: register → create workspace/document → type in one tab → see it appear
        live in a second tab with no refresh → refresh and confirm persistence → save
        and restore a version live → share as VIEWER and confirm the second account
        sees a read-only, disabled editor.
      What's not built: the whiteboard canvas UI (the whiteboard *data layer* — shape
      sync — is already built and tested on the backend; there's nothing to draw with
      yet), inline collaborator cursor rendering inside the text (presence is
      avatars-and-status, not an in-text caret — a native `<textarea>` can't render
      one the way a rich editor can), and a user settings/profile page.

Never claim a later phase or a Tier 3 feature (Section 3) as done until it's actually built
and tested.

## Repository layout

```
core-api/       Java 21 + Spring Boot 3 — auth, workspaces, document metadata, permissions
sync-service/   Node.js + TypeScript — Yjs relay, collab-token auth, snapshot persistence
frontend/       Next.js + TypeScript — auth, workspaces, the collaborative document editor
docker-compose.yml
```

## Running the full stack

```bash
docker compose up --build
```

Brings up Postgres, Redis, the Core API (`:8080`), the sync service (`:4000`), and the
frontend (`:3000`) — open `http://localhost:3000`.

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

Frontend — requires Node 20+, and both backend services running:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev   # http://localhost:3000
```

### Running tests

```bash
cd core-api && mvn test        # Testcontainers spins up a real Postgres — Docker must be running
cd sync-service && npm test    # Vitest, no external services needed
```

### Running the combined end-to-end smoke test

```bash
docker compose up -d --build
node sync-service/scripts/smoke-test.mjs
```

Exercises the full stack over real HTTP + WebSocket calls (Section 16's "combined job");
this is what `.github/workflows/combined-integration-ci.yml` runs on every push/PR.

## Deployment

Not actually deployed from this environment (no external platform account here), but
per Section 16, either of these works for two small services plus Postgres and Redis:

- **Render / Railway free tier**: one web service per `core-api/Dockerfile` and
  `sync-service/Dockerfile`, a managed Postgres and Redis instance each. Set the env
  vars below on each service; point `SYNC_SERVICE_INTERNAL_URL` /
  `CORE_API_INTERNAL_URL` at the other service's internal/private URL if the platform
  provides one, its public URL otherwise.
- **A single small VM**: clone the repo, `docker compose up -d --build` — the compose
  file already wires all four services together with working internal DNS names
  (`postgres`, `redis`, `core-api`, `sync-service`).

Either way, **before deploying anywhere real**, override every `dev-only-*` default:

| Variable | Used by | Must be |
|---|---|---|
| `JWT_SECRET` | both | The same value on both services, ≥32 bytes, unpredictable |
| `INTERNAL_SYNC_SECRET` | both | The same value on both services, unpredictable |
| `DB_PASSWORD` | core-api | A real Postgres password, not `cocanvas` |
| `CORS_ALLOWED_ORIGINS` | core-api | Your actual frontend origin, not `localhost` |

And enforce HTTPS/WSS in front of both services (Section 13) — neither terminates TLS
itself, so that's the load balancer's or platform's job.

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
| `GET /actuator/health` | Liveness/readiness probes |
| `GET /actuator/prometheus` | Prometheus scrape endpoint (`permitAll` — no user JWT for a scraper to present) |

Sync service:

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Health check — reports Redis reachability, not just a static "ok" |
| `WS /sync/{documentId}?token=<collab-token>[&correlationId=...]` | Yjs sync-protocol + awareness relay for one document |
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
- A room's shared Yjs type depends on the document's type, carried in the collab-token's
  `documentType` claim: `Y.Text("body")` for DOCUMENT, a `Y.Map("shapes")` of shape
  records for WHITEBOARD (`sync-service/src/rooms/shapes.ts`) — the relay itself doesn't
  care either way, since the Yjs sync protocol operates on the whole doc's state
  regardless of what shared types live inside it; only restore needs to know which one.
- Not yet done: real update-log compaction (collapsing Yjs's own internal structure, as
  opposed to the Postgres-row compaction Phase 4 already does) — Section 10 point 2,
  still open for a later phase if a long-lived, extremely active document's in-memory
  size ever actually becomes a problem.
