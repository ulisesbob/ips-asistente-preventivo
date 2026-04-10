-- CreateEnum
CREATE TYPE "SelfReminderStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "patient_self_reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patientId" UUID NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "reminderDate" DATE NOT NULL,
    "reminderHour" SMALLINT NOT NULL,
    "reminderMinute" SMALLINT NOT NULL DEFAULT 0,
    "status" "SelfReminderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_self_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_self_reminders_patientId_status_idx" ON "patient_self_reminders"("patientId", "status");

-- CreateIndex
CREATE INDEX "patient_self_reminders_status_reminderDate_reminderHour_remin_idx" ON "patient_self_reminders"("status", "reminderDate", "reminderHour", "reminderMinute");

-- CheckConstraints (defense in depth — LESSONS #43)
ALTER TABLE "patient_self_reminders" ADD CONSTRAINT "check_reminder_hour" CHECK ("reminderHour" >= 0 AND "reminderHour" <= 23);
ALTER TABLE "patient_self_reminders" ADD CONSTRAINT "check_reminder_minute" CHECK ("reminderMinute" >= 0 AND "reminderMinute" <= 59);

-- AddForeignKey
ALTER TABLE "patient_self_reminders" ADD CONSTRAINT "patient_self_reminders_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
