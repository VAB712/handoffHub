CREATE TABLE "mail_schedules" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "time_zone" TEXT NOT NULL,
    "last_sent_on" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mail_schedules_workspace_id_idx" ON "mail_schedules"("workspace_id");

ALTER TABLE "mail_schedules" ADD CONSTRAINT "mail_schedules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
