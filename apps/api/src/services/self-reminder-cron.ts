import {
  processDueSelfReminders,
  enqueueSelfReminders,
} from './self-reminder.service';
import { config } from '../config/env';
import { createScheduledJob } from '../utils/cron';

/**
 * Self-reminder cron — every 30 minutes (Argentina timezone).
 * Same cadence as medication cron, for patient-created reminders.
 */

/**
 * Branch EXCLUSIVO por feature flag (Bloque B, T12):
 *   - QUEUE_SELF=false (default/prod) → processDueSelfReminders() (viejo).
 *   - QUEUE_SELF=true → enqueueSelfReminders() (encola, el worker envía).
 * Nunca ambos: cero riesgo de doble envío.
 */
export async function runSelfReminderCron(): Promise<void> {
  if (config.QUEUE_SELF) {
    await enqueueSelfReminders();
    return;
  }
  await processDueSelfReminders();
}

const job = createScheduledJob({
  label: '[SelfReminderCron]',
  schedule: '0,30 * * * *',
  work: runSelfReminderCron,
});

export function startSelfReminderCron(): void {
  job.start();
}

export function stopSelfReminderCron(): void {
  job.stop();
}
