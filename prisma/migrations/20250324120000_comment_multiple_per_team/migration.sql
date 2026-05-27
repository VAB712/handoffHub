-- Drop unique (topic_id, team) so teams can post multiple updates per item (e.g. after Add HO rollover).
DROP INDEX IF EXISTS "comments_topic_id_team_key";

-- Help lookups by topic + team
CREATE INDEX "comments_topic_id_team_idx" ON "comments"("topic_id", "team");
