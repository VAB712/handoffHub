import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAdmin } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { isValidTimeZone } from "@/lib/mail-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timeZone: z.string().trim().min(1).max(80),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; scheduleId: string }> },
) {
  const { workspaceId, scheduleId } = await ctx.params;
  const access = await requireWorkspaceAdmin(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "Choose an hour from 00 to 23 and a minute from 00 to 59." }, { status: 400 });
  }
  if (!isValidTimeZone(body.timeZone)) {
    return json({ error: "This browser timezone cannot be used for the schedule." }, { status: 400 });
  }

  const current = await prisma.mailSchedule.findFirst({
    where: { id: scheduleId, workspaceId },
  });
  if (!current) return json({ error: "Schedule not found" }, { status: 404 });

  const duplicate = await prisma.mailSchedule.findFirst({
    where: {
      workspaceId,
      hour: body.hour,
      minute: body.minute,
      timeZone: body.timeZone,
      NOT: { id: scheduleId },
    },
    select: { id: true },
  });
  if (duplicate) {
    return json({ error: "That time is already scheduled for this workspace." }, { status: 409 });
  }

  const timeChanged =
    current.hour !== body.hour || current.minute !== body.minute || current.timeZone !== body.timeZone;
  const row = await prisma.mailSchedule.update({
    where: { id: scheduleId },
    data: {
      hour: body.hour,
      minute: body.minute,
      timeZone: body.timeZone,
      lastSentOn: timeChanged ? null : current.lastSentOn,
    },
  });

  return json({
    schedule: {
      id: row.id,
      hour: row.hour,
      minute: row.minute,
      timeZone: row.timeZone,
      lastSentOn: row.lastSentOn,
    },
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string; scheduleId: string }> },
) {
  const { workspaceId, scheduleId } = await ctx.params;
  const access = await requireWorkspaceAdmin(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  const current = await prisma.mailSchedule.findFirst({
    where: { id: scheduleId, workspaceId },
    select: { id: true },
  });
  if (!current) return json({ error: "Schedule not found" }, { status: 404 });

  await prisma.mailSchedule.delete({ where: { id: scheduleId } });
  return json({ ok: true });
}
