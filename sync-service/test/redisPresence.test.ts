import { beforeEach, describe, expect, it, vi } from "vitest";

function makeFakeClient() {
  const client = {
    isOpen: false,
    connect: vi.fn(async () => {
      client.isOpen = true;
    }),
    on: vi.fn(),
    ping: vi.fn(),
    hSet: vi.fn(),
    hDel: vi.fn(),
    expire: vi.fn(),
    hGetAll: vi.fn(),
  };
  return client;
}

let fakeClient = makeFakeClient();

vi.mock("redis", () => ({
  createClient: () => fakeClient,
}));

/** redisPresence.ts holds module-level connection state, so each test needs a fresh
 * module instance (and a fresh fake client) to avoid one test's connection bleeding
 * into the next. */
async function freshRedisPresence() {
  vi.resetModules();
  fakeClient = makeFakeClient();
  return import("../src/presence/redisPresence.js");
}

describe("redisPresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects lazily on first use, not at module load", async () => {
    const { pingRedis } = await freshRedisPresence();
    expect(fakeClient.connect).not.toHaveBeenCalled();
    await pingRedis();
    expect(fakeClient.connect).toHaveBeenCalledTimes(1);
  });

  it("writes a shape/presence state as JSON and refreshes the TTL", async () => {
    const { mirrorPresence } = await freshRedisPresence();
    await mirrorPresence("doc-1", 42, { name: "Alice", cursor: 5 });

    expect(fakeClient.hSet).toHaveBeenCalledWith("presence:doc-1", "42", JSON.stringify({ name: "Alice", cursor: 5 }));
    expect(fakeClient.expire).toHaveBeenCalledWith("presence:doc-1", 30);
  });

  it("removes a client's presence field on disconnect", async () => {
    const { removePresence } = await freshRedisPresence();
    await removePresence("doc-1", 42);
    expect(fakeClient.hDel).toHaveBeenCalledWith("presence:doc-1", "42");
  });

  it("decodes the stored JSON when reading a snapshot", async () => {
    const { getPresenceSnapshot } = await freshRedisPresence();
    fakeClient.hGetAll.mockResolvedValue({
      "1": JSON.stringify({ name: "Alice" }),
      "2": JSON.stringify({ name: "Bob" }),
    });

    const snapshot = await getPresenceSnapshot("doc-1");

    expect(snapshot).toEqual({ 1: { name: "Alice" }, 2: { name: "Bob" } });
  });

  it("never throws when Redis is unreachable — presence mirroring is best-effort", async () => {
    const { mirrorPresence, removePresence, pingRedis } = await freshRedisPresence();
    fakeClient.connect.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(mirrorPresence("doc-1", 1, { x: 1 })).resolves.toBeUndefined();
    await expect(removePresence("doc-1", 1)).resolves.toBeUndefined();
    await expect(pingRedis()).resolves.toBe(false);
  });
});
