import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const fetchSnapshot = vi.fn();
const saveSnapshot = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/persistence/coreApiClient.js", () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshot(...args),
  saveSnapshot: (...args: unknown[]) => saveSnapshot(...args),
}));

// Imported after the mock so roomManager picks up the mocked coreApiClient.
const { getOrCreateRoom, addConnection, removeConnection, _roomsForTesting } = await import(
  "../src/rooms/roomManager.js"
);

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
});
