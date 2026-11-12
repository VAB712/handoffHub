"use client";

import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitAddresses(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const address = part.trim().toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

function mergeAddresses(
  current: string[],
  raw: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  const parts = raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: true, value: current };
  const next = [...current];
  for (const part of parts) {
    if (!EMAIL_RE.test(part)) return { ok: false, error: `Invalid email: ${part}` };
    const address = part.toLowerCase();
    if (!next.includes(address)) next.push(address);
  }
  return { ok: true, value: next };
}

export function WorkspaceNameMailDialog({
  title,
  name,
  mailTo,
  busy,
  error,
  submitLabel,
  onNameChange,
  onMailChange,
  onCancel,
  onSubmit,
  onScheduleMail,
}: {
  title: string;
  name: string;
  mailTo: string;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onNameChange: (value: string) => void;
  onMailChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (mailTo: string) => void;
  onScheduleMail?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [mailErr, setMailErr] = useState<string | null>(null);
  const addresses = splitAddresses(mailTo);

  function applyDraft(raw: string): string[] | null {
    const merged = mergeAddresses(addresses, raw);
    if (!merged.ok) {
      setMailErr(merged.error);
      return null;
    }
    setMailErr(null);
    setDraft("");
    onMailChange(merged.value.join(", "));
    return merged.value;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = applyDraft(draft);
    if (!next) return;
    onSubmit(next.join(", "));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 px-4 pt-24">
      <form
        onSubmit={handleSubmit}
        className="max-h-[calc(100vh-8rem)] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
      >
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <label className="mt-3 block text-xs font-medium text-slate-600" htmlFor="ws-name">
          Workspace name
        </label>
        <input
          id="ws-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
          autoFocus
        />
        <label className="mt-3 block text-xs font-medium text-slate-600" htmlFor="ws-mail">
          Mail / DL
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="ws-mail"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (mailErr) setMailErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              applyDraft(draft);
            }}
            placeholder="name@company.com"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => applyDraft(draft)}
            disabled={!draft.trim()}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Add one or more addresses. Mail goes to all of them in the same email.
        </p>
        {addresses.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {addresses.map((address) => (
              <li
                key={address}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-300 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-800"
              >
                <span className="truncate">{address}</span>
                <button
                  type="button"
                  onClick={() => {
                    setMailErr(null);
                    onMailChange(addresses.filter((item) => item !== address).join(", "));
                  }}
                  aria-label={`Remove ${address}`}
                  className="rounded px-1 text-slate-500 hover:text-slate-900"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {mailErr && <p className="mt-2 text-sm text-red-700">{mailErr}</p>}
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Saving…" : submitLabel}
          </button>
          {onScheduleMail && (
            <button
              type="button"
              onClick={onScheduleMail}
              className="rounded-md border border-slate-900 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              Schedule mail
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
