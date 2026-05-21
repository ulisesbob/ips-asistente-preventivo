import type PgBoss from 'pg-boss';
import { sendTextMessage } from '../services/messaging.service';
import { limiter } from './limiter';
import { QUEUE_NAMES } from './queues';
import { logger } from '../utils/logger';
import { maskId } from '../utils/pii';

/**
 * Worker genérico de envío (Bloque B).
 *
 * INERTE: este módulo sólo DEFINE handlers. No registra workers contra colas
 * reales (eso es T7, en `index.ts` bajo `QUEUE_ENABLED`). Acá no se arranca
 * pg-boss ni se manda ningún mensaje al importar.
 *
 * Contrato pg-boss v10: `boss.work(name, handler)` entrega al handler un ARRAY
 * de jobs (batch). Si el handler rechaza (throw), pg-boss reintenta el job según
 * el `retryLimit`/`retryBackoff` de la cola; al agotarse, el job va a deadLetter.
 */

/** Mensaje listo para enviar, derivado del payload del job. */
export interface OutboundMessage {
  phone: string;
  text: string;
}

/** Forma mínima de un job que necesita el handler (compatible con PgBoss.Job). */
type JobLike<T> = { id: string; data: T };

/**
 * Procesa un lote de jobs con concurrencia ACOTADA (Bloque B — throughput).
 *
 * Por qué acotada y no `Promise.all(jobs.map(...))`: pg-boss entrega lotes grandes
 * (`batchSize`, p.ej. 100) para amortizar el polling. Procesarlos TODOS a la vez
 * dispara N consultas Prisma simultáneas (el guard `findFirst` de cada job) y agota
 * el pool de conexiones → cuelga. Acotamos a `limit` "workers" que tiran de un índice
 * compartido; el `limiter` (Bottleneck) sigue gobernando el RATE de envío (40/s).
 *
 * SEMÁNTICA DE FALLO (importante): pg-boss v10 falla el LOTE COMPLETO cuando el
 * handler hace throw — `manager.js` llama `fail(name, jobIds, err)` con TODOS los
 * jobIds del batch. Acá procesamos todos los jobs (un fallo NO corta el resto) y
 * recién al final hacemos throw si hubo alguno → pg-boss reintenta el lote ENTERO.
 *
 * Esto es seguro porque los 5 handlers tienen guard de re-lectura idempotente: ante
 * el reintento del lote re-leen su estado y hacen skip de lo ya aplicado (followup
 * count/lastAt, survey dispatchedAt, self status, control advance condicional, y
 * medicación lastSentAt — C-1 resuelto). Queda solo el at-least-once residual común a
 * todos: un crash entre el envío y la marca puede reenviar ese job puntual.
 */
export async function runJobBatch<T>(
  jobs: JobLike<T>[],
  limit: number,
  processOne: (data: T) => Promise<void>
): Promise<void> {
  let failed = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next++;
      if (idx >= jobs.length) return;
      try {
        await processOne(jobs[idx].data);
      } catch (err) {
        failed++;
        // Logueamos cada fallo con su jobId: el throw es agregado a nivel lote y se
        // perdería el detalle (qué job, por qué) para el dead-letter / observabilidad.
        logger.error('job del lote falló', {
          event: 'queue',
          action: 'batch_job_failed',
          jobId: jobs[idx].id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
  const workers = Math.max(1, Math.min(limit, jobs.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (failed > 0) {
    throw new Error(`${failed}/${jobs.length} jobs del lote fallaron`);
  }
}

/**
 * Construye un handler de cola reutilizable.
 *
 * @param buildMessage función PURA: payload → {phone, text}. Cada cola pasa la
 *   suya (followup, survey, etc.) para derivar el texto sin acoplar el worker.
 *
 * Comportamiento por job:
 *   - `sendTextMessage` devuelve `true`  → ok.
 *   - `sendTextMessage` devuelve `false` → `throw new Error('send_failed')`
 *     (retriable: pg-boss reintenta).
 * Todo el envío pasa por `limiter.schedule(...)` para respetar el rate-limit.
 */
export function makeSendHandler<T>(
  buildMessage: (payload: T) => OutboundMessage
): (jobs: JobLike<T>[]) => Promise<void> {
  return async (jobs: JobLike<T>[]): Promise<void> => {
    for (const job of jobs) {
      const { phone, text } = buildMessage(job.data);
      const ok = await limiter.schedule(() => sendTextMessage(phone, text));
      if (!ok) {
        // Retriable: pg-boss reintenta este job (no se descarta en silencio).
        throw new Error('send_failed');
      }
    }
  };
}

/**
 * Registra el worker de dead-letter sobre `reminders:dead`.
 *
 * Los jobs que agotaron sus reintentos caen acá. NO re-encolamos ni hacemos
 * throw (eso los volvería a poner en estado failed): sólo logueamos para
 * alerta/observabilidad y dejamos el gancho para Sentry.
 */
export async function registerDeadLetterHandler(boss: PgBoss): Promise<void> {
  await boss.work(QUEUE_NAMES.dead, async (jobs: JobLike<unknown>[]) => {
    for (const job of jobs) {
      // Todos los payloads de recordatorios llevan `patientId`: lo extraemos
      // (enmascarado) para que el dead-letter sea ACCIONABLE (poder rastrear al
      // paciente/inscripción afectada). Sin esto el log solo tenía el jobId opaco.
      const data = job.data as { patientId?: string } | null | undefined;
      const patientId = data?.patientId ? maskId(data.patientId) : undefined;
      logger.error('reminder dead-letter — job agotó reintentos', {
        event: 'queue',
        action: 'dead_letter',
        jobId: job.id,
        patientId,
        // Gancho para Sentry: el error-handler global ya captura logger.error en
        // prod si se desea, pero acá dejamos el punto explícito para enriquecer.
      });
      // FOLLOW-UP (controles): para recuperar el "auto-pause tras N fallos" del cron
      // viejo, acá se podría leer job.data.patientProgramId y pausar la inscripción
      // (o emitir a Sentry). Ver nota en reminder.service.ts (T13). No se hace aún
      // para no acoplar el dead-letter genérico a la semántica de un cron puntual.
    }
  });
}
