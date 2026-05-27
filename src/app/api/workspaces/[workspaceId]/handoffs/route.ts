import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  const days = await prisma.handoffDay.findMany({
    where: { workspaceId },
    orderBy: { handoffDate: "desc" },
    take: 500,
    select: {
      id: true,
      handoffDate: true,
    },
  });

  const list = days.map((d) => ({
    id: d.id,
    handoffDate: d.handoffDate.toISOString().slice(0, 10),
  }));

  return json({ handoffs: list });
}
