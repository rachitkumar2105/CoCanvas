import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const fetchSnapshot = vi.fn();
const saveSnapshot = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/persistence/coreApiClient.js", () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshot(...args),
  saveSnapshot: (...args: unknown[]) => saveSnapshot(...args),
}));

// Imported after the mock so roomManager picks up the mocked coreApiClient.
const {
  getOrCreateRoom,
  addConnection,
  removeConnection,
  applyAwarenessUpdate,
  encodeFullAwarenessState,
  restoreLiveRoom,
  messageAwareness,
  _roomsForTesting,
} = await import("../src/rooms/roomManager.js");

/** Builds a raw awareness-update payload as a real client would, for a synthetic client. */
function makeAwarenessUpdate(clientId: number, state: Record<string, unknown> | null) {
  const doc = new Y.Doc({ guid: String(clientId) });
  Object.defineProperty(doc, "clientID", { value: clientId });
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(state);
  const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [clientId]);
  awareness.destroy();
  return update;
}

function decodeAwarenessPayload(payload: Uint8Array) {
  const decoder = decoding.createDecoder(payload);
  const type = decoding.readVarUint(decoder);
  const inner = decoding.readVarUint8Array(decoder);
  return { type, inner };
}

function fakeSocket() {
  return { readyState: 1, OPEN: 1, send: vi.fn() } as unknown as import("ws").WebSocket;
}

describe("roomManager", () => {
  beforeEach(() => {
    fetchSnapshot.mockReset();
    saveSnapshot.mockClear();
    saveSnapshot.mockResolvedValue(undefined);
    _roomsForTesting().clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates a new room from the Core API snapshot", async () => {
    const seed = new Y.Doc();
    seed.getText("body").insert(0, "hydrated content");
    fetchSnapshot.mockResolvedValue(Y.encodeStateAsUpdate(seed));

    const room = await getOrCreateRoom("doc-hydrate");

    expect(room.doc.getText("body").toString()).toBe("hydrated content");
    expect(fetchSnapshot).toHaveBeenCalledWith("doc-hydrate");
  });

  it("starts an empty doc when the Core API has no snapshot yet", async () => {
    fetchSnapshot.mockResolvedValue(null);
    const room = await getOrCreateRoom("doc-empty");
    expect(room.doc.getText("body").toString()).toBe("");
  });

  it("broadcasts an update to other connections but not back to its origin", async () => {
    fetchSnapshot.mockResolvedValue(null);
    const room = await getOrCreateRoom("doc-broadcast");

    const writer = fakeSocket();
    const listener = fakeSocket();
    addConnection(room, writer, "EDITOR");
    addConnection(room, listener, "VIEWER");

    room.doc.transact(() => {
      room.doc.getText("body").insert(0, "hello");
    }, writer);

    expect(listener.send).toHaveBeenCalledTimes(1);
    expect(writer.send).not.toHaveBeenCalled();
  });

  it("debounces persistence while the room stays active", async () => {
    fetchSnapshot.mockResolvedValue(null);
    const room = await getOrCreateRoom("doc-debounce");
    const conn = fakeSocket();
    addConnection(room, conn, "EDITOR");

    room.doc.getText("body").insert(0, "a");
    await vi.advanceTimersByTimeAsync(1000);
    room.doc.getText("body").insert(1, "b");
    await vi.advanceTimersByTimeAsync(1000);

    // Each edit re-armed the debounce timer, so the 3s window never elapsed.
    expect(saveSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    expect(saveSnapshot).toHaveBeenCalledWith("doc-debounce", expect.any(Uint8Array));
  });

  it("persists immediately when the last connection disconnects, and tears the room down", async () => {
    fetchSnapshot.mockResolvedValue(null);
    const room = await getOrCreateRoom("doc-last-disconnect");
    const conn = fakeSocket();
    addConnection(room, conn, "OWNER");

    room.doc.getText("body").insert(0, "bye");
    await removeConnection(room, conn);

    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    expect(_roomsForTesting().has("doc-last-disconnect")).toBe(false);
  });

  it("does not tear the room down while other connections remain", async () => {
    fetchSnapshot.mockResolvedValue(null);
    const room = await getOrCreateRoom("doc-multi-conn");
    const a = fakeSocket();
    const b = fakeSocket();
    addConnection(room, a, "EDITOR");
    addConnection(room, b, "VIEWER");

    await removeConnection(room, a);

    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(_roomsForTesting().has("doc-multi-conn")).toBe(true);
  });

  describe("presence / awareness", () => {
    it("relays an incoming awareness update to other connections but not back to its sender", async () => {
      fetchSnapshot.mockResolvedValue(null);
      const room = await getOrCreateRoom("doc-awareness-broadcast");
      const alice = fakeSocket();
      const bob = fakeSocket();
      addConnection(room, alice, "EDITOR");
      addConnection(room, bob, "EDITOR");

      const update = makeAwarenessUpdate(9001, { name: "Alice", color: "#f00", cursor: 5 });
      applyAwarenessUpdate(room, alice, update);

      expect(bob.send).toHaveBeenCalledTimes(1);
      expect(alice.send).not.toHaveBeenCalled();

      const { type, inner } = decodeAwarenessPayload((bob.send as any).mock.calls[0][0]);
      expect(type).toBe(messageAwareness);
      // encodeAwarenessUpdate's payload embeds the state as a JSON string — cheapest
      // way to assert the right client's state made it through unmodified.
      expect(Buffer.from(inner).toString("latin1")).toContain("Alice");
    });

    it("returns null (nothing to send) for a brand-new room with no known participants", async () => {
      fetchSnapshot.mockResolvedValue(null);
      const room = await getOrCreateRoom("doc-awareness-empty");
      expect(encodeFullAwarenessState(room)).toBeNull();
    });

    it("encodes every known participant's state for a client joining later", async () => {
      fetchSnapshot.mockResolvedValue(null);
      const room = await getOrCreateRoom("doc-awareness-snapshot");
      const alice = fakeSocket();
      addConnection(room, alice, "EDITOR");
      applyAwarenessUpdate(room, alice, makeAwarenessUpdate(1, { name: "Alice" }));
      applyAwarenessUpdate(room, alice, makeAwarenessUpdate(2, { name: "Bob" }));

      const snapshot = encodeFullAwarenessState(room);
      expect(snapshot).not.toBeNull();
      const { type, inner } = decodeAwarenessPayload(snapshot!);
      expect(type).toBe(messageAwareness);
      const text = Buffer.from(inner).toString("latin1");
      expect(text).toContain("Alice");
      expect(text).toContain("Bob");
    });

    it("removes a connection's awareness state (e.g. its cursor) when it disconnects", async () => {
      fetchSnapshot.mockResolvedValue(null);
      const room = await getOrCreateRoom("doc-awareness-cleanup");
      const alice = fakeSocket();
      const bob = fakeSocket();
      addConnection(room, alice, "EDITOR");
      addConnection(room, bob, "EDITOR");
      applyAwarenessUpdate(room, alice, makeAwarenessUpdate(42, { name: "Alice" }));

      expect(room.awareness.getStates().has(42)).toBe(true);
      bob.send = vi.fn();

      await removeConnection(room, alice);

      expect(room.awareness.getStates().has(42)).toBe(false);
      // Bob (still connected) should have been told Alice's state was removed.
      expect(bob.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("restoreLiveRoom", () => {
    it("replaces the live doc's content, broadcasts it, and schedules a persist", async () => {
      fetchSnapshot.mockResolvedValue(null);
      const room = await getOrCreateRoom("doc-restore-live");
      room.doc.getText("body").insert(0, "current content that has since diverged");

      const conn = fakeSocket();
      addConnection(room, conn, "EDITOR");
      conn.send = vi.fn();

      const oldVersion = new Y.Doc();
      oldVersion.getText("body").insert(0, "the old restored content");
      const restoredState = Y.encodeStateAsUpdate(oldVersion);
      oldVersion.destroy();

      const applied = restoreLiveRoom("doc-restore-live", restoredState);

      expect(applied).toBe(true);
      expect(room.doc.getText("body").toString()).toBe("the old restored content");
      expect(conn.send).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(3000);
      expect(saveSnapshot).toHaveBeenCalledWith("doc-restore-live", expect.any(Uint8Array));
    });

    it("returns false when the document isn't currently loaded in memory", () => {
      const applied = restoreLiveRoom("doc-not-loaded", new Uint8Array());
      expect(applied).toBe(false);
    });
  });
});
