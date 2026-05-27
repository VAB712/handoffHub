/** Format YYYY-MM-DD as DD-MM-YYYY for display. */
export function formatDdMmYyyyFromYmd(ymd: string): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`;
}

/** Format YYYY-MM-DD as DD/MM/YYYY (day-first, slashes). */
export function formatDdMmYyyySlashFromYmd(ymd: string): string {
  const parts = ymd.split("-");
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/**
 * Parse DD/MM/YYYY (or DD-MM-YYYY / DD.MM.YYYY) into YYYY-MM-DD.
 * Day is first, month second (UK order).
 */
export function parseDdMmYyyyToYmd(s: string): string | null {
  const t = s.trim().replace(/\s/g, "");
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Format a Date in a timezone as DD-MM-YYYY (calendar-style). */
export function formatDdMmYyyyInTz(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  if (!day || !month || !year) return formatDdMmYyyyFromDateLocal(date);
  return `${day}-${month}-${year}`;
}

function formatDdMmYyyyFromDateLocal(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`;
}

/** DD-MM-YYYY and 24h time in org timezone for activity lines. */
export function formatDdMmYyyyTimeInTz(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const dayPart = formatDdMmYyyyInTz(date, timeZone);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${dayPart} ${timePart}`;
}

/** Weekday + DD-MM-YYYY for handoff page title (calendar `ymd` in `timeZone`). */
export function formatHandoffTitle(ymd: string, timeZone: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  if (!y || !mo || !d) return ymd;
  const noonUtc = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(noonUtc);
  const ddmmyyyy = formatDdMmYyyyFromYmd(ymd);
  return `${weekday}, ${ddmmyyyy}`;
}
