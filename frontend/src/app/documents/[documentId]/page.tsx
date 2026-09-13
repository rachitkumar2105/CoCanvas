"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Editor } from "@/components/Editor";
import { Whiteboard } from "@/components/Whiteboard";
import { PresenceBar } from "@/components/PresenceBar";
import { ShareModal } from "@/components/ShareModal";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { useCollabProvider } from "@/hooks/useCollabProvider";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";
import type { DocumentResponse } from "@/lib/types";

function DocumentEditorContent() {
  const params = useParams<{ documentId: string }>();
  const documentId = params.documentId;
  const { user } = useAuth();

  const [doc, setDoc] = useState<DocumentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const { doc: yDoc, provider, status } = useCollabProvider(documentId);

  useEffect(() => {
    api
      .getDocument(documentId)
      .then((d) => {
        setDoc(d);
        setTitleDraft(d.title);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load document"));
  }, [documentId]);

  const saveTitle = async () => {
    if (!doc || titleDraft.trim() === doc.title || !titleDraft.trim()) return;
    try {
      const updated = await api.updateDocument(documentId, titleDraft.trim());
      setDoc(updated);
    } catch {
      setTitleDraft(doc.title);
    }
  };

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-gray-500">
        <p>{error}</p>
        <Link href="/workspaces" className="text-blue-600 hover:underline">
          Back to workspaces
        </Link>
      </div>
    );
  }

  if (!doc || !user) {
    return <div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>;
  }

  const canWrite = doc.myRole === "OWNER" || doc.myRole === "EDITOR";
  const canShare = doc.myRole === "OWNER";

  return (
    <div>
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href={`/workspaces/${doc.workspaceId}`} className="text-sm text-gray-400 hover:text-gray-600">
            ← Documents
          </Link>
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            disabled={!canWrite}
            className="rounded-md border border-transparent px-2 py-1 text-lg font-semibold text-gray-900 hover:border-gray-200 focus:border-gray-300 focus:outline-none disabled:hover:border-transparent"
          />
          {!canWrite && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
              View only
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <PresenceBar awareness={provider?.awareness ?? null} status={status} />
          <button
            onClick={() => setShowVersions(true)}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            History
          </button>
          {canShare && (
            <button
              onClick={() => setShowShare(true)}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              Share
            </button>
          )}
        </div>
      </header>

      <main className={doc.type === "WHITEBOARD" ? "" : "px-6 py-10"}>
        {provider ? (
          doc.type === "WHITEBOARD" ? (
            <Whiteboard
              doc={yDoc}
              provider={provider}
              userId={user.userId}
              userName={user.name}
              editable={canWrite}
            />
          ) : (
            <Editor
              doc={yDoc}
              provider={provider}
              userId={user.userId}
              userName={user.name}
              editable={canWrite}
            />
          )
        ) : (
          <div className="flex justify-center py-20 text-gray-400">Connecting…</div>
        )}
      </main>

      {showShare && <ShareModal documentId={documentId} onClose={() => setShowShare(false)} />}
      {showVersions && (
        <VersionHistoryPanel
          documentId={documentId}
          canWrite={canWrite}
          onClose={() => setShowVersions(false)}
          onRestored={() => {
            // The relay applies the restore straight to the live Yjs room and
            // broadcasts it (Section 10), so every open tab — including this one —
            // picks it up automatically; nothing to do here but let the observer fire.
          }}
        />
      )}
    </div>
  );
}

export default function DocumentEditorPage() {
  return (
    <RequireAuth>
      <DocumentEditorContent />
    </RequireAuth>
  );
}
