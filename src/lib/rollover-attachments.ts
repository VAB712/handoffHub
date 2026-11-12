import type { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { readAttachmentBytes, saveUploadedFile, toStoredBytes } from "@/lib/attachments-fs";

type AttachmentRow = {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  content: Uint8Array | null;
};

export async function copyAttachmentsToNewComment(
  tx: Prisma.TransactionClient,
  oldAttachments: AttachmentRow[],
  newCommentId: string,
): Promise<void> {
  for (const a of oldAttachments) {
    const fromDb = toStoredBytes(a.content);
    let fromDisk: Buffer | null = null;
    if (!fromDb) {
      try {
        fromDisk = await readAttachmentBytes(a.storagePath);
      } catch {
        fromDisk = null;
      }
    }
    const buf = fromDb ? Buffer.from(fromDb) : fromDisk;
    if (!buf) {
      throw new Error(`Attachment file is missing: ${a.originalFilename}`);
    }

    let storagePath = `db/${newCommentId}/${randomBytes(8).toString("hex")}`;
    try {
      const saved = await saveUploadedFile(newCommentId, buf, a.originalFilename);
      storagePath = saved.storagePath;
    } catch {
      /* Keep the bytes on the new handoff row when the disk folder cannot be written. */
    }
    await tx.attachment.create({
      data: {
        commentId: newCommentId,
        storagePath,
        originalFilename: a.originalFilename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        content: new Uint8Array(buf),
      },
    });
  }
}
