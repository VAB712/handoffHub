import { readFile } from "fs/promises";
import type { Prisma } from "@prisma/client";
import { ensureAttachmentsRoot, resolveStorageAbsolutePath, saveUploadedFile } from "@/lib/attachments-fs";

type AttachmentRow = {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
};

export async function copyAttachmentsToNewComment(
  tx: Prisma.TransactionClient,
  oldAttachments: AttachmentRow[],
  newCommentId: string,
): Promise<void> {
  ensureAttachmentsRoot();
  for (const a of oldAttachments) {
    const abs = resolveStorageAbsolutePath(a.storagePath);
    const buf = await readFile(abs);
    const { storagePath } = await saveUploadedFile(newCommentId, buf, a.originalFilename);
    await tx.attachment.create({
      data: {
        commentId: newCommentId,
        storagePath,
        originalFilename: a.originalFilename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      },
    });
  }
}
