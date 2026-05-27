import { getHandoffTz } from "./env";

/** Today's calendar date YYYY-MM-DD in the configured org timezone. */
export function todayYmdInTz(tz = getHandoffTz()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatYmdInTz(d: Date, tz = getHandoffTz()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Previous Mon–Fri calendar date before `ymd` (interpreted in org TZ). */
export function previousBusinessDayYmd(ymd: string, tz = getHandoffTz()): string {
  const [y, m, d] = ymd.split("-").map(Number);
  let cur = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  cur = new Date(cur.getTime() - 86400000);
  for (let i = 0; i < 14; i++) {
    const w = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(cur);
    if (w !== "Sat" && w !== "Sun") return formatYmdInTz(cur, tz);
    cur = new Date(cur.getTime() - 86400000);
  }
  return formatYmdInTz(cur, tz);
}

export function parseYmdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}
