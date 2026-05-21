# Test de carga 40k — cola de recordatorios (Bloque B)

Valida que los recordatorios lleguen a **40.000 pacientes sin descartarse** usando
la cola pg-boss: el productor encola sin tope (sin el `take` que cortaba a escala),
el worker drena con rate-limit, y la verificación confirma **encolados ==
completados, 0 perdidos**.

Targetea el cron de **followup** por ser el más simple de seedear (solo pacientes,
sin programas/doctores) y el patrón ya validado. Lo que se prueba es la **infra de
cola** que comparten los 5 crons (productor paginado + worker + limiter +
idempotencia + dead-letter).

## ⚠️ SOLO en STAGING

Estos scripts crean/borran 40k filas y arrancan pg-boss (crea el schema `pgboss` en
la DB). **NUNCA correrlos contra la base de producción.** Apuntá `DATABASE_URL` a la
base de staging (Neon aparte) antes de correr.

Pre-requisitos (ver `docs/plan-bloque-b-recordatorios.md`):
- `DATABASE_URL` = URL **directa** de Neon staging (sin `-pooler`) con permisos DDL.
- El resto de las env vars que valida `config/env.ts` (JWT_SECRET, FRONTEND_URL,
  PRISMA_FIELD_ENCRYPTION_KEY, etc.).

## Pasos

> **Importante:** cada ciclo de test arranca con `cleanup` para garantizar tabla
> limpia (de sintéticos y de jobs de pgboss). Si no, dos efectos contaminan el run:
> (a) `enqueueFollowups` muta el estado de los pacientes (`noProgramReminderCount++`,
> `lastNoProgramReminderAt=hoy`) → un segundo run el mismo día encolaría muchos
> menos; (b) pg-boss retiene los `completed` ~12h. El `run` igual acota el conteo a
> la corrida actual (`created_on >= startedAt`), pero el protocolo limpio es lo
> recomendado.

```bash
cd apps/api

# 0) Cleanup (idempotente): deja la base limpia de sintéticos + jobs de colas.
npm run loadtest:cleanup

# 1) Seed: 40.000 pacientes sintéticos (DNI LOADTEST-*, sin tocar los reales).
npm run loadtest:seed            # o: npm run loadtest:seed -- 1000  (N custom)

# 2) Run: encola followups, drena la cola (MOCK_TWILIO forzado: NO manda nada),
#    y verifica encolados == completados, 0 perdidos. Exit 0 = PASA, 1 = FALLA.
npm run loadtest:run

# 3) Cleanup final: borra los sintéticos + purga los jobs de pgboss (job + archive).
npm run loadtest:cleanup
```

Tunables del run (env vars):
- `SEND_RATE_PER_SEC` (default 40) — techo de envíos/seg del limiter.
- `SEND_MAX_CONCURRENT` (default 20) — concurrencia del limiter.
- `LOADTEST_TIMEOUT_MS` (default 1.200.000 = 20 min) — corte si la cola no drena.

## Qué garantiza el veredicto

`run` cuenta los jobs por estado sumando `pgboss.job` **y** `pgboss.archive` (los
completed se archivan) y aplica `evaluateQueueResult`:
- **PASA** solo si `completados == encolados`, `failed == 0`, nada en vuelo
  (created/active/retry) y `0 perdidos` (encolados que ya no aparecen en ningún lado).
- Cualquier descarte silencioso (el bug que motivó el Bloque B) hace **FALLAR** el test.

## Seguridad del diseño

- **MOCK_TWILIO** se fuerza a `true` dentro de `run.ts` (imports dinámicos para
  setearlo antes de cargar la config): el test **no puede** mandar mensajes reales.
- Los sintéticos se marcan por **convención de DNI** (`LOADTEST-`), no por una
  columna nueva → **cero cambios de schema en producción**. El cleanup borra por ese
  prefijo, que nunca colisiona con un DNI real (numérico).
- `seed`/`run`/`cleanup` son tooling: no se importan desde el código de la app.
