import { prisma, Role } from '@ips/db';
import { NotFoundError, ValidationError } from '../utils/errors';
import { sendTextMessage } from './whatsapp.service';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateMedReminderInput {
  medicationName: string;
  dosage: string;
  reminderHour: number;
  reminderMinute?: number;
}

export interface UpdateMedReminderInput {
  medicationName?: string;
  dosage?: string;
  reminderHour?: number;
  reminderMinute?: number;
  active?: boolean;
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
    },
    select: {
      id: true,
      medicationName: true,
      dosage: true,
      reminderHour: true,
      reminderMinute: true,
      active: true,
    },
  });
}

// ─── UPDATE ─────────────────────────────────────────────────────────────────

export async function updateMedReminder(id: string, doctorId: string, role: Role, input: UpdateMedReminderInput) {
  const existing = await prisma.medicationReminder.findUnique({ where: { id }, select: { id: true, patientId: true } });
  if (!existing) throw new NotFoundError('Recordatorio no encontrado');
  await verifyPatientAccess(existing.patientId, doctorId, role);

  return prisma.medicationReminder.update({
    where: { id },
    data: {
      ...(input.medicationName !== undefined ? { medicationName: input.medicationName.trim() } : {}),
      ...(input.dosage !== undefined ? { dosage: input.dosage.trim() } : {}),
      ...(input.reminderHour !== undefined ? { reminderHour: input.reminderHour } : {}),
      ...(input.reminderMinute !== undefined ? { reminderMinute: input.reminderMinute } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
    select: {
      id: true,
      medicationName: true,
      dosage: true,
      reminderHour: true,
      reminderMinute: true,
      active: true,
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

  const reminders = await prisma.medicationReminder.findMany({
    where: {
      active: true,
      reminderHour: argHour,
      reminderMinute: slot,
      patient: {
        consent: true,
        phone: { not: null },
      },
    },
    take: 200, // LESSONS #13
    select: {
      id: true,
      medicationName: true,
      dosage: true,
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

    // Normalize phone: remove + and apply Argentina fix (LESSONS #40)
    let sendPhone = r.patient.phone.startsWith('+') ? r.patient.phone.slice(1) : r.patient.phone;
    if (sendPhone.startsWith('549') && sendPhone.length === 13) {
      sendPhone = '54' + sendPhone.slice(3);
    }

    const message =
      `Hola ${r.patient.fullName.split(' ')[0]}! Te recuerdo que es hora de tomar tu medicación:\n\n` +
      `💊 *${r.medicationName}* — ${r.dosage}\n\n` +
      `¡Cuidá tu salud!`;

    try {
      await sendTextMessage(sendPhone, message);
      sent++;
    } catch (err) {
      console.error(`[MedReminder] Error sending to ${sendPhone}:`, err);
      failed++;
    }

    // Rate limit: 100ms between messages (LESSONS Meta rate limits)
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[MedReminder] Sent ${sent}, failed ${failed}`);
  return { sent, failed };
}
