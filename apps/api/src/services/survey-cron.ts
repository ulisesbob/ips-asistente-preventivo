import { processPendingSurveys, enqueueSurveys } from './survey.service';
import { config } from '../config/env';
import { createScheduledJob } from '../utils/cron';

/**
 * Survey cron — diario 10:00 AM Argentina.
 *
 * Despacha encuestas pendientes (controles marcados >24h sin enviar). La lógica
 * de dispatch (vieja + cola) vive en survey.service.ts; este archivo solo wirea
 * el schedule y el branch por flag.
 */

/**
 * Branch EXCLUSIVO por feature flag (Bloque B, T10):
 *   - QUEUE_SURVEY=false (default/prod) → processPendingSurveys() (camino viejo
 *     in-process, intacto).
 *   - QUEUE_SURVEY=true → enqueueSurveys() (encola en pg-boss, el worker envía).
 * Nunca ambos: cero riesgo de doble envío.
 */
export async function runSurveyCron(): Promise<void> {
  if (config.QUEUE_SURVEY) {
    await enqueueSurveys();
    return;
  }
  await processPendingSurveys();
}

const job = createScheduledJob({
  label: '[SurveyCron]',
  schedule: '0 10 * * *', // diario 10:00 AM Argentina
  work: runSurveyCron,
});

export function startSurveyCron(): void {
  job.start();
}

export function stopSurveyCron(): void {
  job.stop();
}
