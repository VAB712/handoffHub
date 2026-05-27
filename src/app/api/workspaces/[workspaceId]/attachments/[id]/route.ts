import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { readAttachmentStream, resolveStorageAbsolutePath } from "@/lib/attachments-fs";
import { existsSync } from "fs";
import { json } from "@/lib/json";
import { Readable } from "node:stream";
import { topicBelongsToWorkspace } from "@/lib/handoff-policy";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const { workspaceId, id } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  const att = await prisma.attachment.findUnique({
    where: { id },
    include: { comment: { select: { topicId: true } } },
  });
  if (!att) return json({ error: "Not found" }, { status: 404 });

  const ok = await topicBelongsToWorkspace(att.comment.topicId, workspaceId);
  if (!ok) return json({ error: "Not found" }, { status: 404 });

  const abs = resolveStorageAbsolutePath(att.storagePath);
  if (!existsSync(abs)) return json({ error: "File missing" }, { status: 404 });

  const nodeStream = readAttachmentStream(att.storagePath);
  const webStream = Readable.toWeb(nodeStream);
  const safeName = encodeURIComponent(att.originalFilename);

  return new Response(webStream as unknown as ReadableStream, {
    headers: {
      "Content-Type": att.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`,
    },
  });
}
