import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseYmdToUtcDate } from "@/lib/business-days";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { getLatestHandoffYmd, handoffYmdAllowsMutations } from "@/lib/handoff-policy";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.object({
  summary: z.string().min(1).max(20_000),
  shortSummary: z.string().min(1).max(500).optional(),
  owner: z.string().max(200).nullish(),
  priority: z.enum(["low", "mid", "high"]).nullable().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; date: string }> },
) {
  const { workspaceId, date } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  if (!dateRe.test(date)) return json({ error: "Invalid date" }, { status: 400 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const latestYmd = await getLatestHandoffYmd(workspaceId);
  if (!handoffYmdAllowsMutations(date, latestYmd)) {
    return json(
      { error: "Items can only be added to the latest handoff." },
      { status: 403 },
    );
  }

  const handoffDate = parseYmdToUtcDate(date);

  const result = await prisma.$transaction(async (tx) => {
    let day = await tx.handoffDay.findUnique({
      where: {
        workspaceId_handoffDate: { workspaceId, handoffDate },
      },
    });
    if (!day) {
      day = await tx.handoffDay.create({
        data: { workspaceId, handoffDate },
      });
    }
    const maxOrder = await tx.handoffDayTopic.aggregate({
      where: { handoffDayId: day.id },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;
    const topic = await tx.topic.create({
      data: {
        summary: parsed.summary,
        shortSummary: parsed.shortSummary ?? parsed.summary.slice(0, 120),
        owner: parsed.owner?.trim() ? parsed.owner.trim() : null,
        priority: parsed.priority ?? null,
      },
    });
    await tx.handoffDayTopic.create({
      data: {
        handoffDayId: day.id,
        topicId: topic.id,
        sortOrder,
      },
    });
    return { topic, sortOrder };
  });

  return json({
    topic: {
      id: result.topic.id,
      summary: result.topic.summary,
      shortSummary: result.topic.shortSummary,
      owner: result.topic.owner,
      priority: result.topic.priority,
      sheetData: result.topic.sheetData,
      isClosed: result.topic.isClosed,
      createdAt: result.topic.createdAt.toISOString(),
      sortOrder: result.sortOrder,
      comments: [],
    },
  });
}
