"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { TopNav } from "@/components/TopNav";
import { api, ApiError } from "@/lib/api";
import type { WorkspaceResponse } from "@/lib/types";

function WorkspacesContent() {
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .listWorkspaces()
      .then(setWorkspaces)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load workspaces"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.createWorkspace(newName.trim());
      setNewName("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create workspace");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <TopNav />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-900">Your workspaces</h1>

        <form onSubmit={createWorkspace} className="mt-6 flex gap-2">
          <input
            placeholder="New workspace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Create
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {!loading && workspaces.length === 0 && (
            <p className="text-sm text-gray-400">No workspaces yet — create one above.</p>
          )}
          {workspaces.map((ws) => (
            <Link
              key={ws.id}
              href={`/workspaces/${ws.id}`}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-300 hover:shadow"
            >
              <p className="font-semibold text-gray-900">{ws.name}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">{ws.myRole}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <RequireAuth>
      <WorkspacesContent />
    </RequireAuth>
  );
}
