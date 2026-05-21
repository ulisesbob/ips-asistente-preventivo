import type PgBoss from 'pg-boss';
import { prisma, Role } from '@ips/db';
import { NotFoundError, ValidationError } from '../utils/errors';
import { sendTextMessage } from './messaging.service';
import { maskPhone, maskId, firstName } from '../utils/pii';
import { toMetaSendablePhone } from '../utils/phone';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getBoss } from '../queue/boss';
import { limiter } from '../queue/limiter';
import { runJobBatch } from '../queue/send-worker';
import {
  QUEUE_NAMES,
  medicationSingletonKey,
  type MedicationJobPayload,
} from '../queue/queues';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateMedReminderInput {
  medicationName: string;
  dosage: string;
  reminderHour: number;
  reminderMinute?: number;
  durationDays?: number;
  instructions?: string;
  sideEffects?: string;
}

export interface UpdateMedReminderInput {
  medicationName?: string;
  dosage?: string;
  reminderHour?: number;
  reminderMinute?: number;
  active?: boolean;
  durationDays?: number | null;
  instructions?: string | null;
  sideEffects?: string | null;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Medianoche UTC de hoy. Force UTC midnight para evitar shift de timezone
 * (LESSONS #11/#44; Railway corre en UTC, Argentina es UTC-3).
 */
function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Convierte durationDays a endDate = medianoche UTC de (hoy + durationDays).
 */
function durationDaysToEndDate(durationDays: number): Date {
  const endDate = todayUtcMidnight();
  endDate.setUTCDate(endDate.getUTCDate() + durationDays);
  return endDate;
}

// ─── Access check ───────────────────────────────────────────────────────────

async function verifyPatientAccess(patientId: string, doctorId: string, role: Role) {
  if (role === Role.ADMIN) {
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundError('Paciente no encontrado');
    return;
  }
  const doctorPrograms = await prisma.doctorProgram.findMany({
    where: { doctorId }, select: { programId: true },
  });
  const enrollment = await prisma.patientProgram.findFirst({
    where: { patientId, programId: { in: doctorPrograms.map((dp) => dp.programId) } },
  });
  if (!enrollment) throw new NotFoundError('Paciente no encontrado');
}

// ─── LIST ───────────────────────────────────────────────────────────────────

export async function listMedReminders(patientId: string, doctorId: string, role: Role) {
  await verifyPatientAccess(patientId, doctorId, role);

  return prisma.medicationReminder.findMany({
    where: { patientId },
    orderBy: [{ reminderHour: 'asc' }, { reminderMinute: 'asc' }],
    select: {
      id: true,
      medicationName: true,
      dosage: true,
      reminderHour: true,
      reminderMinute: true,
      active: true,
      endDate: true,
      instructions: true,
      sideEffects: true,
      doctor: { select: { fullName: true } },
    },
  });
}

// ─── CREATE ─────────────────────────────────────────────────────────────────

export async function createMedReminder(
  patientId: string,
  doctorId: string,
  role: Role,
  input: CreateMedReminderInput
) {
  await verifyPatientAccess(patientId, doctorId, role);

  if (input.reminderHour < 0 || input.reminderHour > 23) {
    throw new ValidationError('La hora debe ser entre 0 y 23');
  }

  return prisma.medicationReminder.create({
    data: {
      patientId,
      doctorId,
      medicationName: input.medicationName.trim(),
      dosage: input.dosage.trim(),
      reminderHour: input.reminderHour,
      reminderMinute: input.reminderMinute ?? 0,
      // Ausente = tratamiento continuo/crónico (endDate null)
      endDate: input.durationDays !== undefined ? durationDaysToEndDate(input.durationDays) : null,
      instructions: input.instructions?.trim() || null,
      sideEffects: input.sideEffects?.trim() || null,
    },
    select: {
      id: true,
      medicationName: true,
      dosage: true,
      reminderHour: true,
      reminderMinute: true,
      active: true,
      endDate: true,
      instructions: true,
      sideEffects: true,
    },
  });
}

// ─── UPDATE ─────────────────────────────────────────────────────────────────

export async function updateMedReminder(id: string, doctorId: string, role: Role, input: UpdateMedReminderInput) {
  const existing = await prisma.medicationReminder.findUnique({ where: { id }, select: { id: true, patientId: true } });
  if (!existing) throw new NotFoundError('Recordatorio no encontrado');
  await verifyPatientAccess(existing.patientId, doctorId, role);

  // Validate hour/minute ranges (defense in depth — Zod also validates)
  if (input.reminderHour !== undefined && (input.reminderHour < 0 || input.reminderHour > 23)) {
    throw new ValidationError('La hora debe ser entre 0 y 23');
  }
  if (input.reminderMinute !== undefined && input.reminderMinute !== 0 && input.reminderMinute !== 30) {
    throw new ValidationError('Los minutos deben ser 0 o 30');
  }

  return prisma.medicationReminder.update({
    where: { id },
    data: {
      ...(input.medicationName !== undefined ? { medicationName: input.medicationName.trim() } : {}),
      ...(input.dosage !== undefined ? { dosage: input.dosage.trim() } : {}),
      ...(input.reminderHour !== undefined ? { reminderHour: input.reminderHour } : {}),
      ...(input.reminderMinute !== undefined ? { reminderMinute: input.reminderMinute } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      // durationDays presente: null => volver a continuo (endDate null); número => recalcular endDate
      ...(input.durationDays !== undefined
        ? { endDate: input.durationDays === null ? null : durationDaysToEndDate(input.durationDays) }
        : {}),
      ...(input.instructions !== undefined
        ? { instructions: input.instructions === null ? null : input.instructions.trim() || null }
        : {}),
      ...(input.sideEffects !== undefined
        ? { sideEffects: input.sideEffects === null ? null : input.sideEffects.trim() || null }
        : {}),
    },
    select: {
      id: true,
      medicationName: true,
      dosage: true,
      reminderHour: true,
      reminderMinute: true,
      active: true,
      endDate: true,
      instructions: true,
      sideEffects: true,
    },
  });
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function deleteMedReminder(id: string, doctorId: string, role: Role) {
  const existing = await prisma.medicationReminder.findUnique({ where: { id }, select: { id: true, patientId: true } });
  if (!existing) throw new NotFoundError('Recordatorio no encontrado');
  await verifyPatientAccess(existing.patientId, doctorId, role);
  await prisma.medicationReminder.delete({ where: { id } });
}

// ─── CREATE FROM BOT (no doctor needed) ─────────────────────────────────────

/**
 * Creates a medication reminder from the bot flow (patient self-service).
 * No doctorId required — shows as "Creado por el paciente" in the panel.
 */
export async function createMedReminderFromBot(
  patientId: string,
  medicationName: string,
  dosage: string,
  reminderHour: number,
  reminderMinute: number
): Promise<{
  id: string;
  medicationName: string;
  reminderHour: number;
  reminderMinute: number;
  endDate: Date | null;
  instructions: string | null;
}> {
  if (reminderHour < 0 || reminderHour > 23) {
    throw new ValidationError('La hora debe ser entre 0 y 23');
  }

  // Check max active meds (prevent abuse)
  const activeCount = await prisma.medicationReminder.count({
    where: { patientId, active: true },
  });
  if (activeCount >= 10) {
    throw new ValidationError('Ya tenés 10 recordatorios de medicación activos. Cancelá alguno para agregar otro.');
  }

  return prisma.medicationReminder.create({
    data: {
      patientId,
      doctorId: null,
      medicationName: medicationName.trim().replace(/[<>]/g, ''),
      dosage: dosage.trim().replace(/[<>]/g, ''),
      reminderHour,
      reminderMinute,
      // El bot no maneja duración/efectos secundarios → tratamiento continuo
      endDate: null,
      instructions: null,
      sideEffects: null,
    },
    select: {
      id: true,
      medicationName: true,
      reminderHour: true,
      reminderMinute: true,
      endDate: true,
      instructions: true,
    },
  });
}

// ─── GET PATIENT MEDICATIONS FOR BOT CONTEXT ────────────────────────────────

/**
 * @internal Bot context only — no access control.
 * Fetches active medication reminders for the AI system prompt.
 */
export async function getMedicationsForBot(patientId: string) {
  return prisma.medicationReminder.findMany({
    where: { patientId, active: true },
    orderBy: [{ reminderHour: 'asc' }, { reminderMinute: 'asc' }],
    take: 10,
    select: {
      medicationName: true,
      dosage: true,
      reminderHour: true,
      reminderMinute: true,
      // NOTA: a propósito NO se traen instructions ni sideEffects acá. El bot del
      // chat no debe recitar efectos secundarios (decisión clínica/ley 25.326);
      // las instrucciones ya se reenvían en el recordatorio diario del cron.
    },
  });
}

// ─── CRON: Send medication reminders ────────────────────────────────────────

const MED_MAX_PER_RUN = 200; // tope del camino viejo (LESSONS #13)
const MED_RATE_LIMIT_MS = 100;
// Tamaño de lote de la paginación del productor. No es un tope: itera hasta agotar.
const MED_ENQUEUE_BATCH_SIZE = 200;

/**
 * Hora/slot actual en Argentina. El cron dispara a :00 y :30 → el slot es 0 o 30.
 * LESSONS #16: no mezclar convenciones de timezone.
 */
function currentArgentinaSlot(): { argHour: number; slot: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: 'numeric', hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  }).formatToParts(new Date());
  const argHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const argMinute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { argHour, slot: argMinute < 15 ? 0 : 30 };
}

/** Fecha de hoy en Argentina como YYYY-MM-DD (ventana del singletonKey). */
function todayArgentinaISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

/**
 * `where` de recordatorios a enviar en este slot. Compartido entre el camino
 * viejo (con `take`) y el productor de la cola (paginado sin tope).
 */
function medicationCandidateWhere(argHour: number, slot: number, today: Date) {
  return {
    active: true,
    reminderHour: argHour,
    reminderMinute: slot,
    patient: {
      consent: true,
      phone: { not: null },
    },
    // Tratamiento continuo (endDate null) o aún vigente (endDate >= hoy).
    AND: [{ OR: [{ endDate: null }, { endDate: { gte: today } }] }],
  };
}

/**
 * Condición "no enviado HOY" (idempotencia C-1). `lastSentAt` null (nunca enviado
 * por la cola) o anterior a la medianoche UTC de hoy → candidato. Como cada
 * recordatorio tiene un único slot por día, "enviado hoy" alcanza para deduplicar
 * un reintento de lote. Solo lo usa el camino de COLA (productor + guard); el viejo
 * in-process no toca lastSentAt (queda null → no afecta su comportamiento).
 */
function medicationNotSentTodayOR(today: Date) {
  return [{ lastSentAt: null }, { lastSentAt: { lt: today } }];
}

/** Texto del recordatorio de medicación. Puro (exportado para tests). */
export function buildMedicationMessage(
  fullName: string,
  medicationName: string,
  dosage: string,
  instructions: string | null
): string {
  const instructionsLine = instructions ? `📋 ${instructions}\n\n` : '';
  return (
    `Hola ${firstName(fullName)}! Te recuerdo que es hora de tomar tu medicación:\n\n` +
    `💊 *${medicationName}* — ${dosage}\n\n` +
    instructionsLine +
    `¡Cuidá tu salud!`
  );
}

/**
 * Desactiva tratamientos vencidos (endDate < hoy medianoche UTC). Lo hacen tanto
 * el camino viejo como el productor antes de seleccionar el slot, para no mandar
 * recordatorios caducados.
 */
async function deactivateExpiredMedications(today: Date): Promise<void> {
  const deactivated = await prisma.medicationReminder.updateMany({
    where: { active: true, endDate: { lt: today } },
    data: { active: false },
  });
  if (deactivated.count > 0) {
    console.log(`[MedReminder] Deactivated ${deactivated.count} expired reminders.`);
  }
}

export async function sendMedicationReminders(): Promise<{ sent: number; failed: number }> {
  const { argHour, slot } = currentArgentinaSlot();
  console.log(`[MedReminder] Checking for hour=${argHour} minute=${slot} (Argentina)`);

  const today = todayUtcMidnight();
  await deactivateExpiredMedications(today);

  const reminders = await prisma.medicationReminder.findMany({
    where: medicationCandidateWhere(argHour, slot, today),
    take: MED_MAX_PER_RUN,
    select: {
      id: true,
      medicationName: true,
      dosage: true,
      instructions: true,
      patient: {
        select: {
          fullName: true,
          phone: true,
        },
      },
    },
  });

  if (reminders.length === 0) {
    console.log('[MedReminder] No reminders to send this slot.');
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const r of reminders) {
    if (!r.patient.phone) continue;
    const sendPhone = toMetaSendablePhone(r.patient.phone);
    const message = buildMedicationMessage(
      r.patient.fullName,
      r.medicationName,
      r.dosage,
      r.instructions
    );

    try {
      await sendTextMessage(sendPhone, message);
      sent++;
    } catch (err) {
      console.error(`[MedReminder] Error sending to ${maskPhone(sendPhone)}:`, err);
      failed++;
    }

    // Rate limit: 100ms between messages (LESSONS Meta rate limits)
    await new Promise((resolve) => setTimeout(resolve, MED_RATE_LIMIT_MS));
  }

  console.log(`[MedReminder] Sent ${sent}, failed ${failed}`);
  return { sent, failed };
}

// ─── Bloque B (T11): camino por cola pg-boss (detrás de QUEUE_MEDICATION) ──────
//
// PRODUCTOR: enqueueMedicationReminders desactiva vencidos, luego encola 1 job por
// recordatorio del slot actual (sin tope, paginando; excluye los ya enviados hoy).
// CONSUMIDOR: makeMedicationHandler envía vía limiter y MARCA lastSentAt.
//
// Idempotencia (2 capas, paridad con survey/self — C-1 resuelto):
//   1) singletonKey (medication:{reminderId}:{date}:{HH:MM}) + policy 'short' →
//      un único job por recordatorio/slot/día (no re-encola si el cron redispara).
//   2) guard en el handler: re-lee active + no-vencido + consent + NO enviado hoy
//      (lastSentAt). Tras enviar (FUERA de tx) marca lastSentAt con un updateMany
//      condicional. Esto hace idempotente el reintento de LOTE de pg-boss (un throw
//      falla el lote entero → reintenta los N): el ya enviado tiene lastSentAt=hoy →
//      el guard lo descarta → no re-envía. Antes medicación no marcaba nada y por eso
//      el batch re-enviaba (C-1); ya no.
//   Queda el at-least-once residual común a todos: un crash entre el envío y la marca
//   puede reenviar ese job puntual. Un recordatorio de pastilla duplicado es molesto,
//   no peligroso.
//
// CUTOVER (operacional): al prender QUEUE_MEDICATION a mitad de día, un slot que el
// camino viejo ya envió (sin marcar lastSentAt) puede reenviarse UNA vez (el nuevo lo
// ve como "nunca enviado"). Una sola ventana, aceptable; prender en un borde de slot.

/**
 * Productor: encola un job por CADA recordatorio del slot actual, sin el tope
 * `take` del camino viejo. Desactiva vencidos primero (mismo side-effect).
 */
export async function enqueueMedicationReminders(
  boss: PgBoss = getBoss()
): Promise<{ enqueued: number }> {
  const { argHour, slot } = currentArgentinaSlot();
  const today = todayUtcMidnight();
  const date = todayArgentinaISO();

  await deactivateExpiredMedications(today);

  // El productor extiende el `where` compartido con "no enviado hoy" (C-1): no
  // re-encola los que ya se enviaron en este día (el guard del handler igual lo
  // re-chequea). El camino viejo usa el `where` SIN esta condición.
  const base = medicationCandidateWhere(argHour, slot, today);
  const where = {
    ...base,
    AND: [...base.AND, { OR: medicationNotSentTodayOR(today) }],
  };

  let enqueued = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.medicationReminder.findMany({
      where,
      take: MED_ENQUEUE_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        patientId: true,
        patient: { select: { phone: true } },
      },
    });

    if (batch.length === 0) break;

    for (const r of batch) {
      if (!r.patient.phone) continue;
      const payload: MedicationJobPayload = {
        reminderId: r.id,
        patientId: r.patientId,
        phone: toMetaSendablePhone(r.patient.phone),
        date,
        reminderHour: argHour,
        reminderMinute: slot,
      };
      const id = await boss.send(QUEUE_NAMES.medication, payload, {
        singletonKey: medicationSingletonKey(r.id, date, argHour, slot),
        retryLimit: 5,
        retryBackoff: true,
      });
      if (id) enqueued++;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < MED_ENQUEUE_BATCH_SIZE) break;
  }

  logger.info('medication reminders encolados', {
    event: 'queue',
    action: 'enqueue_medication',
    enqueued,
    argHour,
    slot,
  });

  return { enqueued };
}

/** Forma mínima de un job que necesita el handler (compatible con PgBoss.Job). */
type JobLike<T> = { id: string; data: T };

/**
 * Consumidor: construye el handler del worker `reminders:medication`.
 * Guard re-lee el recordatorio (active + no-vencido + consent + NO enviado hoy) y,
 * tras enviar FUERA de tx, marca `lastSentAt`.
 *
 * C-1 RESUELTO (code-review): con el procesamiento por LOTES + la semántica de pg-boss
 * (un throw falla el lote ENTERO → reintenta los N), un fallo de envío reintenta todo
 * el lote. La marca `lastSentAt` hace a medicación idempotente como los otros 4 crons:
 * el guard descarta los ya enviados HOY, así que el reintento NO re-envía. (Antes
 * medicación no tenía marca de envío → re-enviaba; por eso QUEUE_MEDICATION estaba
 * gateado. Ya no.)
 */
export function makeMedicationHandler(): (
  jobs: JobLike<MedicationJobPayload>[]
) => Promise<void> {
  return async (jobs: JobLike<MedicationJobPayload>[]): Promise<void> => {
    // Concurrencia ACOTADA (runJobBatch): pg-boss entrega lotes grandes
    // (batchSize); procesarlos TODOS a la vez agota el pool de Prisma. El
    // limiter (Bottleneck) gobierna el RATE de envío. Serial toparía en ~1/latencia.
    await runJobBatch(jobs, config.SEND_MAX_CONCURRENT, (data) => processMedicationJob(data));
  };
}

async function processMedicationJob(payload: MedicationJobPayload): Promise<void> {
  const { reminderId, phone } = payload;
  const today = todayUtcMidnight();

  // GUARD: re-lee que el recordatorio sigue activo, no vencido, con consent Y no
  // enviado HOY (C-1: si ya se envió, un reintento de lote NO debe re-enviar). NO
  // re-chequea el slot a propósito (un médico pudo editar la hora entre encolar y
  // consumir; el mensaje sigue siendo válido para ese paciente).
  const reminder = await prisma.medicationReminder.findFirst({
    where: {
      id: reminderId,
      active: true,
      patient: { consent: true, phone: { not: null } },
      AND: [
        { OR: [{ endDate: null }, { endDate: { gte: today } }] },
        { OR: medicationNotSentTodayOR(today) },
      ],
    },
    select: {
      id: true,
      medicationName: true,
      dosage: true,
      instructions: true,
      patient: { select: { fullName: true } },
    },
  });

  if (!reminder) {
    logger.info('medication skip — ya no es candidato (inactivo / vencido / sin consent / ya enviado hoy)', {
      event: 'queue',
      action: 'medication_skip',
      reminderId: maskId(reminderId),
    });
    return;
  }

  const message = buildMedicationMessage(
    reminder.patient.fullName,
    reminder.medicationName,
    reminder.dosage,
    reminder.instructions
  );

  if (config.QUEUE_SHADOW) {
    logger.info('medication SHADOW — habría enviado', {
      event: 'queue',
      action: 'medication_shadow',
      reminderId: maskId(reminderId),
      phone: maskPhone(phone),
    });
    return;
  }

  const ok = await limiter.schedule(() => sendTextMessage(phone, message));
  if (!ok) {
    throw new Error('send_failed');
  }

  // C-1: marca lastSentAt para que un reintento de lote (pg-boss falla el lote entero
  // ante un throw) NO vuelva a enviar este recordatorio — el guard de arriba lo
  // descartará. `updateMany` con where CONDICIONAL ("no enviado hoy") → idempotente
  // ante carrera; va FUERA de transacción (la red ya ocurrió).
  await prisma.medicationReminder.updateMany({
    where: {
      id: reminder.id,
      active: true,
      AND: [{ OR: medicationNotSentTodayOR(today) }],
    },
    data: { lastSentAt: new Date() },
  });
}
