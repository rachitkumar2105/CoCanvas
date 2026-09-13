import { beforeEach, describe, expect, it, vi } from "vitest";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";

const fetchSnapshot = vi.fn();
const saveSnapshot = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/persistence/coreApiClient.js", () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshot(...args),
  saveSnapshot: (...args: unknown[]) => saveSnapshot(...args),
}));

const { getOrCreateRoom, addConnection, _roomsForTesting } = await import("../src/rooms/roomManager.js");
const { handleMessage } = await import("../src/relay.js");

function fakeSocket() {
  return { readyState: 1, OPEN: 1, send: vi.fn() } as unknown as import("ws").WebSocket;
}

function encodeSyncStep1(room: Awaited<ReturnType<typeof getOrCreateRoom>>) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0 /* messageSync */);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  return Buffer.from(encoding.toUint8Array(encoder));
}

function encodeUpdateMessage(update: Uint8Array) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0 /* messageSync */);
  syncProtocol.writeUpdate(encoder, update);
  return Buffer.from(encoding.toUint8Array(encoder));
}

describe("relay VIEWER-write enforcement (Section 10 point 3)", () => {
  beforeEach(() => {
    fetchSnapshot.mockReset().mockResolvedValue(null);
    saveSnapshot.mockClear();
    _roomsForTesting().clear();
  });

  it("drops an update message from a VIEWER connection without applying it", async () => {
    const room = await getOrCreateRoom("doc-viewer-write");
    const viewer = fakeSocket();
    addConnection(room, viewer, "VIEWER");

    // Build a real update by editing an independent doc, so the bytes are a valid
    // Yjs update rather than a hand-rolled fixture.
    const Y = await import("yjs");
    const scratch = new Y.Doc();
    scratch.getText("body").insert(0, "malicious edit");
    const update = Y.encodeStateAsUpdate(scratch);
    scratch.destroy();

    handleMessage(room, viewer, encodeUpdateMessage(update));

    expect(room.doc.getText("body").toString()).toBe("");
  });

  it("still serves a VIEWER's own syncStep1 (read) request", async () => {
    const room = await getOrCreateRoom("doc-viewer-read");
    // Inserted before the viewer joins so this doesn't itself trigger a broadcast to them.
    room.doc.getText("body").insert(0, "existing content");
    const viewer = fakeSocket();
    addConnection(room, viewer, "VIEWER");

    handleMessage(room, viewer, encodeSyncStep1(room));

    expect(viewer.send).toHaveBeenCalledTimes(1);
  });

  it("applies an update message from an EDITOR connection", async () => {
    const room = await getOrCreateRoom("doc-editor-write");
    const editor = fakeSocket();
    addConnection(room, editor, "EDITOR");

    const Y = await import("yjs");
    const scratch = new Y.Doc();
    scratch.getText("body").insert(0, "legitimate edit");
    const update = Y.encodeStateAsUpdate(scratch);
    scratch.destroy();

    handleMessage(room, editor, encodeUpdateMessage(update));

    expect(room.doc.getText("body").toString()).toBe("legitimate edit");
  });

  it("applies an update message from an OWNER connection", async () => {
    const room = await getOrCreateRoom("doc-owner-write");
    const owner = fakeSocket();
    addConnection(room, owner, "OWNER");

    const Y = await import("yjs");
    const scratch = new Y.Doc();
    scratch.getText("body").insert(0, "owner edit");
    const update = Y.encodeStateAsUpdate(scratch);
    scratch.destroy();

    handleMessage(room, owner, encodeUpdateMessage(update));

    expect(room.doc.getText("body").toString()).toBe("owner edit");
  });
});
