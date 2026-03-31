import cron from 'node-cron';
import { sendMedicationReminders } from './medication-reminder.service';
import { logger } from '../utils/logger';

let task: cron.ScheduledTask | null = null;
let running = false;

/**
 * Medication reminder cron — runs every 30 minutes (Argentina timezone).
 * Checks for reminders matching the current hour:minute slot and sends via WhatsApp.
 */
export function startMedicationCron(): void {
  // Every 30 minutes: at :00 and :30
  task = cron.schedule('0,30 * * * *', async () => {
    if (running) {
      logger.warn('[MedCron] Previous run still in progress, skipping');
      return;
    }

    running = true;
    try {
      const result = await sendMedicationReminders();
      if (result.sent > 0 || result.failed > 0) {
        logger.info('[MedCron] Medication reminders sent', {
          event: 'medication_cron',
          sent: result.sent,
          failed: result.failed,
        });
      }
    } catch (err) {
      logger.error('[MedCron] Error in medication reminder cron', {
        event: 'medication_cron_error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  }, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  logger.info('[MedCron] Medication reminder cron started (every 30 min)', {
    event: 'medication_cron_start',
  });
}

export function stopMedicationCron(): void {
  if (task) {
    task.stop();
    task = null;
    logger.info('[MedCron] Medication reminder cron stopped');
  }
}
