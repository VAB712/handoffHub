import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { assertCommentEditAllowed } from "@/lib/handoff-policy";
import { saveUploadedFile, ensureAttachmentsRoot } from "@/lib/attachments-fs";
import { getMaxUploadBytes } from "@/lib/env";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const { workspaceId, id: commentId } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  ensureAttachmentsRoot();

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
  });
  if (!comment) return json({ error: "Comment not found" }, { status: 404 });

  const policy = await assertCommentEditAllowed(commentId, workspaceId);
  if (!policy.ok) return json({ error: policy.message }, { status: policy.status });

  const maxBytes = getMaxUploadBytes();
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ error: "Missing file field" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return json({ error: "File too large" }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const { storagePath } = await saveUploadedFile(commentId, buf, file.name || "upload");

  const row = await prisma.attachment.create({
    data: {
      commentId,
      storagePath,
      originalFilename: file.name || "upload",
      mimeType: file.type || "application/octet-stream",
      sizeBytes: BigInt(buf.length),
    },
  });

  return json({
    attachment: {
      id: row.id,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes.toString(),
    },
  });
}
