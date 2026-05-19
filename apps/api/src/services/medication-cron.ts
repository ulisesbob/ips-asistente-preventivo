import { sendMedicationReminders } from './medication-reminder.service';
import { createScheduledJob } from '../utils/cron';

/**
 * Medication reminder cron — every 30 minutes (Argentina timezone).
 * Checks for reminders matching the current hour:minute slot and sends via WhatsApp.
 *
 * Scaffolding (running guard, logging, error handling) vive en utils/cron.ts.
 */
const job = createScheduledJob({
  label: '[MedCron]',
  schedule: '0,30 * * * *',
  work: sendMedicationReminders,
});

export function startMedicationCron(): void {
  job.start();
}

export function stopMedicationCron(): void {
  job.stop();
}
