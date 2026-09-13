"use client";

import { useEffect, useState } from "react";
import type * as awarenessProtocol from "y-protocols/awareness";
import type { ConnectionStatus } from "@/hooks/useCollabProvider";

interface AwarenessUser {
  name: string;
  color: string;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Saved",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connecting: "bg-amber-400",
  connected: "bg-emerald-500",
  reconnecting: "bg-amber-400 animate-pulse",
  disconnected: "bg-red-500",
};

export function PresenceBar({
  awareness,
  status,
}: {
  awareness: awarenessProtocol.Awareness | null;
  status: ConnectionStatus;
}) {
  const [collaborators, setCollaborators] = useState<AwarenessUser[]>([]);

  useEffect(() => {
    if (!awareness) return;
    const update = () => {
      const states = Array.from(awareness.getStates().values()) as { user?: AwarenessUser }[];
      setCollaborators(states.map((s) => s.user).filter((u): u is AwarenessUser => Boolean(u)));
    };
    update();
    awareness.on("change", update);
    return () => awareness.off("change", update);
  }, [awareness]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {collaborators.map((c, i) => (
          <div
            key={`${c.name}-${i}`}
            title={c.name}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white"
            style={{ backgroundColor: c.color }}
          >
            {c.name.slice(0, 1).toUpperCase()}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-sm text-gray-500">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
        {STATUS_LABEL[status]}
      </div>
    </div>
  );
}
