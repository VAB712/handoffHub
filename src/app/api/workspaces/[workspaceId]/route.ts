import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { json } from "@/lib/json";

const patchSchema = z.object({
  name: z.string().min(1).max(200).trim(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const { workspaceId } = await ctx.params;
  const exists = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!exists) return json({ error: "Workspace not found" }, { status: 404 });

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const ws = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: body.name },
    select: { id: true, name: true, sortOrder: true },
  });

  return json({ workspace: ws });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const { workspaceId } = await ctx.params;

  const exists = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!exists) return json({ error: "Workspace not found" }, { status: 404 });

  const handoffDayIds = (
    await prisma.handoffDay.findMany({
      where: { workspaceId },
      select: { id: true },
    })
  ).map((h) => h.id);

  let topicIds: string[] = [];
  if (handoffDayIds.length > 0) {
    const topicRows = await prisma.handoffDayTopic.findMany({
      where: { handoffDayId: { in: handoffDayIds } },
      select: { topicId: true },
    });
    topicIds = [...new Set(topicRows.map((r) => r.topicId))];

    if (topicIds.length > 0) {
      const linkedElsewhere = await prisma.handoffDayTopic.findFirst({
        where: {
          topicId: { in: topicIds },
          handoffDay: { workspaceId: { not: workspaceId } },
        },
      });
      if (linkedElsewhere) {
        return json(
          {
            error:
              "Cannot delete this workspace because it shares data with another workspace. Contact support.",
          },
          { status: 409 },
        );
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    if (topicIds.length > 0) {
      await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
    }
    await tx.workspace.delete({ where: { id: workspaceId } });
  });

  return json({ ok: true });
}
