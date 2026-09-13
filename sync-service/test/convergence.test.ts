import { describe, expect, it } from "vitest";
import * as Y from "yjs";

/**
 * Section 10's "test that actually matters": the direct equivalent of SeatLock's
 * concurrency test, and the single highest-value artifact in this build (Section 21).
 * It exercises Yjs itself, not our relay — the relay's job (Section 9) is just to carry
 * these updates between clients; the guarantee under test is Yjs's CRDT merge algorithm.
 */

function randomDelayMs(): number {
  return Math.floor(Math.random() * 40);
}

/** Wires N docs so every local update is broadcast to every other doc after a random,
 * independently-rolled delay — simulating an unordered network between clients. */
function simulateNetwork(docs: Y.Doc[]): { flush: () => Promise<void> } {
  const pending: Promise<void>[] = [];

  docs.forEach((doc, senderIndex) => {
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return; // don't rebroadcast updates we received ourselves
      docs.forEach((other, receiverIndex) => {
        if (receiverIndex === senderIndex) return;
        pending.push(
          new Promise<void>((resolve) => {
            setTimeout(() => {
              Y.applyUpdate(other, update, "remote");
              resolve();
            }, randomDelayMs());
          }),
        );
      });
    });
  });

  return { flush: () => Promise.all(pending).then(() => undefined) };
}

describe("Yjs convergence under concurrent, delayed, interleaved edits", () => {
  it("converges to a byte-identical final document across every simulated client", async () => {
    const CLIENT_COUNT = 5;
    const EDITS_PER_CLIENT = 8;
    const docs = Array.from({ length: CLIENT_COUNT }, () => new Y.Doc());
    const network = simulateNetwork(docs);

    // Every client edits the SAME shared text concurrently, at overlapping positions —
    // real conflicts, not independent non-overlapping edits that would "converge"
    // trivially without exercising the merge algorithm at all.
    docs.forEach((doc, clientIndex) => {
      const text = doc.getText("body");
      for (let edit = 0; edit < EDITS_PER_CLIENT; edit++) {
        const len = text.length;
        if (len > 3 && Math.random() < 0.3) {
          const deleteAt = Math.floor(Math.random() * (len - 1));
          text.delete(deleteAt, 1);
        } else {
          const insertAt = len === 0 ? 0 : Math.floor(Math.random() * (len + 1));
          text.insert(insertAt, `[c${clientIndex}e${edit}]`);
        }
      }
    });

    await network.flush();

    const referenceText = docs[0].getText("body").toString();
    const referenceState = Y.encodeStateAsUpdate(docs[0]);

    for (let i = 1; i < docs.length; i++) {
      expect(docs[i].getText("body").toString()).toBe(referenceText);
      // Byte-identical serialized state, not just matching text — the actual guarantee
      // Section 10 describes: every replica's internal state converges identically.
      expect(Y.encodeStateAsUpdate(docs[i])).toEqual(referenceState);
    }

    docs.forEach((doc) => doc.destroy());
  });

  it("converges at scale: 40 clients, randomized delayed/reordered edits, with recorded latency", async () => {
    const CLIENT_COUNT = 40;
    const EDITS_PER_CLIENT = 6;
    const docs = Array.from({ length: CLIENT_COUNT }, () => new Y.Doc());
    const network = simulateNetwork(docs);

    const startedAt = performance.now();

    docs.forEach((doc, clientIndex) => {
      const text = doc.getText("body");
      for (let edit = 0; edit < EDITS_PER_CLIENT; edit++) {
        const len = text.length;
        if (len > 3 && Math.random() < 0.3) {
          const deleteAt = Math.floor(Math.random() * (len - 1));
          text.delete(deleteAt, 1);
        } else {
          const insertAt = len === 0 ? 0 : Math.floor(Math.random() * (len + 1));
          text.insert(insertAt, `[c${clientIndex}e${edit}]`);
        }
      }
    });

    await network.flush();
    const convergenceMs = performance.now() - startedAt;

    // Not a strict performance assertion (this is a correctness test, not a benchmark) —
    // just a sanity bound so a genuine regression (e.g. an accidental O(n^2) broadcast
    // fan-out) fails loudly here instead of only showing up as "the demo feels slow."
    // eslint-disable-next-line no-console
    console.log(
      `[convergence@scale] ${CLIENT_COUNT} clients, ${EDITS_PER_CLIENT} edits each: ${convergenceMs.toFixed(1)}ms to converge`,
    );
    expect(convergenceMs).toBeLessThan(5000);

    const referenceText = docs[0].getText("body").toString();
    const referenceState = Y.encodeStateAsUpdate(docs[0]);

    for (let i = 1; i < docs.length; i++) {
      expect(docs[i].getText("body").toString()).toBe(referenceText);
      expect(Y.encodeStateAsUpdate(docs[i])).toEqual(referenceState);
    }

    docs.forEach((doc) => doc.destroy());
  });

  it("converges correctly even when one sender's updates arrive at a receiver out of order", async () => {
    const sender = new Y.Doc();
    const receiver = new Y.Doc();
    const capturedUpdates: Uint8Array[] = [];
    sender.on("update", (update: Uint8Array) => capturedUpdates.push(update));

    sender.getText("body").insert(0, "one ");
    sender.getText("body").insert(4, "two ");
    sender.getText("body").insert(8, "three");

    // Deliver in reverse order. Yjs applies structs by their own encoded position/ID
    // metadata, not by assuming updates arrive in the order they were produced — this
    // is what makes reconnect-and-resync (Section 10, point 4) safe in general.
    for (const update of [...capturedUpdates].reverse()) {
      Y.applyUpdate(receiver, update, "remote");
    }

    expect(receiver.getText("body").toString()).toBe(sender.getText("body").toString());
    expect(Y.encodeStateAsUpdate(receiver)).toEqual(Y.encodeStateAsUpdate(sender));

    sender.destroy();
    receiver.destroy();
  });

  it("converges when two clients concurrently insert at the exact same position", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const network = simulateNetwork([a, b]);

    a.getText("body").insert(0, "AAA");
    b.getText("body").insert(0, "BBB");

    await network.flush();

    expect(a.getText("body").toString()).toBe(b.getText("body").toString());
    expect(Y.encodeStateAsUpdate(a)).toEqual(Y.encodeStateAsUpdate(b));

    a.destroy();
    b.destroy();
  });

  it("converges when one client deletes text another client concurrently edited nearby", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("body").insert(0, "hello world");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const network = simulateNetwork([a, b]);

    a.getText("body").delete(0, 5); // deletes "hello"
    b.getText("body").insert(5, ","); // inserts right at the boundary, concurrently

    await network.flush();

    expect(a.getText("body").toString()).toBe(b.getText("body").toString());
    expect(Y.encodeStateAsUpdate(a)).toEqual(Y.encodeStateAsUpdate(b));

    a.destroy();
    b.destroy();
  });
});

/**
 * Phase 5's whiteboard shape model (Section 5) is a top-level Y.Map keyed by shape id
 * (sync-service/src/rooms/shapes.ts) rather than the Y.Text used for documents — this
 * is the same convergence guarantee applied to that data shape: concurrent, delayed,
 * conflicting shape edits from multiple simulated clients must still converge to a
 * byte-identical final state everywhere.
 */
describe("Yjs convergence for whiteboard shapes (Y.Map)", () => {
  function shapesOf(doc: Y.Doc) {
    return doc.getMap<Record<string, unknown>>("shapes");
  }

  it("converges when clients concurrently create different shapes", async () => {
    const CLIENT_COUNT = 4;
    const docs = Array.from({ length: CLIENT_COUNT }, () => new Y.Doc());
    const network = simulateNetwork(docs);

    docs.forEach((doc, i) => {
      shapesOf(doc).set(`shape-${i}`, { id: `shape-${i}`, type: "rect", x: i * 10, y: i * 10 });
    });

    await network.flush();

    const referenceState = Y.encodeStateAsUpdate(docs[0]);
    for (let i = 1; i < docs.length; i++) {
      expect(Y.encodeStateAsUpdate(docs[i])).toEqual(referenceState);
      expect(shapesOf(docs[i]).size).toBe(CLIENT_COUNT);
    }

    docs.forEach((doc) => doc.destroy());
  });

  it("converges to the same winner when two clients concurrently move the same shape", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    shapesOf(a).set("shape-1", { id: "shape-1", type: "circle", x: 0, y: 0 });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const network = simulateNetwork([a, b]);

    // Both clients drag the SAME shape to different positions at the same time —
    // Y.Map resolves this the same way any other concurrent same-key write resolves:
    // one deterministic winner, identical on every replica, no error, no merge of the
    // two positions into something nonsensical.
    shapesOf(a).set("shape-1", { id: "shape-1", type: "circle", x: 100, y: 5 });
    shapesOf(b).set("shape-1", { id: "shape-1", type: "circle", x: 5, y: 100 });

    await network.flush();

    expect(Y.encodeStateAsUpdate(a)).toEqual(Y.encodeStateAsUpdate(b));
    expect(shapesOf(a).get("shape-1")).toEqual(shapesOf(b).get("shape-1"));

    a.destroy();
    b.destroy();
  });

  it("converges when one client deletes a shape another client concurrently edited", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    shapesOf(a).set("shape-1", { id: "shape-1", type: "rect", x: 0, y: 0 });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const network = simulateNetwork([a, b]);

    shapesOf(a).delete("shape-1");
    shapesOf(b).set("shape-1", { id: "shape-1", type: "rect", x: 50, y: 50 });

    await network.flush();

    expect(Y.encodeStateAsUpdate(a)).toEqual(Y.encodeStateAsUpdate(b));
    // Whichever way Yjs resolves a delete-vs-set race, both replicas must agree.
    expect(shapesOf(a).has("shape-1")).toBe(shapesOf(b).has("shape-1"));

    a.destroy();
    b.destroy();
  });

  it("converges across many clients with randomized, interleaved, delayed shape edits", async () => {
    const CLIENT_COUNT = 30;
    const EDITS_PER_CLIENT = 10;
    const SHARED_SHAPE_IDS = ["shape-a", "shape-b", "shape-c"];
    const docs = Array.from({ length: CLIENT_COUNT }, () => new Y.Doc());
    const network = simulateNetwork(docs);

    const startedAt = performance.now();

    docs.forEach((doc, clientIndex) => {
      const shapes = shapesOf(doc);
      for (let edit = 0; edit < EDITS_PER_CLIENT; edit++) {
        const id = SHARED_SHAPE_IDS[Math.floor(Math.random() * SHARED_SHAPE_IDS.length)];
        if (Math.random() < 0.2) {
          shapes.delete(id);
        } else {
          shapes.set(id, { id, type: "rect", x: clientIndex, y: edit, updatedBy: clientIndex });
        }
      }
    });

    await network.flush();
    const convergenceMs = performance.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(
      `[convergence@scale] ${CLIENT_COUNT} whiteboard clients, ${EDITS_PER_CLIENT} edits each: ${convergenceMs.toFixed(1)}ms to converge`,
    );
    expect(convergenceMs).toBeLessThan(5000);

    const referenceState = Y.encodeStateAsUpdate(docs[0]);
    for (let i = 1; i < docs.length; i++) {
      expect(Y.encodeStateAsUpdate(docs[i])).toEqual(referenceState);
    }

    docs.forEach((doc) => doc.destroy());
  });
});
