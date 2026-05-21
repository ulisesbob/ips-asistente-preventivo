import { processFollowups, enqueueFollowups } from './patient-followup.service';
import { config } from '../config/env';
import { createScheduledJob } from '../utils/cron';

/**
 * Followup cron — daily 10:30 AM Argentina.
 *
 * Procesa pacientes registrados por bot que llevan >=7 días sin programa.
 * Les manda hasta 3 recordatorios espaciados (cada 7 días) para que se
 * acerquen al IPS a inscribirse.
 *
 * Slot a las 10:30 (no 10:00 como survey-cron) para no saturar Meta/Twilio.
 */

/**
 * Branch EXCLUSIVO por feature flag (Bloque B, T7):
 *   - QUEUE_FOLLOWUP=false (default/prod) → processFollowups() (camino viejo
 *     in-process, intacto).
 *   - QUEUE_FOLLOWUP=true → enqueueFollowups() (encola en pg-boss, el worker envía).
 * Nunca ambos: cero riesgo de doble envío. Con el flag OFF el comportamiento de
 * producción no cambia.
 */
export async function runFollowupCron(): Promise<void> {
  if (config.QUEUE_FOLLOWUP) {
    await enqueueFollowups();
    return;
  }
  await processFollowups();
}

const job = createScheduledJob({
  label: '[FollowupCron]',
  schedule: '30 10 * * *',
  work: runFollowupCron,
});

export function startFollowupCron(): void {
  job.start();
}

export function stopFollowupCron(): void {
  job.stop();
}
