import { prisma, Role } from '@ips/db';
import { NotFoundError, ValidationError } from '../utils/errors';
import { sendTextMessage } from './messaging.service';
import { maskPhone, firstName } from '../utils/pii';
import { toMetaSendablePhone } from '../utils/phone';

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

export async function sendMedicationReminders(): Promise<{ sent: number; failed: number }> {
  // Cron fires with timezone 'America/Argentina/Buenos_Aires' so we use
  // Intl to get the current Argentina hour/minute (LESSONS #16: don't mix conventions)
  const argFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: 'numeric', hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const parts = argFormatter.formatToParts(new Date());
  const argHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const argMinute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0');

  // Match the slot: cron fires at :00 and :30, so match exactly
  const slot = argMinute < 15 ? 0 : 30;

  console.log(`[MedReminder] Checking for hour=${argHour} minute=${slot} (Argentina)`);

  // Desactivar tratamientos vencidos (endDate < hoy medianoche UTC) antes de
  // seleccionar el slot, así no se manda ningún recordatorio caducado.
  const today = todayUtcMidnight();
  const deactivated = await prisma.medicationReminder.updateMany({
    where: { active: true, endDate: { lt: today } },
    data: { active: false },
  });
  if (deactivated.count > 0) {
    console.log(`[MedReminder] Deactivated ${deactivated.count} expired reminders.`);
  }

  const reminders = await prisma.medicationReminder.findMany({
    where: {
      active: true,
      reminderHour: argHour,
      reminderMinute: slot,
      patient: {
        consent: true,
        phone: { not: null },
      },
      // Tratamiento continuo (endDate null) o aún vigente (endDate >= hoy)
      AND: [{ OR: [{ endDate: null }, { endDate: { gte: today } }] }],
    },
    take: 200, // LESSONS #13
    select: {
      id: true,
      medicationName: true,
      dosage: true,
      instructions: true,
      sideEffects: true,
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

    const instructionsLine = r.instructions ? `📋 ${r.instructions}\n\n` : '';
    const sideEffectsLine = r.sideEffects ? `⚠️ Posibles efectos: ${r.sideEffects}\n\n` : '';
    const message =
      `Hola ${firstName(r.patient.fullName)}! Te recuerdo que es hora de tomar tu medicación:\n\n` +
      `💊 *${r.medicationName}* — ${r.dosage}\n\n` +
      instructionsLine +
      sideEffectsLine +
      `¡Cuidá tu salud!`;

    try {
      await sendTextMessage(sendPhone, message);
      sent++;
    } catch (err) {
      console.error(`[MedReminder] Error sending to ${maskPhone(sendPhone)}:`, err);
      failed++;
    }

    // Rate limit: 100ms between messages (LESSONS Meta rate limits)
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[MedReminder] Sent ${sent}, failed ${failed}`);
  return { sent, failed };
}
