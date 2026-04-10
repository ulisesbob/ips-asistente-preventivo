import cron from 'node-cron';
import { processDueSelfReminders } from './self-reminder.service';
import { logger } from '../utils/logger';

let task: cron.ScheduledTask | null = null;
let running = false;

/**
 * Self-reminder cron — runs every 30 minutes (Argentina timezone).
 * Checks for patient-created reminders that are due and sends via WhatsApp.
 */
export function startSelfReminderCron(): void {
  // Every 30 minutes: at :00 and :30 (same cadence as medication cron)
  task = cron.schedule('0,30 * * * *', async () => {
    if (running) {
      logger.warn('[SelfReminderCron] Previous run still in progress, skipping');
      return;
    }

    running = true;
    try {
      const result = await processDueSelfReminders();
      if (result.sent > 0 || result.failed > 0) {
        logger.info('[SelfReminderCron] Self-reminders sent', {
          event: 'self_reminder_cron',
          sent: result.sent,
          failed: result.failed,
        });
      }
    } catch (err) {
      logger.error('[SelfReminderCron] Error in self-reminder cron', {
        event: 'self_reminder_cron_error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  }, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  logger.info('[SelfReminderCron] Self-reminder cron started (every 30 min)', {
    event: 'self_reminder_cron_start',
  });
}

export function stopSelfReminderCron(): void {
  if (task) {
    task.stop();
    task = null;
    logger.info('[SelfReminderCron] Self-reminder cron stopped');
  }
}
