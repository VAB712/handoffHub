-- AlterTable
ALTER TABLE "User" ADD COLUMN "team" "Team";

-- AlterTable: backfill updated_at for existing comments
ALTER TABLE "comments" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Deduplicate (topic_id, team): keep the newest row by created_at
DELETE FROM "comments" a
WHERE EXISTS (
  SELECT 1
  FROM "comments" b
  WHERE b."topic_id" = a."topic_id"
    AND b."team" = a."team"
    AND b."created_at" > a."created_at"
);

-- If ties on created_at, keep lexicographically greater id
DELETE FROM "comments" a
WHERE EXISTS (
  SELECT 1
  FROM "comments" b
  WHERE b."topic_id" = a."topic_id"
    AND b."team" = a."team"
    AND b."created_at" = a."created_at"
    AND b."id" > a."id"
);

-- CreateIndex
CREATE UNIQUE INDEX "comments_topic_id_team_key" ON "comments"("topic_id", "team");
