import cron from 'node-cron';
import { prisma, PatientProgramStatus, ReminderStatus } from '@ips/db';
import { config } from '../config/env';
import { sendTextMessage } from './whatsapp.service';
import { logger } from '../utils/logger';

// ─── Constants ───────────────────────────────────────────────────────────────

// Default: 8:00 AM Argentina — timezone se configura en cron.schedule()
const DEFAULT_CRON = '0 8 * * *';

// Max reminders per run to prevent runaway sends
const MAX_REMINDERS_PER_RUN = 500;

// Max consecutive failures before pausing enrollment to prevent infinite retries
const MAX_CONSECUTIVE_FAILURES = 5;

// Delay between WhatsApp API calls to respect Meta rate limits (ms)
const INTER_MESSAGE_DELAY_MS = 100;

// ─── Cron Status (for /health/cron endpoint) ───────────────────────────────

export interface CronStatus {
  lastRun: string | null;
  status: 'success' | 'failed' | 'never_run';
  sent: number;
  failed: number;
  durationMs: number;
}

let lastCronStatus: CronStatus = {
  lastRun: null,
  status: 'never_run',
  sent: 0,
  failed: 0,
  durationMs: 0,
};

export function getCronStatus(): CronStatus {
  return { ...lastCronStatus };
}

// ─── Concurrency Guard ──────────────────────────────────────────────────────

let isRunning = false;
let runningPromise: Promise<{ sent: number; failed: number }> | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function interpolateTemplate(template: string, patientName: string): string {
  return template.replace(/\{\{nombre\}\}/g, patientName);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core: Process Due Reminders ─────────────────────────────────────────────

export async function processDueReminders(): Promise<{ sent: number; failed: number }> {
  // Concurrency guard: prevent overlapping runs (Finding 1)
  if (isRunning) {
    logger.cron('skipped', { reason: 'already_running' });
    return { sent: 0, failed: 0 };
  }

  isRunning = true;
  try {
    return await _processDueReminders();
  } finally {
    isRunning = false;
    runningPromise = null;
  }
}

async function _processDueReminders(): Promise<{ sent: number; failed: number }> {
  const today = todayUTC();

  // Query patient_programs due for a reminder
  // Ordered by nextReminderDate ASC to prioritize the most overdue (Finding 9)
  const dueEnrollments = await prisma.patientProgram.findMany({
    where: {
      nextReminderDate: { lte: today },
      status: PatientProgramStatus.ACTIVE,
      patient: {
        consent: true,
        phone: { not: null },
      },
    },
    orderBy: { nextReminderDate: 'asc' },
    take: MAX_REMINDERS_PER_RUN,
    select: {
      id: true,
      programId: true,
      patient: {
        select: {
          id: true,
          fullName: true,
          phone: true,
        },
      },
      program: {
        select: {
          id: true,
          name: true,
          templateMessage: true,
          reminderFrequencyDays: true,
        },
      },
    },
  });

  if (dueEnrollments.length === 0) {
    logger.cron('no_reminders_due');
    return { sent: 0, failed: 0 };
  }

  // Warn if we hit the limit — there may be more pending (Finding 9)
  if (dueEnrollments.length === MAX_REMINDERS_PER_RUN) {
    logger.warn('Cron hit reminder limit — may have more pending', {
      event: 'cron',
      limit: MAX_REMINDERS_PER_RUN,
    });
  }

  logger.cron('processing', { count: dueEnrollments.length });

  let sent = 0;
  let failed = 0;

  for (const enrollment of dueEnrollments) {
    const { patient, program } = enrollment;

    // Skip programs with invalid frequency to prevent infinite loop (Finding 8)
    if (program.reminderFrequencyDays < 1) {
      logger.error('Invalid reminder frequency — skipping', {
        event: 'cron',
        programId: program.id,
        programName: program.name,
        frequency: program.reminderFrequencyDays,
      });
      continue;
    }

    const phone = patient.phone!;
    const message = interpolateTemplate(program.templateMessage, patient.fullName);

    // Attempt to send via WhatsApp
    const success = await sendTextMessage(phone, message);

    if (success) {
      const nextReminderDate = new Date(today);
      nextReminderDate.setUTCDate(nextReminderDate.getUTCDate() + program.reminderFrequencyDays);

      await prisma.$transaction([
        prisma.reminder.create({
          data: {
            patientId: patient.id,
            programId: program.id,
            message,
            scheduledFor: today,
            sentAt: new Date(),
            status: ReminderStatus.SENT,
          },
        }),
        prisma.patientProgram.update({
          where: { id: enrollment.id },
          data: { nextReminderDate },
        }),
      ]);

      sent++;
    } else {
      // Create FAILED record — do NOT advance nextReminderDate (retry next run)
      await prisma.reminder.create({
        data: {
          patientId: patient.id,
          programId: program.id,
          message,
          scheduledFor: today,
          sentAt: null,
          status: ReminderStatus.FAILED,
        },
      });

      // Check consecutive failures to prevent infinite retries (Finding 2)
      const recentFailures = await prisma.reminder.count({
        where: {
          patientId: patient.id,
          programId: program.id,
          status: ReminderStatus.FAILED,
          createdAt: { gte: new Date(Date.now() - MAX_CONSECUTIVE_FAILURES * 24 * 60 * 60 * 1000) },
        },
      });

      if (recentFailures >= MAX_CONSECUTIVE_FAILURES) {
        await prisma.patientProgram.update({
          where: { id: enrollment.id },
          data: { status: PatientProgramStatus.PAUSED },
        });
        logger.warn('Enrollment paused due to consecutive failures', {
          event: 'cron',
          enrollmentId: enrollment.id,
          patientId: patient.id,
          programName: program.name,
          consecutiveFailures: recentFailures,
        });
      }

      failed++;
    }

    // Rate limiting: delay between Meta API calls (Finding 4)
    if (sent + failed < dueEnrollments.length) {
      await delay(INTER_MESSAGE_DELAY_MS);
    }
  }

  return { sent, failed };
}

// ─── Start Cron Job ──────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;

export function startReminderCron(): void {
  // Skip if WhatsApp credentials are not configured
  if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
    logger.warn('WhatsApp not configured — reminder cron disabled', { event: 'cron' });
    return;
  }

  const schedule = config.REMINDER_CRON ?? DEFAULT_CRON;

  if (!cron.validate(schedule)) {
    logger.error(`Invalid cron expression: "${schedule}" — using default`, { event: 'cron' });
    return startReminderCronWithSchedule(DEFAULT_CRON);
  }

  startReminderCronWithSchedule(schedule);
}

function startReminderCronWithSchedule(schedule: string): void {
  cronTask = cron.schedule(schedule, async () => {
    const start = Date.now();
    logger.cron('started');

    try {
      runningPromise = processDueReminders();
      const result = await runningPromise;
      const durationMs = Date.now() - start;

      lastCronStatus = {
        lastRun: new Date().toISOString(),
        status: result.failed > 0 ? 'failed' : 'success',
        sent: result.sent,
        failed: result.failed,
        durationMs,
      };

      logger.cronResult(result.sent, result.failed, durationMs);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - start;

      logger.error(`Cron reminder run crashed: ${msg}`, {
        event: 'cron',
        durationMs,
        error: msg,
      });

      lastCronStatus = {
        lastRun: new Date().toISOString(),
        status: 'failed',
        sent: 0,
        failed: 0,
        durationMs,
      };
    }
  }, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  logger.info(`Reminder cron scheduled: "${schedule}" (America/Argentina/Buenos_Aires)`, {
    event: 'cron',
    schedule,
  });
}

export async function stopReminderCron(): Promise<void> {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  // Wait for in-flight run to complete before shutdown (Finding 5)
  if (runningPromise) {
    logger.info('Waiting for in-flight cron run to finish...', { event: 'cron' });
    try {
      await runningPromise;
    } catch {
      // Already logged inside processDueReminders
    }
  }

  logger.info('Reminder cron stopped', { event: 'cron' });
}
