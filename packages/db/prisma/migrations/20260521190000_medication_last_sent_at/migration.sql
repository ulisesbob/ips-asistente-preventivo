-- C-1 (Bloque B): marca de envío idempotente para medicación.
-- Aditiva y nullable → segura para prod (las filas existentes quedan en NULL =
-- "nunca enviado por la cola", el guard las trata como candidatas).
-- AlterTable
ALTER TABLE "medication_reminders" ADD COLUMN     "lastSentAt" TIMESTAMPTZ;
