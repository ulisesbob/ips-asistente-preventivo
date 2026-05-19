# Paso E4 — Optimización de queries y batching

**Tipo**: Optimización DB + código
**Tiempo estimado**: 4-5 días
**Skills**: prisma-client-api, prisma-cli, prisma-postgres, vitest
**Agents**: database-optimizer, postgres-pro, performance-engineer, database-administrator, code-reviewer
**MCPs**: Context7 (Prisma queries, Postgres EXPLAIN ANALYZE)

---

## Prompt para copiar y pegar

```
Vamos a ejecutar el Paso E4: optimización de queries y batching para volumen.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lectura previa

1. CLAUDE.md
2. LESSONS.md (lecciones sobre Prisma, índices, N+1)
3. escala-100k/PLAN.md sección "Paso E4"
4. packages/db/prisma/schema.prisma (schema completo)
5. STATUS.md sección "Base de datos — 12 tablas"
6. apps/api/src/crons/* y apps/api/src/services/* (queries actuales)

## Investigación con Context7

- Prisma + Postgres: cuándo usar include vs select vs raw queries
- Postgres EXPLAIN ANALYZE para detectar sequential scans
- Índices compuestos: orden de columnas
- Prisma findMany con cursor-based pagination
- Connection pooling con Neon (pgbouncer en transaction mode)

## Activar skills prisma

- prisma-client-api skill para queries
- prisma-postgres skill para configuración de conexiones

## Tareas

### 1. Audit de queries (database-optimizer agent)

Lanzar database-optimizer agent para que:
- Identifique todas las queries en crons y endpoints críticos
- Para cada una: corra EXPLAIN ANALYZE contra una DB con 100K filas sintéticas
- Marque las que hacen sequential scan
- Detecte N+1 queries

Generar escala-100k/results/audit-queries-E4.md con findings.

### 2. Crear índices necesarios

Migración Prisma con índices compuestos según findings:
- (consent, nextReminderDate) en patient_programs
- (active, scheduledFor) en medication_reminders
- (status, reminderDate) en patient_self_reminders
- (createdAt) en messages
- Otros que aparezcan en el audit

Cada índice debe justificarse contra una query real.

### 3. Batching del cron de controles

- Procesar de a 500 pacientes por iteración
- Cursor-based, no offset
- Worker pool para envíos paralelos (concurrencia controlada por el rate limiter del E3)
- Continuación robusta: si el cron muere a la mitad, debe poder retomar

### 4. Cache de lectura (Redis del Pre-C)

- programs (los 9, cambian rarísimo) → TTL 1 hora
- knowledge_base (30 FAQs) → TTL 5 min
- Invalidación al editar desde panel admin

### 5. Eliminar N+1

Audit y refactor de queries con include/select correctos. Especialmente:
- GET /api/patients/:id (trae programas, recordatorios, conversaciones)
- GET /api/conversations/:id/messages
- GET /api/dashboard/alerts

### 6. Paginación cursor-based

Cambiar offset-based a cursor-based en endpoints con muchos registros:
- GET /api/patients
- GET /api/conversations
- GET /api/messages

## Sub-tareas (TodoWrite)

- [ ] Generar 100K pacientes sintéticos en staging para tests reales
- [ ] Lanzar database-optimizer agent → audit
- [ ] Crear migración con índices justificados
- [ ] Batching del cron de controles
- [ ] Cache de programs y knowledge_base
- [ ] Eliminar N+1 en endpoints críticos
- [ ] Migrar paginación a cursor-based
- [ ] Verificar criterios de aceptación del paso E4

## Criterios de aceptación (del plan)

- [ ] Cron con 50K pacientes vencidos termina en < 30 min
- [ ] GET /api/patients con 100K registros: P95 < 500ms
- [ ] Búsqueda por DNI con 100K: P95 < 100ms

## Code review

EN PARALELO:
- database-optimizer agent
- postgres-pro agent
- performance-engineer agent
- code-reviewer agent

## Cierre

- Checkboxes + ✅ en escala-100k/PLAN.md
- STATUS.md
- LESSONS.md con todo lo aprendido sobre queries
- escala-100k/results/audit-queries-E4.md commiteado como referencia
- Commit: "feat(scale): Paso E4 — queries optimizadas, índices, batching, cache"
```
