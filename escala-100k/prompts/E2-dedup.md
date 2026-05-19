# Paso E2 — Deduplicación persistente de webhooks

**Tipo**: Código backend
**Tiempo estimado**: 1-2 días
**Skills**: nodejs-backend-patterns, test-driven-development, vitest
**Agents**: backend-developer, security-auditor, code-reviewer
**MCPs**: Context7 (Upstash Redis docs)

---

## Prompt para copiar y pegar

```
Vamos a ejecutar el Paso E2: deduplicación persistente de webhooks de Meta WhatsApp.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lectura previa

1. CLAUDE.md
2. LESSONS.md (lección sobre deduplicación de webhooks ya existe — leerla)
3. escala-100k/PLAN.md sección "Paso E2"
4. apps/api/src/webhooks/whatsapp.ts (o donde esté el handler actual)
5. spec.md sección sobre webhooks

## Investigación con Context7

- Upstash Redis: SET con NX y EX (atomic check-and-set), latencia esperada en sa-east-1
- Alternativa: tabla webhook_events con UNIQUE + ON CONFLICT en Postgres
- Patterns de idempotencia en webhooks

## Decisión

Comparar Redis vs Tabla SQL para dedup. Decidir según:
- Latencia (webhook tiene SLA con Meta de respuesta < 20s)
- Costo
- Operabilidad (qué pasa si el store se cae)

Documentar la decisión en LESSONS.md.

## Implementación TDD

1. Test que falle: 3 instancias reciben el mismo webhook ID, solo 1 lo procesa
2. Test: si el store está caído, NO procesar (mejor perder uno que duplicar)
3. Test: TTL de 24h funciona
4. Test: métricas de dedups por hora

## Sub-tareas (TodoWrite)

- [ ] Decidir Redis o tabla SQL
- [ ] Implementar el módulo de dedup nuevo
- [ ] Reemplazar el Set in-memory en el webhook handler
- [ ] Métricas: contador de dedups
- [ ] Fallback documentado si el store se cae
- [ ] Tests unitarios + integración
- [ ] Ejecutar test con 3 instancias en docker-compose

## Seguridad (lanzar security-auditor)

- ¿Qué pasa si alguien envía un webhook ID inventado para "envenenar" el store?
- ¿La verificación HMAC sigue intacta antes de la dedup?
- ¿El TTL es configurable o hardcoded?

## Reglas

- HMAC SIEMPRE primero, dedup después
- Si dedup falla, NO procesar (mejor que duplicar)
- Métricas obligatorias para detectar abuso
- NO loggear payloads completos (PII)

## Code review

Lanzar EN PARALELO:
- code-reviewer agent
- security-auditor agent

## Cierre

- Checkboxes [x] + ✅ en escala-100k/PLAN.md
- STATUS.md actualizado
- LESSONS.md con la decisión Redis vs SQL
- Commit: "feat(scale): Paso E2 — dedup webhooks persistente con [Redis|SQL]"
```
