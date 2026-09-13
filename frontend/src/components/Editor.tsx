"use client";

import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import type { Transaction } from "yjs";
import type { CollabProvider } from "@/hooks/useCollabProvider";
import { colorForUser } from "@/lib/collaboratorColor";

const LOCAL_ORIGIN = "local-textarea";

/**
 * Finds the minimal [start, oldEnd, newEnd) changed range between two strings by
 * growing matching prefix/suffix inward — the standard technique for binding a
 * plain <textarea> to a Yjs Y.Text without rebuilding the whole string on every
 * keystroke (this is what the sync service's "body" field actually is; see the
 * comment in Editor's caller for why this binds to Y.Text rather than TipTap).
 */
function diffRange(oldStr: string, newStr: string) {
  const maxStart = Math.min(oldStr.length, newStr.length);
  let start = 0;
  while (start < maxStart && oldStr[start] === newStr[start]) start++;

  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, oldEnd, newEnd };
}

export function Editor({
  doc,
  provider,
  userId,
  userName,
  editable,
}: {
  doc: Y.Doc;
  provider: CollabProvider;
  userId: string;
  userName: string;
  editable: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    provider.awareness.setLocalStateField("user", { name: userName, color: colorForUser(userId) });
  }, [provider, userId, userName]);

  useEffect(() => {
    const ytext = doc.getText("body");
    const el = textareaRef.current;
    if (!el) return;

    el.value = ytext.toString();

    const onYjsChange = (_event: unknown, transaction: Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const newValue = ytext.toString();
      if (el.value === newValue) return;
      // Best-effort cursor preservation: shift the caret by however much text
      // changed before it, rather than snapping to the end on every remote edit.
      const prevValue = el.value;
      const selStart = el.selectionStart;
      const selEnd = el.selectionEnd;
      const { start, oldEnd, newEnd } = diffRange(prevValue, newValue);
      const shift = newEnd - oldEnd;
      const adjust = (pos: number) => (pos <= start ? pos : pos >= oldEnd ? pos + shift : start);
      el.value = newValue;
      el.selectionStart = adjust(selStart);
      el.selectionEnd = adjust(selEnd);
    };

    ytext.observe(onYjsChange);
    return () => ytext.unobserve(onYjsChange);
  }, [doc]);

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const newValue = e.currentTarget.value;
    const ytext = doc.getText("body");
    const oldValue = ytext.toString();
    if (newValue === oldValue) return;

    const { start, oldEnd, newEnd } = diffRange(oldValue, newValue);
    doc.transact(() => {
      if (oldEnd > start) ytext.delete(start, oldEnd - start);
      if (newEnd > start) ytext.insert(start, newValue.slice(start, newEnd));
    }, LOCAL_ORIGIN);
  };

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white shadow-sm">
      <textarea
        ref={textareaRef}
        onInput={handleInput}
        disabled={!editable}
        placeholder="Start typing…"
        spellCheck={false}
        className="min-h-[60vh] w-full resize-none rounded-lg px-10 py-8 text-base leading-relaxed text-gray-900 outline-none disabled:bg-gray-50 disabled:text-gray-500"
      />
    </div>
  );
}
