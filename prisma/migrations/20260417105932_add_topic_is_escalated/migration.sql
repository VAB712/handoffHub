-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "is_escalated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: topics whose latest comment started with ESCALATED (legacy behaviour)
UPDATE "Topic" t
SET "is_escalated" = true
WHERE EXISTS (
  SELECT 1 FROM (
    SELECT DISTINCT ON ("topic_id") "topic_id", "body"
    FROM "comments"
    ORDER BY "topic_id", "created_at" DESC
  ) latest
  WHERE latest."topic_id" = t."id"
  AND upper(trim(latest."body")) LIKE 'ESCALATED%'
);
