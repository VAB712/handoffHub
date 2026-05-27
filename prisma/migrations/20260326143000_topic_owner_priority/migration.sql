-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'mid', 'high');

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN "owner" TEXT;
ALTER TABLE "Topic" ADD COLUMN "priority" "Priority";
