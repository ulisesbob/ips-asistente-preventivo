import type PgBoss from 'pg-boss';
import { config } from '../config/env';
import { QUEUE_NAMES } from './queues';
import { registerDeadLetterHandler } from './send-worker';
import { makeFollowupHandler } from '../services/patient-followup.service';
import { makeSurveyHandler } from '../services/survey.service';
import { logger } from '../utils/logger';

/**
 * Crea (idempotente) las colas en pg-boss ANTES de cualquier `work`/`send`.
 *
 * C1 (CRÍTICO): pg-boss v10 NO autocrea colas. `insertJob` hace un INNER JOIN
 * contra `pgboss.queue` (`j JOIN queue q ON j.name = q.name`): si la cola no
 * existe, el insert no produce filas y `boss.send` retorna `null` SIN insertar —
 * el job se descarta EN SILENCIO y el dead-letter handler nunca recibe nada.
 * `createQueue` es idempotente (UPSERT sobre `pgboss.queue`), así que es seguro
 * llamarlo en cada arranque.
 *
 * Decisiones por cola:
 * - `reminders:dead` (dead-letter): se crea SIEMPRE. Es el destino de los jobs que
 *   agotan reintentos; sin la cola creada, el `deadLetter` configurado abajo no
 *   tendría a dónde mover los jobs.
 * - `reminders:followup`: `policy: 'short'` para que el `singletonKey`
 *   (`followup:{patientId}:{date}`) DEDUPLIQUE en cola. Con la policy default
 *   (`standard`) el singletonKey NO deduplica: los índices únicos de singleton de
 *   pg-boss aplican solo a las policies `short`/`singleton`/`stately`. `short`
 *   garantiza un único job en estado `created` por (cola, singletonKey) → si el
 *   cron corre dos veces el mismo día (o un re-deploy lo redispara), no se encola
 *   un segundo job para el mismo paciente/día. `deadLetter` apunta a `reminders:dead`
 *   a NIVEL DE COLA para que los jobs agotados lleguen al dead-letter handler.
 */
export async function createQueues(boss: PgBoss): Promise<void> {
  // El dead-letter primero: es el destino del `deadLetter` de las demás colas.
  await boss.createQueue(QUEUE_NAMES.dead);

  if (config.QUEUE_FOLLOWUP) {
    await boss.createQueue(QUEUE_NAMES.followup, {
      name: QUEUE_NAMES.followup,
      policy: 'short',
      deadLetter: QUEUE_NAMES.dead,
    });
  }

  if (config.QUEUE_SURVEY) {
    await boss.createQueue(QUEUE_NAMES.survey, {
      name: QUEUE_NAMES.survey,
      policy: 'short',
      deadLetter: QUEUE_NAMES.dead,
    });
  }

  // Próximas etapas (inertes hasta su flag): crear su cola acá con la misma forma.
  // if (config.QUEUE_MEDICATION) { await boss.createQueue(QUEUE_NAMES.medication, { name: QUEUE_NAMES.medication, policy: 'short', deadLetter: QUEUE_NAMES.dead }); }
  // if (config.QUEUE_SELF)       { await boss.createQueue(QUEUE_NAMES.self, { name: QUEUE_NAMES.self, policy: 'short', deadLetter: QUEUE_NAMES.dead }); }
  // if (config.QUEUE_CONTROL)    { await boss.createQueue(QUEUE_NAMES.control, { name: QUEUE_NAMES.control, policy: 'short', deadLetter: QUEUE_NAMES.dead }); }
}

/**
 * Registro reusable de workers de pg-boss (Bloque B, T7).
 *
 * Lo llama `index.ts` UNA vez en el arranque, bajo `QUEUE_ENABLED`. PRIMERO crea
 * las colas (C1: imprescindible, sin ellas los `send` se descartan en silencio) y
 * recién después registra el worker de cada cola cuyo flag esté ON (rollout
 * gradual) + el dead-letter. Diseñado para sumar las otras colas
 * (survey/medication/self/control) en etapas siguientes sin tocar `index.ts`:
 * solo se agrega un branch en `createQueues` y otro acá.
 *
 * El dead-letter se registra SIEMPRE (es barato y necesario para observabilidad
 * apenas haya alguna cola activa).
 */
export async function registerQueueWorkers(boss: PgBoss): Promise<void> {
  // C1: crear las colas ANTES de cualquier work/send.
  await createQueues(boss);

  if (config.QUEUE_FOLLOWUP) {
    await boss.work(QUEUE_NAMES.followup, makeFollowupHandler());
    logger.info('worker registrado', {
      event: 'queue',
      action: 'register_worker',
      queue: QUEUE_NAMES.followup,
    });
  }

  if (config.QUEUE_SURVEY) {
    await boss.work(QUEUE_NAMES.survey, makeSurveyHandler());
    logger.info('worker registrado', {
      event: 'queue',
      action: 'register_worker',
      queue: QUEUE_NAMES.survey,
    });
  }

  // Próximas etapas (inertes hasta su flag):
  // if (config.QUEUE_MEDICATION) { await boss.work(QUEUE_NAMES.medication, makeMedicationHandler()); }
  // if (config.QUEUE_SELF)       { await boss.work(QUEUE_NAMES.self, makeSelfHandler()); }
  // if (config.QUEUE_CONTROL)    { await boss.work(QUEUE_NAMES.control, makeControlHandler()); }

  await registerDeadLetterHandler(boss);
}
