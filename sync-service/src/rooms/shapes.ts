import type * as Y from "yjs";

/**
 * Whiteboard shape data model (Phase 5, Section 5's "Yjs-bound canvas"). Each shape is
 * one entry in a top-level Y.Map, keyed by shape id — so two clients creating or
 * deleting different shapes concurrently never conflict (per-key CRDT), and two
 * clients editing the SAME shape concurrently resolve via Yjs's normal last-write-wins
 * semantics on that key, exactly as if it were any other Y.Map entry.
 *
 * A shape is stored as a plain JSON-serializable record rather than a nested Y.Map,
 * which means an edit replaces the whole shape atomically (no finer-grained merge of
 * individual properties like x/y while two people drag the same shape at once). That's
 * a real, documented limitation — real-time drag-preview smoothness would want nested
 * Y.Maps per property — but it's the right level of granularity for what's actually
 * built here (no rendering canvas yet, Phase 6), and correctness (convergence) holds
 * either way since Y.Map guarantees a single deterministic winner per key regardless.
 */
export const SHAPES_KEY = "shapes";

export interface Shape {
  id: string;
  type: string;
  x: number;
  y: number;
  [property: string]: unknown;
}

export function getShapesMap(doc: Y.Doc): Y.Map<Shape> {
  return doc.getMap<Shape>(SHAPES_KEY);
}
