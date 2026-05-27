import path from "path";

export function getHandoffTz(): string {
  return process.env.HANDOFF_TZ?.trim() || "UTC";
}

export function getAttachmentsDir(): string {
  const raw = process.env.ATTACHMENTS_DIR?.trim() || "data/attachments";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function getMaxUploadBytes(): number {
  const n = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 50 * 1024 * 1024;
}
