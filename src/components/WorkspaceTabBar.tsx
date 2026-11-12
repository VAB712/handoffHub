"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { WorkspaceNameMailDialog } from "@/components/WorkspaceNameMailDialog";

type Ws = { id: string; name: string; sortOrder: number; mailTo?: string | null };

function localTodayYmd(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function WorkspaceTabBar({ workspaceId }: { workspaceId: string }) {
  const [list, setList] = useState<Ws[]>([]);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin ?? false;
  const [editor, setEditor] = useState<null | { id?: string; name: string; mailTo: string }>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorErr, setEditorErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/workspaces", { credentials: "include" });
    if (res.ok) {
      const d = await res.json();
      setList(d.workspaces ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dateMatch = pathname?.match(/\/handoff\/(\d{4}-\d{2}-\d{2})/);
  const currentDate = dateMatch?.[1] ?? localTodayYmd();

  function openAdd() {
    setEditorErr(null);
    setEditor({ name: "", mailTo: "" });
  }

  function openEdit(ws: Ws) {
    setEditorErr(null);
    setEditor({ id: ws.id, name: ws.name, mailTo: ws.mailTo ?? "" });
  }

  async function saveWorkspace(mailTo: string) {
    if (!editor?.name.trim()) return;
    setEditorBusy(true);
    setEditorErr(null);
    try {
      const payload = { name: editor.name.trim(), mailTo: mailTo.trim() };
      const res = await fetch(
        editor.id ? `/api/workspaces/${encodeURIComponent(editor.id)}` : "/api/workspaces",
        {
          method: editor.id ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditorErr(typeof data.error === "string" ? data.error : "Could not save workspace.");
        return;
      }
      const savedId = editor.id ?? data.workspace?.id;
      setEditor(null);
      await load();
      if (!editor.id && savedId) {
        router.push(`/w/${encodeURIComponent(savedId)}/handoff/${currentDate}`);
      }
    } finally {
      setEditorBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-0 border-b border-slate-300 bg-slate-200/90 px-2 pt-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1">
        {list.map((w) => {
          const active = w.id === workspaceId;
          return (
            <div
              key={w.id}
              className={`group flex items-stretch rounded-t-md border border-b-0 ${active
                  ? "z-[1] -mb-px border-slate-300 border-b-white bg-white shadow-sm"
                  : "border-transparent bg-slate-100 hover:bg-slate-50"
                }`}
            >
              <Link
                href={`/w/${encodeURIComponent(w.id)}/handoff/${currentDate}`}
                className={`max-w-[200px] truncate px-3 py-2 text-sm font-medium ${active ? "text-slate-900" : "text-slate-600"
                  }`}
              >
                {w.name}
              </Link>
              {isAdmin && (
                <button
                  type="button"
                  title="Edit name and mail"
                  onClick={() => openEdit(w)}
                  className="border-l border-slate-200 px-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  ✎
                </button>
              )}
            </div>
          );
        })}
        {isAdmin && (
          <button
            type="button"
            onClick={openAdd}
            title="Add workspace tab"
            className="mb-1 rounded-md border border-dashed border-slate-400 bg-white/80 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white"
          >
            +
          </button>
        )}
      </div>
      {editor && (
        <WorkspaceNameMailDialog
          title={editor.id ? "Edit workspace" : "Add workspace"}
          name={editor.name}
          mailTo={editor.mailTo}
          busy={editorBusy}
          error={editorErr}
          submitLabel={editor.id ? "Save" : "Add workspace"}
          onNameChange={(value) => setEditor((prev) => (prev ? { ...prev, name: value } : prev))}
          onMailChange={(value) => setEditor((prev) => (prev ? { ...prev, mailTo: value } : prev))}
          onCancel={() => setEditor(null)}
          onSubmit={(mailTo) => void saveWorkspace(mailTo)}
        />
      )}
    </div>
  );
}
