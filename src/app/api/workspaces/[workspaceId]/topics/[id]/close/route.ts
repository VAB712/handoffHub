import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { assertTopicHandoffIsLatestForMutation } from "@/lib/handoff-policy";

const bodySchema = z.object({
  isClosed: z.boolean(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const { workspaceId, id } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const policy = await assertTopicHandoffIsLatestForMutation(id, workspaceId);
  if (!policy.ok) return json({ error: policy.message }, { status: policy.status });

  const topic = await prisma.topic.update({
    where: { id },
    data: {
      isClosed: body.isClosed,
      closedAt: body.isClosed ? new Date() : null,
    },
  });

  return json({
    topic: {
      id: topic.id,
      isClosed: topic.isClosed,
      closedAt: topic.closedAt?.toISOString() ?? null,
    },
  });
}
