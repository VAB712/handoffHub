/** How long after the chosen minute the server may still send, so a short restart does not skip the day. */
export const MAIL_SCHEDULE_GRACE_MINUTES = 15;

export type ZonedClock = {
  hour: number;
  minute: number;
  ymd: string;
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function zonedClock(date: Date, timeZone: string): ZonedClock {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => fmt.find((p) => p.type === type)?.value ?? "";
  let hour = Number(part("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(part("minute"));
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return {
    hour,
    minute,
    ymd: `${year}-${month}-${day}`,
  };
}

export function scheduleIsDue(
  schedule: { hour: number; minute: number; timeZone: string; lastSentOn: string | null },
  now = new Date(),
): { due: boolean; ymd: string } {
  const clock = zonedClock(now, schedule.timeZone);
  if (schedule.lastSentOn === clock.ymd) return { due: false, ymd: clock.ymd };
  const delta = clock.hour * 60 + clock.minute - (schedule.hour * 60 + schedule.minute);
  return { due: delta >= 0 && delta <= MAIL_SCHEDULE_GRACE_MINUTES, ymd: clock.ymd };
}

export function padClock(n: number): string {
  return String(n).padStart(2, "0");
}
