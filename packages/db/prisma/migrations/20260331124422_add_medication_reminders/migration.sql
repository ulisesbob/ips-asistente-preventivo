-- CreateTable
CREATE TABLE "medication_reminders" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "medicationName" VARCHAR(200) NOT NULL,
    "dosage" VARCHAR(200) NOT NULL,
    "reminderHour" SMALLINT NOT NULL,
    "reminderMinute" SMALLINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medication_reminders_patientId_active_idx" ON "medication_reminders"("patientId", "active");

-- CreateIndex
CREATE INDEX "medication_reminders_active_reminderHour_reminderMinute_idx" ON "medication_reminders"("active", "reminderHour", "reminderMinute");

-- AddForeignKey
ALTER TABLE "medication_reminders" ADD CONSTRAINT "medication_reminders_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_reminders" ADD CONSTRAINT "medication_reminders_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
