import type { Priority, Team } from "@prisma/client";
import { teamMailColor } from "@/lib/team";

type MailComment = {
  id: string;
  team: Team;
  body: string;
  prefix: string;
  createdAt: string;
  attachments: { originalFilename: string }[];
};

type MailCell = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

export type MailTopic = {
  summary: string;
  owner: string | null;
  priority: Priority | null;
  isClosed: boolean;
  sheetData: unknown;
  comments: MailComment[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function commentsInOrder(topic: MailTopic): MailComment[] {
  return [...topic.comments].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function isEscalated(topic: MailTopic): boolean {
  if (topic.priority === "escalated") return true;
  if (topic.priority !== "high") return false;
  const ordered = commentsInOrder(topic);
  const latest = ordered[ordered.length - 1];
  return !!latest && latest.body.trim().toUpperCase().startsWith("ESCALATED");
}

function priorityText(priority: Priority | null): string {
  if (!priority) return "-";
  if (priority === "escalated") return "ESCALATED";
  return priority.toUpperCase();
}

function colored(color: string, content: string, bold = false): string {
  const weight = bold ? "font-weight:bold;" : "";
  const inner = bold ? `<b>${content}</b>` : content;
  return (
    `<span style="color:${color};${weight}mso-color-alt:auto;">` +
    `<font color="${color}">${inner}</font></span>`
  );
}

function tint(topic: MailTopic): string {
  if (isEscalated(topic) || topic.priority === "high") return "#fee2e2";
  if (topic.priority === "mid") return "#ffedd5";
  if (topic.priority === "low") return "#dbeafe";
  return "#f1f5f9";
}

function priorityHtml(topic: MailTopic): string {
  const text = escapeHtml(priorityText(topic.priority));
  if (isEscalated(topic) || topic.priority === "high") return colored("#B91C1C", text, true);
  if (topic.priority === "mid") return colored("#EA580C", text, true);
  if (topic.priority === "low") return colored("#1D4ED8", text, true);
  return text;
}

function summaryHtml(topic: MailTopic): string {
  const raw = escapeHtml(topic.summary);
  if (isEscalated(topic)) return `${colored("#7F1D1D", "ESCALATED - ", true)}${raw}`;
  return raw;
}

function updatesHtml(topic: MailTopic): string {
  const list = commentsInOrder(topic);
  if (list.length === 0) return colored("#94A3B8", "—");
  return list
    .map((c) => {
      const prefix = escapeHtml(c.prefix);
      const body = escapeHtml(c.body).replace(/\n/g, "<br/>");
      const att =
        c.attachments.length > 0
          ? `<ul style="margin:4px 0 0 18px;padding:0;color:#475569;font-size:11px;">${c.attachments
              .map((a) => `<li>${escapeHtml(a.originalFilename)}</li>`)
              .join("")}</ul>`
          : "";
      return (
        `<p style="margin:0 0 6pt 0;line-height:1.35;">` +
        `${colored(teamMailColor(c.team), `${prefix} `, true)}` +
        `<span style="color:#0F172A;">${body}</span>${att}</p>`
      );
    })
    .join("");
}

function readCells(sheetData: unknown): MailCell[][] | null {
  if (!sheetData || typeof sheetData !== "object") return null;
  const cells = (sheetData as { cells?: unknown }).cells;
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const rows: MailCell[][] = [];
  for (const row of cells) {
    if (!Array.isArray(row)) continue;
    rows.push(
      row.map((cell) => {
        const c = cell && typeof cell === "object" ? (cell as MailCell) : null;
        return {
          text: typeof c?.text === "string" ? c.text : "",
          bold: !!c?.bold,
          italic: !!c?.italic,
          underline: !!c?.underline,
        };
      }),
    );
  }
  return rows.length > 0 ? rows : null;
}

function sheetHtml(topic: MailTopic): string {
  const rows = readCells(topic.sheetData);
  if (!rows) return '<p style="margin:0;color:#64748b;font-size:12px;">No sheet</p>';
  const border = "1px solid #cbd5e1";
  const body = rows
    .map((row, r) => {
      const tds = row
        .map((cell) => {
          const inner = escapeHtml(cell.text).replace(/\r\n/g, "\n").replace(/\n/g, "<br/>") || "—";
          const fw = cell.bold ? "font-weight:bold;" : "";
          const it = cell.italic ? "font-style:italic;" : "";
          const ul = cell.underline ? "text-decoration:underline;" : "";
          const head = r === 0 ? "background:#f1f5f9;font-weight:600;color:#334155;" : "color:#0f172a;";
          return `<td style="border:${border};padding:4px 6px;font-size:11px;white-space:normal;${head}${fw}${it}${ul}">${inner}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table border="1" cellpadding="3" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:11px;">${body}</table>`;
}

function topicHasSheet(topic: MailTopic): boolean {
  return readCells(topic.sheetData) != null;
}

function rowHtml(topic: MailTopic, includeSheet: boolean): string {
  const border = "1px solid #cbd5e1";
  const op = topic.isClosed ? "opacity:0.78;" : "";
  const td = `border:${border};padding:10px;vertical-align:top;font-size:13px;line-height:1.4;color:#0f172a;background:#ffffff;${op}`;
  const tdTint = `border:${border};padding:4px 2px;vertical-align:top;background:${tint(topic)};${op}`;
  const tdPri = `border:${border};padding:10px;vertical-align:top;font-size:13px;line-height:1.4;background:#ffffff;${op}`;
  const sheetCell = includeSheet ? `<td style="${td}">${sheetHtml(topic)}</td>` : "";
  return `<tr style="background:#ffffff;">
    <td style="${tdTint}">&nbsp;</td>
    <td style="${td}">${summaryHtml(topic)}</td>
    <td style="${td}">${escapeHtml(topic.owner || "—")}</td>
    <td style="${tdPri}">${priorityHtml(topic)}</td>
    <td style="${td}">${updatesHtml(topic)}</td>
    ${sheetCell}
  </tr>`;
}

export function buildHandoffMailTableHtml(topics: MailTopic[]): string {
  const includeSheet = topics.some(topicHasSheet);
  const border = "1px solid #cbd5e1";
  const th = `border:${border};background:#f1f5f9;padding:8px 10px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#475569;`;
  const updatesWidth = includeSheet ? "31%" : "59%";
  const sheetHeader = includeSheet ? `<th style="${th}width:28%;">Sheet</th>` : "";
  const columnCount = includeSheet ? 6 : 5;
  const thead = `<thead><tr>
    <th style="${th}width:3%;"></th>
    <th style="${th}width:20%;">Summary</th>
    <th style="${th}width:10%;">Owner</th>
    <th style="${th}width:8%;">Priority</th>
    <th style="${th}width:${updatesWidth};">Updates</th>
    ${sheetHeader}
  </tr></thead>`;
  const body =
    topics.length === 0
      ? `<tr><td colspan="${columnCount}" style="border:${border};padding:14px;color:#64748b;font-size:13px;">No items for this handoff date.</td></tr>`
      : topics.map((topic) => rowHtml(topic, includeSheet)).join("");
  return `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:1200px;table-layout:fixed;font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:12px;color:#0f172a;">${thead}<tbody>${body}</tbody></table>`;
}

export function handoffMailPlainText(topics: MailTopic[]): string {
  const lines: string[] = [];
  for (const t of topics) {
    lines.push(t.summary.replace(/\r?\n/g, " "));
    lines.push(`Owner: ${t.owner || "—"} | Priority: ${priorityText(t.priority)}`);
    for (const c of commentsInOrder(t)) {
      lines.push(`${c.prefix} ${c.body.replace(/\r?\n/g, " ")}`);
    }
    lines.push("");
  }
  if (topics.length === 0) lines.push("(No items for this date.)");
  return lines.join("\n").replace(/\n+$/, "");
}
