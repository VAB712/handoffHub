-- SharePoint is no longer used. Files stay on the app server.
ALTER TABLE "attachments" DROP COLUMN IF EXISTS "sharepoint_drive_id";
ALTER TABLE "attachments" DROP COLUMN IF EXISTS "sharepoint_item_id";
