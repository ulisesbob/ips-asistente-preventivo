-- Followup tracking para pacientes registrados sin programa.
-- Permite al cron diario enviarles recordatorios espaciados (max N) para que
-- se acerquen al IPS a inscribirse, en vez de quedar silenciosamente abandonados.

ALTER TABLE "patients"
  ADD COLUMN "lastNoProgramReminderAt" TIMESTAMPTZ,
  ADD COLUMN "noProgramReminderCount" INTEGER NOT NULL DEFAULT 0;
