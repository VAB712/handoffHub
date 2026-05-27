import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { formatCommentLine } from "@/lib/format-comment";
import { resolveDisplayTimeZone } from "@/lib/display-tz";
import { canEditComment } from "@/lib/comment-permissions";
import { assertCommentEditAllowed } from "@/lib/handoff-policy";

const patchSchema = z.object({
  body: z.string().min(1).max(100_000),
  team: z.enum(["on_shore", "off_shore"]).optional(),
  clientTimeZone: z.string().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const { workspaceId, id: commentId } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });
  const userId = access.userId;

  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { team: true },
  });
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      author: { select: { name: true, email: true } },
      attachments: true,
    },
  });
  if (!comment) return json({ error: "Not found" }, { status: 404 });

  if (
    !canEditComment({
      userId,
      userTeam: user.team,
      commentAuthorId: comment.authorId,
      commentTeam: comment.team,
    })
  ) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const policy = await assertCommentEditAllowed(commentId, workspaceId);
  if (!policy.ok) return json({ error: policy.message }, { status: policy.status });

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: {
      body: parsed.body,
      ...(parsed.team !== undefined ? { team: parsed.team } : {}),
    },
    include: {
      author: { select: { name: true, email: true } },
      attachments: true,
    },
  });

  const tz = resolveDisplayTimeZone(parsed.clientTimeZone);
  return json({
    comment: {
      id: updated.id,
      team: updated.team,
      body: updated.body,
      prefix: formatCommentLine(updated.team, updated.createdAt, tz),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      author: { name: updated.author.name, email: updated.author.email },
      attachments: updated.attachments.map((a) => ({
        id: a.id,
        originalFilename: a.originalFilename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes.toString(),
      })),
    },
  });
}
