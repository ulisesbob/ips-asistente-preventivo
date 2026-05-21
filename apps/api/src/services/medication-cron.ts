import {
  sendMedicationReminders,
  enqueueMedicationReminders,
} from './medication-reminder.service';
import { config } from '../config/env';
import { createScheduledJob } from '../utils/cron';

/**
 * Medication reminder cron — every 30 minutes (Argentina timezone).
 * Checks for reminders matching the current hour:minute slot and sends via WhatsApp.
 *
 * Scaffolding (running guard, logging, error handling) vive en utils/cron.ts.
 */

/**
 * Branch EXCLUSIVO por feature flag (Bloque B, T11):
 *   - QUEUE_MEDICATION=false (default/prod) → sendMedicationReminders() (viejo).
 *   - QUEUE_MEDICATION=true → enqueueMedicationReminders() (encola, el worker envía).
 * Nunca ambos: cero riesgo de doble envío.
 */
export async function runMedicationCron(): Promise<void> {
  if (config.QUEUE_MEDICATION) {
    await enqueueMedicationReminders();
    return;
  }
  await sendMedicationReminders();
}

const job = createScheduledJob({
  label: '[MedCron]',
  schedule: '0,30 * * * *',
  work: runMedicationCron,
});

export function startMedicationCron(): void {
  job.start();
}

export function stopMedicationCron(): void {
  job.stop();
}
