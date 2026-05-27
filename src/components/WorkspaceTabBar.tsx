"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type Ws = { id: string; name: string; sortOrder: number };

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

  async function addTab() {
    const name = window.prompt("New workspace tab name");
    if (!name?.trim()) return;
    const res = await fetch("/api/workspaces", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      window.alert("Could not add workspace (admin only).");
      return;
    }
    const d = await res.json();
    await load();
    router.push(`/w/${encodeURIComponent(d.workspace.id)}/handoff/${currentDate}`);
  }

  async function renameTab(id: string, currentName: string) {
    const name = window.prompt("Rename workspace tab", currentName);
    if (!name?.trim()) return;
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      window.alert("Could not rename.");
      return;
    }
    await load();
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
                  title="Rename"
                  onClick={() => void renameTab(w.id, w.name)}
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
            onClick={() => void addTab()}
            title="Add workspace tab"
            className="mb-1 rounded-md border border-dashed border-slate-400 bg-white/80 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
