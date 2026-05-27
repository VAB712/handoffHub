import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { assertTopicHandoffIsLatestForMutation } from "@/lib/handoff-policy";

const patchSchema = z.object({
  summary: z.string().min(1).max(20_000).optional(),
  shortSummary: z.string().min(1).max(500).optional(),
  owner: z.string().max(200).nullable().optional(),
  priority: z.enum(["low", "mid", "high", "escalated"]).nullable().optional(),
  sheetData: z
    .object({
      cols: z.number().int().min(1).max(26),
      rows: z.number().int().min(1).max(50),
      headers: z.array(z.string().max(200)),
      cells: z.array(
        z.array(
          z.object({
            text: z.string().max(5_000),
            bold: z.boolean(),
            italic: z.boolean(),
            underline: z.boolean(),
          }),
        ),
      ),
    })
    .nullable()
    .optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const { workspaceId, id } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }
  if (
    body.summary === undefined &&
    body.shortSummary === undefined &&
    body.owner === undefined &&
    body.priority === undefined &&
    body.sheetData === undefined
  ) {
    return json({ error: "Nothing to update" }, { status: 400 });
  }
  const sheetData = body.sheetData;
  if (
    sheetData !== undefined &&
    sheetData !== null &&
    (sheetData.headers.length !== sheetData.cols ||
      sheetData.cells.length !== sheetData.rows ||
      sheetData.cells.some((row) => row.length !== sheetData.cols))
  ) {
    return json({ error: "Invalid sheet dimensions" }, { status: 400 });
  }

  const policy = await assertTopicHandoffIsLatestForMutation(id, workspaceId);
  if (!policy.ok) return json({ error: policy.message }, { status: policy.status });

  const topic = await prisma.topic.update({
    where: { id },
    data: {
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.shortSummary !== undefined ? { shortSummary: body.shortSummary } : {}),
      ...(body.owner !== undefined ? { owner: body.owner?.trim() ? body.owner.trim() : null } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.sheetData !== undefined
        ? {
            sheetData:
              body.sheetData === null
                ? Prisma.JsonNull
                : (body.sheetData as unknown as Prisma.InputJsonValue),
          }
        : {}),
    },
  });

  return json({
    topic: {
      id: topic.id,
      summary: topic.summary,
      shortSummary: topic.shortSummary,
      owner: topic.owner,
      priority: topic.priority,
      sheetData: topic.sheetData,
      isClosed: topic.isClosed,
    },
  });
}
