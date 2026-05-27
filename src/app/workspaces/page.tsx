"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";

type Ws = { id: string; name: string; sortOrder: number };
type AccessLevel = "admin" | "workspace";
function localTodayYmd(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function WorkspacesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [list, setList] = useState<Ws[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [redirected, setRedirected] = useState(false);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [usersMsg, setUsersMsg] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState("");
  const [newUserContactEmail, setNewUserContactEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserAccessLevel, setNewUserAccessLevel] = useState<AccessLevel>("workspace");
  const [newUserWorkspaceIds, setNewUserWorkspaceIds] = useState<string[]>([]);
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [bulkFailedRows, setBulkFailedRows] = useState<Array<{ row: number; userId: string; error: string }>>([]);
  const [removeWsBusyId, setRemoveWsBusyId] = useState<string | null>(null);
  const isAdmin = session?.user?.isAdmin ?? false;

  const load = useCallback(async () => {
    setErr(null);
    const res = await fetch("/api/workspaces", { credentials: "include" });
    if (res.status === 401) {
      window.location.href = "/login?callbackUrl=/workspaces";
      return;
    }
    if (!res.ok) {
      setErr("Could not load workspaces.");
      return;
    }
    const d = await res.json();
    setList(d.workspaces ?? []);
  }, []);

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status, load]);

  useEffect(() => {
    if (status !== "authenticated" || isAdmin || redirected) return;
    if (list.length !== 1) return;
    setRedirected(true);
    const ymd = localTodayYmd();
    router.replace(`/w/${encodeURIComponent(list[0]!.id)}/handoff/${ymd}`);
  }, [status, isAdmin, redirected, list, router]);

  async function addWorkspace() {
    const name = window.prompt("New workspace name");
    if (!name?.trim()) return;
    const res = await fetch("/api/workspaces", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      window.alert("Could not add (admin only).");
      return;
    }
    await load();
  }

  function openWorkspace(id: string) {
    const ymd = localTodayYmd();
    router.push(`/w/${encodeURIComponent(id)}/handoff/${ymd}`);
  }

  async function removeWorkspace(ws: Ws) {
    if (
      !window.confirm(
        `Delete workspace "${ws.name}"? All handoff history for this workspace will be permanently deleted. This cannot be undone.`,
      )
    ) {
      return;
    }
    setRemoveWsBusyId(ws.id);
    setErr(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(ws.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Could not remove workspace.");
        return;
      }
      await load();
    } finally {
      setRemoveWsBusyId(null);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setUsersErr(null);
    setUsersMsg(null);
    const body: {
      userId: string;
      password: string;
      accessLevel: AccessLevel;
      workspaceIds?: string[];
      contactEmail?: string | null;
    } = {
      userId: newUserId.trim(),
      password: newUserPassword,
      accessLevel: newUserAccessLevel,
    };
    if (newUserAccessLevel === "workspace") body.workspaceIds = newUserWorkspaceIds;
    const ce = newUserContactEmail.trim();
    if (ce) body.contactEmail = ce;

    const res = await fetch("/api/users", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUsersErr(typeof data.error === "string" ? data.error : "Could not create user.");
      return;
    }
    setUsersMsg("User created.");
    setNewUserId("");
    setNewUserContactEmail("");
    setNewUserPassword("");
    setNewUserWorkspaceIds([]);
  }

  async function updateOwnPassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordErr(null);
    setPasswordMsg(null);
    if (pwdNew !== pwdConfirm) {
      setPasswordErr("New password and confirm password do not match.");
      return;
    }
    const res = await fetch("/api/users/password", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwdCurrent, newPassword: pwdNew }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPasswordErr(typeof data.error === "string" ? data.error : "Could not update password.");
      return;
    }
    setPwdCurrent("");
    setPwdNew("");
    setPwdConfirm("");
    setPasswordMsg("Password updated.");
  }

  async function downloadBulkTemplate() {
    const res = await fetch("/api/users/bulk", { credentials: "include" });
    if (!res.ok) {
      setBulkErr("Could not download template.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "handoff-hub-users-template.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function uploadBulkUsers(e: React.FormEvent) {
    e.preventDefault();
    if (!bulkFile) return;
    setBulkBusy(true);
    setBulkErr(null);
    setBulkMsg(null);
    setBulkFailedRows([]);
    try {
      const fd = new FormData();
      fd.set("file", bulkFile);
      const res = await fetch("/api/users/bulk", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBulkErr(typeof data.error === "string" ? data.error : "Bulk upload failed.");
        return;
      }
      const failedRows = Array.isArray(data.results)
        ? (data.results as Array<{ row: number; userId?: string; ok: boolean; error?: string }>)
          .filter((r) => !r.ok)
          .map((r) => ({
            row: Number(r.row) || 0,
            userId: typeof r.userId === "string" ? r.userId : "",
            error: typeof r.error === "string" ? r.error : "Unknown error",
          }))
        : [];
      setBulkFailedRows(failedRows);
      setBulkMsg(`Bulk upload done. Created: ${data.created ?? 0}, Failed: ${data.failed ?? 0}.`);
      setBulkFile(null);
    } finally {
      setBulkBusy(false);
    }
  }

  function downloadBulkErrorReportCsv() {
    if (bulkFailedRows.length === 0) return;
    const rows = [
      ["row", "user_id", "error"],
      ...bulkFailedRows.map((r) => [String(r.row), r.userId, r.error]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => {
            const escaped = String(cell).replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "handoff-hub-bulk-user-errors.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Loading…</p>
      </main>
    );
  }

  const workspaceList = (
    <>
      <ul className="space-y-2">
        {list.map((w) => (
          <li key={w.id} className="flex gap-2">
            <button
              type="button"
              onClick={() => openWorkspace(w.id)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-900 shadow-sm hover:border-emerald-300 hover:bg-emerald-50/50"
            >
              {w.name}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => void removeWorkspace(w)}
                disabled={removeWsBusyId !== null}
                title="Delete workspace"
                className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-3 text-xs font-medium text-red-800 shadow-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removeWsBusyId === w.id ? "…" : "Delete"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {list.length === 0 && !err && (
        <p className="mt-4 text-sm text-slate-500">No workspaces yet. Run db seed or ask an admin to add one.</p>
      )}

      {isAdmin && (
        <button
          type="button"
          onClick={() => void addWorkspace()}
          className="mt-6 w-full rounded-lg border border-dashed border-slate-400 bg-white py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          + Add workspace
        </button>
      )}
    </>
  );

  const updatePasswordCard = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Update password</h2>
      <form onSubmit={updateOwnPassword} className="mt-3 space-y-3">
        <input
          type="password"
          value={pwdCurrent}
          onChange={(e) => setPwdCurrent(e.target.value)}
          placeholder="Current password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
        />
        <input
          type="password"
          value={pwdNew}
          onChange={(e) => setPwdNew(e.target.value)}
          placeholder="New password (min 6 chars)"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
          minLength={6}
        />
        <input
          type="password"
          value={pwdConfirm}
          onChange={(e) => setPwdConfirm(e.target.value)}
          placeholder="Confirm new password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
          minLength={6}
        />
        {passwordErr && <p className="text-sm text-red-700">{passwordErr}</p>}
        {passwordMsg && <p className="text-sm text-emerald-700">{passwordMsg}</p>}
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Change password
        </button>
      </form>
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className={`mx-auto ${isAdmin ? "max-w-6xl" : "max-w-lg"}`}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Workspaces</h1>
            <p className="mt-1 text-sm text-slate-600">
              Choose a workspace to open its handoff board. Each tab has its own handoff history.
            </p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="shrink-0 text-sm text-slate-600 underline hover:text-slate-900"
          >
            Sign out
          </button>
        </div>

        {err && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </div>
        )}

        {isAdmin ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
            <div className="min-w-0 space-y-8">
              {workspaceList}
              {updatePasswordCard}
            </div>
            <div className="min-w-0">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Admin - Create user</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Create a login user ID and set access level: full admin or one/more workspace access.
                </p>
                <form onSubmit={createUser} className="mt-3 space-y-3">
                  <input
                    type="text"
                    value={newUserId}
                    onChange={(e) => setNewUserId(e.target.value)}
                    placeholder="User ID (example: feProd)"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <input
                    type="email"
                    value={newUserContactEmail}
                    onChange={(e) => setNewUserContactEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    autoComplete="off"
                  />
                  <input
                    type="password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Password (min 6 chars)"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                    minLength={6}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      value={newUserAccessLevel}
                      onChange={(e) => setNewUserAccessLevel(e.target.value as AccessLevel)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      title={
                        newUserAccessLevel === "workspace"
                          ? "Workspace access: assign one or more workspaces. User can view/edit only assigned workspaces."
                          : "Admin access: full access to all workspaces and admin management actions."
                      }
                    >
                      <option value="workspace" title="Assign one or more workspaces">
                        Workspace access
                      </option>
                      <option value="admin" title="Full admin access">
                        Admin access
                      </option>
                    </select>
                    <div className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
                      <p className="mb-1 text-xs text-slate-600">Workspace access</p>
                      <div className="max-h-32 space-y-1 overflow-auto pr-1">
                        {list.map((w) => (
                          <label key={w.id} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              disabled={newUserAccessLevel !== "workspace"}
                              checked={newUserWorkspaceIds.includes(w.id)}
                              onChange={(e) =>
                                setNewUserWorkspaceIds((prev) =>
                                  e.target.checked ? [...prev, w.id] : prev.filter((id) => id !== w.id),
                                )
                              }
                            />
                            <span>{w.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  {newUserAccessLevel === "workspace" && newUserWorkspaceIds.length === 0 && (
                    <p className="text-xs text-amber-700">Select at least one workspace.</p>
                  )}
                  {usersErr && <p className="text-sm text-red-700">{usersErr}</p>}
                  {usersMsg && <p className="text-sm text-emerald-700">{usersMsg}</p>}
                  <button
                    type="submit"
                    disabled={newUserAccessLevel === "workspace" && newUserWorkspaceIds.length === 0}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Create user
                  </button>
                </form>

                <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Bulk add users</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Download template, fill rows (`user_id`, optional `contact_email`, `password`, `is_admin`, workspace
                    columns), then upload.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void downloadBulkTemplate()}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      Download template
                    </button>
                  </div>
                  <form onSubmit={uploadBulkUsers} className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)}
                      className="text-xs text-slate-700"
                    />
                    <button
                      type="submit"
                      disabled={!bulkFile || bulkBusy}
                      className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {bulkBusy ? "Uploading..." : "Upload users"}
                    </button>
                  </form>
                  {bulkErr && <p className="mt-2 text-xs text-red-700">{bulkErr}</p>}
                  {bulkMsg && <p className="mt-2 text-xs text-emerald-700">{bulkMsg}</p>}
                  {bulkFailedRows.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={downloadBulkErrorReportCsv}
                        className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Download error report (CSV)
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-6 border-t border-slate-200 pt-4">
                  <Link
                    href="/workspaces/all-users"
                    className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    All users
                  </Link>
                  <p className="mt-2 text-xs text-slate-600">
                    Table view: edit access, add users or remove users.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {workspaceList}
            <div className="mt-8">{updatePasswordCard}</div>
          </>
        )}
      </div>
    </main>
  );
}
