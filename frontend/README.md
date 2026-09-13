# CoCanvas Frontend

A Next.js (App Router, TypeScript) UI over the Core API and the Sync Service: auth pages,
a workspace/document dashboard, a real-time collaborative document editor, and a
real-time collaborative whiteboard.

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

## The whiteboard: a hand-rolled SVG canvas, not tldraw/Fabric.js

Section 5's tech stack suggests tldraw or a Yjs-bound Fabric.js canvas. Both have their own
internal document schemas that don't map cleanly onto the backend's actual shape model — a
flat, opaque JSON record per shape in a top-level `Y.Map` keyed by id
(`sync-service/src/rooms/shapes.ts`), with no nested per-property CRDT merging (an edit
replaces a shape atomically). Bridging either library's schema onto that model is real
adapter work for a library that would then fight the underlying data structure, rather than
the TipTap situation where the library actively assumed a *different* Yjs type existed.
Given that, `src/components/Whiteboard.tsx` is a small hand-rolled SVG canvas — rectangles,
ellipses, sticky notes, and freehand paths, each stored exactly as `shapes.ts` describes them
— which keeps the frontend's shape schema and the tested backend's shape schema identical
instead of introducing a translation layer.

Unlike the text editor, the whiteboard *does* render other collaborators' live cursors as
colored dots (via the same awareness channel, with a `cursor: {x, y}` field) — a canvas is
just coordinates, so this doesn't have the "can't render a caret inside a native textarea"
problem the document editor has.

## What's built

- Register / login / logout, silent session restore via the httpOnly refresh cookie on load
- Workspace list + create, workspace member invites
- Document list + create (either document type) within a workspace
- The collaborative document editor: live multi-tab text sync, presence avatars with a
  status indicator (Saved / Connecting / Reconnecting), a save/sync status line
- The collaborative whiteboard: rectangle/ellipse/sticky-note/freehand tools, per-shape
  color, select/move/delete, live multi-tab shape sync, and live collaborator cursor dots
- Share modal (assign OWNER/EDITOR/VIEWER per document — works the same for both types)
- Version history panel: save a labeled snapshot, list snapshots, restore one
  (restoring updates the live session for every open tab via the relay's broadcast,
  not just this page) — works for whiteboards too, since it's generic on document id
- VIEWER role is enforced in the UI (editor/canvas disabled, Share hidden) — the real
  enforcement is still server-side, at the relay (Section 10, point 3)

## What's explicitly not built

- Inline collaborator cursor rendering inside the *text* editor (a native `<textarea>`
  can't render a colored caret at another user's position the way a rich editor can) —
  presence is visible there as avatars + connection status instead
- Shape resize handles (move and delete are implemented; resizing an existing shape isn't)
- Pan/zoom on the whiteboard — it's a large (2400×1400) scrollable canvas instead
- User settings / profile / active-sessions page
