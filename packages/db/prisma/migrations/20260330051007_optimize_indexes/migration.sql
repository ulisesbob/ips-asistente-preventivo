-- DropIndex
DROP INDEX "doctor_programs_doctorId_idx";

-- DropIndex
DROP INDEX "messages_conversationId_idx";

-- DropIndex
DROP INDEX "patient_programs_nextReminderDate_idx";

-- DropIndex
DROP INDEX "patients_phone_idx";

-- CreateIndex
CREATE INDEX "patients_fullName_idx" ON "patients"("fullName");
