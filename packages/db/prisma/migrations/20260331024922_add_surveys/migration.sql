-- CreateTable
CREATE TABLE "surveys" (
    "id" UUID NOT NULL,
    "patientProgramId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "sentAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attended" BOOLEAN,
    "rating" SMALLINT,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "surveys_patientId_idx" ON "surveys"("patientId");

-- CreateIndex
CREATE INDEX "surveys_patientProgramId_idx" ON "surveys"("patientProgramId");

-- CreateIndex
CREATE INDEX "surveys_completedAt_idx" ON "surveys"("completedAt");

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_patientProgramId_fkey" FOREIGN KEY ("patientProgramId") REFERENCES "patient_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
