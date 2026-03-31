/*
  Warnings:

  - You are about to drop the column `sentAt` on the `surveys` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "surveys" DROP COLUMN "sentAt",
ADD COLUMN     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dispatchedAt" TIMESTAMPTZ;
