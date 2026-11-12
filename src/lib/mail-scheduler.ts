import { prisma } from "@/lib/prisma";
import { scheduleIsDue } from "@/lib/mail-schedule";
import { sendLatestHandoffToWorkspaceMail } from "@/lib/send-scheduled-handoff";

const TICK_MS = 20_000;

type SchedulerGlobal = typeof globalThis & { __handoffMailScheduler?: boolean };

export function startMailScheduler(): void {
  const g = globalThis as SchedulerGlobal;
  if (g.__handoffMailScheduler) return;
  g.__handoffMailScheduler = true;
  const tick = () => {
    void runDueMailSchedules().catch((err) => {
      console.error("Scheduled mail check failed:", err instanceof Error ? err.message : err);
    });
  };
  tick();
  setInterval(tick, TICK_MS);
}

export async function runDueMailSchedules(now = new Date()): Promise<void> {
  const schedules = await prisma.mailSchedule.findMany({
    select: {
      id: true,
      workspaceId: true,
      hour: true,
      minute: true,
      timeZone: true,
      lastSentOn: true,
    },
  });

  for (const schedule of schedules) {
    let due: { due: boolean; ymd: string };
    try {
      due = scheduleIsDue(schedule, now);
    } catch {
      continue;
    }
    if (!due.due) continue;

    const claimed = await prisma.mailSchedule.updateMany({
      where: {
        id: schedule.id,
        OR: [{ lastSentOn: null }, { lastSentOn: { not: due.ymd } }],
      },
      data: { lastSentOn: due.ymd },
    });
    if (claimed.count !== 1) continue;

    try {
      const result = await sendLatestHandoffToWorkspaceMail(schedule.workspaceId, schedule.timeZone);
      if (!result.sent) {
        await prisma.mailSchedule.updateMany({
          where: { id: schedule.id, lastSentOn: due.ymd },
          data: { lastSentOn: schedule.lastSentOn },
        });
      }
    } catch (err) {
      await prisma.mailSchedule.updateMany({
        where: { id: schedule.id, lastSentOn: due.ymd },
        data: { lastSentOn: schedule.lastSentOn },
      });
      console.error(
        `Scheduled mail failed for workspace ${schedule.workspaceId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
