/*
  Warnings:

  - You are about to alter the column `content` on the `patient_notes` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.

*/
-- AlterTable
ALTER TABLE "patient_notes" ALTER COLUMN "content" SET DATA TYPE VARCHAR(500);
