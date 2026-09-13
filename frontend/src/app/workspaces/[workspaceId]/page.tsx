"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { TopNav } from "@/components/TopNav";
import { api, ApiError } from "@/lib/api";
import type { DocumentResponse, DocumentType } from "@/lib/types";

function DocumentsContent() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const [documents, setDocuments] = useState<DocumentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<DocumentType>("DOCUMENT");
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .listDocuments(workspaceId)
      .then(setDocuments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load documents"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [workspaceId]);

  const createDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await api.createDocument(workspaceId, newTitle.trim(), newType);
      setNewTitle("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create document");
    } finally {
      setCreating(false);
    }
  };

  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteStatus(null);
    try {
      await api.inviteMember(workspaceId, inviteEmail.trim(), "MEMBER");
      setInviteStatus(`Invited ${inviteEmail.trim()} to this workspace.`);
      setInviteEmail("");
    } catch (err) {
      setInviteStatus(err instanceof ApiError ? err.message : "Failed to invite member");
    }
  };

  return (
    <div>
      <TopNav />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/workspaces" className="text-sm text-gray-500 hover:underline">
          ← All workspaces
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Documents</h1>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <form onSubmit={createDocument} className="flex flex-1 gap-2">
            <input
              placeholder="New document title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as DocumentType)}
              className="rounded-md border border-gray-300 px-2 py-2 text-sm"
            >
              <option value="DOCUMENT">Document</option>
              <option value="WHITEBOARD">Whiteboard</option>
            </select>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              New {newType === "WHITEBOARD" ? "whiteboard" : "document"}
            </button>
          </form>
        </div>

        <form onSubmit={inviteMember} className="mt-3 flex gap-2">
          <input
            type="email"
            placeholder="Invite a workspace member by email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700">
            Invite
          </button>
        </form>
        {inviteStatus && <p className="mt-2 text-sm text-gray-500">{inviteStatus}</p>}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {!loading && documents.length === 0 && (
            <p className="text-sm text-gray-400">No documents yet — create one above.</p>
          )}
          {documents.map((doc) => (
            <Link
              key={doc.id}
              href={`/documents/${doc.id}`}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-300 hover:shadow"
            >
              <p className="font-semibold text-gray-900">{doc.title}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">
                {doc.type} · {doc.myRole ?? "—"}
              </p>
              <p className="mt-2 text-xs text-gray-400">Updated {new Date(doc.updatedAt).toLocaleString()}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <RequireAuth>
      <DocumentsContent />
    </RequireAuth>
  );
}
