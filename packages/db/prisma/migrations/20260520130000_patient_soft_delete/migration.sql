-- Soft-delete de pacientes (retención ley 25.326 + derecho de supresión art. 16).
-- Borrar un paciente = setear deletedAt; nunca DELETE físico (preserva historia).
-- Migración aditiva: columna nullable + índice. No toca datos existentes.

-- AlterTable
ALTER TABLE "patients" ADD COLUMN "deletedAt" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "patients_deletedAt_idx" ON "patients"("deletedAt");
