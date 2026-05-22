-- Fase 2: autoinscripción del paciente a un programa por WhatsApp.
-- El paciente puede inscribirse solo (sin médico). La inscripción NO está validada
-- clínicamente: nace marcada para revisión del equipo.

-- 1) enrolledByDoctorId pasa a opcional (la autoinscripción por bot no tiene médico).
--    El FK existente (onDelete Restrict) sigue válido: ahora admite NULL.
ALTER TABLE "patient_programs" ALTER COLUMN "enrolledByDoctorId" DROP NOT NULL;

-- 2) Origen de la inscripción.
CREATE TYPE "EnrolledVia" AS ENUM ('DOCTOR', 'BOT');
ALTER TABLE "patient_programs"
  ADD COLUMN "enrolledVia" "EnrolledVia" NOT NULL DEFAULT 'DOCTOR';

-- 3) Marca de revisión del equipo: NULL = pendiente; con fecha = ya revisada.
ALTER TABLE "patient_programs" ADD COLUMN "reviewedAt" TIMESTAMPTZ;

-- 4) Índice para la cola de revisión (autoinscripciones del bot sin revisar).
CREATE INDEX "patient_programs_enrolledVia_reviewedAt_idx"
  ON "patient_programs"("enrolledVia", "reviewedAt");
