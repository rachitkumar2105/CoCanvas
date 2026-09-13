import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { getDocumentTypeStrategy } from "../src/rooms/documentTypeStrategy.js";

describe("getDocumentTypeStrategy", () => {
  it("resolves a distinct strategy instance per document type", () => {
    const textStrategy = getDocumentTypeStrategy("DOCUMENT");
    const whiteboardStrategy = getDocumentTypeStrategy("WHITEBOARD");
    expect(textStrategy).not.toBe(whiteboardStrategy);
  });

  it("DOCUMENT strategy replaces the live Y.Text with the restored doc's text", () => {
    const live = new Y.Doc();
    live.getText("body").insert(0, "diverged content");
    const restored = new Y.Doc();
    restored.getText("body").insert(0, "restored content");

    getDocumentTypeStrategy("DOCUMENT").replaceWithRestoredState(live, restored);

    expect(live.getText("body").toString()).toBe("restored content");
  });

  it("WHITEBOARD strategy replaces the live shapes map with the restored doc's shapes", () => {
    const live = new Y.Doc();
    live.getMap("shapes").set("stale", { id: "stale", type: "rectangle", x: 0, y: 0 });
    const restored = new Y.Doc();
    restored.getMap("shapes").set("kept", { id: "kept", type: "ellipse", x: 5, y: 5 });

    getDocumentTypeStrategy("WHITEBOARD").replaceWithRestoredState(live, restored);

    const liveShapes = live.getMap("shapes");
    expect(liveShapes.has("stale")).toBe(false);
    expect(liveShapes.get("kept")).toEqual({ id: "kept", type: "ellipse", x: 5, y: 5 });
  });
});
