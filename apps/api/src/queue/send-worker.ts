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
