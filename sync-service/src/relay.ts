import type { WebSocket } from "ws";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { applyAwarenessUpdate, getConnRole, messageAwareness, messageSync, type Room } from "./rooms/roomManager.js";

export function sendSyncStep1(ws: WebSocket, room: Room): void {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  ws.send(encoding.toUint8Array(encoder));
}

function isSyncWriteSubType(subType: number): boolean {
  return subType === syncProtocol.messageYjsSyncStep2 || subType === syncProtocol.messageYjsUpdate;
}

/**
 * Dispatches one raw WS message for a joined connection: sync-protocol messages
 * (Section 9's relay) and awareness/presence messages. Section 10 point 3's
 * permission gate lives here — a VIEWER's own read (syncStep1) still gets served,
 * but anything that would mutate the doc (syncStep2 carrying missing updates, or a
 * live update) is dropped before it ever reaches the shared Y.Doc.
 */
export function handleMessage(room: Room, ws: WebSocket, data: Buffer): void {
  const decoder = decoding.createDecoder(new Uint8Array(data));
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case messageSync: {
      const peek = decoding.clone(decoder);
      const syncSubType = decoding.readVarUint(peek);

      if (isSyncWriteSubType(syncSubType) && getConnRole(room, ws) === "VIEWER") {
        return;
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder));
      }
      break;
    }
    case messageAwareness: {
      // Presence isn't a document write — Section 3 lists live cursors as available
      // to every participant, viewers included.
      const update = decoding.readVarUint8Array(decoder);
      applyAwarenessUpdate(room, ws, update);
      break;
    }
    default:
      break;
  }
}
