-- Additive only. Existing handoff rows, users, and attachment metadata stay as they are.
-- mail_to is null until someone edits the workspace.
-- content is null for attachments already stored on disk; those files still download from storage_path.

ALTER TABLE "Workspace" ADD COLUMN "mail_to" TEXT;

ALTER TABLE "attachments" ADD COLUMN "content" BYTEA;
