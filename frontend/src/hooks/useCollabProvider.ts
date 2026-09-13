"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { api } from "@/lib/api";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const SYNC_SERVICE_WS_URL = process.env.NEXT_PUBLIC_SYNC_SERVICE_WS_URL ?? "ws://localhost:4000";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

/**
 * A minimal Yjs WebSocket provider speaking the same sync/awareness protocol as
 * the sync service's relay (Section 8/9). Deliberately hand-rolled instead of
 * y-websocket: the collab-token handoff (60s TTL, re-issued by the Core API) means
 * every reconnect needs a *fresh* token fetch, which y-websocket's fixed
 * connection-params model doesn't support.
 */
export class CollabProvider {
  public readonly doc: Y.Doc;
  public readonly awareness: awarenessProtocol.Awareness;

  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private reconnectDelayMs = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private documentId: string,
    doc: Y.Doc,
    private onStatusChange: (status: ConnectionStatus) => void,
  ) {
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);

    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);

    window.addEventListener("beforeunload", this.handleBeforeUnload);
    this.connect();
  }

  private handleBeforeUnload = () => {
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "window closed");
  };

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoder);
  };

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    const changed = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
    this.send(encoder);
  };

  private send(encoder: encoding.Encoder) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encoding.toUint8Array(encoder));
    }
  }

  private async connect() {
    if (!this.shouldReconnect) return;
    this.onStatusChange("connecting");

    let token: string;
    try {
      const collab = await api.collabToken(this.documentId);
      token = collab.token;
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (!this.shouldReconnect) return;

    const ws = new WebSocket(
      `${SYNC_SERVICE_WS_URL}/sync/${this.documentId}?token=${encodeURIComponent(token)}`,
    );
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelayMs = 500;
      this.onStatusChange("connected");
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.send(encoder);

      if (this.awareness.getLocalState() !== null) {
        const encoder2 = encoding.createEncoder();
        encoding.writeVarUint(encoder2, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder2,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        );
        this.send(encoder2);
      }
    };

    ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
      const messageType = decoding.readVarUint(decoder);
      switch (messageType) {
        case MESSAGE_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
          if (encoding.length(encoder) > 1) {
            this.send(encoder);
          }
          break;
        }
        case MESSAGE_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
          break;
        }
        default:
          break;
      }
    };

    ws.onclose = () => {
      this.ws = null;
      // Everyone else's cursors vanish locally the instant we drop, rather than
      // waiting on the server's own stale-state cleanup, so the UI doesn't show
      // ghost collaborators during a reconnect.
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID),
        "connection closed",
      );
      if (this.shouldReconnect) {
        this.onStatusChange("reconnecting");
        this.scheduleReconnect();
      } else {
        this.onStatusChange("disconnected");
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 10_000);
  }

  destroy() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "provider destroyed");
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.ws?.close();
    this.doc.destroy();
  }
}

export function useCollabProvider(documentId: string) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [provider, setProvider] = useState<CollabProvider | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  if (!docRef.current) {
    docRef.current = new Y.Doc();
  }

  useEffect(() => {
    const doc = docRef.current!;
    const nextProvider = new CollabProvider(documentId, doc, setStatus);
    setProvider(nextProvider);
    return () => {
      nextProvider.destroy();
      setProvider(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  return { doc: docRef.current, provider, status };
}
