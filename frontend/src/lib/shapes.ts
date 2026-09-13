import type * as Y from "yjs";

// Mirrors sync-service/src/rooms/shapes.ts exactly — same top-level Y.Map key
// ("shapes") and the same "a shape is a flat, opaque JSON record keyed by id"
// contract. The relay never inspects shape fields, so this type is a frontend-only
// convention, not something the backend validates.
export const SHAPES_KEY = "shapes";

interface ShapeBase {
  id: string;
  x: number;
  y: number;
  color: string;
}

export interface RectangleShape extends ShapeBase {
  type: "rectangle";
  width: number;
  height: number;
}

export interface EllipseShape extends ShapeBase {
  type: "ellipse";
  width: number;
  height: number;
}

export interface StickyShape extends ShapeBase {
  type: "sticky";
  width: number;
  height: number;
  text: string;
}

export interface PathShape extends ShapeBase {
  type: "path";
  // Absolute [x0, y0, x1, y1, ...] points — (x, y) above is just the first point,
  // kept so every shape has a consistent anchor for selection/hit-testing.
  points: number[];
}

export type Shape = RectangleShape | EllipseShape | StickyShape | PathShape;
export type ShapeTool = Shape["type"];

export function getShapesMap(doc: Y.Doc): Y.Map<Shape> {
  return doc.getMap<Shape>(SHAPES_KEY);
}

export const COLORS = ["#F97316", "#3B82F6", "#10B981", "#EC4899", "#8B5CF6", "#111827"];

export function newShapeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `shape-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
