import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSnapshot, saveSnapshot } from "../src/persistence/coreApiClient.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchSnapshot", () => {
  it("returns null when the Core API has no snapshot yet (204)", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await fetchSnapshot("doc-1");
    expect(result).toBeNull();
  });

  it("decodes the base64 state into bytes on success", async () => {
    const original = new Uint8Array([1, 2, 3, 250, 255]);
    const base64 = Buffer.from(original).toString("base64");
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ state: base64 }), { status: 200 })
    );

    const result = await fetchSnapshot("doc-1");
    expect(result).toEqual(original);
  });

  it("sends the shared internal secret header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;

    await fetchSnapshot("doc-1");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Internal-Secret"]).toBeTruthy();
  });

  it("throws on a non-2xx, non-204 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(fetchSnapshot("doc-1")).rejects.toThrow(/500/);
  });
});

describe("saveSnapshot", () => {
  it("base64-encodes the update bytes in the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;

    const bytes = new Uint8Array([10, 20, 30]);
    await saveSnapshot("doc-1", bytes);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(Buffer.from(body.state, "base64")).toEqual(Buffer.from(bytes));
  });

  it("throws on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 403 }));
    await expect(saveSnapshot("doc-1", new Uint8Array())).rejects.toThrow(/403/);
  });
});
