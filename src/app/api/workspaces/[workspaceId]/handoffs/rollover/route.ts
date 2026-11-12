import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { parseYmdToUtcDate, todayYmdInTz } from "@/lib/business-days";
import { getHandoffTz } from "@/lib/env";
import { copyAttachmentsToNewComment } from "@/lib/rollover-attachments";
import { isValidIanaTimeZone, isValidYmd } from "@/lib/client-today";

const rolloverBodySchema = z
  .object({
    clientToday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clientTimeZone: z.string().min(1).max(120),
  })
  .strict();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  let todayYmd: string;

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const raw = await req.json().catch(() => null);
    const parsed = rolloverBodySchema.safeParse(raw);
    if (parsed.success) {
      if (!isValidYmd(parsed.data.clientToday)) {
        return json({ error: "Invalid clientToday calendar date" }, { status: 400 });
      }
      if (!isValidIanaTimeZone(parsed.data.clientTimeZone)) {
        return json({ error: "Invalid clientTimeZone" }, { status: 400 });
      }
      todayYmd = parsed.data.clientToday;
    } else {
      todayYmd = todayYmdInTz(getHandoffTz());
    }
  } else {
    todayYmd = todayYmdInTz(getHandoffTz());
  }

  const todayDate = parseYmdToUtcDate(todayYmd);

  const existing = await prisma.handoffDay.findUnique({
    where: {
      workspaceId_handoffDate: { workspaceId, handoffDate: todayDate },
    },
  });
  if (existing) {
    return json(
      { error: "Handoff for today already exists", handoffDate: todayYmd, id: existing.id },
      { status: 409 },
    );
  }

  const prevDay = await prisma.handoffDay.findFirst({
    where: {
      workspaceId,
      handoffDate: { lt: todayDate },
    },
    orderBy: { handoffDate: "desc" },
    include: {
      topics: {
        orderBy: { sortOrder: "asc" },
        include: {
          topic: {
            include: {
              comments: {
                orderBy: { createdAt: "asc" },
                include: {
                  attachments: {
                    select: {
                      storagePath: true,
                      originalFilename: true,
                      mimeType: true,
                      sizeBytes: true,
                      content: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const openRows = prevDay?.topics.filter((r) => !r.topic.isClosed) ?? [];
  const rolledFromYmd = prevDay ? prevDay.handoffDate.toISOString().slice(0, 10) : null;

  const created = await prisma.$transaction(async (tx) => {
    const day = await tx.handoffDay.create({
      data: { workspaceId, handoffDate: todayDate },
    });
    let order = 0;
    for (const row of openRows) {
      const t = row.topic;
      const newTopic = await tx.topic.create({
        data: {
          summary: t.summary,
          shortSummary: t.shortSummary,
          owner: t.owner,
          priority: t.priority,
          sheetData: t.sheetData === null ? Prisma.JsonNull : t.sheetData,
          isClosed: false,
          closedAt: null,
        },
      });
      await tx.handoffDayTopic.create({
        data: {
          handoffDayId: day.id,
          topicId: newTopic.id,
          sortOrder: order++,
        },
      });
      for (const c of t.comments) {
        const newComment = await tx.comment.create({
          data: {
            topicId: newTopic.id,
            authorId: c.authorId,
            team: c.team,
            body: c.body,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          },
        });
        if (c.attachments.length > 0) {
          await copyAttachmentsToNewComment(tx, c.attachments, newComment.id);
        }
      }
    }
    return day;
  }, { timeout: 120_000, maxWait: 10_000 });

  return json({
    ok: true,
    handoffDate: todayYmd,
    id: created.id,
    rolledFrom: rolledFromYmd,
    topicCount: openRows.length,
  });
}
