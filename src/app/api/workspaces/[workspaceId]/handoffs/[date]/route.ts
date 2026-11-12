import { prisma } from "@/lib/prisma";
import { parseYmdToUtcDate } from "@/lib/business-days";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { formatCommentLine } from "@/lib/format-comment";
import { resolveDisplayTimeZone } from "@/lib/display-tz";
import { deleteCommentAttachmentDir } from "@/lib/attachments-fs";
import { getLatestHandoffYmd } from "@/lib/handoff-policy";
import type { Team } from "@prisma/client";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function serializeComment(
  c: {
    id: string;
    team: Team;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    authorId: string;
    author: { name: string | null; email: string };
    attachments: { id: string; originalFilename: string; mimeType: string; sizeBytes: bigint }[];
  },
  displayTz: string,
) {
  return {
    id: c.id,
    team: c.team,
    body: c.body,
    prefix: formatCommentLine(c.team, c.createdAt, displayTz),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    authorId: c.authorId,
    author: { name: c.author.name, email: c.author.email },
    attachments: c.attachments.map((a) => ({
      id: a.id,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes.toString(),
    })),
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; date: string }> },
) {
  const displayTz = resolveDisplayTimeZone(new URL(req.url).searchParams.get("displayTz"));

  const { workspaceId, date } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  if (!dateRe.test(date)) return json({ error: "Invalid date" }, { status: 400 });

  const latestRow = await prisma.handoffDay.findFirst({
    where: { workspaceId },
    orderBy: { handoffDate: "desc" },
    select: { handoffDate: true },
  });
  const latestHandoffDate = latestRow ? latestRow.handoffDate.toISOString().slice(0, 10) : null;

  const handoffDate = parseYmdToUtcDate(date);
  const day = await prisma.handoffDay.findUnique({
    where: {
      workspaceId_handoffDate: { workspaceId, handoffDate },
    },
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
                      id: true,
                      originalFilename: true,
                      mimeType: true,
                      sizeBytes: true,
                    },
                  },
                  author: { select: { id: true, name: true, email: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!day) {
    return json({
      exists: false,
      handoffDate: date,
      latestHandoffDate,
      topics: [],
    });
  }

  const topics = day.topics.map((row) => ({
    id: row.topic.id,
    summary: row.topic.summary,
    shortSummary: row.topic.shortSummary,
    owner: row.topic.owner,
    priority: row.topic.priority,
    sheetData: row.topic.sheetData,
    isClosed: row.topic.isClosed,
    createdAt: row.topic.createdAt.toISOString(),
    sortOrder: row.sortOrder,
    comments: row.topic.comments.map((c) => serializeComment(c, displayTz)),
  }));

  return json({
    exists: true,
    id: day.id,
    handoffDate: date,
    latestHandoffDate,
    createdAt: day.createdAt.toISOString(),
    topics,
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string; date: string }> },
) {
  const { workspaceId, date } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  if (!dateRe.test(date)) return json({ error: "Invalid date" }, { status: 400 });

  const handoffDate = parseYmdToUtcDate(date);
  const day = await prisma.handoffDay.findUnique({
    where: {
      workspaceId_handoffDate: { workspaceId, handoffDate },
    },
    include: {
      topics: {
        include: {
          topic: {
            include: {
              comments: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!day) return json({ error: "Handoff not found" }, { status: 404 });

  const ymd = day.handoffDate.toISOString().slice(0, 10);
  const latestYmd = await getLatestHandoffYmd(workspaceId);
  if (latestYmd !== ymd) {
    return json({ error: "Only the latest handoff can be deleted." }, { status: 403 });
  }

  const commentIds = day.topics.flatMap((row) => row.topic.comments.map((c) => c.id));
  const topicIds = day.topics.map((row) => row.topicId);

  await prisma.$transaction(async (tx) => {
    await tx.handoffDayTopic.deleteMany({ where: { handoffDayId: day.id } });
    if (topicIds.length > 0) {
      await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
    }
    await tx.handoffDay.delete({ where: { id: day.id } });
  });

  for (const cid of commentIds) {
    await deleteCommentAttachmentDir(cid);
  }

  return json({ ok: true, deletedDate: ymd });
}
