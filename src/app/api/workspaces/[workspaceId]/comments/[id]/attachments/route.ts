import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { assertCommentEditAllowed } from "@/lib/handoff-policy";
import { saveUploadedFile } from "@/lib/attachments-fs";
import { getMaxUploadBytes } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const { workspaceId, id: commentId } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

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

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return json({ error: "Missing file field" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return json({ error: "File too large" }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const originalFilename = ("name" in file && typeof file.name === "string" && file.name) || "upload";
  const mimeType = ("type" in file && file.type) || "application/octet-stream";

  let storagePath = `db/${commentId}/${randomBytes(8).toString("hex")}`;
  try {
    const saved = await saveUploadedFile(commentId, buf, originalFilename);
    storagePath = saved.storagePath;
  } catch {
    /* The database copy below is what the browser downloads. A disk folder is optional. */
  }

  const row = await prisma.attachment.create({
    data: {
      commentId,
      storagePath,
      originalFilename,
      mimeType,
      sizeBytes: BigInt(buf.length),
      content: new Uint8Array(buf),
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
