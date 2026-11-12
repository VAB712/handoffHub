import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { readAttachmentBytes, toStoredBytes } from "@/lib/attachments-fs";
import { json } from "@/lib/json";
import { topicBelongsToWorkspace } from "@/lib/handoff-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "attachment";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const { workspaceId, id } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  const att = await prisma.attachment.findUnique({
    where: { id },
    select: {
      originalFilename: true,
      mimeType: true,
      storagePath: true,
      content: true,
      comment: { select: { topicId: true } },
    },
  });
  if (!att) return json({ error: "Not found" }, { status: 404 });

  const ok = await topicBelongsToWorkspace(att.comment.topicId, workspaceId);
  if (!ok) return json({ error: "Not found" }, { status: 404 });

  const stored = toStoredBytes(att.content);
  let fromDisk: Buffer | null = null;
  if (!stored) {
    try {
      fromDisk = await readAttachmentBytes(att.storagePath);
    } catch {
      fromDisk = null;
    }
  }
  const bytes = stored ?? fromDisk;
  if (!bytes) {
    return json({ error: "File missing. Upload it again on this update." }, { status: 404 });
  }

  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);

  return new Response(body, {
    headers: {
      "Content-Type": att.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(att.originalFilename),
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
