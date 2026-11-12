import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAdmin } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { isValidTimeZone } from "@/lib/mail-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SCHEDULES = 48;

const bodySchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timeZone: z.string().trim().min(1).max(80),
});

function scheduleJson(row: {
  id: string;
  hour: number;
  minute: number;
  timeZone: string;
  lastSentOn: string | null;
}) {
  return {
    id: row.id,
    hour: row.hour,
    minute: row.minute,
    timeZone: row.timeZone,
    lastSentOn: row.lastSentOn,
  };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  const access = await requireWorkspaceAdmin(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      mailTo: true,
      mailSchedules: { orderBy: [{ hour: "asc" }, { minute: "asc" }, { timeZone: "asc" }] },
    },
  });
  if (!workspace) return json({ error: "Workspace not found" }, { status: 404 });

  return json({
    mailTo: workspace.mailTo,
    schedules: workspace.mailSchedules.map(scheduleJson),
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
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

  const count = await prisma.mailSchedule.count({ where: { workspaceId } });
  if (count >= MAX_SCHEDULES) {
    return json({ error: "This workspace already has the maximum number of schedules." }, { status: 400 });
  }

  const duplicate = await prisma.mailSchedule.findFirst({
    where: { workspaceId, hour: body.hour, minute: body.minute, timeZone: body.timeZone },
    select: { id: true },
  });
  if (duplicate) {
    return json({ error: "That time is already scheduled for this workspace." }, { status: 409 });
  }

  const row = await prisma.mailSchedule.create({
    data: {
      workspaceId,
      hour: body.hour,
      minute: body.minute,
      timeZone: body.timeZone,
    },
  });
  return json({ schedule: scheduleJson(row) });
}
