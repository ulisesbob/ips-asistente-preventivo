-- Compliance (ley 25.326): audit log, trazabilidad de consentimiento y updatedAt.
-- Migración aditiva. No toca dni/phone ni la lógica de deduplicación.

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('ADMIN', 'DOCTOR', 'SYSTEM', 'BOT');

-- CreateEnum
CREATE TYPE "ConsentVia" AS ENUM ('PANEL', 'BOT', 'IMPORT', 'UNKNOWN');

-- AlterTable: patients
-- consentAt/consentVia son nullable (no rompen filas existentes).
-- updatedAt es NOT NULL: se agrega con DEFAULT para rellenar filas existentes
-- y luego se quita el DEFAULT para que matchee el schema (@updatedAt lo maneja Prisma).
ALTER TABLE "patients" ADD COLUMN "consentAt" TIMESTAMPTZ;
ALTER TABLE "patients" ADD COLUMN "consentVia" "ConsentVia";
ALTER TABLE "patients" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "patients" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Backfill: para los pacientes ya existentes asumimos el consentimiento al alta.
-- consentAt = createdAt; consentVia inferido de registeredVia.
UPDATE "patients" SET "consentAt" = "createdAt" WHERE "consent" = true AND "consentAt" IS NULL;
UPDATE "patients" SET "consentVia" = 'PANEL'  WHERE "consentVia" IS NULL AND "registeredVia" = 'PANEL'  AND "consent" = true;
UPDATE "patients" SET "consentVia" = 'BOT'    WHERE "consentVia" IS NULL AND "registeredVia" = 'BOT'    AND "consent" = true;
UPDATE "patients" SET "consentVia" = 'IMPORT' WHERE "consentVia" IS NULL AND "registeredVia" = 'IMPORT' AND "consent" = true;

-- AlterTable: patient_programs
ALTER TABLE "patient_programs" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "patient_programs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: reminders
ALTER TABLE "reminders" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "reminders" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable: audit_logs (registro inmutable de trazabilidad)
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "action" "AuditAction" NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "recordId" VARCHAR(64),
    "changedFields" TEXT[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_model_recordId_idx" ON "audit_logs"("model", "recordId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
