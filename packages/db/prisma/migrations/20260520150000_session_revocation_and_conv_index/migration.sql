-- Revocación de sesiones (audit #4): tokenVersion por médico. Incrementarlo
-- invalida todos los JWT (access + refresh) emitidos antes (logout / cambio pass).
ALTER TABLE "doctors" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Índice compuesto para getOrCreateConversation (busca por phone + status=OPEN).
-- El compuesto (phone, status) también sirve las búsquedas solo-por-phone (audit #42).
DROP INDEX IF EXISTS "conversations_phone_idx";
CREATE INDEX "conversations_phone_status_idx" ON "conversations"("phone", "status");
