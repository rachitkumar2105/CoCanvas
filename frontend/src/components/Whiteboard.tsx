"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import type { CollabProvider } from "@/hooks/useCollabProvider";
import { colorForUser } from "@/lib/collaboratorColor";
import { COLORS, getShapesMap, newShapeId, type Shape, type ShapeTool } from "@/lib/shapes";

const CANVAS_WIDTH = 2400;
const CANVAS_HEIGHT = 1400;
const MIN_DRAG_SIZE = 4;

interface Point {
  x: number;
  y: number;
}

interface CursorState {
  user?: { name: string; color: string };
  cursor?: Point;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathBounds(points: number[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function Whiteboard({
  doc,
  provider,
  userId,
  userName,
  editable,
}: {
  doc: Y.Doc;
  provider: CollabProvider;
  userId: string;
  userName: string;
  editable: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<"select" | ShapeTool>("select");
  const [color, setColor] = useState(COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [collaborators, setCollaborators] = useState<Map<number, CursorState>>(new Map());

  const dragRef = useRef<{ id: string; origin: Shape; start: Point } | null>(null);
  const lastCursorSentRef = useRef(0);

  const shapesMap = getShapesMap(doc);

  // Presence: same "user" field the document editor sets, plus a "cursor" field the
  // document editor has no equivalent of — a native <textarea> can't render another
  // person's caret, but a canvas is just x/y, so live cursor dots are cheap here.
  useEffect(() => {
    provider.awareness.setLocalStateField("user", { name: userName, color: colorForUser(userId) });
  }, [provider, userId, userName]);

  useEffect(() => {
    const update = () => {
      const next = new Map<number, CursorState>();
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID) return;
        next.set(clientId, state as CursorState);
      });
      setCollaborators(next);
    };
    update();
    provider.awareness.on("change", update);
    return () => provider.awareness.off("change", update);
  }, [provider, doc]);

  useEffect(() => {
    const sync = () => setShapes(Array.from(shapesMap.values()));
    sync();
    shapesMap.observe(sync);
    return () => shapesMap.unobserve(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const getPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const commitShape = useCallback(
    (shape: Shape) => {
      shapesMap.set(shape.id, shape);
    },
    [shapesMap],
  );

  const updateShape = useCallback(
    (id: string, patch: Partial<Shape>) => {
      const current = shapesMap.get(id);
      if (!current) return;
      shapesMap.set(id, { ...current, ...patch } as Shape);
    },
    [shapesMap],
  );

  const deleteShape = useCallback(
    (id: string) => {
      shapesMap.delete(id);
      setSelectedId((sel) => (sel === id ? null : sel));
    },
    [shapesMap],
  );

  // Delete/Backspace removes the selected shape, unless focus is inside the sticky
  // text overlay (where Backspace should delete a character, not the whole note).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!editable || !selectedId || editingId) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
        e.preventDefault();
        deleteShape(selectedId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editable, selectedId, editingId, deleteShape]);

  const broadcastCursor = useCallback(
    (point: Point) => {
      const now = performance.now();
      if (now - lastCursorSentRef.current < 40) return;
      lastCursorSentRef.current = now;
      provider.awareness.setLocalStateField("cursor", point);
    },
    [provider],
  );

  const handlePointerDownCanvas = (e: React.PointerEvent<SVGSVGElement>) => {
    const point = getPoint(e);
    if (tool === "select") {
      setSelectedId(null);
      return;
    }
    if (!editable) return;

    if (tool === "sticky") {
      const shape: Shape = {
        id: newShapeId(),
        type: "sticky",
        x: point.x - 100,
        y: point.y - 75,
        width: 200,
        height: 150,
        color,
        text: "",
      };
      commitShape(shape);
      setSelectedId(shape.id);
      setEditingId(shape.id);
      return;
    }

    if (tool === "path") {
      setDraft({ id: newShapeId(), type: "path", x: point.x, y: point.y, color, points: [point.x, point.y] });
      return;
    }

    // rectangle / ellipse
    setDraft({ id: newShapeId(), type: tool, x: point.x, y: point.y, width: 0, height: 0, color });
  };

  const handlePointerMoveCanvas = (e: React.PointerEvent<SVGSVGElement>) => {
    const point = getPoint(e);
    broadcastCursor(point);

    if (dragRef.current) {
      const { id, origin, start } = dragRef.current;
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      if (origin.type === "path") {
        const shifted: number[] = [];
        for (let i = 0; i < origin.points.length; i += 2) {
          shifted.push(origin.points[i] + dx, origin.points[i + 1] + dy);
        }
        updateShape(id, { x: origin.x + dx, y: origin.y + dy, points: shifted });
      } else {
        updateShape(id, { x: origin.x + dx, y: origin.y + dy });
      }
      return;
    }

    if (!draft) return;
    if (draft.type === "path") {
      setDraft({ ...draft, points: [...draft.points, point.x, point.y] });
    } else {
      const x = Math.min(draft.x, point.x);
      const y = Math.min(draft.y, point.y);
      const width = Math.abs(point.x - draft.x);
      const height = Math.abs(point.y - draft.y);
      setDraft({ ...draft, x, y, width, height });
    }
  };

  const handlePointerUpCanvas = () => {
    if (dragRef.current) {
      dragRef.current = null;
      return;
    }
    if (!draft) return;

    if (draft.type === "path") {
      if (draft.points.length >= 4) commitShape(draft);
    } else if (draft.width >= MIN_DRAG_SIZE && draft.height >= MIN_DRAG_SIZE) {
      commitShape(draft);
      setSelectedId(draft.id);
    }
    setDraft(null);
  };

  const startDragShape = (e: React.PointerEvent, shape: Shape) => {
    e.stopPropagation();
    if (tool !== "select") return;
    setSelectedId(shape.id);
    if (!editable) return;
    dragRef.current = { id: shape.id, origin: shape, start: getPoint(e) };
  };

  const renderShape = (shape: Shape) => {
    const isSelected = shape.id === selectedId;
    switch (shape.type) {
      case "rectangle":
        return (
          <rect
            key={shape.id}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            fill={shape.color}
            fillOpacity={0.25}
            stroke={shape.color}
            strokeWidth={2}
            onPointerDown={(e) => startDragShape(e, shape)}
          />
        );
      case "ellipse":
        return (
          <ellipse
            key={shape.id}
            cx={shape.x + shape.width / 2}
            cy={shape.y + shape.height / 2}
            rx={shape.width / 2}
            ry={shape.height / 2}
            fill={shape.color}
            fillOpacity={0.25}
            stroke={shape.color}
            strokeWidth={2}
            onPointerDown={(e) => startDragShape(e, shape)}
          />
        );
      case "path": {
        const pts = shape.points.reduce<string>((acc, v, i) => acc + (i % 2 === 0 ? `${i ? " " : ""}${v},` : `${v}`), "");
        return (
          <polyline
            key={shape.id}
            points={pts}
            fill="none"
            stroke={shape.color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            onPointerDown={(e) => startDragShape(e, shape)}
          />
        );
      }
      case "sticky":
        return (
          <g key={shape.id} onPointerDown={(e) => startDragShape(e, shape)}>
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              fill={shape.color}
              fillOpacity={0.85}
              stroke={isSelected ? "#111827" : "none"}
              strokeWidth={2}
              rx={4}
            />
            {editingId !== shape.id && (
              <foreignObject x={shape.x} y={shape.y} width={shape.width} height={shape.height}>
                <div
                  onDoubleClick={() => editable && setEditingId(shape.id)}
                  className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-sm text-gray-900"
                >
                  {shape.text || (editable ? "Double-click to edit…" : "")}
                </div>
              </foreignObject>
            )}
          </g>
        );
      default:
        return null;
    }
  };

  const selectedShape = shapes.find((s) => s.id === selectedId) ?? null;
  const editingShape = shapes.find((s) => s.id === editingId) ?? null;

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      {editable && (
        <Toolbar
          tool={tool}
          onToolChange={setTool}
          color={color}
          onColorChange={(c) => {
            setColor(c);
            if (selectedId) updateShape(selectedId, { color: c });
          }}
          canDelete={Boolean(selectedId)}
          onDelete={() => selectedId && deleteShape(selectedId)}
        />
      )}
      <div className="flex-1 overflow-auto bg-gray-50">
        <div style={{ position: "relative", width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
          <svg
            ref={svgRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="block bg-white"
            style={{ cursor: tool === "select" ? "default" : "crosshair" }}
            onPointerDown={handlePointerDownCanvas}
            onPointerMove={handlePointerMoveCanvas}
            onPointerUp={handlePointerUpCanvas}
            onPointerLeave={handlePointerUpCanvas}
          >
            <defs>
              <pattern id="grid" width={24} height={24} patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#f1f5f9" strokeWidth={1} />
              </pattern>
            </defs>
            <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#grid)" />

            {shapes.map(renderShape)}
            {draft && renderShape(draft)}

            {selectedShape && (
              <rect
                x={selectedShape.type === "path" ? pathBounds(selectedShape.points).x - 6 : selectedShape.x - 6}
                y={selectedShape.type === "path" ? pathBounds(selectedShape.points).y - 6 : selectedShape.y - 6}
                width={
                  (selectedShape.type === "path"
                    ? pathBounds(selectedShape.points).width
                    : selectedShape.width) + 12
                }
                height={
                  (selectedShape.type === "path"
                    ? pathBounds(selectedShape.points).height
                    : selectedShape.height) + 12
                }
                fill="none"
                stroke="#2563EB"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                pointerEvents="none"
              />
            )}
          </svg>

          {Array.from(collaborators.entries()).map(([clientId, state]) =>
            state.cursor && state.user ? (
              <div
                key={clientId}
                className="pointer-events-none absolute z-10 flex items-center gap-1"
                style={{ left: state.cursor.x, top: state.cursor.y, transform: "translate(-2px, -2px)" }}
              >
                <div className="h-3 w-3 rounded-full border-2 border-white" style={{ backgroundColor: state.user.color }} />
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-white shadow"
                  style={{ backgroundColor: state.user.color }}
                >
                  {state.user.name}
                </span>
              </div>
            ) : null,
          )}

          {editingShape && editingShape.type === "sticky" && (
            <textarea
              autoFocus
              defaultValue={editingShape.text}
              onBlur={(e) => {
                updateShape(editingShape.id, { text: e.target.value });
                setEditingId(null);
              }}
              className="absolute resize-none border-2 border-gray-900 p-2.5 text-sm text-gray-900 outline-none"
              style={{
                left: editingShape.x,
                top: editingShape.y,
                width: editingShape.width,
                height: editingShape.height,
                backgroundColor: editingShape.color,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const TOOL_LABELS: { tool: "select" | ShapeTool; label: string }[] = [
  { tool: "select", label: "↖ Select" },
  { tool: "rectangle", label: "▭ Rectangle" },
  { tool: "ellipse", label: "◯ Ellipse" },
  { tool: "sticky", label: "🗒 Sticky" },
  { tool: "path", label: "✏️ Pen" },
];

function Toolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  canDelete,
  onDelete,
}: {
  tool: "select" | ShapeTool;
  onToolChange: (t: "select" | ShapeTool) => void;
  color: string;
  onColorChange: (c: string) => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2">
      <div className="flex gap-1">
        {TOOL_LABELS.map(({ tool: t, label }) => (
          <button
            key={t}
            onClick={() => onToolChange(t)}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
              tool === t ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-l border-gray-200 pl-4">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            className="h-6 w-6 rounded-full ring-offset-1"
            style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>
      <button
        onClick={onDelete}
        disabled={!canDelete}
        className="ml-auto rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
      >
        Delete selected
      </button>
    </div>
  );
}
