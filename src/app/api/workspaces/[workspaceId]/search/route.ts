import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return json({ results: [] });
  if (q.length < 2) return json({ error: "Enter at least 2 characters" }, { status: 400 });

  const rows = (await prisma.handoffDayTopic.findMany({
    where: {
      handoffDay: { workspaceId },
    },
    include: {
      handoffDay: { select: { handoffDate: true } },
      topic: {
        select: {
          id: true,
          summary: true,
          owner: true,
          priority: true,
          sheetData: true,
          comments: {
            orderBy: { createdAt: "desc" },
            take: 200,
            select: { id: true, body: true, createdAt: true },
          },
        },
      },
    },
    orderBy: [{ handoffDay: { handoffDate: "desc" } }, { sortOrder: "asc" }],
    take: 500,
  })) as Array<{
    handoffDay: { handoffDate: Date };
    topic: {
      id: string;
      summary: string;
      owner: string | null;
      priority: "low" | "mid" | "high" | "escalated" | null;
      sheetData: unknown;
      comments: { id: string; body: string; createdAt: Date }[];
    };
  }>;

  const dedupedBySummary = new Map<
    string,
    {
      topicId: string;
      handoffDate: string;
      summary: string;
      owner: string | null;
      priority: "low" | "mid" | "high" | "escalated" | null;
      matchedInSummary: boolean;
      matchedInUpdates: boolean;
      matchedInSheet: boolean;
      latestMatchingUpdate: string | null;
    }
  >();
  const needle = q.toLowerCase();

  for (const row of rows) {
    const summaryKey = row.topic.summary.trim().toLowerCase();
    if (dedupedBySummary.has(summaryKey)) continue;
    const matchedInSummary = row.topic.summary.toLowerCase().includes(needle);
    const matchingComments = row.topic.comments.filter((c) => c.body.toLowerCase().includes(needle));
    const latestMatchingComment = matchingComments[0] ?? null;
    const matchedInUpdates = matchingComments.length > 0;
    const sheetText =
      row.topic.sheetData && typeof row.topic.sheetData === "object"
        ? JSON.stringify(row.topic.sheetData).toLowerCase()
        : "";
    const matchedInSheet = sheetText.includes(needle);
    if (!matchedInSummary && !matchedInUpdates && !matchedInSheet) continue;
    dedupedBySummary.set(summaryKey, {
      topicId: row.topic.id,
      handoffDate: row.handoffDay.handoffDate.toISOString().slice(0, 10),
      summary: row.topic.summary,
      owner: row.topic.owner,
      priority: row.topic.priority,
      matchedInSummary,
      matchedInUpdates,
      matchedInSheet,
      latestMatchingUpdate: latestMatchingComment?.body ?? null,
    });
  }

  const results = [...dedupedBySummary.values()]
    .sort((a, b) => {
      if (a.handoffDate !== b.handoffDate) return b.handoffDate.localeCompare(a.handoffDate);
      return a.summary.localeCompare(b.summary);
    })
    .slice(0, 100);

  return json({ results });
}
