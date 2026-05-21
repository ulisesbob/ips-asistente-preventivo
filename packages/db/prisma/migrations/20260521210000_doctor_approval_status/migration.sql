-- Aprobación de médicos por un admin (auto-registro).
-- Migración ADITIVA: columna con default + backfill de existentes.

-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: nace PENDING por default (lo que querés para el auto-registro).
ALTER TABLE "doctors" ADD COLUMN "status" "DoctorStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: TODOS los médicos que ya existían (creados por admin) quedan APROBADOS,
-- así no se bloquea a nadie que ya estaba usando el sistema.
UPDATE "doctors" SET "status" = 'APPROVED';

-- CreateIndex: para listar pendientes sin escanear toda la tabla.
CREATE INDEX "doctors_status_idx" ON "doctors"("status");
