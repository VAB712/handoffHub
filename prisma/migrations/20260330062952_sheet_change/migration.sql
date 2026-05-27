/*
  Warnings:

  - You are about to drop the column `body_format` on the `comments` table. All the data in the column will be lost.
  - You are about to drop the column `body_rich` on the `comments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "comments" DROP COLUMN "body_format",
DROP COLUMN "body_rich";
