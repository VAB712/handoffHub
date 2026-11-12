import { mkdir, writeFile, unlink, rm, readFile } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { getAttachmentsDir } from "./env";

export async function ensureAttachmentsRoot(): Promise<string> {
  const root = getAttachmentsDir();
  await mkdir(root, { recursive: true });
  return root;
}

export async function saveUploadedFile(
  commentId: string,
  buffer: Buffer,
  originalName: string,
): Promise<{ storagePath: string; storedName: string }> {
  const root = await ensureAttachmentsRoot();
  const dir = join(root, commentId);
  await mkdir(dir, { recursive: true });
  const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")) : "";
  const storedName = `${randomBytes(16).toString("hex")}${ext}`;
  const full = join(dir, storedName);
  await writeFile(full, buffer);
  const storagePath = `${commentId}/${storedName}`;
  return { storagePath, storedName };
}

export function resolveStorageAbsolutePath(storagePath: string): string {
  const root = getAttachmentsDir();
  return join(root, ...storagePath.split("/"));
}

export function readAttachmentStream(storagePath: string) {
  const abs = resolveStorageAbsolutePath(storagePath);
  return createReadStream(abs);
}

export async function readAttachmentBytes(storagePath: string): Promise<Buffer | null> {
  try {
    const abs = resolveStorageAbsolutePath(storagePath);
    if (!existsSync(abs)) return null;
    return await readFile(abs);
  } catch {
    return null;
  }
}

export function toStoredBytes(content: Uint8Array | Buffer | null | undefined): Uint8Array | null {
  if (!content || content.byteLength === 0) return null;
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  return copy;
}

export async function deleteAttachmentFile(storagePath: string) {
  try {
    const abs = resolveStorageAbsolutePath(storagePath);
    await unlink(abs);
  } catch {
    /* ignore */
  }
}

/** Remove the whole storage directory for a comment (all uploaded files). */
export async function deleteCommentAttachmentDir(commentId: string): Promise<void> {
  const root = getAttachmentsDir();
  const dir = join(root, commentId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
