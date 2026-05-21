-- AlterTable
ALTER TABLE "medication_reminders" ADD COLUMN     "endDate" DATE,
ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "sideEffects" TEXT;
