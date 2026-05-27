"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Ws = { id: string; name: string };
type ApiUser = {
  id: string;
  userId: string;
  contactEmail: string | null;
  isAdmin: boolean;
  createdAt: string;
  workspaceAccesses: { workspaceId: string; workspaceName: string }[];
};

type Row = {
  clientKey: string;
  serverId: string | null;
  userId: string;
  contactEmail: string;
  password: string;
  isAdmin: boolean;
  workspaces: Record<string, boolean>;
};

type Baseline = { isAdmin: boolean; workspaceKey: string; contactEmail: string };

function workspaceKeyFromRow(ws: Record<string, boolean>): string {
  return Object.entries(ws)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort()
    .join(",");
}

function normalizeContactEmailField(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function userToRow(u: ApiUser, wsList: Ws[]): Row {
  return {
    clientKey: u.id,
    serverId: u.id,
    userId: u.userId,
    contactEmail: normalizeContactEmailField(u.contactEmail),
    password: "",
    isAdmin: u.isAdmin,
    workspaces: Object.fromEntries(wsList.map((w) => [w.id, u.workspaceAccesses.some((a) => a.workspaceId === w.id)])),
  };
}

function emptyDraftRow(wsList: Ws[]): Row {
  return {
    clientKey: `draft-${crypto.randomUUID()}`,
    serverId: null,
    userId: "",
    contactEmail: "",
    password: "",
    isAdmin: false,
    workspaces: Object.fromEntries(wsList.map((w) => [w.id, false])),
  };
}

/** When workspaces are added/removed on the server, extend row checkboxes without dropping unsaved drafts. */
function mergeWorkspacesIntoRows(prevRows: Row[], wsList: Ws[]): Row[] {
  return prevRows.map((r) => {
    const next: Record<string, boolean> = {};
    for (const w of wsList) {
      next[w.id] = r.workspaces[w.id] ?? false;
    }
    return { ...r, workspaces: next };
  });
}

function selectedWorkspaceIds(row: Row): string[] {
  return Object.entries(row.workspaces)
    .filter(([, on]) => on)
    .map(([id]) => id);
}

function renderHighlightedText(text: string, searchTerm: string | null): ReactNode[] {
  if (!searchTerm?.trim()) return [text];
  const needle = searchTerm.trim();
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "ig");
  const parts = text.split(re);
  return parts.map((part, idx) =>
    part.toLowerCase() === needle.toLowerCase() ? (
      <mark key={`mark-${idx}`} className="rounded bg-yellow-200 px-0.5">
        {part}
      </mark>
    ) : (
      <span key={`txt-${idx}`}>{part}</span>
    ),
  );
}

function rowMatchesUserSearch(row: Row, q: string, wsList: Ws[]): boolean {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return true;
  if (row.userId.toLowerCase().includes(needle)) return true;
  if (row.contactEmail.toLowerCase().includes(needle)) return true;
  for (const w of wsList) {
    if (!row.workspaces[w.id]) continue;
    if (w.name.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export default function AllUsersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.isAdmin ?? false;
  const myUserId = session?.user?.id ?? null;

  const [workspaces, setWorkspaces] = useState<Ws[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [baseline, setBaseline] = useState<Map<string, Baseline>>(new Map());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wsSyncBusy, setWsSyncBusy] = useState(false);
  const [userSearchText, setUserSearchText] = useState("");
  const [userSearchActive, setUserSearchActive] = useState("");
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  useEffect(() => {
    const q = userSearchText.trim();
    if (!q) {
      setUserSearchActive("");
      setUserSearchError(null);
      return;
    }
    if (q.length < 2) {
      setUserSearchActive("");
      setUserSearchError("Enter at least 2 characters");
      return;
    }
    const handle = window.setTimeout(() => {
      setUserSearchActive(q);
      setUserSearchError(null);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [userSearchText]);

  const filteredRows = useMemo(() => {
    const q = userSearchActive.trim();
    if (!q || q.length < 2) return rows;
    return rows.filter((r) => rowMatchesUserSearch(r, q, workspaces));
  }, [rows, userSearchActive, workspaces]);

  const syncWorkspaceColumns = useCallback(async () => {
    if (!isAdmin) return;
    setWsSyncBusy(true);
    try {
      const res = await fetch("/api/workspaces", { credentials: "include" });
      if (!res.ok) return;
      const d = await res.json();
      const raw = d.workspaces ?? [];
      const ws: Ws[] = raw.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name }));
      setWorkspaces(ws);
      setRows((prev) => mergeWorkspacesIntoRows(prev, ws));
    } finally {
      setWsSyncBusy(false);
    }
  }, [isAdmin]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoadErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/users", { credentials: "include" });
      if (res.status === 401) {
        window.location.href = "/login?callbackUrl=/workspaces/all-users";
        return;
      }
      if (!res.ok) {
        setLoadErr("Could not load users.");
        return;
      }
      const d = await res.json();
      const ws: Ws[] = d.workspaces ?? [];
      const users: ApiUser[] = d.users ?? [];
      setWorkspaces(ws);
      const nextRows = users.map((u) => userToRow(u, ws));
      setRows(nextRows);
      const b = new Map<string, Baseline>();
      for (const r of nextRows) {
        if (r.serverId) {
          b.set(r.serverId, {
            isAdmin: r.isAdmin,
            workspaceKey: workspaceKeyFromRow(r.workspaces),
            contactEmail: normalizeContactEmailField(r.contactEmail).toLowerCase(),
          });
        }
      }
      setBaseline(b);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (status === "authenticated" && !isAdmin) {
      router.replace("/workspaces");
      return;
    }
    if (status === "authenticated" && isAdmin) void load();
  }, [status, isAdmin, load, router]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    let tabWasHidden = false;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        tabWasHidden = true;
        return;
      }
      if (document.visibilityState === "visible" && tabWasHidden) {
        tabWasHidden = false;
        void syncWorkspaceColumns();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [status, isAdmin, syncWorkspaceColumns]);

  function addCreateRow() {
    setRows((prev) => [emptyDraftRow(workspaces), ...prev]);
    setSaveErr(null);
    setSaveMsg(null);
  }

  function updateRow(clientKey: string, patch: Partial<Row> | ((r: Row) => Row)) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.clientKey !== clientKey) return r;
        return typeof patch === "function" ? patch(r) : { ...r, ...patch };
      }),
    );
  }

  function setWorkspaceChecked(clientKey: string, wsId: string, checked: boolean) {
    updateRow(clientKey, (r) => ({
      ...r,
      workspaces: { ...r.workspaces, [wsId]: checked },
    }));
  }

  function removeRow(clientKey: string) {
    const row = rows.find((r) => r.clientKey === clientKey);
    if (!row) return;
    if (row.serverId && row.serverId === myUserId) {
      window.alert("You cannot remove your own account.");
      return;
    }
    if (!row.serverId) {
      setRows((prev) => prev.filter((r) => r.clientKey !== clientKey));
      return;
    }
    if (!window.confirm(`Remove user '${row.userId}'?`)) return;
    void (async () => {
      const res = await fetch(`/api/users/${encodeURIComponent(row.serverId!)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveErr(typeof data.error === "string" ? data.error : "Could not delete user.");
        return;
      }
      setRows((prev) => prev.filter((r) => r.clientKey !== clientKey));
      setBaseline((prev) => {
        const n = new Map(prev);
        n.delete(row.serverId!);
        return n;
      });
      setSaveMsg("User removed.");
      window.setTimeout(() => setSaveMsg(null), 3000);
    })();
  }

  async function saveAll() {
    setSaveErr(null);
    setSaveMsg(null);
    const trimmed = rows.map((r) => ({
      ...r,
      userId: r.userId.trim(),
      contactEmail: normalizeContactEmailField(r.contactEmail),
    }));

    for (const r of trimmed) {
      if (!r.userId) {
        setSaveErr("Every row must have a User (login ID).");
        return;
      }
      if (r.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.contactEmail)) {
        setSaveErr(`User '${r.userId}': enter a valid email or leave Email blank.`);
        return;
      }
      if (!r.isAdmin && selectedWorkspaceIds(r).length === 0) {
        setSaveErr(`User '${r.userId}': select at least one workspace, or mark as admin.`);
        return;
      }
    }

    const seen = new Set<string>();
    for (const r of trimmed) {
      const k = r.userId.toLowerCase();
      if (seen.has(k)) {
        setSaveErr(`Duplicate user ID: ${r.userId}`);
        return;
      }
      seen.add(k);
    }

    for (const r of trimmed) {
      if (!r.serverId && r.password.trim().length < 6) {
        setSaveErr(`New user '${r.userId || "(empty)"}': password must be at least 6 characters.`);
        return;
      }
    }

    setSaving(true);
    const errors: string[] = [];
    try {
      for (const r of trimmed) {
        if (!r.serverId) continue;
        const base = baseline.get(r.serverId);
        const wsKey = workspaceKeyFromRow(r.workspaces);
        const pwd = r.password.trim();
        const ceLower = r.contactEmail ? r.contactEmail.toLowerCase() : "";
        const needPatch =
          !base ||
          base.isAdmin !== r.isAdmin ||
          base.workspaceKey !== wsKey ||
          pwd.length >= 6 ||
          base.contactEmail !== ceLower;

        if (!needPatch) continue;

        const body: {
          accessLevel: "admin" | "workspace";
          workspaceIds?: string[];
          password?: string;
          contactEmail?: string | null;
        } = {
          accessLevel: r.isAdmin ? "admin" : "workspace",
          workspaceIds: r.isAdmin ? undefined : selectedWorkspaceIds(r),
          contactEmail: ceLower || null,
        };
        if (pwd.length >= 6) body.password = pwd;

        const res = await fetch(`/api/users/${encodeURIComponent(r.serverId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          errors.push(`${r.userId}: ${typeof data.error === "string" ? data.error : "Update failed"}`);
        }
      }

      for (const r of trimmed) {
        if (r.serverId) continue;
        const res = await fetch("/api/users", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: r.userId,
            password: r.password,
            accessLevel: r.isAdmin ? "admin" : "workspace",
            workspaceIds: r.isAdmin ? undefined : selectedWorkspaceIds(r),
            ...(r.contactEmail ? { contactEmail: r.contactEmail.toLowerCase() } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          errors.push(`${r.userId}: ${typeof data.error === "string" ? data.error : "Create failed"}`);
        }
      }

      if (errors.length > 0) {
        setSaveErr(errors.join(" · "));
        await load();
        return;
      }
      setSaveMsg("Saved.");
      window.setTimeout(() => setSaveMsg(null), 3000);
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href="/workspaces" className="text-sm text-slate-600 underline hover:text-slate-900">
            ← Workspaces
          </Link>
        </div>

        <div className="mb-4 flex w-full flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900">All users</h1>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="order-3 w-full min-w-[12rem] max-w-md flex-1 sm:order-none"
          >
            <input
              type="search"
              value={userSearchText}
              onChange={(e) => setUserSearchText(e.target.value)}
              placeholder="Search"
              aria-label="Search users"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
          </form>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAll()}
            className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {userSearchError && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {userSearchError}
          </div>
        )}

        {userSearchActive && !userSearchError && (
          <div className="mb-4 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm">
            Search results for &quot;<span className="font-semibold">{userSearchActive}</span>&quot; ({filteredRows.length})
          </div>
        )}

        <div className="mb-4">
          <button
            type="button"
            onClick={addCreateRow}
            className="rounded-md border border-amber-800/40 bg-slate-200 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-300"
          >
            Create user
          </button>
          <p className="mt-2 text-xs text-slate-600">
            Adds an empty row at the top. Fill User and Password, set admin or workspace access, then click Save.
          </p>
        </div>

        {loadErr && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadErr}</div>
        )}
        {saveErr && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{saveErr}</div>
        )}
        {saveMsg && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {saveMsg}
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={wsSyncBusy || loading}
            onClick={() => void syncWorkspaceColumns()}
            className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {wsSyncBusy ? "Refreshing…" : "Refresh workspace columns"}
          </button>
        </div>

        <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-slate-300 bg-white shadow-sm">
          <table className="w-max min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100">
                <th className="min-w-[9rem] border border-slate-300 px-2 py-2 font-semibold text-slate-800">User</th>
                <th className="min-w-[11rem] border border-slate-300 px-2 py-2 font-semibold text-slate-800">Email</th>
                <th className="min-w-[9rem] border border-slate-300 px-2 py-2 font-semibold text-slate-800">Password</th>
                <th className="min-w-[5rem] border border-slate-300 px-2 py-2 font-semibold text-slate-800">is_admin</th>
                {workspaces.map((w) => (
                  <th
                    key={w.id}
                    className="min-w-[8rem] whitespace-nowrap border border-slate-300 px-2 py-2 font-semibold text-slate-800"
                  >
                    {renderHighlightedText(w.name, userSearchActive)}
                  </th>
                ))}
                <th className="min-w-[5.5rem] border border-slate-300 px-2 py-2 font-semibold text-slate-800">Remove</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const wsDisabled = r.isAdmin;
                return (
                  <tr key={r.clientKey} className="border-b border-slate-200">
                    <td className="border border-slate-300 p-1 align-top">
                      {r.serverId ? (
                        <div className="min-w-[8rem] rounded border border-transparent bg-slate-50 px-2 py-1.5 text-sm text-slate-900">
                          {renderHighlightedText(r.userId, userSearchActive)}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={r.userId}
                          onChange={(e) => updateRow(r.clientKey, { userId: e.target.value })}
                          className="w-full min-w-[8rem] rounded border border-slate-300 px-2 py-1 text-sm"
                          autoComplete="off"
                          aria-label="User ID"
                        />
                      )}
                    </td>
                    <td className="border border-slate-300 p-1 align-top">
                      <input
                        type="email"
                        value={r.contactEmail}
                        onChange={(e) => updateRow(r.clientKey, { contactEmail: e.target.value })}
                        placeholder="Optional"
                        className="w-full min-w-[10rem] rounded border border-slate-300 px-2 py-1 text-sm"
                        autoComplete="off"
                        aria-label="Contact email"
                      />
                    </td>
                    <td className="border border-slate-300 p-1 align-top">
                      <input
                        type="password"
                        value={r.password}
                        onChange={(e) => updateRow(r.clientKey, { password: e.target.value })}
                        placeholder={r.serverId ? "New password (optional)" : "Required (min 6)"}
                        className="w-full min-w-[8rem] rounded border border-slate-300 px-2 py-1 text-sm"
                        autoComplete="new-password"
                      />
                    </td>
                    <td className="border border-slate-300 p-2 align-middle text-center">
                      <input
                        type="checkbox"
                        checked={r.isAdmin}
                        onChange={(e) =>
                          updateRow(r.clientKey, {
                            isAdmin: e.target.checked,
                          })
                        }
                        aria-label="Admin"
                        className="h-4 w-4"
                      />
                    </td>
                    {workspaces.map((w) => (
                      <td
                        key={w.id}
                        className={`border border-slate-300 p-2 align-middle text-center ${
                          wsDisabled ? "bg-slate-100 opacity-50" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={wsDisabled}
                          checked={!!r.workspaces[w.id]}
                          onChange={(e) => setWorkspaceChecked(r.clientKey, w.id, e.target.checked)}
                          aria-label={`Access ${w.name}`}
                          className="h-4 w-4 disabled:cursor-not-allowed"
                        />
                      </td>
                    ))}
                    <td className="border border-slate-300 p-2 align-middle text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(r.clientKey)}
                        disabled={r.serverId !== null && r.serverId === myUserId}
                        className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && !loadErr && <p className="mt-4 text-sm text-slate-500">No users yet.</p>}
        {rows.length > 0 && filteredRows.length === 0 && userSearchActive && !userSearchError && (
          <p className="mt-4 text-sm text-slate-600">No users match your search.</p>
        )}
      </div>
    </main>
  );
}
