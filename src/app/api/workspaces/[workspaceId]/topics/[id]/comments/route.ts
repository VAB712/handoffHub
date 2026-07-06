import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { formatCommentLine } from "@/lib/format-comment";
import { resolveDisplayTimeZone } from "@/lib/display-tz";
import { assertTopicHandoffIsLatestForMutation } from "@/lib/handoff-policy";
import { TEAM_VALUES } from "@/lib/team";

const bodySchema = z.object({
  body: z.string().min(1).max(100_000),
  team: z.enum(TEAM_VALUES),
  clientTimeZone: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const { workspaceId, id: topicId } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });
  const userId = access.userId;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const userExists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!userExists) {
    return json({ error: "Session is stale. Please sign out and sign in again." }, { status: 401 });
  }

  const policy = await assertTopicHandoffIsLatestForMutation(topicId, workspaceId);
  if (!policy.ok) return json({ error: policy.message }, { status: policy.status });

  let comment;
  try {
    comment = await prisma.comment.create({
      data: {
        topicId,
        authorId: userId,
        team: parsed.team,
        body: parsed.body,
      },
      include: {
        author: { select: { name: true, email: true } },
        attachments: true,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return json({ error: "Session is stale. Please sign out and sign in again." }, { status: 401 });
    }
    throw error;
  }

  const tz = resolveDisplayTimeZone(parsed.clientTimeZone);
  return json({
    comment: {
      id: comment.id,
      team: comment.team,
      body: comment.body,
      prefix: formatCommentLine(comment.team, comment.createdAt, tz),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      author: { name: comment.author.name, email: comment.author.email },
      attachments: [],
    },
  });
}
