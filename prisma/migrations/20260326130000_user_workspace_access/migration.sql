-- CreateTable
CREATE TABLE "user_workspace_access" (
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_workspace_access_pkey" PRIMARY KEY ("user_id","workspace_id")
);

-- AddForeignKey
ALTER TABLE "user_workspace_access" ADD CONSTRAINT "user_workspace_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_workspace_access" ADD CONSTRAINT "user_workspace_access_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing behavior for current non-admin users (access to all workspaces)
INSERT INTO "user_workspace_access" ("user_id", "workspace_id")
SELECT u."id", w."id"
FROM "User" u
CROSS JOIN "Workspace" w
WHERE u."is_admin" = false
ON CONFLICT DO NOTHING;
