-- AlterTable: make doctorId optional (patient can create via bot without doctor)
ALTER TABLE "medication_reminders" ALTER COLUMN "doctorId" DROP NOT NULL;
