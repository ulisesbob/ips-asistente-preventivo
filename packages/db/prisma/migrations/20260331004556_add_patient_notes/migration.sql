-- CreateTable
CREATE TABLE "patient_notes" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_notes_patientId_createdAt_idx" ON "patient_notes"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "patient_notes_doctorId_idx" ON "patient_notes"("doctorId");

-- CreateIndex
CREATE INDEX "reminders_sentAt_idx" ON "reminders"("sentAt");

-- AddForeignKey
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
