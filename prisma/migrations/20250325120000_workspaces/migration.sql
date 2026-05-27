-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Workspace" ("id", "name", "sort_order", "created_at") VALUES
    ('ws_fe_production', 'FE Production', 0, CURRENT_TIMESTAMP),
    ('ws_oms_dev', 'OMS DEV', 1, CURRENT_TIMESTAMP),
    ('ws_testing', 'Testing', 2, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HandoffDay" ADD COLUMN "workspace_id" TEXT;

UPDATE "HandoffDay" SET "workspace_id" = 'ws_fe_production' WHERE "workspace_id" IS NULL;

ALTER TABLE "HandoffDay" ALTER COLUMN "workspace_id" SET NOT NULL;

DROP INDEX IF EXISTS "HandoffDay_handoff_date_key";

CREATE UNIQUE INDEX "HandoffDay_workspace_id_handoff_date_key" ON "HandoffDay"("workspace_id", "handoff_date");

ALTER TABLE "HandoffDay" ADD CONSTRAINT "HandoffDay_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Promote default seed admin if present (re-run seed for other accounts)
UPDATE "User" SET "is_admin" = true WHERE "email" = 'admin@handoff.local';
