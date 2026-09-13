# CoCanvas Frontend

A Next.js (App Router, TypeScript) UI over the Core API and the Sync Service: auth pages,
a workspace/document dashboard, and a real-time collaborative document editor. This pass
covers the **document editor only** — no whiteboard canvas UI (the blueprint's own honesty
section explicitly allows shipping a working document-only editor over a half-working
doc-plus-whiteboard system; see Section 22).

## Running it

```bash
cp .env.example .env.local   # only needed for `next dev`; docker-compose sets these directly
npm install
npm run dev
```

Or as part of the full stack: `docker compose up -d --build` from the repo root brings this
up alongside `core-api`, `sync-service`, `postgres`, and `redis` on `http://localhost:3000`.

## Why the editor is a plain `<textarea>`, not TipTap

The blueprint's tech stack (Section 5) calls for TipTap + `y-prosemirror` for rich text.
That binding needs a `Y.XmlFragment` — a nested node/mark tree — as the shared Yjs type.
But the Sync Service's relay, persistence, and version-restore logic (built and verified in
Phases 2-4) all operate on a flat `Y.Text` under the fixed key `"body"`
(`roomManager.ts`'s `restoreLiveRoom`, and the Phase 2-4 convergence/smoke tests). Wiring
TipTap's `Collaboration` extension to the same `Y.Doc` would create a second, disconnected
shared type — edits would sync fine between browser tabs (Yjs syncs the whole document's
update stream regardless of field name), but version restore would silently do nothing
visible, since it rewrites `"body"`, not the XML fragment TipTap would actually render from.

Rather than touch the already-tested backend Yjs model to accommodate a richer editor (real
scope creep into re-verifying Phases 2-4), this pass keeps a plain-text editor
(`src/components/Editor.tsx`) hand-bound directly to `Y.Text("body")` via a small
diff-based `<textarea>` binding. It's less visually rich than TipTap, but every guarantee
the backend was built and tested against — convergence, persistence, version restore,
VIEWER-write rejection — applies to exactly what's on screen. Correctness over polish,
consistent with the rest of this project's build discipline.

## Real-time sync: a hand-rolled provider, not `y-websocket`

`src/hooks/useCollabProvider.ts` implements the Yjs sync/awareness wire protocol directly
(same message framing as `sync-service/src/relay.ts` and `roomManager.ts`) rather than using
the `y-websocket` package's `WebsocketProvider`. The reason is the collab-token handoff
(Section 8): the token is scoped to one document and expires in 60 seconds, and a fresh one
must be fetched from the Core API on *every* reconnect — not just the first connection.
`y-websocket` assumes a fixed set of connection params for the life of the provider, which
doesn't fit that model. The hand-rolled provider re-fetches `/api/documents/{id}/collab-token`
before each (re)connect attempt, with exponential backoff on failure.

## What's built

- Register / login / logout, silent session restore via the httpOnly refresh cookie on load
- Workspace list + create, workspace member invites
- Document list + create (document type only) within a workspace
- The collaborative editor: live multi-tab text sync, presence avatars with a
  status indicator (Saved / Connecting / Reconnecting), a save/sync status line
- Share modal (assign OWNER/EDITOR/VIEWER per document)
- Version history panel: save a labeled snapshot, list snapshots, restore one
  (restoring updates the live session for every open tab via the relay's broadcast,
  not just this page)
- VIEWER role is enforced in the UI (textarea disabled, Share hidden) — the real
  enforcement is still server-side, at the relay (Section 10, point 3)

## What's explicitly not built in this pass

- Whiteboard canvas UI (the whiteboard *data layer* — shape sync — is built and tested on
  the backend; there's simply nothing to draw with yet)
- Inline collaborator cursor rendering inside the text (a native `<textarea>` can't render
  a colored caret at another user's position the way a rich editor can) — presence is
  visible as avatars + connection status instead, not as an in-text cursor
- User settings / profile / active-sessions page
