/** True if `ymd` is a real calendar day (YYYY-MM-DD, Gregorian). */
export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True if `tz` is accepted by Intl (IANA zone id). */
export function isValidIanaTimeZone(tz: string): boolean {
  const t = tz.trim();
  if (t.length < 2 || t.length > 120) return false;
  if (!/^[A-Za-z0-9/_\-+]+$/.test(t)) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: t }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
