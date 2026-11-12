"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { Priority, Team } from "@prisma/client";
import { canEditComment } from "@/lib/comment-permissions";
import { pickLatestCommentIdFromRows } from "@/lib/comment-latest";
import { CollapseChevronIcon } from "@/components/CollapseChevronIcon";
import { formatDdMmYyyyFromYmd, formatDdMmYyyyInTz, formatHandoffTitle } from "@/lib/date-display";
import { requestHandoffSidebarListRefresh } from "@/lib/handoff-sidebar-refresh";
import { buildClipboardHtmlDocument, writeRichHtmlToClipboard } from "@/lib/cf-html-clipboard";
import { parseTeamValue, teamMailColor, teamSelectLabel, teamTextClass, TEAM_VALUES } from "@/lib/team";

type AttachmentMeta = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: string;
};

type CommentRow = {
  id: string;
  team: Team;
  body: string;
  prefix: string;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  author: { name: string | null; email: string };
  attachments: AttachmentMeta[];
};

type TopicRow = {
  id: string;
  summary: string;
  owner: string | null;
  priority: Priority | null;
  sheetData: TopicSheetData | null;
  isClosed: boolean;
  createdAt: string;
  sortOrder: number;
  comments: CommentRow[];
};

type SearchResultRow = {
  topicId: string;
  handoffDate: string;
  summary: string;
  owner: string | null;
  priority: Priority | null;
  matchedInSummary: boolean;
  matchedInUpdates: boolean;
  matchedInSheet: boolean;
  latestMatchingUpdate: string | null;
};

type SheetCellData = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

type TopicSheetData = {
  cols: number;
  rows: number;
  headers: string[];
  cells: SheetCellData[][];
};

const TEAM_STORAGE = "handoff_team";
/** Widen with API `sheetData` limits in `topics/[id]/route.ts`. */
const MAX_SHEET_COLS = 26;
const MAX_SHEET_ROWS = 50;
const MAX_SHEET_CELL_TEXT = 5_000;
/** Background refresh interval while the handoff page is open (viewers see others’ updates). */
const HANDOFF_POLL_MS = 25_000;

type HandoffTableSort =
  | { kind: "default" }
  | { kind: "priority"; dir: "asc" | "desc" }
  | { kind: "owner"; dir: "asc" | "desc" };

function compareCreatedDescendingThenOrder(a: TopicRow, b: TopicRow): number {
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return tb - ta;
  return a.sortOrder - b.sortOrder;
}

/** Min px per column when resizing: status, summary, owner, priority, updates, sheet. */
const HANDOFF_PRIORITY_COL_MIN_PX = 100;
const HANDOFF_TABLE_COL_MIN = [32, 120, 64, HANDOFF_PRIORITY_COL_MIN_PX, 80, 100] as const;
const HANDOFF_TABLE_COL_MAX = 900;
/** Sheet column when at least one item has a sheet. */
const SHEET_COL_WIDE = 320;
/** Sheet column when the handoff has no sheets, so Updates can use the space. */
const SHEET_COL_NARROW = 112;

function isComposingInHandoffMain(root: HTMLElement | null): boolean {
  if (!root) return false;
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return false;
  if (!root.contains(el)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    if (
      type === "button" ||
      type === "submit" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "hidden" ||
      type === "file"
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function TeamSelectOptions() {
  return (
    <>
      {TEAM_VALUES.map((value) => (
        <option key={value} value={value}>
          {teamSelectLabel(value)}
        </option>
      ))}
    </>
  );
}

/** Prepended once to the stored comment when removing escalation via Add update (then user text). */
const REMOVE_ESCALATION_COMMENT_PREFIX = "Escalation marker Remove - ";

/** Legacy: high priority + latest comment still prefixed ESCALATED (before `escalated` enum). */
function isEscalatedByLatestComment(topic: TopicRow): boolean {
  if (topic.priority !== "high") return false;
  const ordered = commentsInChronologicalOrder(topic);
  const latest = ordered[ordered.length - 1];
  if (!latest) return false;
  return latest.body.trim().toUpperCase().startsWith("ESCALATED");
}

function isTopicEscalated(topic: TopicRow): boolean {
  return topic.priority === "escalated" || isEscalatedByLatestComment(topic);
}

function formatPriorityCell(priority: Priority | null): string {
  if (!priority) return "-";
  if (priority === "escalated") return "ESCALATED";
  return priority.toUpperCase();
}

/** Bold priority label: Low blue, Mid orange, High & Escalated red. */
function priorityLabelTextClass(topic: TopicRow): string {
  if (isTopicEscalated(topic) || topic.priority === "high") return "text-red-700";
  if (topic.priority === "mid") return "text-orange-600";
  if (topic.priority === "low") return "text-blue-700";
  return "text-slate-700";
}

/** Faint first-column background: same hue family as priority text, one step darker than *-50. */
function priorityFirstColumnBgClass(topic: TopicRow): string {
  if (isTopicEscalated(topic) || topic.priority === "high") return "bg-red-100";
  if (topic.priority === "mid") return "bg-orange-100";
  if (topic.priority === "low") return "bg-blue-100";
  return "bg-slate-100";
}

function priorityLabelTextClassForSearch(priority: Priority | null): string {
  if (priority === "escalated" || priority === "high") return "text-red-700";
  if (priority === "mid") return "text-orange-600";
  if (priority === "low") return "text-blue-700";
  return "text-slate-700";
}

function topicSortRank(topic: TopicRow): number {
  if (isTopicEscalated(topic)) return 100;
  return priorityRank(topic.priority ?? null);
}

function renderSummaryWithEscalation(topic: TopicRow, searchTerm: string | null): React.ReactNode {
  if (!isTopicEscalated(topic)) {
    return renderHighlightedText(topic.summary, searchTerm);
  }
  return (
    <>
      <span className="font-bold text-red-900">ESCALATED - </span>
      {renderHighlightedText(topic.summary, searchTerm)}
    </>
  );
}

function priorityRank(priority: Priority | null): number {
  if (priority === "escalated") return 4;
  if (priority === "high") return 3;
  if (priority === "mid") return 2;
  if (priority === "low") return 1;
  return 0;
}

const URL_RE = /((?:https?:\/\/|www\.)[^\s]+)/gi;
const URL_PART_RE = /^(?:https?:\/\/|www\.)[^\s]+$/i;

function renderHighlightedText(text: string, searchTerm: string | null): React.ReactNode[] {
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

function renderTextWithLinks(text: string, searchTerm?: string | null): React.ReactNode[] {
  const parts = text.split(URL_RE);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (URL_PART_RE.test(part)) {
      const href = /^www\./i.test(part) ? `https://${part}` : part;
      return (
        <a
          key={`link-${idx}-${part}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="break-all text-blue-700 underline hover:text-blue-900"
        >
          {renderHighlightedText(part, searchTerm ?? null)}
        </a>
      );
    }
    return <span key={`txt-${idx}`}>{renderHighlightedText(part, searchTerm ?? null)}</span>;
  });
}

function makeEmptyCell(): SheetCellData {
  return { text: "", bold: false, italic: false, underline: false };
}

function createSheetData(cols: number, rows: number): TopicSheetData {
  const safeCols = Math.max(1, Math.min(MAX_SHEET_COLS, cols));
  const safeRows = Math.max(1, Math.min(MAX_SHEET_ROWS, rows));
  const headers = Array.from({ length: safeCols }, (_, i) => excelColLabel(i));
  const cells = Array.from({ length: safeRows }, (_, r) =>
    Array.from({ length: safeCols }, (_, c) =>
      r === 0
        ? { text: headers[c], bold: false, italic: false, underline: false }
        : makeEmptyCell(),
    ),
  );
  return withSyncedHeaders({
    cols: safeCols,
    rows: safeRows,
    headers,
    cells,
  });
}

function excelColLabel(index: number) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function rowTextsMatchHeaders(
  cellsRow: SheetCellData[] | undefined,
  hdrs: string[],
  cols: number,
): boolean {
  if (!cellsRow) return false;
  for (let c = 0; c < cols; c++) {
    const h = clipHeaderText(hdrs[c] ?? "");
    const t = clipHeaderText(cellsRow[c]?.text ?? "");
    if (h !== t) return false;
  }
  return true;
}

function normalizeSheetData(input: TopicSheetData | null | undefined): TopicSheetData | null {
  if (!input || !Array.isArray(input.cells)) return null;
  const safeCols = Math.max(1, Math.min(MAX_SHEET_COLS, input.cols));
  const incomingHeaders = Array.isArray((input as { headers?: unknown }).headers)
    ? ((input as { headers?: unknown[] }).headers ?? [])
    : [];
  const hdrs = Array.from({ length: safeCols }, (_, c) => {
    const maybeHeader = incomingHeaders[c];
    return typeof maybeHeader === "string" ? maybeHeader : excelColLabel(c);
  });

  const bodyCells = input.cells;
  const declaredRows = Math.min(MAX_SHEET_ROWS, Math.max(1, input.rows));

  const unified =
    declaredRows === bodyCells.length && rowTextsMatchHeaders(bodyCells[0], hdrs, safeCols);

  let mergedCells: SheetCellData[][];

  if (unified) {
    mergedCells = Array.from({ length: declaredRows }, (_, r) =>
      Array.from({ length: safeCols }, (_, c) => {
        const source = bodyCells[r]?.[c];
        if (!source) return makeEmptyCell();
        return {
          text: clipCellText(typeof source.text === "string" ? source.text : ""),
          bold: !!source.bold,
          italic: !!source.italic,
          underline: !!source.underline,
        };
      }),
    );
  } else {
    mergedCells = [
      Array.from({ length: safeCols }, (_, c) => ({
        text: clipCellText(hdrs[c]),
        bold: false,
        italic: false,
        underline: false,
      })),
    ];
    for (let r = 0; r < declaredRows && mergedCells.length < MAX_SHEET_ROWS; r++) {
      const row = bodyCells[r];
      mergedCells.push(
        Array.from({ length: safeCols }, (_, c) => {
          const source = row?.[c];
          if (!source) return makeEmptyCell();
          return {
            text: clipCellText(typeof source.text === "string" ? source.text : ""),
            bold: !!source.bold,
            italic: !!source.italic,
            underline: !!source.underline,
          };
        }),
      );
    }
  }

  for (const row of mergedCells) {
    while (row.length < safeCols) row.push(makeEmptyCell());
    row.length = safeCols;
  }
  mergedCells = mergedCells.slice(0, MAX_SHEET_ROWS);

  return withSyncedHeaders({
    cols: safeCols,
    rows: mergedCells.length,
    headers: [],
    cells: mergedCells,
  });
}

const MAX_SHEET_HEADER_TEXT = 200;

function clipCellText(t: string): string {
  if (t.length <= MAX_SHEET_CELL_TEXT) return t;
  return t.slice(0, MAX_SHEET_CELL_TEXT);
}

function clipHeaderText(t: string): string {
  if (t.length <= MAX_SHEET_HEADER_TEXT) return t;
  return t.slice(0, MAX_SHEET_HEADER_TEXT);
}

/** Keeps API `headers` in sync with first grid row (clipped for JSON); empty cells use column letters. */
function withSyncedHeaders(value: TopicSheetData): TopicSheetData {
  const headers = Array.from({ length: value.cols }, (_, c) => {
    const raw = value.cells[0]?.[c]?.text ?? "";
    if (raw.length > 0) return clipHeaderText(raw);
    return excelColLabel(c);
  });
  return { ...value, headers };
}

/**
 * Parses tab-separated clipboard text. Supports quoted fields (Excel) so cells can contain newlines (Alt+Enter in Excel).
 */
function parseClipboardToGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < normalized.length) {
    const ch = normalized[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === "\t") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  row.push(field);
  rows.push(row);
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0] === "" && rows.length > 1) {
      rows.pop();
      continue;
    }
    break;
  }
  return rows;
}

function ensureSheetDimensions(value: TopicSheetData, minRows: number, minCols: number): TopicSheetData {
  const nextRows = Math.min(MAX_SHEET_ROWS, Math.max(value.rows, minRows));
  const nextCols = Math.min(MAX_SHEET_COLS, Math.max(value.cols, minCols));
  if (nextRows === value.rows && nextCols === value.cols) return withSyncedHeaders(value);
  const cells = value.cells.map((row) => [...row]);
  for (const row of cells) {
    while (row.length < nextCols) row.push(makeEmptyCell());
    row.length = nextCols;
  }
  while (cells.length < nextRows) {
    cells.push(Array.from({ length: nextCols }, () => makeEmptyCell()));
  }
  if (cells.length > nextRows) cells.length = nextRows;
  return withSyncedHeaders({
    ...value,
    rows: nextRows,
    cols: nextCols,
    cells,
  });
}

function applyTsvPasteToCells(
  value: TopicSheetData,
  startRow: number,
  startCol: number,
  tsvText: string,
): TopicSheetData {
  const grid = parseClipboardToGrid(tsvText);
  if (grid.length === 0) return withSyncedHeaders(value);
  let maxW = 0;
  for (const row of grid) maxW = Math.max(maxW, row.length);
  const needRows = startRow + grid.length;
  const needCols = startCol + maxW;
  const next = ensureSheetDimensions(value, needRows, needCols);
  const cells = next.cells.map((row) => row.map((cell) => ({ ...cell })));
  for (let i = 0; i < grid.length; i++) {
    const r = startRow + i;
    if (r >= next.rows) break;
    const line = grid[i];
    for (let j = 0; j < line.length; j++) {
      const c = startCol + j;
      if (c >= next.cols) break;
      cells[r][c] = { ...cells[r][c], text: clipCellText(line[j] ?? "") };
    }
  }
  return withSyncedHeaders({ ...next, cells });
}

export function HandoffView({ workspaceId, date }: { workspaceId: string; date: string }) {
  const router = useRouter();
  const urlSearchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const api = `/api/workspaces/${encodeURIComponent(workspaceId)}`;
  const clientDisplayTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [exists, setExists] = useState(false);
  const [latestHandoffDate, setLatestHandoffDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addHoBusy, setAddHoBusy] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [deleteHoBusy, setDeleteHoBusy] = useState(false);
  const [searchText, setSearchText] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchHadFocus = useRef(false);
  const [activeSearch, setActiveSearch] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResultRow[]>([]);
  const [focusedTopicId, setFocusedTopicId] = useState<string | null>(null);
  const [focusedSearchTerm, setFocusedSearchTerm] = useState<string | null>(null);

  const [newSummary, setNewSummary] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newPriority, setNewPriority] = useState<Priority | "">("");
  const [addingRow, setAddingRow] = useState(false);
  const [team, setTeam] = useState<Team>("on_shore");
  const [tableSort, setTableSort] = useState<HandoffTableSort>({ kind: "default" });
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<number[]>([
    40,
    300,
    140,
    HANDOFF_PRIORITY_COL_MIN_PX,
    460,
    SHEET_COL_WIDE,
  ]);
  const [localSheetTopicIds, setLocalSheetTopicIds] = useState<string[]>([]);
  const sheetLayoutRef = useRef<"unknown" | "wide" | "narrow">("unknown");
  const resizingRef = useRef<{
    colIndex: number;
    startX: number;
    startWidths: number[];
  } | null>(null);
  const handoffMainRef = useRef<HTMLElement | null>(null);
  const [actionBarWidth, setActionBarWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const main = handoffMainRef.current;
    if (!main) return;
    const measure = () => {
      const inner = main.firstElementChild as HTMLElement | null;
      const pad = inner
        ? parseFloat(getComputedStyle(inner).paddingLeft) + parseFloat(getComputedStyle(inner).paddingRight)
        : 0;
      setActionBarWidth(Math.max(0, main.clientWidth - (Number.isFinite(pad) ? pad : 0)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const t = localStorage.getItem(TEAM_STORAGE);
    const saved = parseTeamValue(t ?? "");
    if (saved) setTeam(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(TEAM_STORAGE, team);
  }, [team]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const active = resizingRef.current;
      if (!active) return;
      const delta = e.clientX - active.startX;
      const s = active.startWidths;
      const min = HANDOFF_TABLE_COL_MIN;
      const max = HANDOFF_TABLE_COL_MAX;
      let i: number;
      let j: number;
      if (active.colIndex === 5) {
        i = 5;
        j = 4;
      } else {
        i = active.colIndex;
        j = active.colIndex + 1;
      }
      const sum = s[i] + s[j];
      const minI = min[i]!;
      const minJ = min[j]!;
      const wiLow = Math.max(minI, sum - max);
      const wiHigh = Math.min(max, sum - minJ);
      const wi = Math.max(wiLow, Math.min(wiHigh, s[i] + delta));
      const wj = sum - wi;
      setColumnWidths(() => {
        const next = [...s];
        next[i] = wi;
        next[j] = wj;
        return next;
      });
    }
    function onMouseUp() {
      resizingRef.current = null;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handoffHasSheet =
    (loading && topics.length === 0) ||
    localSheetTopicIds.length > 0 ||
    topics.some((topic) => normalizeSheetData(topic.sheetData) != null);

  useEffect(() => {
    setLocalSheetTopicIds([]);
    sheetLayoutRef.current = "unknown";
  }, [workspaceId, date]);

  useEffect(() => {
    const mode = handoffHasSheet ? "wide" : "narrow";
    if (sheetLayoutRef.current === mode) return;
    const previous = sheetLayoutRef.current;
    sheetLayoutRef.current = mode;
    if (previous === "unknown" && mode === "wide") return;
    setColumnWidths((widths) => {
      const next = [...widths];
      if (mode === "narrow") {
        const freed = Math.max(0, next[5] - SHEET_COL_NARROW);
        next[5] = SHEET_COL_NARROW;
        next[4] += freed;
        return next;
      }
      const need = Math.max(0, SHEET_COL_WIDE - next[5]);
      const canTake = Math.max(0, next[4] - HANDOFF_TABLE_COL_MIN[4]);
      const take = Math.min(need, canTake);
      next[4] -= take;
      next[5] += take;
      if (next[5] < SHEET_COL_WIDE) next[5] = SHEET_COL_WIDE;
      return next;
    });
  }, [handoffHasSheet]);

  const setTopicSheetDraft = useCallback((topicId: string, active: boolean) => {
    setLocalSheetTopicIds((prev) => {
      const has = prev.includes(topicId);
      if (active && !has) return [...prev, topicId];
      if (!active && has) return prev.filter((id) => id !== topicId);
      return prev;
    });
  }, []);

  function startColumnResize(colIndex: number, e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    resizingRef.current = {
      colIndex,
      startX: e.clientX,
      startWidths: [...columnWidths],
    };
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/workspaces", { credentials: "include" });
        if (!res.ok) return;
        const data: { workspaces?: { id: string; name: string }[] } = await res.json();
        const w = data.workspaces?.find((x) => x.id === workspaceId);
        if (w?.name) setWorkspaceName(w.name);
      } catch {
        /* ignore */
      }
    })();
  }, [workspaceId]);

  const displayTitle = formatHandoffTitle(date, clientDisplayTz);
  const displayDateDdMmYyyy = formatDdMmYyyyFromYmd(date);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const q = new URLSearchParams({ displayTz: clientDisplayTz });
      const res = await fetch(`${api}/handoffs/${date}?${q}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load handoff");
      const data = await res.json();
      setExists(!!data.exists);
      setLatestHandoffDate(
        typeof data.latestHandoffDate === "string" ? data.latestHandoffDate : null,
      );
      setTopics(data.topics ?? []);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [api, date, clientDisplayTz]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    function tick() {
      if (document.visibilityState !== "visible") return;
      if (isComposingInHandoffMain(handoffMainRef.current)) return;
      void loadRef.current({ silent: true });
    }
    const intervalId = window.setInterval(tick, HANDOFF_POLL_MS);
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (isComposingInHandoffMain(handoffMainRef.current)) return;
      void loadRef.current({ silent: true });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  async function onAddHo() {
    setAddHoBusy(true);
    setError(null);
    try {
      const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const clientToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: clientTimeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const res = await fetch(`${api}/handoffs/rollover`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientToday, clientTimeZone }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.handoffDate) {
        setNotice("Today's HO is already created.");
        setTimeout(() => setNotice(null), 5000);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Rollover failed");
      const nextYmd = data.handoffDate as string;
      if (!nextYmd) throw new Error("Invalid handoff response");
      router.push(`/w/${encodeURIComponent(workspaceId)}/handoff/${nextYmd}`);
      // Next.js does not re-run the handoff page effect when the URL is unchanged, so the main
      // view would stay empty until a full refresh; the sidebar also would not see the new list.
      if (nextYmd === date) {
        void load();
        requestHandoffSidebarListRefresh();
      }
      // If the path date changed, the sidebar's effect keyed on `pathname` refetches the list.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollover failed");
    } finally {
      setAddHoBusy(false);
    }
  }

  async function onDeleteHo() {
    if (
      !window.confirm(
        `Delete this handoff (${displayDateDdMmYyyy})? All rows, updates, and attachments for this day will be removed. You can use Add HO again afterward.`,
      )
    ) {
      return;
    }
    setDeleteHoBusy(true);
    setError(null);
    try {
      const res = await fetch(`${api}/handoffs/${date}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not delete handoff");
      const listRes = await fetch(`${api}/handoffs`, { credentials: "include" });
      if (listRes.ok) {
        const listData = await listRes.json();
        const first = listData.handoffs?.[0]?.handoffDate as string | undefined;
        if (first) {
          router.push(`/w/${encodeURIComponent(workspaceId)}/handoff/${first}`);
          return;
        }
      }
      router.push("/workspaces");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleteHoBusy(false);
    }
  }

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    setSearchError(null);
    if (!q) {
      setActiveSearch("");
      setSearchResults([]);
      return;
    }
    if (q.length < 2) {
      setActiveSearch("");
      setSearchResults([]);
      setSearchError("Enter at least 2 characters");
      return;
    }
    setSearchBusy(true);
    setActiveSearch(q);
    try {
      const res = await fetch(`${api}/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Search failed");
      setSearchResults(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
    }
  }, [api]);

  useEffect(() => {
    const q = searchText.trim();
    if (!q) {
      setActiveSearch("");
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    if (q.length < 2) {
      setActiveSearch("");
      setSearchResults([]);
      setSearchError("Enter at least 2 characters");
      return;
    }
    const handle = window.setTimeout(() => {
      void runSearch(q);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [searchText, runSearch]);

  useLayoutEffect(() => {
    const el = searchInputRef.current;
    if (!el || !searchHadFocus.current) return;
    if (document.activeElement === el) return;
    const pos = el.value.length;
    el.focus();
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* ignore */
    }
  }, [searchText, searchBusy, searchResults, searchError, activeSearch]);

  async function onAddRow(e: React.FormEvent) {
    e.preventDefault();
    if (!newSummary.trim()) return;
    setError(null);
    try {
      const res = await fetch(`${api}/handoffs/${date}/topics`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: newSummary.trim(),
          owner: newOwner.trim() || null,
          priority: newPriority || null,
        }),
      });
      if (!res.ok) throw new Error("Could not add row");
      setNewSummary("");
      setNewOwner("");
      setNewPriority("");
      setAddingRow(false);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add row");
    }
  }

  async function saveTopic(topicId: string, summary: string, owner: string, priority: Priority | "") {
    setError(null);
    try {
      const res = await fetch(`${api}/topics/${topicId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary,
          owner: owner.trim() || null,
          priority: priority || null,
        }),
      });
      if (!res.ok) throw new Error("Could not save");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function saveTopicSheet(topicId: string, sheetData: TopicSheetData | null) {
    setError(null);
    try {
      const res = await fetch(`${api}/topics/${topicId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetData,
        }),
      });
      if (!res.ok) throw new Error("Could not save sheet");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  function toggleTopicCollapsed(topicId: string) {
    setCollapsedTopicIds((prev) =>
      prev.includes(topicId) ? prev.filter((id) => id !== topicId) : [...prev, topicId],
    );
  }

  const userId = session?.user?.id;
  const userTeam = session?.user?.team ?? null;

  const canMutateThisHandoff =
    latestHandoffDate === null || latestHandoffDate === date;
  const orderedTopics = useMemo(
    () =>
      [...topics].sort((a, b) => {
        if (tableSort.kind === "default") {
          return compareCreatedDescendingThenOrder(a, b);
        }
        if (tableSort.kind === "priority") {
          const pa = topicSortRank(a);
          const pb = topicSortRank(b);
          if (pa !== pb) return tableSort.dir === "desc" ? pb - pa : pa - pb;
          return compareCreatedDescendingThenOrder(a, b);
        }
        const oa = (a.owner ?? "").trim();
        const ob = (b.owner ?? "").trim();
        const cmp = oa.localeCompare(ob, undefined, { sensitivity: "base", numeric: true });
        if (cmp !== 0) return tableSort.dir === "asc" ? cmp : -cmp;
        return compareCreatedDescendingThenOrder(a, b);
      }),
    [topics, tableSort],
  );

  function cyclePriorityHeaderSort() {
    setTableSort((prev) => {
      if (prev.kind !== "priority") {
        return { kind: "priority", dir: "desc" };
      }
      if (prev.dir === "desc") {
        return { kind: "priority", dir: "asc" };
      }
      window.setTimeout(() => {
        setNotice("Default sorting applied");
        window.setTimeout(() => setNotice(null), 3000);
      }, 0);
      return { kind: "default" };
    });
  }

  function cycleOwnerHeaderSort() {
    setTableSort((prev) => {
      if (prev.kind !== "owner") {
        return { kind: "owner", dir: "asc" };
      }
      if (prev.dir === "asc") {
        return { kind: "owner", dir: "desc" };
      }
      window.setTimeout(() => {
        setNotice("Default sorting applied");
        window.setTimeout(() => setNotice(null), 3000);
      }, 0);
      return { kind: "default" };
    });
  }

  const onCopyHandoff = useCallback(
    async (latestUpdateOnly = false) => {
      await copyHandoffToClipboard({
        workspaceName,
        dateYmd: date,
        titleLine: displayTitle,
        topics: orderedTopics,
        latestUpdateOnly,
        onNotice: setNotice,
      });
    },
    [workspaceName, date, displayTitle, orderedTopics],
  );

  useEffect(() => {
    const topic = urlSearchParams.get("focusTopic");
    const term = urlSearchParams.get("q");
    setFocusedTopicId(topic);
    setFocusedSearchTerm(term);
  }, [date, urlSearchParams]);

  useEffect(() => {
    if (!focusedTopicId) return;
    const el = document.getElementById(`topic-row-${focusedTopicId}`) ?? document.getElementById(`topic-card-${focusedTopicId}`);
    if (!el) return;
    window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }, [focusedTopicId, topics]);

  async function onMailHandoff() {
    setMailBusy(true);
    setError(null);
    try {
      const html = buildHandoffTableHtml(orderedTopics, orderedTopics.some(topicHasSheet));
      const text = handoffTopicsToPlainFallback(orderedTopics);
      const res = await fetch(`${api}/mail`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoffDate: date, html, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not send mail");
      }
      setNotice(typeof data.message === "string" ? data.message : "Handoff mailed.");
      window.setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send mail");
    } finally {
      setMailBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {notice && (
        <div className="fixed right-4 top-4 z-50 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg">
          {notice}
        </div>
      )}
      <header className="shrink-0 border-b border-slate-300 bg-slate-200/90">
        <div className="flex items-center justify-between px-2 pt-2 sm:px-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/logos/logosmallNew.png"
            alt="Handoff Hub"
            className="h-8 w-auto object-contain sm:h-10"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/logos/amdocslogo.png"
            alt="Amdocs"
            className="h-8 w-auto sm:h-10"
          />
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 px-2 pb-3 pt-1 sm:px-3 sm:pb-4">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">
              {workspaceName || "Handoff"}
            </h1>
            <p className="text-sm text-slate-700 sm:text-base">{displayTitle}</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(searchText);
            }}
            className="order-3 w-full sm:order-2 sm:max-w-md lg:order-none lg:flex-1 lg:px-4"
          >
            <input
              ref={searchInputRef}
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onFocus={() => {
                searchHadFocus.current = true;
              }}
              onBlur={(e) => {
                if (e.relatedTarget) searchHadFocus.current = false;
              }}
              placeholder="Search"
              aria-label="Search handoff"
              autoComplete="off"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
          </form>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <label className="flex flex-wrap items-center gap-2 text-xs text-slate-700 sm:text-sm">
              <span className="whitespace-nowrap">Team</span>
              <select
                value={team}
                onChange={(e) => setTeam(e.target.value as Team)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <TeamSelectOptions />
              </select>
            </label>
            <button
              type="button"
              onClick={() => void onAddHo()}
              disabled={addHoBusy}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 sm:text-sm"
            >
              {addHoBusy ? "Working…" : "Add HO"}
            </button>
            {canMutateThisHandoff && exists && (
              <button
                type="button"
                onClick={() => void onDeleteHo()}
                disabled={deleteHoBusy}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50 sm:text-sm"
              >
                {deleteHoBusy ? "Deleting…" : "Delete HO"}
              </button>
            )}
            <Link
              href={session?.user?.isAdmin ? "/workspaces" : "/profile"}
              className="inline-flex h-[2.625rem] w-[2.625rem] items-center justify-center rounded text-slate-700 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              aria-label={session?.user?.isAdmin ? "Home" : "Profile"}
              title={session?.user?.isAdmin ? "Home" : "Profile"}
            >
              {session?.user?.isAdmin ? (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 9.5 12 3l9 6.5V20a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 20V9.5z" />
                  <path d="M9 21.5V12h6v9.5" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="9" r="3.25" />
                  <path d="M6.5 20.25c0-3.25 2.75-5.5 5.5-5.5s5.5 2.25 5.5 5.5" />
                </svg>
              )}
            </Link>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              title="Sign out"
              aria-label="Sign out"
              className="inline-flex h-[2.625rem] w-[2.625rem] items-center justify-center rounded text-slate-700 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
                <path d="M15 16l4-4-4-4" />
                <path d="M19 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main
        ref={handoffMainRef}
        className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto"
      >
        <div className="inline-block min-w-full bg-sky-100 px-2 py-3 sm:px-3 sm:py-5">
          {sessionStatus === "loading" && <p className="text-sm text-slate-600">Loading session…</p>}

          {searchError && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {searchError}
            </div>
          )}

          {activeSearch && !searchError && (
            <div className="mb-4 rounded-lg border border-slate-300 bg-white p-3 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">
                  Search results for &quot;<span className="font-semibold">{activeSearch}</span>&quot; ({searchResults.length})
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSearch("");
                    setSearchResults([]);
                    setSearchText("");
                    setSearchError(null);
                  }}
                  className="text-xs text-slate-600 underline hover:text-slate-900"
                >
                  Clear
                </button>
              </div>
              {searchResults.length === 0 ? (
                <p className="text-sm text-slate-600">No matches found in summary, updates, or sheet.</p>
              ) : (
                <ul className="space-y-2">
                  {searchResults.map((r) => (
                    <li key={`${r.topicId}-${r.handoffDate}`} className="rounded border border-slate-200 bg-slate-50 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">{renderHighlightedText(r.summary, activeSearch)}</p>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/w/${encodeURIComponent(workspaceId)}/handoff/${r.handoffDate}?focusTopic=${encodeURIComponent(r.topicId)}&q=${encodeURIComponent(activeSearch)}`,
                            )
                          }
                          className="text-xs text-blue-700 underline hover:text-blue-900"
                        >
                          Open {formatDdMmYyyyFromYmd(r.handoffDate)}
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        Owner: {r.owner || "-"} | Priority:{" "}
                        <span className={`font-bold ${priorityLabelTextClassForSearch(r.priority)}`}>
                          {formatPriorityCell(r.priority)}
                        </span>{" "}
                        | Matched in:{" "}
                        {[
                          r.matchedInSummary ? "Summary" : null,
                          r.matchedInUpdates ? "Updates" : null,
                          r.matchedInSheet ? "Sheet" : null,
                        ]
                          .filter(Boolean)
                          .join(" + ")}
                      </p>
                      {r.latestMatchingUpdate && (
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-700">
                          Latest matching update: {renderHighlightedText(r.latestMatchingUpdate, activeSearch)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          {!exists && !loading && (
            <p className="mb-4 text-sm text-slate-600">
              No handoff saved for this date yet. Add a row below to create it, or use <strong>Add HO</strong> to roll open
              items from the previous business day.
            </p>
          )}

          {loading ? (
            <p className="text-slate-600">Loading…</p>
          ) : (
            <>
              <div
                className="sticky left-0 z-10 mb-2"
                style={actionBarWidth != null ? { width: actionBarWidth } : undefined}
              >
                {!canMutateThisHandoff && (
                  <p className="mb-2 text-sm text-amber-800">
                    Only the latest handoff can be edited. Open the most recent handoff date to make changes.
                  </p>
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {!addingRow && (
                      <button
                        type="button"
                        onClick={() => setAddingRow(true)}
                        disabled={!canMutateThisHandoff}
                        aria-label="Add row"
                        title="Add row"
                        className="inline-flex h-[2.625rem] w-[2.625rem] items-center justify-center rounded text-slate-700 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className="h-6 w-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void onMailHandoff()}
                    disabled={mailBusy}
                    aria-label={mailBusy ? "Sending mail" : "Mail"}
                    title={mailBusy ? "Sending…" : "Email this handoff to every address on this workspace"}
                    className="inline-flex h-[2.625rem] w-[2.625rem] shrink-0 items-center justify-center rounded text-slate-700 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 7 9-7" />
                    </svg>
                  </button>
                </div>
                {addingRow && (
                  <form
                    onSubmit={onAddRow}
                    className="mt-3 max-w-xl space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Summary</label>
                      <textarea
                        required
                        rows={2}
                        value={newSummary}
                        onChange={(e) => setNewSummary(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Owner (optional)</label>
                      <input
                        value={newOwner}
                        onChange={(e) => setNewOwner(e.target.value)}
                        placeholder="Leave blank if not set"
                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Priority</label>
                      <select
                        value={newPriority}
                        onChange={(e) => setNewPriority(e.target.value as Priority | "")}
                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">None</option>
                        <option value="low">Low</option>
                        <option value="mid">Mid</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                      >
                        Save row
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingRow(false)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
              <div className="hidden min-w-0 md:block">
                <div className="max-w-full rounded-lg border border-slate-300 bg-white shadow-sm">
                  <table className="table-fixed min-w-[1200px] w-full border-collapse text-left text-sm">
                    <colgroup>
                      {columnWidths.map((w, idx) => (
                        <col key={`col-${idx}`} style={{ width: `${w}px` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100">
                        <th
                          className="sticky top-0 z-20 border border-slate-300 bg-slate-100 px-1 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 shadow-[inset_0_-1px_0_0_rgb(203_213_225)]"
                          aria-label="Status and actions"
                        >
                          <HandoffTableCopyButton
                            disabled={loading}
                            onCopy={() => void onCopyHandoff(false)}
                            onCopyLatestOnly={() => void onCopyHandoff(true)}
                          />
                        </th>
                        <th className="sticky top-0 z-20 border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 shadow-[inset_0_-1px_0_0_rgb(203_213_225)]">
                          Summary
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            className="absolute right-0 top-0 z-30 h-full w-1 cursor-col-resize bg-transparent hover:bg-slate-400"
                            onMouseDown={(e) => startColumnResize(1, e)}
                          />
                        </th>
                        <th
                          className={`relative sticky top-0 z-20 cursor-pointer select-none border border-slate-300 px-2 py-2 text-xs font-semibold uppercase tracking-wide shadow-[inset_0_-1px_0_0_rgb(203_213_225)] ${tableSort.kind === "owner" ? "bg-slate-200 text-slate-900" : "bg-slate-100 text-slate-600"
                            }`}
                          title={
                            tableSort.kind === "owner"
                              ? tableSort.dir === "asc"
                                ? "Owner A→Z (click for Z→A, then default)"
                                : "Owner Z→A (click to restore default sort)"
                              : "Sort by owner A→Z"
                          }
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("[data-col-resize]")) return;
                            cycleOwnerHeaderSort();
                          }}
                        >
                          Owner
                          {tableSort.kind === "owner" ? (
                            <span className="ml-1 font-normal text-slate-500" aria-hidden>
                              {tableSort.dir === "asc" ? "↑" : "↓"}
                            </span>
                          ) : null}
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            data-col-resize
                            className="absolute right-0 top-0 z-30 h-full w-1 cursor-col-resize bg-transparent hover:bg-slate-400"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => startColumnResize(2, e)}
                          />
                        </th>
                        <th
                          className={`relative sticky top-0 z-20 cursor-pointer select-none border border-slate-300 px-2 py-2 text-xs font-semibold uppercase tracking-wide shadow-[inset_0_-1px_0_0_rgb(203_213_225)] ${tableSort.kind === "priority" ? "bg-slate-200 text-slate-900" : "bg-slate-100 text-slate-600"
                            }`}
                          title={
                            tableSort.kind === "priority"
                              ? tableSort.dir === "desc"
                                ? "Priority high→low (click for low→high, then default)"
                                : "Priority low→high (click to restore default sort)"
                              : "Sort by priority high→low"
                          }
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("[data-col-resize]")) return;
                            cyclePriorityHeaderSort();
                          }}
                        >
                          Priority
                          {tableSort.kind === "priority" ? (
                            <span className="ml-1 font-normal text-slate-500" aria-hidden>
                              {tableSort.dir === "desc" ? "↓" : "↑"}
                            </span>
                          ) : null}
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            data-col-resize
                            className="absolute right-0 top-0 z-30 h-full w-1 cursor-col-resize bg-transparent hover:bg-slate-400"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => startColumnResize(3, e)}
                          />
                        </th>
                        <th className="sticky top-0 z-20 border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 shadow-[inset_0_-1px_0_0_rgb(203_213_225)]">
                          Updates
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            className="absolute right-0 top-0 z-30 h-full w-1 cursor-col-resize bg-transparent hover:bg-slate-400"
                            onMouseDown={(e) => startColumnResize(4, e)}
                          />
                        </th>
                        <th className="sticky top-0 z-20 border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 shadow-[inset_0_-1px_0_0_rgb(203_213_225)]">
                          Sheet
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            className="absolute right-0 top-0 z-30 h-full w-1 cursor-col-resize bg-transparent hover:bg-slate-400"
                            onMouseDown={(e) => startColumnResize(5, e)}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderedTopics.map((t) => (
                        <TopicRowTable
                          key={t.id}
                          api={api}
                          topic={t}
                          selectedTeam={team}
                          userId={userId}
                          userTeam={userTeam}
                          clientDisplayTz={clientDisplayTz}
                          canMutateHandoff={canMutateThisHandoff}
                          focusedTopicId={focusedTopicId}
                          focusedSearchTerm={focusedSearchTerm}
                          collapsed={collapsedTopicIds.includes(t.id)}
                          onToggleCollapsed={() => toggleTopicCollapsed(t.id)}
                          onNotice={setNotice}
                          onSave={(s, owner, p) => void saveTopic(t.id, s, owner, p)}
                          onSaveSheet={(sheet) => void saveTopicSheet(t.id, sheet)}
                          onSheetDraft={(active) => setTopicSheetDraft(t.id, active)}
                          onRefresh={() => void load({ silent: true })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4 md:hidden">
                {orderedTopics.map((t) => (
                  <TopicCard
                    key={t.id}
                    api={api}
                    topic={t}
                    selectedTeam={team}
                    userId={userId}
                    userTeam={userTeam}
                    clientDisplayTz={clientDisplayTz}
                    canMutateHandoff={canMutateThisHandoff}
                    focusedTopicId={focusedTopicId}
                    focusedSearchTerm={focusedSearchTerm}
                    collapsed={collapsedTopicIds.includes(t.id)}
                    onToggleCollapsed={() => toggleTopicCollapsed(t.id)}
                    onNotice={setNotice}
                    onSave={(s, owner, p) => void saveTopic(t.id, s, owner, p)}
                    onSaveSheet={(sheet) => void saveTopicSheet(t.id, sheet)}
                    onRefresh={() => void load({ silent: true })}
                  />
                ))}
              </div>
            </>
          )}

        </div>
      </main>
    </div>
  );
}

const HANDOFF_COPY_HOLD_MS = 500;

function HandoffTableCopyButton({
  disabled,
  onCopy,
  onCopyLatestOnly,
}: {
  disabled: boolean;
  onCopy: () => void;
  onCopyLatestOnly: () => void;
}) {
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFiredRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || e.button !== 0) return;
      holdFiredRef.current = false;
      clearHoldTimer();
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        holdFiredRef.current = true;
        onCopyLatestOnly();
      }, HANDOFF_COPY_HOLD_MS);
    },
    [disabled, clearHoldTimer, onCopyLatestOnly],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || e.button !== 0) return;
      const wasHold = holdFiredRef.current;
      clearHoldTimer();
      if (!wasHold) onCopy();
      holdFiredRef.current = false;
    },
    [disabled, clearHoldTimer, onCopy],
  );

  const onPointerCancel = useCallback(() => {
    clearHoldTimer();
    holdFiredRef.current = false;
  }, [clearHoldTimer]);

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
      disabled={disabled}
      title="Click: copy handoff with all updates. Hold: copy with only the latest update per item."
      aria-label="Copy handoff table to clipboard. Press and hold to copy with only the latest update per item."
      className="inline-flex h-7 w-7 touch-manipulation select-none items-center justify-center rounded text-slate-700 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        <path d="M9 4h7" />
      </svg>
    </button>
  );
}

function topicWithLatestCommentOnly(topic: TopicRow): TopicRow {
  const latestId = pickLatestCommentIdFromRows(topic.comments);
  if (!latestId) return { ...topic, comments: [] };
  const latest = topic.comments.find((c) => c.id === latestId);
  return { ...topic, comments: latest ? [latest] : [] };
}

/** All updates for the row, oldest first (cross-team sequence as posted). */
function commentsInChronologicalOrder(topic: TopicRow): CommentRow[] {
  return [...topic.comments].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function escapeHtmlForMail(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function handoffMailFirstColumnFaintHex(topic: TopicRow): string {
  if (isTopicEscalated(topic) || topic.priority === "high") return "#fee2e2";
  if (topic.priority === "mid") return "#ffedd5";
  if (topic.priority === "low") return "#dbeafe";
  return "#f1f5f9";
}

function mailColoredText(color: string, content: string, bold = false): string {
  const weight = bold ? "font-weight:bold;" : "";
  const inner = bold ? `<b>${content}</b>` : content;
  return (
    `<span style="color:${color};${weight}mso-color-alt:auto;">` +
    `<font color="${color}">${inner}</font></span>`
  );
}

function handoffMailPriorityHtml(topic: TopicRow): string {
  const text = escapeHtmlForMail(formatPriorityCell(topic.priority));
  if (isTopicEscalated(topic) || topic.priority === "high") {
    return mailColoredText("#B91C1C", text, true);
  }
  if (topic.priority === "mid") {
    return mailColoredText("#EA580C", text, true);
  }
  if (topic.priority === "low") {
    return mailColoredText("#1D4ED8", text, true);
  }
  return text;
}

function handoffMailSummaryHtml(topic: TopicRow): string {
  const raw = escapeHtmlForMail(topic.summary);
  if (isTopicEscalated(topic)) {
    return `${mailColoredText("#7F1D1D", "ESCALATED - ", true)}${raw}`;
  }
  return raw;
}

function handoffMailUpdatesHtml(topic: TopicRow): string {
  const list = commentsInChronologicalOrder(topic);
  if (list.length === 0) {
    return mailColoredText("#94A3B8", "—");
  }
  return list
    .map((c) => {
      const teamColor = teamMailColor(c.team);
      const prefix = escapeHtmlForMail(c.prefix);
      const body = escapeHtmlForMail(c.body).replace(/\n/g, "<br/>");
      const att =
        c.attachments?.length > 0
          ? `<ul style="margin:4px 0 0 18px;padding:0;color:#475569;font-size:11px;">${c.attachments
            .map((a) => `<li>${escapeHtmlForMail(a.originalFilename)}</li>`)
            .join("")}</ul>`
          : "";
      return (
        `<p style="margin:0 0 6pt 0;line-height:1.35;">` +
        `${mailColoredText(teamColor, `${prefix} `, true)}` +
        `<span style="color:#0F172A;">${body}</span>${att}</p>`
      );
    })
    .join("");
}

function handoffMailSheetHtml(topic: TopicRow): string {
  const sheet = normalizeSheetData(topic.sheetData);
  if (!sheet) {
    return '<p style="margin:0;color:#64748b;font-size:12px;">No sheet</p>';
  }
  const border = "1px solid #cbd5e1";
  const rows: string[] = [];
  for (let r = 0; r < sheet.rows; r++) {
    const row = sheet.cells[r] ?? [];
    const tds = row
      .map((cell, c) => {
        const raw = cell.text || "";
        const innerHtml = escapeHtmlForMail(raw).replace(/\r\n/g, "\n").replace(/\n/g, "<br/>");
        const fw = cell.bold ? "font-weight:bold;" : "";
        const it = cell.italic ? "font-style:italic;" : "";
        const ul = cell.underline ? "text-decoration:underline;" : "";
        const head = r === 0 ? "background:#f1f5f9;font-weight:600;color:#334155;" : "color:#0f172a;";
        const inner = raw.length ? innerHtml : "—";
        return `<td style="border:${border};padding:4px 6px;font-size:11px;white-space:normal;${head}${fw}${it}${ul}">${inner}</td>`;
      })
      .join("");
    rows.push(`<tr>${tds}</tr>`);
  }
  return `<table border="1" cellpadding="3" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:11px;">${rows.join("")}</table>`;
}

function topicSnapshotForCopy(
  topic: TopicRow,
  editing: boolean,
  editSum: string,
  editOwner: string,
  editPriority: Priority | "",
): TopicRow {
  if (!editing) return topic;
  return {
    ...topic,
    summary: editSum.trim(),
    owner: editOwner.trim() || null,
    priority: topic.priority === "escalated" ? "escalated" : editPriority || null,
  };
}

function topicHasSheet(topic: TopicRow): boolean {
  return normalizeSheetData(topic.sheetData) != null;
}

function topicToMailTableRowHtml(topic: TopicRow, includeSheet = true): string {
  const border = "1px solid #cbd5e1";
  const op = topic.isClosed ? "opacity:0.78;" : "";
  const td = `border:${border};padding:10px;vertical-align:top;font-size:13px;line-height:1.4;color:#0f172a;background:#ffffff;${op}`;
  const tintBg = handoffMailFirstColumnFaintHex(topic);
  const tdTint = `border:${border};padding:4px 2px;vertical-align:top;background:${tintBg};${op}`;
  const tdPri = `border:${border};padding:10px;vertical-align:top;font-size:13px;line-height:1.4;background:#ffffff;${op}`;
  const sheetCell = includeSheet ? `<td style="${td}">${handoffMailSheetHtml(topic)}</td>` : "";
  return `<tr style="background:#ffffff;">
            <td style="${tdTint}">&nbsp;</td>
            <td style="${td}">${handoffMailSummaryHtml(topic)}</td>
            <td style="${td}">${escapeHtmlForMail(topic.owner || "—")}</td>
            <td style="${tdPri}">${handoffMailPriorityHtml(topic)}</td>
            <td style="${td}">${handoffMailUpdatesHtml(topic)}</td>
            ${sheetCell}
          </tr>`;
}

function buildHandoffTableHtml(topics: TopicRow[], includeSheet = true): string {
  const border = "1px solid #cbd5e1";
  const thStyle = `border:${border};background:#f1f5f9;padding:8px 10px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#475569;`;
  const updatesWidth = includeSheet ? "31%" : "59%";
  const sheetHeader = includeSheet ? `<th style="${thStyle}width:28%;">Sheet</th>` : "";
  const columnCount = includeSheet ? 6 : 5;
  const thead = `<thead><tr>
    <th style="${thStyle}width:3%;" aria-label="Status tint"></th>
    <th style="${thStyle}width:20%;">Summary</th>
    <th style="${thStyle}width:10%;">Owner</th>
    <th style="${thStyle}width:8%;">Priority</th>
    <th style="${thStyle}width:${updatesWidth};">Updates</th>
    ${sheetHeader}
  </tr></thead>`;
  const emptyBody =
    topics.length === 0
      ? `<tr><td colspan="${columnCount}" style="border:${border};padding:14px;color:#64748b;font-size:13px;">No items for this handoff date.</td></tr>`
      : "";
  const bodyRows =
    topics.length === 0 ? emptyBody : topics.map((topic) => topicToMailTableRowHtml(topic, includeSheet)).join("");
  return `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:1200px;table-layout:fixed;font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:12px;color:#0f172a;">${thead}<tbody>${bodyRows}</tbody></table>`;
}

function handoffTopicsToPlainFallback(topics: TopicRow[]): string {
  const lines: string[] = [];
  for (const t of topics) {
    lines.push(`${t.summary.replace(/\r?\n/g, " ")}`);
    lines.push(`Owner: ${t.owner || "—"} | Priority: ${formatPriorityCell(t.priority)}`);
    for (const c of commentsInChronologicalOrder(t)) {
      lines.push(`${c.prefix} ${c.body.replace(/\r?\n/g, " ")}`);
    }
    lines.push("");
  }
  if (topics.length === 0) lines.push("(No items for this date.)");
  return lines.join("\n").replace(/\n+$/, "");
}

async function copyTopicRowToClipboard(topic: TopicRow, onNotice: (msg: string | null) => void): Promise<void> {
  const tableHtml = buildHandoffTableHtml([topic]);
  const cleanHtml = buildClipboardHtmlDocument(tableHtml);
  const plain = handoffTopicsToPlainFallback([topic]);
  const ok = await writeRichHtmlToClipboard(cleanHtml, plain, tableHtml);
  if (ok) {
    onNotice("Row copied to clipboard.");
    window.setTimeout(() => onNotice(null), 3000);
    return;
  }
  onNotice("Could not copy to clipboard. Check browser clipboard permissions.");
  window.setTimeout(() => onNotice(null), 6000);
}

async function copyPlainTextToClipboard(
  text: string,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    onNotice("Copied");
    window.setTimeout(() => onNotice(null), 2200);
  } catch {
    /* ignore clipboard denial to keep notice language consistent */
  }
}

async function copyHandoffToClipboard(opts: {
  workspaceName: string | null;
  dateYmd: string;
  titleLine: string;
  topics: TopicRow[];
  latestUpdateOnly?: boolean;
  onNotice: (msg: string | null) => void;
}): Promise<void> {
  const { workspaceName, dateYmd, titleLine, topics, latestUpdateOnly, onNotice } = opts;
  const topicsToCopy = latestUpdateOnly ? topics.map(topicWithLatestCommentOnly) : topics;
  const includeSheet = topicsToCopy.some(topicHasSheet);
  const tableHtml = buildHandoffTableHtml(topicsToCopy, includeSheet);
  const cleanHtml = buildClipboardHtmlDocument(tableHtml);
  const plain = handoffTopicsToPlainFallback(topicsToCopy);
  const successNotice = latestUpdateOnly
    ? "Handoff copied (latest update per item only)."
    : "Handoff copied to clipboard.";
  const ok = await writeRichHtmlToClipboard(cleanHtml, plain, tableHtml);
  if (ok) {
    onNotice(successNotice);
    window.setTimeout(() => onNotice(null), 3000);
    return;
  }
  onNotice("Could not copy to clipboard. Check browser clipboard permissions.");
  window.setTimeout(() => onNotice(null), 6000);
}

function TopicRowTable({
  api,
  topic,
  selectedTeam,
  userId,
  userTeam,
  clientDisplayTz,
  canMutateHandoff,
  focusedTopicId,
  focusedSearchTerm,
  collapsed,
  onToggleCollapsed,
  onNotice,
  onSave,
  onSaveSheet,
  onSheetDraft,
  onRefresh,
}: {
  api: string;
  topic: TopicRow;
  selectedTeam: Team;
  userId?: string;
  userTeam: Team | null | undefined;
  clientDisplayTz: string;
  canMutateHandoff: boolean;
  focusedTopicId: string | null;
  focusedSearchTerm: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNotice: (msg: string | null) => void;
  onSave: (summary: string, owner: string, priority: Priority | "") => void;
  onSaveSheet: (sheetData: TopicSheetData | null) => void;
  onSheetDraft?: (active: boolean) => void;
  onRefresh: () => void;
}) {
  const [editSum, setEditSum] = useState(topic.summary);
  const [editOwner, setEditOwner] = useState(topic.owner ?? "");
  const [editPriority, setEditPriority] = useState<Priority | "">(topic.priority ?? "");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditSum(topic.summary);
    setEditOwner(topic.owner ?? "");
    setEditPriority(topic.priority ?? "");
  }, [topic.summary, topic.owner, topic.priority]);

  const isFocused = focusedTopicId === topic.id;

  return (
    <tr
      id={`topic-row-${topic.id}`}
      className={`align-top bg-white ${isFocused ? "ring-2 ring-amber-400" : ""}`}
      style={isFocused ? { animation: "handoffRowBlink 0.45s ease-in-out 3" } : undefined}
    >
      <td
        className={`relative border border-slate-300 px-1 py-3 text-center ${priorityFirstColumnBgClass(topic)}`}
      >
        <div className="flex flex-col items-center gap-2 pb-8">
          <input
            type="checkbox"
            checked={topic.isClosed}
            disabled
            onChange={() => { }}
            className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
            title={
              topic.isClosed
                ? canMutateHandoff
                  ? "Marked done. Edit the latest update and use Undo done to reopen."
                  : "Marked done."
                : "Use 'Mark Done & post update' to mark this item done."
            }
          />
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex items-center justify-center rounded p-0.5 text-slate-900 hover:bg-slate-200"
            aria-label={collapsed ? "Expand details" : "Collapse details"}
            title={collapsed ? "Expand details" : "Collapse details"}
          >
            <CollapseChevronIcon expanded={!collapsed} className="h-5 w-5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() =>
            void copyTopicRowToClipboard(
              topicSnapshotForCopy(topic, editing, editSum, editOwner, editPriority),
              onNotice,
            )
          }
          title="Copy full row (Summary, Owner, Priority, Updates, Sheet) with formatting"
          aria-label="Copy full row with formatting"
          className="absolute bottom-1 left-1/2 inline-flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded text-slate-700 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h9" />
            <path d="M9 4h7" />
          </svg>
        </button>
      </td>
      <td className="border border-slate-300 bg-white px-3 py-3">
        <div className="space-y-2">
          {editing ? (
            <textarea
              value={editSum}
              onChange={(e) => setEditSum(e.target.value)}
              rows={3}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          ) : (
            <div className="whitespace-pre-wrap text-slate-900">
              {renderSummaryWithEscalation(topic, focusedSearchTerm)}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  className="rounded bg-slate-900 px-2 py-1 text-xs text-white"
                  onClick={() => {
                    onSave(
                      editSum.trim(),
                      editOwner,
                      topic.priority === "escalated" ? "escalated" : editPriority,
                    );
                    setEditing(false);
                  }}
                >
                  Save row
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                  onClick={() => {
                    setEditSum(topic.summary);
                    setEditOwner(topic.owner ?? "");
                    setEditPriority(topic.priority ?? "");
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              canMutateHandoff && (
                <button
                  type="button"
                  className="text-xs text-slate-600 underline hover:text-slate-900"
                  onClick={() => setEditing(true)}
                >
                  Edit summaries
                </button>
              )
            )}
          </div>
        </div>
      </td>
      <td className="border border-slate-300 bg-white px-3 py-3">
        {editing ? (
          <input
            value={editOwner}
            onChange={(e) => setEditOwner(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        ) : (
          <div className="text-slate-800">{topic.owner || "-"}</div>
        )}
      </td>
      <td className="border border-slate-300 bg-white px-2 py-3">
        {editing ? (
          topic.priority === "escalated" ? (
            <div
              className={`whitespace-nowrap rounded px-2 py-1 text-sm font-bold ${priorityLabelTextClass(topic)}`}
            >
              Escalated
            </div>
          ) : (
            <select
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value as Priority | "")}
              className="w-full min-w-[6.5rem] rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">None</option>
              <option value="low">Low</option>
              <option value="mid">Mid</option>
              <option value="high">High</option>
            </select>
          )
        ) : (
          <div
            className={`whitespace-nowrap rounded px-2 py-1 text-sm font-bold ${priorityLabelTextClass(topic)}`}
          >
            {formatPriorityCell(topic.priority)}
          </div>
        )}
      </td>
      <td className="border border-slate-300 bg-white px-2 py-2 align-top">
        <TopicUpdatesColumn
          api={api}
          topic={topic}
          selectedTeam={selectedTeam}
          userId={userId}
          userTeam={userTeam}
          clientDisplayTz={clientDisplayTz}
          canMutateHandoff={canMutateHandoff}
          isClosed={topic.isClosed}
          focusedSearchTerm={focusedSearchTerm}
          collapsed={collapsed}
          onExpand={onToggleCollapsed}
          onRefresh={onRefresh}
        />
      </td>
      <td className="border border-slate-300 bg-white px-2 py-2 align-top">
        {!collapsed && (
          <TopicSheetColumn
            topic={topic}
            canMutateHandoff={canMutateHandoff}
            focusedSearchTerm={focusedSearchTerm}
            onSave={onSaveSheet}
            onDraftActive={onSheetDraft}
          />
        )}
      </td>
    </tr>
  );
}

function TopicCard({
  api,
  topic,
  selectedTeam,
  userId,
  userTeam,
  clientDisplayTz,
  canMutateHandoff,
  focusedTopicId,
  focusedSearchTerm,
  collapsed,
  onToggleCollapsed,
  onNotice,
  onSave,
  onSaveSheet,
  onRefresh,
}: {
  api: string;
  topic: TopicRow;
  selectedTeam: Team;
  userId?: string;
  userTeam: Team | null | undefined;
  clientDisplayTz: string;
  canMutateHandoff: boolean;
  focusedTopicId: string | null;
  focusedSearchTerm: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNotice: (msg: string | null) => void;
  onSave: (summary: string, owner: string, priority: Priority | "") => void;
  onSaveSheet: (sheetData: TopicSheetData | null) => void;
  onRefresh: () => void;
}) {
  const [editSum, setEditSum] = useState(topic.summary);
  const [editOwner, setEditOwner] = useState(topic.owner ?? "");
  const [editPriority, setEditPriority] = useState<Priority | "">(topic.priority ?? "");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditSum(topic.summary);
    setEditOwner(topic.owner ?? "");
    setEditPriority(topic.priority ?? "");
  }, [topic.summary, topic.owner, topic.priority]);

  const isFocused = focusedTopicId === topic.id;
  return (
    <div
      id={`topic-card-${topic.id}`}
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${isFocused ? "ring-2 ring-amber-400" : ""}`}
      style={isFocused ? { animation: "handoffRowBlink 0.45s ease-in-out 3" } : undefined}
    >
      <div className="mb-2 flex items-start gap-2">
        <div
          className={`mt-1 flex flex-col items-center gap-2 self-stretch rounded-md px-1.5 py-1 ${priorityFirstColumnBgClass(topic)}`}
        >
          <input
            type="checkbox"
            checked={topic.isClosed}
            disabled
            onChange={() => { }}
            className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
            title={
              topic.isClosed
                ? canMutateHandoff
                  ? "Marked done. Edit the latest update and use Undo done to reopen."
                  : "Marked done."
                : "Use 'Mark Done & post update' to mark this item done."
            }
          />
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex items-center justify-center rounded p-0.5 text-slate-900 hover:bg-slate-200"
            aria-label={collapsed ? "Expand details" : "Collapse details"}
            title={collapsed ? "Expand details" : "Collapse details"}
          >
            <CollapseChevronIcon expanded={!collapsed} className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() =>
              void copyTopicRowToClipboard(
                topicSnapshotForCopy(topic, editing, editSum, editOwner, editPriority),
                onNotice,
              )
            }
            title="Copy full row (Summary, Owner, Priority, Updates, Sheet) with formatting"
            aria-label="Copy full row with formatting"
            className="inline-flex items-center justify-center rounded p-0.5 text-slate-700 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V6a2 2 0 0 1 2-2h9" />
              <path d="M9 4h7" />
            </svg>
          </button>
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <textarea
                value={editSum}
                onChange={(e) => setEditSum(e.target.value)}
                rows={3}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <input
                value={editOwner}
                onChange={(e) => setEditOwner(e.target.value)}
                className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
              {topic.priority === "escalated" ? (
                <p className={`mt-2 text-sm font-bold ${priorityLabelTextClass(topic)}`}>Priority: Escalated</p>
              ) : (
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as Priority | "")}
                  className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="">None</option>
                  <option value="low">Low</option>
                  <option value="mid">Mid</option>
                  <option value="high">High</option>
                </select>
              )}
            </>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm font-medium text-slate-900">
                {renderSummaryWithEscalation(topic, focusedSearchTerm)}
              </p>
              <p className="mt-1 text-sm text-slate-700">Owner: {topic.owner || "-"}</p>
              <p className={`mt-1 text-sm font-bold ${priorityLabelTextClass(topic)}`}>
                Priority: {formatPriorityCell(topic.priority)}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-3">
        <TopicUpdatesColumn
          api={api}
          topic={topic}
          selectedTeam={selectedTeam}
          userId={userId}
          userTeam={userTeam}
          clientDisplayTz={clientDisplayTz}
          canMutateHandoff={canMutateHandoff}
          isClosed={topic.isClosed}
          focusedSearchTerm={focusedSearchTerm}
          collapsed={collapsed}
          onExpand={onToggleCollapsed}
          onRefresh={onRefresh}
        />
      </div>
      {!collapsed && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Sheet</p>
          <TopicSheetColumn
            topic={topic}
            canMutateHandoff={canMutateHandoff}
            focusedSearchTerm={focusedSearchTerm}
            onSave={onSaveSheet}
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
        {editing ? (
          <>
            <button
              type="button"
              className="rounded bg-slate-900 px-2 py-1 text-xs text-white"
              onClick={() => {
                onSave(
                  editSum.trim(),
                  editOwner,
                  topic.priority === "escalated" ? "escalated" : editPriority,
                );
                setEditing(false);
              }}
            >
              Save row
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
              onClick={() => {
                setEditSum(topic.summary);
                setEditOwner(topic.owner ?? "");
                setEditPriority(topic.priority ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          canMutateHandoff && (
            <button
              type="button"
              className="text-xs text-slate-600 underline hover:text-slate-900"
              onClick={() => setEditing(true)}
            >
              Edit summaries
            </button>
          )
        )}
      </div>
    </div>
  );
}

function TopicSheetColumn({
  topic,
  canMutateHandoff,
  focusedSearchTerm,
  onSave,
  onDraftActive,
}: {
  topic: TopicRow;
  canMutateHandoff: boolean;
  focusedSearchTerm: string | null;
  onSave: (sheetData: TopicSheetData | null) => void;
  onDraftActive?: (active: boolean) => void;
}) {
  const [sheetVisible, setSheetVisible] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TopicSheetData | null>(normalizeSheetData(topic.sheetData));
  const editable = canMutateHandoff && !topic.isClosed;

  useEffect(() => {
    setDraft(normalizeSheetData(topic.sheetData));
    setEditing(false);
  }, [topic.sheetData]);

  const draftActiveRef = useRef(onDraftActive);
  draftActiveRef.current = onDraftActive;

  useEffect(() => {
    draftActiveRef.current?.(draft != null);
  }, [draft]);

  useEffect(() => {
    return () => draftActiveRef.current?.(false);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-slate-600">No sheet</p>
        <button
          type="button"
          disabled={!editable}
          onClick={() => {
            setDraft(createSheetData(2, 3));
            setEditing(true);
            setSheetVisible(true);
          }}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Add Sheet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setSheetVisible((v) => !v)}
          title={sheetVisible ? "Hide sheet" : "Show sheet"}
          aria-label={sheetVisible ? "Hide sheet" : "Show sheet"}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-900 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <CollapseChevronIcon expanded={sheetVisible} className="h-4 w-4" />
        </button>
        {!sheetVisible && (
          <span className="text-[11px] text-slate-500">
            {draft.cols}×{draft.rows} (hidden)
          </span>
        )}
      </div>

      {sheetVisible && (
        <>
          {!editing ? (
            <div className="space-y-1">
              <div className="max-w-full overflow-auto rounded border border-slate-200 bg-white p-0.5">
                <table className="border-collapse text-[11px] leading-tight">
                  <tbody>
                    {draft.cells.map((row, r) => (
                      <tr key={`preview-r-${r}`}>
                        {row.map((cell, c) => (
                          <td
                            key={`preview-c-${c}`}
                            className={`min-w-12 border px-0.5 py-0.5 ${r === 0
                              ? "border-slate-300 bg-slate-100 text-left text-[10px] font-semibold text-slate-800"
                              : "border-slate-200 text-[11px] text-slate-800"
                              }`}
                          >
                            <span
                              className={`whitespace-pre-wrap ${cell.bold ? "font-bold" : ""} ${cell.italic ? "italic" : ""} ${cell.underline ? "underline" : ""}`}
                            >
                              {cell.text ? renderHighlightedText(cell.text, focusedSearchTerm) : "-"}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => setEditing(true)}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Edit Sheet
                </button>
                {editable && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Remove this sheet permanently? You can add a sheet again later, but all current sheet data will be lost.",
                        )
                      ) {
                        return;
                      }
                      setDraft(null);
                      void onSave(null);
                    }}
                    className="rounded border border-red-300 bg-white px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <SheetEditor value={draft} onChange={setDraft} disabled={!editable || saving} />
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!editable || saving}
                  className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-white disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save sheet"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setDraft(normalizeSheetData(topic.sheetData));
                    setEditing(false);
                  }}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SheetEditor({
  value,
  onChange,
  disabled,
}: {
  value: TopicSheetData;
  onChange: (next: TopicSheetData) => void;
  disabled: boolean;
}) {
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const commit = useCallback(
    (next: TopicSheetData) => {
      onChange(withSyncedHeaders(next));
    },
    [onChange],
  );

  const colWidths = value.cells[0]?.map((_, c) => {
    let maxLen = 0;
    for (let r = 0; r < value.rows; r++) {
      const t = value.cells[r]?.[c]?.text ?? "";
      for (const line of t.split(/\r?\n/)) {
        maxLen = Math.max(maxLen, line.length);
      }
    }
    return Math.max(8, Math.min(36, maxLen + 2));
  }) ?? [];

  function setCell(
    rowIndex: number,
    colIndex: number,
    updater: (cell: SheetCellData) => SheetCellData,
  ) {
    commit({
      ...value,
      cells: value.cells.map((row, r) =>
        r !== rowIndex ? row : row.map((cell, c) => (c !== colIndex ? cell : updater(cell))),
      ),
    });
  }

  function cellKey(rowIndex: number, colIndex: number) {
    return `${rowIndex}-${colIndex}`;
  }

  function focusCell(rowIndex: number, colIndex: number) {
    const safeRow = Math.max(0, Math.min(value.rows - 1, rowIndex));
    const safeCol = Math.max(0, Math.min(value.cols - 1, colIndex));
    const target = inputRefs.current[cellKey(safeRow, safeCol)];
    if (!target) return;
    target.focus();
    const len = target.value.length;
    target.setSelectionRange(len, len);
  }

  function addRow() {
    if (value.rows >= MAX_SHEET_ROWS) return;
    commit({
      ...value,
      rows: value.rows + 1,
      cells: [...value.cells, Array.from({ length: value.cols }, () => makeEmptyCell())],
    });
  }

  function removeRow() {
    if (value.rows <= 1) return;
    commit({
      ...value,
      rows: value.rows - 1,
      cells: value.cells.slice(0, -1),
    });
  }

  function addCol() {
    if (value.cols >= MAX_SHEET_COLS) return;
    commit({
      ...value,
      cols: value.cols + 1,
      cells: value.cells.map((row) => [...row, makeEmptyCell()]),
    });
  }

  function removeCol() {
    if (value.cols <= 1) return;
    commit({
      ...value,
      cols: value.cols - 1,
      cells: value.cells.map((row) => row.slice(0, -1)),
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={addCol}
          disabled={disabled || value.cols >= MAX_SHEET_COLS}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 disabled:opacity-50"
        >
          + Col
        </button>
        <button
          type="button"
          onClick={removeCol}
          disabled={disabled || value.cols <= 1}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 disabled:opacity-50"
        >
          - Col
        </button>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled || value.rows >= MAX_SHEET_ROWS}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 disabled:opacity-50"
        >
          + Row
        </button>
        <button
          type="button"
          onClick={removeRow}
          disabled={disabled || value.rows <= 1}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 disabled:opacity-50"
        >
          - Row
        </button>
      </div>
      <div className="max-w-full overflow-auto rounded border border-slate-200 bg-white p-0.5">
        <table className="border-collapse text-[11px] leading-tight">
          <tbody>
            {value.cells.map((row, r) => (
              <tr key={`r-${r}`}>
                {row.map((cell, c) => (
                  <td
                    key={`c-${c}`}
                    className={`border p-0.5 align-top ${r === 0 ? "border-slate-300 bg-slate-100" : "border-slate-300"
                      }`}
                    style={{ width: `${colWidths[c]}ch` }}
                  >
                    <textarea
                      value={cell.text}
                      ref={(el) => {
                        inputRefs.current[cellKey(r, c)] = el;
                      }}
                      disabled={disabled}
                      rows={Math.min(8, Math.max(1, (cell.text.match(/\n/g)?.length ?? 0) + 1))}
                      onChange={(e) =>
                        setCell(r, c, (current) => ({
                          ...current,
                          text: clipCellText(e.target.value),
                        }))
                      }
                      onPaste={(e) => {
                        if (disabled) return;
                        const text = e.clipboardData.getData("text/plain");
                        if (!text || !text.includes("\t")) return;
                        e.preventDefault();
                        commit(applyTsvPasteToCells(value, r, c, text));
                      }}
                      onKeyDown={(e) => {
                        if (disabled) return;
                        const atLastCol = c === value.cols - 1;
                        const atFirstCol = c === 0;
                        const atLastRow = r === value.rows - 1;
                        const atFirstRow = r === 0;

                        if (e.key === "Tab") {
                          e.preventDefault();
                          if (e.shiftKey) {
                            if (atFirstCol && !atFirstRow) focusCell(r - 1, value.cols - 1);
                            else focusCell(r, c - 1);
                          } else {
                            if (atLastCol && !atLastRow) focusCell(r + 1, 0);
                            else focusCell(r, c + 1);
                          }
                          return;
                        }
                        if (e.ctrlKey && e.key === "Enter") {
                          e.preventDefault();
                          focusCell(e.shiftKey ? r - 1 : r + 1, c);
                          return;
                        }
                        if (e.ctrlKey && e.key === "ArrowRight") {
                          e.preventDefault();
                          focusCell(r, c + 1);
                          return;
                        }
                        if (e.ctrlKey && e.key === "ArrowLeft") {
                          e.preventDefault();
                          focusCell(r, c - 1);
                          return;
                        }
                        if (e.ctrlKey && e.key === "ArrowDown") {
                          e.preventDefault();
                          focusCell(r + 1, c);
                          return;
                        }
                        if (e.ctrlKey && e.key === "ArrowUp") {
                          e.preventDefault();
                          focusCell(r - 1, c);
                          return;
                        }
                      }}
                      className="w-full min-h-[1.5rem] resize-y rounded border border-slate-200 px-0.5 py-0.5 text-[11px] leading-tight"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] leading-snug text-slate-500">
        Limits: up to {MAX_SHEET_COLS} columns and {MAX_SHEET_ROWS} rows. Press Enter for a new line in a cell (like
        Excel Alt+Enter). Ctrl+Enter moves to the row below; Ctrl+Arrow moves between cells; Tab moves to the next cell.
        Paste from Excel/Sheets supports multi-line cells. Extra rows/columns are added up to the limit.
      </p>
    </div>
  );
}

function TopicUpdatesColumn({
  api,
  topic,
  selectedTeam,
  userId,
  userTeam,
  clientDisplayTz,
  canMutateHandoff,
  isClosed,
  focusedSearchTerm,
  collapsed,
  onExpand,
  onRefresh,
}: {
  api: string;
  topic: TopicRow;
  selectedTeam: Team;
  userId?: string;
  userTeam: Team | null | undefined;
  clientDisplayTz: string;
  canMutateHandoff: boolean;
  isClosed: boolean;
  focusedSearchTerm: string | null;
  collapsed: boolean;
  onExpand: () => void;
  onRefresh: () => void;
}) {
  const orderedComments = commentsInChronologicalOrder(topic);
  const latestCommentId = pickLatestCommentIdFromRows(topic.comments);
  const visibleComments = collapsed
    ? orderedComments.filter((c) => c.id === latestCommentId)
    : orderedComments;
  const hasOlderComments = collapsed && orderedComments.length > visibleComments.length;
  const [showPostForm, setShowPostForm] = useState(false);

  return (
    <div className="min-w-0 space-y-1">
      {hasOlderComments && (
        <button
          type="button"
          onClick={onExpand}
          className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
        >
          See more
        </button>
      )}
      {visibleComments.map((c) => (
        <CommentBlock
          key={c.id}
          api={api}
          topicId={topic.id}
          comment={c}
          userId={userId}
          userTeam={userTeam}
          clientDisplayTz={clientDisplayTz}
          canMutateHandoff={canMutateHandoff}
          isLatestComment={latestCommentId === c.id}
          canMarkDone={!isClosed}
          canUndoDone={canMutateHandoff && isClosed}
          focusedSearchTerm={focusedSearchTerm}
          onRefresh={onRefresh}
        />
      ))}
      {canMutateHandoff && !showPostForm && (
        <button
          type="button"
          onClick={() => setShowPostForm(true)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Add update
        </button>
      )}
      {showPostForm && (
        <PostUpdateForm
          api={api}
          topicId={topic.id}
          team={selectedTeam}
          clientDisplayTz={clientDisplayTz}
          canMarkDone={!isClosed}
          topicEscalated={isTopicEscalated(topic)}
          onCancel={() => setShowPostForm(false)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

async function uploadCommentFiles(api: string, commentId: string, files: File[]) {
  for (const f of files) {
    const fd = new FormData();
    fd.set("file", f);
    const up = await fetch(`${api}/comments/${commentId}/attachments`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (!up.ok) {
      const data = await up.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : `Upload failed: ${f.name}`);
    }
  }
}

function AttachmentDownloadButton({ api, attachment }: { api: string; attachment: AttachmentMeta }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`${api}/attachments/${attachment.id}`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Could not download file");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.originalFilename || "attachment";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not download file");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={busy}
      className="text-left text-blue-700 underline hover:text-blue-900 disabled:opacity-50"
    >
      {busy ? "Downloading…" : attachment.originalFilename}
    </button>
  );
}

function CommentBlock({
  api,
  topicId,
  comment,
  userId,
  userTeam,
  clientDisplayTz,
  canMutateHandoff,
  isLatestComment,
  canMarkDone,
  canUndoDone,
  focusedSearchTerm,
  onRefresh,
}: {
  api: string;
  topicId: string;
  comment: CommentRow;
  userId?: string;
  userTeam: Team | null | undefined;
  clientDisplayTz: string;
  canMutateHandoff: boolean;
  isLatestComment: boolean;
  canMarkDone: boolean;
  canUndoDone: boolean;
  focusedSearchTerm: string | null;
  onRefresh: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [undoSubmitting, setUndoSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [editTeam, setEditTeam] = useState<Team>(comment.team);
  const [editFiles, setEditFiles] = useState<File[]>([]);

  useEffect(() => {
    setEditBody(comment.body);
    setEditTeam(comment.team);
  }, [comment.body, comment.team]);

  const canEdit =
    canMutateHandoff &&
    isLatestComment &&
    userId &&
    canEditComment({
      userId,
      userTeam: userTeam ?? null,
      commentAuthorId: comment.authorId,
      commentTeam: comment.team,
    });

  async function saveEdit(e: React.SyntheticEvent, markDone: boolean) {
    e.preventDefault();
    if (!editBody.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`${api}/comments/${comment.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody.trim(), team: editTeam, clientTimeZone: clientDisplayTz }),
      });
      if (!res.ok) throw new Error("Could not save");
      if (editFiles.length > 0) {
        await uploadCommentFiles(api, comment.id, editFiles);
        setEditFiles([]);
      }
      if (markDone) {
        const close = await fetch(`${api}/topics/${topicId}/close`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isClosed: true }),
        });
        if (!close.ok) throw new Error("Could not mark item done");
      }
      setEditing(false);
      onRefresh();
    } catch (err) {
      setErr(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSubmitting(false);
    }
  }

  async function undoDoneFromEdit() {
    setUndoSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`${api}/topics/${encodeURIComponent(topicId)}/close`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isClosed: false }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof data.error === "string" ? data.error : "Could not reopen item");
      }
      setEditing(false);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reopen item");
    } finally {
      setUndoSubmitting(false);
    }
  }

  if (editing && canEdit) {
    return (
      <form onSubmit={(e) => void saveEdit(e, false)} className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
        {err && <p className="text-xs text-red-600">{err}</p>}
        <textarea
          rows={4}
          value={editBody}
          onChange={(e) => setEditBody(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-600">Team</label>
          <select
            value={editTeam}
            onChange={(e) => setEditTeam(e.target.value as Team)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <TeamSelectOptions />
          </select>
        </div>
        <div>
          <input
            type="file"
            multiple
            onChange={(e) => setEditFiles(e.target.files ? Array.from(e.target.files) : [])}
            className="text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
          />
          {editFiles.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-500">{editFiles.map((f) => f.name).join(", ")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={submitting || !editBody.trim()}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save update"}
          </button>
          {canMarkDone && (
            <button
              type="button"
              onClick={(e) => void saveEdit(e, true)}
              disabled={submitting || !editBody.trim()}
              className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {submitting ? "Working…" : "Mark Done & post update"}
            </button>
          )}
          {canUndoDone && (
            <button
              type="button"
              onClick={() => void undoDoneFromEdit()}
              disabled={submitting || undoSubmitting}
              className="rounded-md border border-amber-600 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
              title="Reopen this item if it was marked done by mistake (latest handoff only)"
            >
              {undoSubmitting ? "Working…" : "Undo done"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditBody(comment.body);
              setEditTeam(comment.team);
              setEditing(false);
              setErr(null);
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded border border-slate-100 bg-slate-50/80 px-1.5 py-1">
      <p className="text-xs leading-snug text-slate-800">
        <span className={`font-semibold ${teamTextClass(comment.team)}`}>{comment.prefix} </span>
        <span className="font-normal whitespace-pre-wrap">
          {renderTextWithLinks(comment.body, focusedSearchTerm)}
        </span>
      </p>
      {comment.attachments.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
          {comment.attachments.map((a) => (
            <li key={a.id}>
              <AttachmentDownloadButton api={api} attachment={a} />
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-0.5 text-[11px] font-medium text-slate-700 underline hover:text-slate-900"
        >
          Edit update
        </button>
      )}
    </div>
  );
}

function PostUpdateForm({
  api,
  topicId,
  team,
  clientDisplayTz,
  canMarkDone,
  topicEscalated,
  onCancel,
  onRefresh,
}: {
  api: string;
  topicId: string;
  team: Team;
  clientDisplayTz: string;
  canMarkDone: boolean;
  topicEscalated: boolean;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submitComment(action: "post" | "markDone" | "escalate" | "removeEscalation") {
    if (action !== "escalate" && action !== "removeEscalation" && !text.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const clean = text.trim();
      const bodyToPost =
        action === "escalate"
          ? clean.length > 0
            ? clean
            : "Escalated."
          : action === "removeEscalation"
            ? REMOVE_ESCALATION_COMMENT_PREFIX +
            (clean.length > 0 ? clean : "Escalation removed.")
            : clean;
      const res = await fetch(`${api}/topics/${topicId}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: bodyToPost,
          team,
          clientTimeZone: clientDisplayTz,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Comment failed");
      }
      const data = await res.json();
      const commentId: string = data.comment.id;
      if (files.length > 0) {
        await uploadCommentFiles(api, commentId, files);
      }
      if (action === "markDone") {
        const close = await fetch(`${api}/topics/${topicId}/close`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isClosed: true }),
        });
        if (!close.ok) throw new Error("Could not mark item done");
      }
      if (action === "escalate") {
        const bump = await fetch(`${api}/topics/${topicId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: "escalated" }),
        });
        if (!bump.ok) throw new Error("Could not escalate item");
      }
      if (action === "removeEscalation") {
        const bump = await fetch(`${api}/topics/${topicId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: "high" }),
        });
        if (!bump.ok) {
          const data = await bump.json().catch(() => ({}));
          throw new Error(typeof data.error === "string" ? data.error : "Could not remove escalation");
        }
      }
      setText("");
      setFiles([]);
      onCancel();
      onRefresh();
    } catch (err) {
      setErr(err instanceof Error ? err.message : "Could not save update");
    } finally {
      setSubmitting(false);
    }
  }

  const teamAria = teamSelectLabel(team);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submitComment("post");
      }}
      className="space-y-2 rounded-md border border-dashed border-slate-300 bg-slate-50/80 p-2"
      aria-label={`Post update as ${teamAria} team`}
    >
      <p className="text-xs font-medium text-slate-600">
        Add update — {teamSelectLabel(team)} (use Team selector in header)
      </p>
      <p className="text-xs text-slate-500">
        Today in your location ({clientDisplayTz}):{" "}
        <span className="font-medium text-slate-700">
          {formatDdMmYyyyInTz(new Date(), clientDisplayTz)}
        </span>{" "}
        — this date is used on the update line when you post.
      </p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add today's Update"
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
      <div>
        <input
          type="file"
          multiple
          onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
          className="text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          {files.length > 0
            ? files.map((f) => f.name).join(", ")
            : "You can attach more than one file. Click a name to download it."}
        </p>
      </div>
      <button
        type="submit"
        disabled={submitting || !text.trim()}
        className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Post update"}
      </button>
      {canMarkDone && (
        <button
          type="button"
          onClick={() => void submitComment("markDone")}
          disabled={submitting || !text.trim()}
          className="ml-2 rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Working…" : "Mark Done & post update"}
        </button>
      )}
      <button
        type="button"
        onClick={() => void submitComment(topicEscalated ? "removeEscalation" : "escalate")}
        disabled={submitting}
        className={`ml-2 rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-50 ${topicEscalated ? "bg-slate-700 hover:bg-slate-800" : "bg-red-700 hover:bg-red-800"
          }`}
      >
        {submitting ? "Working…" : topicEscalated ? "Remove escalation" : "Escalate"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
      >
        Cancel
      </button>
    </form>
  );
}
