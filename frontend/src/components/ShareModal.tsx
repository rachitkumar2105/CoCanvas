"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { DocumentRole } from "@/lib/types";

export function ShareModal({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DocumentRole>("EDITOR");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      await api.shareDocument(documentId, email, role);
      setStatus("done");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Failed to share document");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Share document</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="email"
            required
            placeholder="Collaborator's email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as DocumentRole)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="EDITOR">Editor — can edit</option>
            <option value="VIEWER">Viewer — read only</option>
            <option value="OWNER">Owner — full control</option>
          </select>
          {status === "done" && <p className="text-sm text-emerald-600">Shared.</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600">
              Close
            </button>
            <button
              type="submit"
              disabled={status === "sending"}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {status === "sending" ? "Sharing…" : "Share"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
