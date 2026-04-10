-- AlterTable: add recurring flag to patient_self_reminders
ALTER TABLE "patient_self_reminders" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT false;
