import cron from 'node-cron';
import { prisma, PatientProgramStatus, ReminderStatus } from '@ips/db';
import { config } from '../config/env';
import { sendTextMessage } from './whatsapp.service';

// ─── Constants ───────────────────────────────────────────────────────────────

// Default: 8:00 AM Argentina — timezone se configura en cron.schedule()
const DEFAULT_CRON = '0 8 * * *';

// Max reminders per run to prevent runaway sends
const MAX_REMINDERS_PER_RUN = 500;

// Max consecutive failures before pausing enrollment to prevent infinite retries
const MAX_CONSECUTIVE_FAILURES = 5;

// Delay between WhatsApp API calls to respect Meta rate limits (ms)
const INTER_MESSAGE_DELAY_MS = 100;

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
    console.warn('[Cron] Ya hay una ejecución en curso — omitiendo');
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
    console.log('[Cron] No hay recordatorios pendientes para hoy.');
    return { sent: 0, failed: 0 };
  }

  // Warn if we hit the limit — there may be more pending (Finding 9)
  if (dueEnrollments.length === MAX_REMINDERS_PER_RUN) {
    console.warn(`[Cron] ATENCION: Se alcanzó el límite de ${MAX_REMINDERS_PER_RUN} recordatorios. Puede haber más pendientes.`);
  }

  console.log(`[Cron] Procesando ${dueEnrollments.length} recordatorios...`);

  let sent = 0;
  let failed = 0;

  for (const enrollment of dueEnrollments) {
    const { patient, program } = enrollment;

    // Skip programs with invalid frequency to prevent infinite loop (Finding 8)
    if (program.reminderFrequencyDays < 1) {
      console.error(`[Cron] Programa ${program.id} (${program.name}) tiene frecuencia inválida: ${program.reminderFrequencyDays} — omitiendo`);
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
        console.warn(`[Cron] Inscripción ${enrollment.id} pausada por ${recentFailures} fallos consecutivos (paciente ${patient.id}, programa ${program.name})`);
      }

      failed++;
    }

    // Rate limiting: delay between Meta API calls (Finding 4)
    if (sent + failed < dueEnrollments.length) {
      await delay(INTER_MESSAGE_DELAY_MS);
    }
  }

  console.log(`[Cron] Enviados ${sent} recordatorios. ${failed} fallidos.`);
  return { sent, failed };
}

// ─── Start Cron Job ──────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;

export function startReminderCron(): void {
  // Skip if WhatsApp credentials are not configured
  if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
    console.warn('[Cron] WhatsApp no configurado — cron de recordatorios deshabilitado');
    return;
  }

  const schedule = config.REMINDER_CRON ?? DEFAULT_CRON;

  if (!cron.validate(schedule)) {
    console.error(`[Cron] Expresión cron inválida: "${schedule}" — usando default`);
    return startReminderCronWithSchedule(DEFAULT_CRON);
  }

  startReminderCronWithSchedule(schedule);
}

function startReminderCronWithSchedule(schedule: string): void {
  cronTask = cron.schedule(schedule, async () => {
    console.log(`[Cron] Ejecutando cron de recordatorios — ${new Date().toISOString()}`);
    try {
      runningPromise = processDueReminders();
      await runningPromise;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Cron] Error en cron de recordatorios: ${msg}`);
    }
  }, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  console.log(`[Cron] Recordatorios programados: "${schedule}" (America/Argentina/Buenos_Aires)`);
}

export async function stopReminderCron(): Promise<void> {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  // Wait for in-flight run to complete before shutdown (Finding 5)
  if (runningPromise) {
    console.log('[Cron] Esperando que la ejecución en curso termine...');
    try {
      await runningPromise;
    } catch {
      // Already logged inside processDueReminders
    }
  }

  console.log('[Cron] Cron de recordatorios detenido.');
}
