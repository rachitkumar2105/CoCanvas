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
- [ ] **Phase 2 — Sync Service skeleton**: Yjs + y-websocket relay, collab-token
      verification, single-client document editing with persistence. `sync-service/` is
      currently just a health-check placeholder.
- [ ] **Phase 3 — Multi-client sync + presence**: convergence test, live cursors.
- [ ] **Phase 4 — Snapshotting + version history + write-permission enforcement.**
- [ ] **Phase 5 — Whiteboard mode.**
- [ ] **Phase 6 — Redis presence, rate limiting, observability, Docker Compose, CI,
      deployment.** `frontend/` is currently just a folder scaffold — see its README.

Never claim a later phase or a Tier 3 feature (Section 3) as done until it's actually built
and tested.

## Repository layout

```
core-api/       Java 21 + Spring Boot 3 — auth, workspaces, document metadata, permissions
sync-service/   Node.js + TypeScript — Yjs relay, presence, snapshot persistence (Phase 2+)
frontend/       React/Next.js shell (Phase 1 follow-up / Phase 5-6)
docker-compose.yml
```

## Running the Core API locally

Requires Java 21, Maven, and a Postgres instance (or Docker for the one below).

```bash
docker compose up postgres -d
cd core-api
mvn spring-boot:run
```

The API listens on `http://localhost:8080`. Health check: `GET /actuator/health`.

### Running tests

```bash
cd core-api
mvn test
```

Integration tests spin up a real Postgres via Testcontainers — Docker must be running.

## API surface (Phase 1)

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

See the blueprint's Section 7 for the full target surface (version history, collab-token
issuance) that later phases add.
