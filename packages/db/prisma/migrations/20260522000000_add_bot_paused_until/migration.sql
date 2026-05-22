-- Modo híbrido de atención: el operador puede escribir desde el panel en una
-- conversación OPEN y el bot queda en pausa hasta este timestamp (auto-expira).
-- null = bot activo. El operador puede devolver el control antes (resume).
ALTER TABLE "conversations" ADD COLUMN "botPausedUntil" TIMESTAMPTZ;

-- Índice parcial: solo indexa las pocas conversaciones con pausa vigente.
CREATE INDEX "conversations_botPausedUntil_idx"
  ON "conversations"("botPausedUntil") WHERE "botPausedUntil" IS NOT NULL;
