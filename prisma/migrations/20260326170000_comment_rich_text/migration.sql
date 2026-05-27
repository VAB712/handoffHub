ALTER TABLE "comments"
ADD COLUMN "body_rich" JSONB;

ALTER TABLE "comments"
ADD COLUMN "body_format" TEXT NOT NULL DEFAULT 'plain';
