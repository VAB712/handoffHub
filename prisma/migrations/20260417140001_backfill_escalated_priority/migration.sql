-- Legacy: high-priority rows whose latest comment still starts with ESCALATED
UPDATE "Topic" t
SET priority = 'escalated'
WHERE priority = 'high'
AND EXISTS (
  SELECT 1 FROM (
    SELECT DISTINCT ON ("topic_id") "topic_id", body
    FROM "comments"
    ORDER BY "topic_id", "created_at" DESC
  ) latest
  WHERE latest."topic_id" = t."id"
  AND upper(trim(latest.body)) LIKE 'ESCALATED%'
);
