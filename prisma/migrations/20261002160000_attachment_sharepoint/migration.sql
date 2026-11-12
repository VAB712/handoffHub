-- Additive only. Existing attachment rows stay as they are.
-- New files use these ids to live in SharePoint. Older files keep storage_path / content / disk.

ALTER TABLE "attachments" ADD COLUMN "sharepoint_drive_id" TEXT;
ALTER TABLE "attachments" ADD COLUMN "sharepoint_item_id" TEXT;
