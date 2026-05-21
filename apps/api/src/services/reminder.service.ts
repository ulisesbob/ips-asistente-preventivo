import cron from 'node-cron';
import type PgBoss from 'pg-boss';
import { prisma, PatientProgramStatus, ReminderStatus } from '@ips/db';
import { config } from '../config/env';
import { sendTextMessage } from './messaging.service';
import { logger } from '../utils/logger';
import { advanceNextReminderDate } from '../utils/schedule';
import { toMetaSendablePhone } from '../utils/phone';
import { maskId, maskPhone } from '../utils/pii';
import { getBoss } from '../queue/boss';
import { limiter } from '../queue/limiter';
import {
  QUEUE_NAMES,
  controlSingletonKey,
  type ControlJobPayload,
} from '../queue/queues';

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

/** Fecha de hoy en Argentina como YYYY-MM-DD (ventana del singletonKey diario). */
function todayArgentinaISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

/**
 * `where` de inscripciones con un control vencido HOY. Compartido entre el camino
 * viejo (`_processDueReminders`, con `take`) y el productor de la cola
 * (`enqueueControls`, paginado sin tope): la cola procesa EXACTAMENTE la misma
 * población que el cron viejo, sin el corte silencioso del `take`.
 */
function controlCandidateWhere(today: Date) {
  return {
    nextReminderDate: { lte: today },
    status: PatientProgramStatus.ACTIVE,
    patient: {
      consent: true,
      phone: { not: null },
    },
  };
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
    where: controlCandidateWhere(today),
    orderBy: { nextReminderDate: 'asc' },
    take: MAX_REMINDERS_PER_RUN,
    select: {
      id: true,
      programId: true,
      nextReminderDate: true,
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
      const nextReminderDate = advanceNextReminderDate(
        enrollment.nextReminderDate,
        program.reminderFrequencyDays,
        today
      );

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

// ─── Bloque B (T13): camino por cola pg-boss (detrás de QUEUE_CONTROL) ─────────
//
// El cron MÁS RIESGOSO: muta nextReminderDate y crea registros `reminder` (el
// historial del panel). Por eso va con modo SHADOW primero (QUEUE_SHADOW: encola
// y loguea pero NO envía ni muta) para comparar conteos antes del corte real.
//
// PRODUCTOR: enqueueControls encola 1 job por inscripción vencida (sin tope,
// paginando) y NO envía. CONSUMIDOR: makeControlHandler envía vía limiter y aplica
// el efecto de forma idempotente. Idempotencia en 2 capas:
//   1) singletonKey (control:{patientProgramId}:{date}) + policy 'short' → no se
//      encola dos veces el mismo día.
//   2) guard en el handler (re-lee ACTIVE + due + consent) + un advance CONDICIONAL
//      de nextReminderDate dentro de una $transaction que GATEA la creación del
//      registro SENT: si el advance afecta 0 filas (otro proceso/reintento ya
//      avanzó), NO se crea el registro → ni doble historial ni doble avance.
//   El envío va FUERA de la transacción (la red no debe mantener un lock abierto).
//
// DIFERENCIA DELIBERADA con el camino viejo (validar en staging shadow): ante un
// fallo de envío, el handler hace `throw` → pg-boss reintenta con backoff y, si
// agota, manda el job al dead-letter (logueado). NO replicamos el viejo "crear
// registro FAILED + pausar la inscripción tras 5 fallos consecutivos": ese
// mecanismo existía porque el loop in-process NO tenía reintento persistente; la
// cola lo reemplaza con retry + dead-letter. El historial SENT (panel) sí se
// preserva. Si se quisiera conservar el FAILED/pause, el lugar correcto sería
// enriquecer el dead-letter handler (follow-up), no inflar registros por reintento.

const CONTROL_ENQUEUE_BATCH_SIZE = 200;

/**
 * Productor: encola un job por CADA inscripción con control vencido hoy, sin el
 * tope `take` del camino viejo (procesa hasta los ~40k). Pagina por cursor `id`.
 */
export async function enqueueControls(
  boss: PgBoss = getBoss()
): Promise<{ enqueued: number }> {
  const today = todayUTC();
  const where = controlCandidateWhere(today);
  const date = todayArgentinaISO();

  let enqueued = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.patientProgram.findMany({
      where,
      take: CONTROL_ENQUEUE_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        patient: { select: { id: true, phone: true } },
      },
    });

    if (batch.length === 0) break;

    for (const e of batch) {
      if (!e.patient.phone) continue;
      const payload: ControlJobPayload = {
        patientProgramId: e.id,
        patientId: e.patient.id,
        phone: toMetaSendablePhone(e.patient.phone),
        date,
      };
      const id = await boss.send(QUEUE_NAMES.control, payload, {
        singletonKey: controlSingletonKey(e.id, date),
        retryLimit: 5,
        retryBackoff: true,
      });
      if (id) enqueued++;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < CONTROL_ENQUEUE_BATCH_SIZE) break;
  }

  logger.info('controles encolados', {
    event: 'queue',
    action: 'enqueue_control',
    enqueued,
  });

  return { enqueued };
}

/** Forma mínima de un job que necesita el handler (compatible con PgBoss.Job). */
type JobLike<T> = { id: string; data: T };

/**
 * Consumidor: construye el handler del worker `reminders:control`.
 */
export function makeControlHandler(): (
  jobs: JobLike<ControlJobPayload>[]
) => Promise<void> {
  return async (jobs: JobLike<ControlJobPayload>[]): Promise<void> => {
    for (const job of jobs) {
      await processControlJob(job.data);
    }
  };
}

async function processControlJob(payload: ControlJobPayload): Promise<void> {
  const { patientProgramId, phone } = payload;
  const today = todayUTC();

  // 1) GUARD: re-lee que la inscripción sigue ACTIVE, con control vencido y consent.
  // Trae el programa para el mensaje + la frecuencia.
  const enrollment = await prisma.patientProgram.findFirst({
    where: {
      id: patientProgramId,
      status: PatientProgramStatus.ACTIVE,
      nextReminderDate: { lte: today },
      patient: { consent: true },
    },
    select: {
      id: true,
      nextReminderDate: true,
      patient: { select: { id: true, fullName: true } },
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

  if (!enrollment) {
    logger.info('control skip — ya no es candidato (no ACTIVE / ya avanzado / sin consent)', {
      event: 'queue',
      action: 'control_skip',
      patientProgramId: maskId(patientProgramId),
    });
    return;
  }

  // Frecuencia inválida → skip (evita loop infinito, igual que el viejo).
  if (enrollment.program.reminderFrequencyDays < 1) {
    logger.error('control skip — frecuencia inválida', {
      event: 'queue',
      action: 'control_invalid_frequency',
      programId: enrollment.program.id,
      frequency: enrollment.program.reminderFrequencyDays,
    });
    return;
  }

  const message = interpolateTemplate(enrollment.program.templateMessage, enrollment.patient.fullName);

  if (config.QUEUE_SHADOW) {
    logger.info('control SHADOW — habría enviado', {
      event: 'queue',
      action: 'control_shadow',
      patientProgramId: maskId(patientProgramId),
      phone: maskPhone(phone),
    });
    return;
  }

  // 2) ENVÍO FUERA de transacción.
  const ok = await limiter.schedule(() => sendTextMessage(phone, message));
  if (!ok) {
    // Retriable: pg-boss reintenta (backoff) y, si agota, dead-letter. NO mutamos.
    throw new Error('send_failed');
  }

  // 3) ÉXITO: advance CONDICIONAL que GATEA la creación del registro SENT. La $tx
  // es corta y SIN la red adentro. Si el advance afecta 0 filas (ya avanzado por
  // otro proceso/reintento), no creamos el registro → idempotente.
  const nextReminderDate = advanceNextReminderDate(
    enrollment.nextReminderDate,
    enrollment.program.reminderFrequencyDays,
    today
  );
  await prisma.$transaction(async (tx) => {
    const advanced = await tx.patientProgram.updateMany({
      where: {
        id: enrollment.id,
        status: PatientProgramStatus.ACTIVE,
        nextReminderDate: { lte: today },
      },
      data: { nextReminderDate },
    });
    if (advanced.count === 0) {
      // Otro proceso/reintento ya avanzó esta inscripción → no duplicar historial.
      return;
    }
    await tx.reminder.create({
      data: {
        patientId: enrollment.patient.id,
        programId: enrollment.program.id,
        message,
        scheduledFor: today,
        sentAt: new Date(),
        status: ReminderStatus.SENT,
      },
    });
  });
}

/**
 * Branch EXCLUSIVO por feature flag (Bloque B, T13). Lo llama el cron node-cron de
 * abajo (a diferencia de los otros crons, controles tiene su scheduler bespoke con
 * lastCronStatus + guard de concurrencia).
 *   - QUEUE_CONTROL=false (default/prod) → processDueReminders() (camino viejo).
 *   - QUEUE_CONTROL=true → enqueueControls() (encola, el worker envía).
 * Para el camino de cola devuelve {sent:0,failed:0}: el envío real lo hace el
 * worker; /health/cron observa la profundidad de la cola aparte.
 */
export async function runControlCron(): Promise<{ sent: number; failed: number }> {
  if (config.QUEUE_CONTROL) {
    await enqueueControls();
    return { sent: 0, failed: 0 };
  }
  return processDueReminders();
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
      // Branch exclusivo por QUEUE_CONTROL (camino viejo o encolar). Ver runControlCron.
      runningPromise = runControlCron();
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
