# Plan Bloque B — Recordatorios escalables (pg-boss + Bottleneck)

> **Objetivo:** que los recordatorios lleguen a TODOS los pacientes (hasta 40.000) sin descartarse en silencio, sin duplicar, y sobreviviendo a deploys. Sistema EN PRODUCCIÓN — rollout gradual con rollback instantáneo por feature flag.

**Stack:** Node 20 CommonJS, Express, Prisma + Postgres (Neon), Twilio, Vitest. Provider activo: Twilio.

## Decisiones de versión (Node 20 + CommonJS)
- **pg-boss `^10`** (última línea CommonJS, soporta Node ≥18; v11/v12 piden Node 22/ESM → descartadas). Crea su propio schema `pgboss` en la misma DB.
- **bottleneck `^2`** (CommonJS nativo) para rate-limit de envío.
- NO p-retry (lo cubre pg-boss). NO Redis.
- Verificar en T1: `require('pg-boss')` funciona en CJS y `engines.node` permite 20.

## Estado actual (6 crons in-process, descartan a escala)
| # | Cron | Schedule | Tope | Riesgo migrar |
|---|------|----------|------|---------------|
| 1 | Controles (`reminder.service.ts`) | 8:00 | take 500/día | Alto (muta nextReminderDate) → ÚLTIMO |
| 2 | Medicación (`medication-reminder.service.ts`) | cada 30min | take 200 | Medio |
| 3 | Self-reminders (`self-reminder.service.ts`) | cada 30min | take 200 | Medio-alto (race con cancelación) |
| 4 | Followup (`patient-followup.service.ts`) | 10:30 | take 200 | **Bajo → PRIMERO** |
| 5 | Encuestas (`survey-cron.ts`) | 10:00 | take 100 | Bajo |
Todos serial + delay 100ms (~10/s) + guard in-memory (`utils/cron.ts`) → se cortan en cada deploy, sin reintentos.

## Diseño objetivo
- **Productor** (cron, sin tope): encola 1 job por paciente/recordatorio en pg-boss con `singletonKey` (idempotencia) + `retryLimit`/`retryBackoff`.
- **Consumidor** (worker pg-boss): envía con Bottleneck (~40/s al inicio, tope Twilio ~80/s) + reintentos persistentes + dead-letter.
- **Idempotencia en 2 capas:** `singletonKey` (no encolar dos veces) + guard de estado en el handler (no aplicar el efecto dos veces).
- Archivos nuevos: `apps/api/src/queue/{boss,limiter,queues,send-worker}.ts` + tests.
- pg-boss usa `DATABASE_URL` directa (NO el cliente Prisma extendido; pool propio chico `max:4`).

## Rollout gradual SIN romper producción (lo más importante)
- **Feature flags por cron** (env vars en `config/env.ts`): `QUEUE_ENABLED` (master), `QUEUE_FOLLOWUP/SURVEY/MEDICATION/SELF/CONTROL`, `SEND_RATE_PER_SEC`, `SEND_MAX_CONCURRENT`, `QUEUE_SHADOW`.
- Cada cron: `if (config.QUEUE_X) return enqueueX(); return processX_viejo();` — exclusivo, nunca ambos. **Código viejo intacto hasta terminar.**
- **Orden** (menor→mayor riesgo): Followup → Survey → Medicación → Self → Controles.
- **Modo sombra** (`QUEUE_SHADOW`) para Controles: encola pero NO envía (solo loguea), el viejo sigue mandando → comparar conteos sin doble envío.
- **Gate por etapa:** conteo jobs `completed`+`failed` == filas encoladas (cero descartes); observar 1 ciclo antes del siguiente cron.
- **Rollback instantáneo:** flag del cron en `false` + restart (segundos).

## Worker: empezar en el web service (Opción A)
pg-boss en el mismo proceso web (cero infra nueva, rollback simple). Diseñar agnóstico del entrypoint para migrar a un Background Worker separado de Render (Opción B) si los envíos laten el webhook del bot (medir P95). `shutdown()` debe `await boss.stop({wait:true})` antes de `prisma.$disconnect()`.

## Testing (TDD)
Encolado sin tope; idempotencia (singletonKey + guard); reintento ante fallo Twilio; rate-limit (fake timers); dead-letter; no-regresión de crons viejos (flag OFF). Mock pg-boss + messaging.service (patrón existente en `self-reminder-service.test.ts`).

## Riesgos clave
- **Duplicar** → flag exclusivo + shadow + idempotencia 2 capas.
- **pg-boss schema en prod** → necesita URL DIRECTA de Neon (no pooler) + permisos DDL.
- **Conexiones Neon** → pool chico de pg-boss (`max:4`) + Prisma por pooler.
- **Reintento re-muta estado** → guard idempotente en la `$transaction`.

## Rollback por etapa
Flag a `false` (instantáneo) · master kill `QUEUE_ENABLED=false` · jobs en vuelo expiran por `expireInSeconds` · redeploy build anterior (schema pgboss queda inerte, no estorba).

## Pre-requisitos del usuario (NO código)
1. ⚠️ **Render plan pago** (Starter) — con Free el container DUERME y el worker no drena. **BLOQUEANTE.**
2. **Neon URL directa** (sin `-pooler`) + permisos DDL para schema `pgboss`.
3. Confirmar tier real de Twilio; arrancar `SEND_RATE_PER_SEC=40`.
4. Staging con Neon aparte (ideal) para el shadow.
5. Rotar contraseña de la DB (pendiente) — se va a tocar `DATABASE_URL`.

## Tareas atómicas (TDD: test RED → impl → GREEN → commit)
- **T1** Instalar pg-boss@^10 + bottleneck@^2 + sanity CommonJS/Node20.
- **T2** `queue/boss.ts` (singleton, URL directa, pool chico).
- **T3** `queue/limiter.ts` (Bottleneck por env).
- **T4** `queue/queues.ts` (colas + payloads + builders de singletonKey puros).
- **T5** Flags en `config/env.ts` (default `false`).
- **T6** `queue/send-worker.ts` (handler + throw en fallo retriable + dead-letter).
- **T7** Migrar Followup (#4) tras flag + wire boss en `index.ts` bajo `QUEUE_ENABLED`. PR.
- **T8** Verificar Followup en prod (shadow→real). Gate.
- **T9** `/health/cron` extendido (profundidad de cola).
- **T10** Migrar Survey (#5). Gate.
- **T11** Migrar Medicación (#2). Gate.
- **T12** Migrar Self (#3), portar re-read de status. Gate.
- **T13** Migrar Controles (#1) con SHADOW primero + guard idempotente. PR.
- **T14** Shutdown limpio (`stopBoss` antes de disconnect).
- **T15** Limpieza (post 1-2 semanas estables): borrar código viejo + flags.

> **Nota:** T1–T6 arman la cola INERTE (flags en false) → no afectan producción, se pueden mergear sin riesgo. Recién T7+ activa algo y requiere Render pago + verificación.
