"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { VersionResponse } from "@/lib/types";

export function VersionHistoryPanel({
  documentId,
  canWrite,
  onClose,
  onRestored,
}: {
  documentId: string;
  canWrite: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<VersionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .listVersions(documentId)
      .then(setVersions)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load versions"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [documentId]);

  const saveVersion = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createVersion(documentId, label || undefined);
      setLabel("");
      load();
    } catch (err) {
      // The Core API returns 409 if no auto-save snapshot exists yet — surface that
      // plainly rather than a generic failure, since it means "type something first."
      setError(err instanceof ApiError ? err.message : "Failed to save version");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (versionId: string) => {
    if (!confirm("Restore this version? This replaces the document's current content.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.restoreVersion(documentId, versionId);
      onRestored();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to restore version");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-80 overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Version history</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>

      {canWrite && (
        <div className="mt-4 space-y-2 border-b border-gray-100 pb-4">
          <input
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            onClick={saveVersion}
            disabled={busy}
            className="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Save current state as a version
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-gray-400">Loading…</p>}
        {!loading && versions.length === 0 && <p className="text-sm text-gray-400">No versions saved yet.</p>}
        {versions.map((v) => (
          <div key={v.id} className="rounded-md border border-gray-100 p-3">
            <p className="text-sm font-medium text-gray-800">{v.label ?? "Untitled version"}</p>
            <p className="text-xs text-gray-400">{new Date(v.createdAt).toLocaleString()}</p>
            {canWrite && (
              <button
                onClick={() => restore(v.id)}
                disabled={busy}
                className="mt-2 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
              >
                Restore
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
