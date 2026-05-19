import { processDueSelfReminders } from './self-reminder.service';
import { createScheduledJob } from '../utils/cron';

/**
 * Self-reminder cron — every 30 minutes (Argentina timezone).
 * Same cadence as medication cron, for patient-created reminders.
 */
const job = createScheduledJob({
  label: '[SelfReminderCron]',
  schedule: '0,30 * * * *',
  work: processDueSelfReminders,
});

export function startSelfReminderCron(): void {
  job.start();
}

export function stopSelfReminderCron(): void {
  job.stop();
}
