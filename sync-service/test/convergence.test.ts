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
          })
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
