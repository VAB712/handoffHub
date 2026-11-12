"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { padClock } from "@/lib/mail-schedule";

type Schedule = {
  id: string;
  hour: number;
  minute: number;
  timeZone: string;
};

const ITEM_PX = 40;
const VISIBLE = 5;
const PAD = Math.floor(VISIBLE / 2);
const HOURS = Array.from({ length: 24 }, (_, i) => padClock(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => padClock(i));

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function nowParts(): { hour: string; minute: string } {
  const now = new Date();
  return { hour: padClock(now.getHours()), minute: padClock(now.getMinutes()) };
}

function Wheel({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const ignore = useRef(false);
  const fromUserScroll = useRef(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (fromUserScroll.current) {
      fromUserScroll.current = false;
      return;
    }
    const index = Math.max(0, items.indexOf(value));
    ignore.current = true;
    el.scrollTop = index * ITEM_PX;
    const id = window.requestAnimationFrame(() => {
      ignore.current = false;
    });
    return () => window.cancelAnimationFrame(id);
  }, [items, value]);

  function pickFromScroll() {
    const el = scroller.current;
    if (!el || ignore.current) return;
    const index = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_PX)));
    const next = items[index];
    if (next && next !== value) {
      fromUserScroll.current = true;
      onChange(next);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <div className="relative h-[200px] w-16">
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-10 -translate-y-1/2 rounded-md border border-slate-300 bg-slate-100/80"
          aria-hidden
        />
        <div
          ref={scroller}
          role="listbox"
          aria-label={label}
          onScroll={pickFromScroll}
          className="relative z-20 h-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollSnapType: "y mandatory" }}
        >
          {Array.from({ length: PAD }, (_, i) => (
            <div key={`pad-top-${i}`} className="h-10" aria-hidden />
          ))}
          {items.map((item) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={item === value}
              onClick={() => onChange(item)}
              className={`flex h-10 w-full items-center justify-center text-lg tabular-nums ${
                item === value ? "font-semibold text-slate-900" : "text-slate-400"
              }`}
              style={{ scrollSnapAlign: "center" }}
            >
              {item}
            </button>
          ))}
          {Array.from({ length: PAD }, (_, i) => (
            <div key={`pad-bot-${i}`} className="h-10" aria-hidden />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ScheduleMailDialog({ api, onClose }: { api: string; onClose: () => void }) {
  const timeZone = localTimeZone();
  const initial = nowParts();
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [mailTo, setMailTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`${api}/mail-schedules`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not load schedules");
        setReady(true);
        return;
      }
      setMailTo(typeof data.mailTo === "string" ? data.mailTo : null);
      setSchedules(Array.isArray(data.schedules) ? data.schedules : []);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { hour: Number(hour), minute: Number(minute), timeZone };
      const res = await fetch(editingId ? `${api}/mail-schedules/${editingId}` : `${api}/mail-schedules`, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save schedule");
      const saved = data.schedule as Schedule;
      setSchedules((prev) => {
        const next = editingId ? prev.map((row) => (row.id === saved.id ? saved : row)) : [...prev, saved];
        return next.sort((a, b) => a.hour - b.hour || a.minute - b.minute || a.timeZone.localeCompare(b.timeZone));
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save schedule");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this daily mail schedule?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${api}/mail-schedules/${id}`, { method: "DELETE", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not delete schedule");
      setSchedules((prev) => prev.filter((row) => row.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete schedule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/30 px-4 py-10">
      <form onSubmit={(e) => void save(e)} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
        <h2 className="text-sm font-semibold text-slate-900">Schedule mail</h2>
        <p className="mt-1 text-xs text-slate-600">
          Scroll to a time in 24-hour format. It uses your local timezone ({timeZone}) and sends the latest handoff every
          day in one email to every address saved on this workspace.
        </p>
        {ready && !mailTo && (
          <p className="mt-2 text-xs text-amber-800">
            No mail address is saved yet. Add addresses in Edit and save before the scheduled mail can send.
          </p>
        )}

        <div className="mt-4 flex items-center justify-center gap-2">
          <Wheel label="Hour" items={HOURS} value={hour} onChange={setHour} />
          <span className="pt-5 text-2xl font-semibold text-slate-700">:</span>
          <Wheel label="Minute" items={MINUTES} value={minute} onChange={setMinute} />
        </div>
        <p className="mt-2 text-center text-sm font-medium tabular-nums text-slate-800">
          {hour}:{minute}
          {editingId ? " — updating" : ""}
        </p>

        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Saving…" : editingId ? "Update schedule" : "Add schedule"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel update
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-4 border-t border-slate-200 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled</h3>
          {schedules.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No scheduled mail yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {schedules.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-2">
                  <div>
                    <p className="text-sm font-medium tabular-nums text-slate-900">
                      {padClock(row.hour)}:{padClock(row.minute)}
                    </p>
                    <p className="text-[11px] text-slate-500">Every day · {row.timeZone}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(row.id);
                        setHour(padClock(row.hour));
                        setMinute(padClock(row.minute));
                        setError(null);
                      }}
                      className="text-xs font-medium text-slate-800 underline hover:text-slate-950 disabled:opacity-50"
                    >
                      Update
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(row.id)}
                      className="text-xs font-medium text-red-700 underline hover:text-red-900 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </div>
  );
}
