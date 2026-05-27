-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contact_email" TEXT;

-- CreateIndex (nullable unique: multiple NULLs allowed in PostgreSQL)
CREATE UNIQUE INDEX IF NOT EXISTS "User_contact_email_key" ON "User"("contact_email");
