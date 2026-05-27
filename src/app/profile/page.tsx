"use client";

import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [contactErr, setContactErr] = useState<string | null>(null);
  const [contactMsg, setContactMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    void (async () => {
      const res = await fetch("/api/users/me", { credentials: "include" });
      if (!res.ok) return;
      const d = (await res.json()) as { contactEmail?: string | null };
      setContactEmail(typeof d.contactEmail === "string" ? d.contactEmail : "");
    })();
  }, [status]);

  async function saveContactEmail(e: React.FormEvent) {
    e.preventDefault();
    setContactErr(null);
    setContactMsg(null);
    const trimmed = contactEmail.trim();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setContactErr("Enter a valid email or leave blank.");
      return;
    }
    setContactBusy(true);
    const res = await fetch("/api/users/me", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactEmail: trimmed || "" }),
    });
    const data = await res.json().catch(() => ({}));
    setContactBusy(false);
    if (!res.ok) {
      setContactErr(typeof data.error === "string" ? data.error : "Could not save.");
      return;
    }
    setContactMsg("Saved.");
    window.setTimeout(() => setContactMsg(null), 3000);
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (newPassword !== confirmPassword) {
      setErr("New password and confirm password do not match.");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/users/password", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setErr(typeof data.error === "string" ? data.error : "Could not update password.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMsg("Password updated.");
  }

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Loading…</p>
      </main>
    );
  }

  if (!session?.user) {
    if (typeof window !== "undefined") window.location.href = "/login?callbackUrl=/profile";
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Profile</h1>
            <p className="mt-1 text-sm text-slate-600">Manage your login details.</p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="shrink-0 text-sm text-slate-600 underline hover:text-slate-900"
          >
            Sign out
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">User ID (login)</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{session.user.email}</p>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Email (optional)</h2>
          <p className="mt-1 text-xs text-slate-600">
            Contact email for notifications or directory display. Different from your login User ID.
          </p>
          <form onSubmit={saveContactEmail} className="mt-3 flex flex-wrap items-end gap-2">
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@company.com"
              className="min-w-[12rem] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              autoComplete="email"
            />
            <button
              type="submit"
              disabled={contactBusy}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {contactBusy ? "Saving…" : "Save email"}
            </button>
          </form>
          {contactErr && <p className="mt-2 text-sm text-red-700">{contactErr}</p>}
          {contactMsg && <p className="mt-2 text-sm text-emerald-700">{contactMsg}</p>}
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
          <form onSubmit={updatePassword} className="mt-3 space-y-3">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
              minLength={6}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
              minLength={6}
            />
            {err && <p className="text-sm text-red-700">{err}</p>}
            {msg && <p className="text-sm text-emerald-700">{msg}</p>}
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Updating..." : "Change password"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
