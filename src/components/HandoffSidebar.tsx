"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { HandoffPanelChevronIcon, MonthAccordionChevronIcon } from "@/components/CollapseChevronIcon";
import {
  formatDdMmYyyyFromYmd,
  formatDdMmYyyySlashFromYmd,
  parseDdMmYyyyToYmd,
} from "@/lib/date-display";
import { HANDOFF_SIDEBAR_LIST_REFRESH } from "@/lib/handoff-sidebar-refresh";

type HandoffItem = { handoffDate: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function monthKeyFromYmd(ymd: string): string {
  const [y, m] = ymd.split("-");
  return `${m}-${y}`;
}

/** Same key shape as {@link monthKeyFromYmd} (`MM-YYYY`). */
function monthKeyFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${m}-${y}`;
}

function labelForMonthKey(key: string): string {
  const [mm, yyyy] = key.split("-");
  return `${mm}-${yyyy}`;
}

function sortMonthKeysDesc(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const [ma, ya] = a.split("-").map(Number);
    const [mb, yb] = b.split("-").map(Number);
    if (ya !== yb) return yb - ya;
    return mb - ma;
  });
}

function groupByMonth(handoffs: HandoffItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const h of handoffs) {
    const key = monthKeyFromYmd(h.handoffDate);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h.handoffDate);
  }
  for (const dates of map.values()) {
    dates.sort((a, b) => b.localeCompare(a));
  }
  return map;
}

function SidebarHandoffDateInput({
  workspaceId,
  ymd,
  className,
  onPicked,
}: {
  workspaceId: string;
  ymd: string;
  className?: string;
  onPicked?: () => void;
}) {
  const router = useRouter();
  const nativePickerRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => formatDdMmYyyySlashFromYmd(ymd));

  useEffect(() => {
    setText(formatDdMmYyyySlashFromYmd(ymd));
  }, [ymd]);

  function goTo(nextYmd: string) {
    onPicked?.();
    router.push(`/w/${encodeURIComponent(workspaceId)}/handoff/${nextYmd}`);
  }

  function commitText() {
    const parsed = parseDdMmYyyyToYmd(text);
    if (parsed) goTo(parsed);
    else setText(formatDdMmYyyySlashFromYmd(ymd));
  }

  const fieldClass =
    "rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 sm:text-sm";

  return (
    <div
      className={`flex shrink-0 items-stretch gap-0.5 ${className ?? ""}`.trim()}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Go to handoff date (DD/MM/YYYY)"
        className={`w-[9.1rem] min-w-0 max-w-full shrink-0 font-mono tabular-nums ${fieldClass}`.trim()}
      />
      <input
        ref={nativePickerRef}
        type="date"
        value={ymd}
        tabIndex={-1}
        aria-hidden
        className="fixed left-0 top-0 h-px w-px opacity-0"
        onChange={(e) => {
          const v = e.target.value;
          if (v) goTo(v);
        }}
      />
      <button
        type="button"
        aria-label="Open calendar"
        className={`shrink-0 text-slate-700 hover:bg-slate-50 ${fieldClass}`.trim()}
        onClick={() => {
          const el = nativePickerRef.current;
          if (el && "showPicker" in el && typeof (el as HTMLInputElement & { showPicker: () => void }).showPicker === "function") {
            void (el as HTMLInputElement & { showPicker: () => void }).showPicker();
          } else el?.click();
        }}
      >
        <span className="inline-block h-[1em] w-[1em] align-[-0.125em]" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </span>
      </button>
    </div>
  );
}

export function HandoffSidebar({
  workspaceId,
  collapsed,
  onToggleCollapsed,
  onCollapse,
}: {
  workspaceId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCollapse: () => void;
}) {
  const pathname = usePathname();
  const current =
    pathname?.match(
      new RegExp(`^/w/${escapeRegex(workspaceId)}/handoff/(\\d{4}-\\d{2}-\\d{2})$`),
    )?.[1] ?? null;
  const [handoffs, setHandoffs] = useState<HandoffItem[]>([]);
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [mobileDatesOpen, setMobileDatesOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/handoffs`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setHandoffs(data.handoffs ?? []);
    } catch {
      /* ignore */
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    function onRefresh() {
      void load();
    }
    window.addEventListener(HANDOFF_SIDEBAR_LIST_REFRESH, onRefresh);
    return () => window.removeEventListener(HANDOFF_SIDEBAR_LIST_REFRESH, onRefresh);
  }, [load]);

  const grouped = useMemo(() => groupByMonth(handoffs), [handoffs]);
  const monthKeys = useMemo(() => sortMonthKeysDesc([...grouped.keys()]), [grouped]);
  const calendarMonthKey = monthKeyFromLocalDate(new Date());

  function toggleMonth(key: string) {
    setOpenMonths((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const nav = (
    <nav className="space-y-2" aria-label="Handoffs by month">
      {monthKeys.map((key) => {
        const dates = grouped.get(key) ?? [];
        const open = key in openMonths ? openMonths[key]! : key === calendarMonthKey;
        return (
          <div key={key} className="rounded-lg border border-slate-200 bg-slate-50/80">
            <button
              type="button"
              onClick={() => toggleMonth(key)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 hover:bg-slate-100"
              aria-expanded={open}
            >
              <span>{labelForMonthKey(key)}</span>
              <span className="inline-flex shrink-0 items-center justify-center rounded p-0.5 text-slate-900">
                <MonthAccordionChevronIcon open={open} className="h-4 w-4" />
              </span>
            </button>
            {open && (
              <ul className="border-t border-slate-200 bg-white px-2 py-1">
                {dates.map((ymd) => (
                  <li key={ymd}>
                    <Link
                      href={`/w/${encodeURIComponent(workspaceId)}/handoff/${ymd}`}
                      onClick={() => {
                        onCollapse();
                        setMobileDatesOpen(false);
                      }}
                      className={`block rounded px-2 py-1.5 text-sm ${current === ymd
                          ? "bg-emerald-100 font-medium text-emerald-900"
                          : "text-slate-700 hover:bg-slate-50"
                        }`}
                    >
                      {formatDdMmYyyyFromYmd(ymd)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );

  const asideWidth = collapsed
    ? "lg:w-10 lg:min-w-10 lg:max-w-10"
    : "lg:w-72 lg:min-w-72 lg:max-w-72";

  return (
    <>
      <div className="border-b border-slate-200 bg-white p-3 lg:hidden">
        <details
          open={mobileDatesOpen}
          onToggle={(e) => setMobileDatesOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="shrink-0">Date</span>
                {current && (
                  <SidebarHandoffDateInput
                    workspaceId={workspaceId}
                    ymd={current}
                    onPicked={() => setMobileDatesOpen(false)}
                    className="max-w-[10rem] rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-800"
                  />
                )}
              </span>
              <span className="inline-flex shrink-0 rounded border border-slate-800 p-0.5">
                <HandoffPanelChevronIcon collapsed={!mobileDatesOpen} className="h-4 w-4" />
              </span>
            </span>
          </summary>
          <div className="mt-2 max-h-[50vh] overflow-y-auto pr-1">
            {handoffs.length === 0 ? (
              <p className="text-xs text-slate-500">No saved handoffs yet.</p>
            ) : (
              nav
            )}
          </div>
        </details>
      </div>
      <aside
        className={`hidden shrink-0 overflow-hidden border-slate-200 bg-white transition-[width] duration-300 ease-in-out lg:flex lg:flex-col lg:border-r ${asideWidth}`}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex h-full min-h-[12rem] w-full flex-col items-center gap-3 py-3 text-slate-700 hover:bg-slate-50"
            title="Open dates"
            aria-label="Open dates"
          >
            <HandoffPanelChevronIcon collapsed className="h-5 w-5" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-600 [writing-mode:vertical-rl]">
              Dates
            </span>
          </button>
        ) : (
          <>
            <div className="mb-2 flex min-w-0 items-center gap-2 p-3 pb-0">
              <p className="shrink-0 text-sm font-semibold text-slate-800">Date</p>
              <span className="min-w-0 flex-1" aria-hidden="true" />
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {current && (
                  <SidebarHandoffDateInput
                    workspaceId={workspaceId}
                    ymd={current}
                    onPicked={onCollapse}
                  />
                )}
                <button
                  type="button"
                  onClick={onToggleCollapsed}
                  className="inline-flex shrink-0 items-center justify-center rounded border border-slate-800 p-0.5 text-slate-900 hover:bg-slate-100"
                  title="Collapse dates panel"
                  aria-label="Collapse dates panel"
                >
                  <HandoffPanelChevronIcon collapsed={false} className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-2">
              {handoffs.length === 0 ? (
                <p className="text-xs text-slate-500">No saved handoffs yet.</p>
              ) : (
                nav
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
