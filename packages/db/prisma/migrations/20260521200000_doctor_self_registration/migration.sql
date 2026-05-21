-- Auto-registro de médicos: matrícula + verificación de email.
-- Migración ADITIVA y rollback-safe: todas las columnas son nullable.

-- AlterTable
ALTER TABLE "doctors" ADD COLUMN "licenseNumber" TEXT;
ALTER TABLE "doctors" ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ;
ALTER TABLE "doctors" ADD COLUMN "verificationCodeHash" TEXT;
ALTER TABLE "doctors" ADD COLUMN "verificationExpiresAt" TIMESTAMPTZ;

-- Backfill: los médicos que YA existían (creados por un admin) se consideran
-- verificados para no bloquearles el login. Sólo los nuevos auto-registros
-- nacen con emailVerifiedAt = NULL (pendientes de verificar).
UPDATE "doctors" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- Índice para resolver la verificación por token sin escanear toda la tabla.
-- CreateIndex
CREATE INDEX "doctors_verificationCodeHash_idx" ON "doctors"("verificationCodeHash");
