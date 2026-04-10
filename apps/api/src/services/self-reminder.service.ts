import { prisma, SelfReminderStatus } from '@ips/db';
import { sendTextMessage } from './whatsapp.service';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ACTIVE_PER_PATIENT = 10;
const MAX_DAYS_AHEAD = 365;
const MAX_PER_CRON_RUN = 200;

// CSV injection prevention (LESSONS #30)
const CSV_INJECTION_REGEX = /^[=+\-@\t\r]/;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateSelfReminderInput {
  description: string;
  date: string;      // YYYY-MM-DD
  time: string;      // HH:MM
}

export interface SelfReminderResult {
  success: boolean;
  message: string;
  reminder?: {
    id: string;
    description: string;
    reminderDate: Date;
    reminderHour: number;
    reminderMinute: number;
  };
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

export async function createSelfReminder(
  patientId: string,
  input: CreateSelfReminderInput
): Promise<SelfReminderResult> {
  // Validate description
  const desc = input.description.trim();
  if (desc.length < 2 || desc.length > 200) {
    return { success: false, message: 'La descripción debe tener entre 2 y 200 caracteres.' };
  }
  if (CSV_INJECTION_REGEX.test(desc)) {
    return { success: false, message: 'La descripción contiene caracteres no permitidos.' };
  }

  // Parse and validate date (LESSONS #44: use UTC getters)
  const dateMatch = input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return { success: false, message: 'Formato de fecha inválido. Usá YYYY-MM-DD.' };
  }
  const year = parseInt(dateMatch[1]);
  const month = parseInt(dateMatch[2]) - 1;
  const day = parseInt(dateMatch[3]);
  const reminderDate = new Date(Date.UTC(year, month, day));

  // Validate date is not in the past (use Argentina timezone)
  const todayArg = getTodayArgentina();
  if (reminderDate < todayArg) {
    return { success: false, message: 'La fecha no puede ser en el pasado.' };
  }

  // Validate not too far ahead
  const maxDate = new Date(todayArg);
  maxDate.setUTCDate(maxDate.getUTCDate() + MAX_DAYS_AHEAD);
  if (reminderDate > maxDate) {
    return { success: false, message: `La fecha no puede ser más de ${MAX_DAYS_AHEAD} días en el futuro.` };
  }

  // Parse and validate time
  const timeMatch = input.time.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    return { success: false, message: 'Formato de hora inválido. Usá HH:MM.' };
  }
  const hour = parseInt(timeMatch[1]);
  const minute = parseInt(timeMatch[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { success: false, message: 'Hora inválida.' };
  }

  // Round minute to nearest 30 (cron runs every 30 min)
  const roundedMinute = minute < 15 ? 0 : 30;

  // Check active reminders limit
  const activeCount = await prisma.patientSelfReminder.count({
    where: { patientId, status: SelfReminderStatus.PENDING },
  });
  if (activeCount >= MAX_ACTIVE_PER_PATIENT) {
    return {
      success: false,
      message: `Ya tenés ${MAX_ACTIVE_PER_PATIENT} recordatorios activos. Cancelá alguno para agregar otro.`,
    };
  }

  // Create
  const reminder = await prisma.patientSelfReminder.create({
    data: {
      patientId,
      description: desc,
      reminderDate,
      reminderHour: hour,
      reminderMinute: roundedMinute,
    },
    select: {
      id: true,
      description: true,
      reminderDate: true,
      reminderHour: true,
      reminderMinute: true,
    },
  });

  return { success: true, message: 'Recordatorio creado.', reminder };
}

// ─── LIST ACTIVE ──────────────────────────────────────────────────────────────

export async function listActiveSelfReminders(patientId: string) {
  return prisma.patientSelfReminder.findMany({
    where: { patientId, status: SelfReminderStatus.PENDING },
    orderBy: [{ reminderDate: 'asc' }, { reminderHour: 'asc' }, { reminderMinute: 'asc' }],
    take: MAX_ACTIVE_PER_PATIENT,
    select: {
      id: true,
      description: true,
      reminderDate: true,
      reminderHour: true,
      reminderMinute: true,
    },
  });
}

// ─── CANCEL ───────────────────────────────────────────────────────────────────

export async function cancelSelfReminder(
  patientId: string,
  reminderIndex: number
): Promise<{ success: boolean; message: string }> {
  const reminders = await listActiveSelfReminders(patientId);

  if (reminderIndex < 1 || reminderIndex > reminders.length) {
    return {
      success: false,
      message: `No existe el recordatorio #${reminderIndex}. Tenés ${reminders.length} recordatorio(s) activo(s).`,
    };
  }

  const reminder = reminders[reminderIndex - 1];
  await prisma.patientSelfReminder.update({
    where: { id: reminder.id },
    data: { status: SelfReminderStatus.CANCELLED },
  });

  return {
    success: true,
    message: `Recordatorio "${reminder.description}" cancelado.`,
  };
}

// ─── LIST FOR PANEL (read-only, with access control) ─────────────────────────

export async function listSelfRemindersForPanel(patientId: string) {
  return prisma.patientSelfReminder.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      description: true,
      reminderDate: true,
      reminderHour: true,
      reminderMinute: true,
      status: true,
      createdAt: true,
    },
  });
}

// ─── CRON: Process due self-reminders ────────────────────────────────────────

export async function processDueSelfReminders(): Promise<{ sent: number; failed: number }> {
  // Get current Argentina time (LESSONS #16)
  const argFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: 'numeric', hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const parts = argFormatter.formatToParts(new Date());
  const argYear = parseInt(parts.find((p) => p.type === 'year')?.value ?? '2026');
  const argMonth = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1') - 1;
  const argDay = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1');
  const argHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const argMinute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0');

  const todayUtc = new Date(Date.UTC(argYear, argMonth, argDay));
  const slot = argMinute < 15 ? 0 : 30;

  console.log(`[SelfReminder] Checking for date=${todayUtc.toISOString().slice(0, 10)} hour=${argHour} minute=${slot}`);

  // Query: past dates (any time) + today with hour:minute <= now
  const reminders = await prisma.patientSelfReminder.findMany({
    where: {
      status: SelfReminderStatus.PENDING,
      OR: [
        // Past dates — overdue
        { reminderDate: { lt: todayUtc } },
        // Today, current slot or earlier
        {
          reminderDate: todayUtc,
          OR: [
            { reminderHour: { lt: argHour } },
            { reminderHour: argHour, reminderMinute: { lte: slot } },
          ],
        },
      ],
      patient: {
        consent: true,
        phone: { not: null },
      },
    },
    take: MAX_PER_CRON_RUN,
    select: {
      id: true,
      description: true,
      reminderDate: true,
      reminderHour: true,
      reminderMinute: true,
      patient: {
        select: {
          fullName: true,
          phone: true,
        },
      },
    },
  });

  if (reminders.length === 0) {
    console.log('[SelfReminder] No self-reminders to send.');
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const r of reminders) {
    if (!r.patient.phone) continue;

    // Normalize phone (LESSONS #40)
    let sendPhone = r.patient.phone.startsWith('+') ? r.patient.phone.slice(1) : r.patient.phone;
    if (sendPhone.startsWith('549') && sendPhone.length === 13) {
      sendPhone = '54' + sendPhone.slice(3);
    }

    const firstName = r.patient.fullName.split(' ')[0];
    const message =
      `Hola ${firstName}! Te recuerdo:\n\n` +
      `📌 *${r.description}*\n\n` +
      `Este recordatorio lo creaste vos desde el chat. ¡Éxitos!`;

    try {
      await sendTextMessage(sendPhone, message);
      await prisma.patientSelfReminder.update({
        where: { id: r.id },
        data: { status: SelfReminderStatus.SENT },
      });
      sent++;
    } catch (err) {
      console.error(`[SelfReminder] Error sending to ${sendPhone}:`, err);
      // Cancel permanently overdue reminders (>48h past) to avoid infinite retries
      const ageMs = Date.now() - new Date(r.reminderDate).getTime();
      if (ageMs > 48 * 60 * 60 * 1000) {
        await prisma.patientSelfReminder.update({
          where: { id: r.id },
          data: { status: SelfReminderStatus.CANCELLED },
        });
        console.warn(`[SelfReminder] Cancelled permanently overdue reminder ${r.id} (>48h)`);
      }
      failed++;
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[SelfReminder] Sent ${sent}, failed ${failed}`);
  return { sent, failed };
}

// ─── FORMAT FOR BOT CONTEXT ─────────────────────────────────────────────────

export async function getSelfRemindersForBot(patientId: string) {
  return listActiveSelfReminders(patientId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayArgentina(): Date {
  const argFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const parts = argFormatter.formatToParts(new Date());
  const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '2026');
  const m = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1') - 1;
  const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1');
  return new Date(Date.UTC(y, m, d));
}

// ─── PARSE AI TAG ─────────────────────────────────────────────────────────────

/**
 * Parses the AI response for a self-reminder tag.
 * Format: <<SELF_REMINDER:{"descripcion":"...","fecha":"YYYY-MM-DD","hora":"HH:MM"}>>
 * Returns the parsed data and the cleaned response (tag stripped).
 */
export function parseSelfReminderTag(
  aiResponse: string
): { found: boolean; data?: CreateSelfReminderInput; cleanResponse: string } {
  const tagRegex = /<<SELF_REMINDER:(\{[^}]+\})>>/;
  const match = aiResponse.match(tagRegex);

  if (!match) {
    return { found: false, cleanResponse: aiResponse };
  }

  try {
    const parsed = JSON.parse(match[1]);
    const data: CreateSelfReminderInput = {
      description: String(parsed.descripcion || parsed.description || '').trim(),
      date: String(parsed.fecha || parsed.date || '').trim(),
      time: String(parsed.hora || parsed.time || '').trim(),
    };

    if (!data.description || !data.date || !data.time) {
      return { found: false, cleanResponse: aiResponse };
    }

    // Strip the tag from the response
    const cleanResponse = aiResponse.replace(tagRegex, '').trim();
    return { found: true, data, cleanResponse };
  } catch {
    return { found: false, cleanResponse: aiResponse };
  }
}

/**
 * Parses the AI response for a list-reminders tag.
 * Format: <<LIST_REMINDERS>>
 */
export function parseListRemindersTag(aiResponse: string): { found: boolean; cleanResponse: string } {
  const tagRegex = /<<LIST_REMINDERS>>/;
  if (tagRegex.test(aiResponse)) {
    return { found: true, cleanResponse: aiResponse.replace(tagRegex, '').trim() };
  }
  return { found: false, cleanResponse: aiResponse };
}

/**
 * Parses the AI response for a cancel-reminder tag.
 * Format: <<CANCEL_REMINDER:N>>
 */
export function parseCancelReminderTag(
  aiResponse: string
): { found: boolean; index?: number; cleanResponse: string } {
  const tagRegex = /<<CANCEL_REMINDER:(\d+)>>/;
  const match = aiResponse.match(tagRegex);

  if (!match) {
    return { found: false, cleanResponse: aiResponse };
  }

  const index = parseInt(match[1]);
  const cleanResponse = aiResponse.replace(tagRegex, '').trim();
  return { found: true, index, cleanResponse };
}

/**
 * Formats a list of reminders for display in WhatsApp.
 */
export function formatRemindersForWhatsApp(
  reminders: Array<{ description: string; reminderDate: Date; reminderHour: number; reminderMinute: number }>
): string {
  if (reminders.length === 0) {
    return 'No tenés recordatorios activos. Podés crear uno diciéndome, por ejemplo: "Recordame el turno del dentista el lunes a las 9".';
  }

  const lines = reminders.map((r, i) => {
    const date = new Intl.DateTimeFormat('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long',
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(r.reminderDate);
    const time = `${String(r.reminderHour).padStart(2, '0')}:${String(r.reminderMinute).padStart(2, '0')}`;
    return `${i + 1}. 📌 *${r.description}* — ${date} a las ${time}`;
  });

  return `Tus recordatorios activos:\n\n${lines.join('\n')}\n\nPara cancelar uno, decime "cancelar recordatorio" y el número.`;
}
