import { prisma, SelfReminderStatus } from '@ips/db';
import { sendTextMessage } from './messaging.service';
import { maskPhone, firstName } from '../utils/pii';
import { toMetaSendablePhone } from '../utils/phone';

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
  recurring?: boolean;
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
  // Validate description — check CSV injection on RAW input before trimming
  // (LESSONS #30: \t and \r are injection chars, but .trim() removes them)
  if (CSV_INJECTION_REGEX.test(input.description)) {
    return { success: false, message: 'La descripción contiene caracteres no permitidos.' };
  }
  // Strip << >> to prevent prompt injection when description is injected into system prompt
  const desc = input.description.trim().replace(/[<>]/g, '');
  if (desc.length < 2 || desc.length > 200) {
    return { success: false, message: 'La descripción debe tener entre 2 y 200 caracteres.' };
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

  const isRecurring = input.recurring === true;

  // Dedupe: si ya existe un recordatorio activo idéntico (misma descripción +
  // hora + minuto + recurrencia), NO creamos un duplicado. En la evidencia de
  // producción el paciente terminó con 3 recordatorios idénticos. Idempotente:
  // devolvemos el existente como si lo hubiéramos creado.
  const duplicate = await prisma.patientSelfReminder.findFirst({
    where: {
      patientId,
      status: SelfReminderStatus.PENDING,
      description: desc,
      reminderHour: hour,
      reminderMinute: roundedMinute,
      recurring: isRecurring,
    },
    select: {
      id: true,
      description: true,
      reminderDate: true,
      reminderHour: true,
      reminderMinute: true,
      recurring: true,
    },
  });
  if (duplicate) {
    return {
      success: true,
      message: isRecurring
        ? 'Ya tenías ese recordatorio diario, lo dejé como estaba.'
        : 'Ya tenías ese recordatorio, lo dejé como estaba.',
      reminder: duplicate,
    };
  }

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
      recurring: isRecurring,
    },
    select: {
      id: true,
      description: true,
      reminderDate: true,
      reminderHour: true,
      reminderMinute: true,
      recurring: true,
    },
  });

  return { success: true, message: isRecurring ? 'Recordatorio diario creado.' : 'Recordatorio creado.', reminder };
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
      recurring: true,
    },
  });
}

// ─── CANCEL ───────────────────────────────────────────────────────────────────

export interface CancelResult {
  /** Cuántos se cancelaron REALMENTE en la DB (fuente de verdad para el bot). */
  cancelledCount: number;
  /** Índices (1-based) pedidos que no corresponden a ningún recordatorio activo. */
  invalidIndices: number[];
  /** Descripciones de los recordatorios efectivamente cancelados. */
  cancelledDescriptions: string[];
}

/**
 * Cancela uno o varios recordatorios por índice (1-based, según el orden de
 * listActiveSelfReminders). El conteo devuelto es el REAL de la DB; el bot debe
 * armar su confirmación con esto, NUNCA inventarla.
 */
export async function cancelSelfReminders(
  patientId: string,
  indices: number[]
): Promise<CancelResult> {
  const reminders = await listActiveSelfReminders(patientId);

  const validIds: string[] = [];
  const cancelledDescriptions: string[] = [];
  const invalidIndices: number[] = [];

  // De-dup índices y mapear a IDs reales.
  for (const idx of Array.from(new Set(indices))) {
    if (idx < 1 || idx > reminders.length) {
      invalidIndices.push(idx);
      continue;
    }
    const r = reminders[idx - 1];
    validIds.push(r.id);
    cancelledDescriptions.push(r.description);
  }

  if (validIds.length === 0) {
    return { cancelledCount: 0, invalidIndices, cancelledDescriptions: [] };
  }

  // updateMany acotado a este paciente + IDs válidos + PENDING (defensa contra
  // race con el cron y contra cancelar lo de otro paciente).
  const result = await prisma.patientSelfReminder.updateMany({
    where: {
      patientId,
      status: SelfReminderStatus.PENDING,
      id: { in: validIds },
    },
    data: { status: SelfReminderStatus.CANCELLED },
  });

  return {
    cancelledCount: result.count,
    invalidIndices,
    cancelledDescriptions,
  };
}

/**
 * Cancela TODOS los recordatorios activos del paciente. Devuelve el conteo real.
 */
export async function cancelAllSelfReminders(patientId: string): Promise<CancelResult> {
  const result = await prisma.patientSelfReminder.updateMany({
    where: { patientId, status: SelfReminderStatus.PENDING },
    data: { status: SelfReminderStatus.CANCELLED },
  });
  return { cancelledCount: result.count, invalidIndices: [], cancelledDescriptions: [] };
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
      recurring: true,
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
      recurring: true,
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

    // Re-leer status JUSTO antes de enviar para evitar race con cancelación
    // desde el bot (paciente escribe "cancelar recordatorio N" entre que el
    // cron tomó el snapshot y llega al iter de este reminder).
    const fresh = await prisma.patientSelfReminder.findUnique({
      where: { id: r.id },
      select: { status: true },
    });
    if (!fresh || fresh.status !== SelfReminderStatus.PENDING) {
      console.log(`[SelfReminder] Skipping ${r.id} — status cambió a ${fresh?.status ?? 'deleted'}`);
      continue;
    }

    const sendPhone = toMetaSendablePhone(r.patient.phone);
    const greetName = firstName(r.patient.fullName);
    const message =
      `Hola ${greetName}! Te recuerdo:\n\n` +
      `📌 *${r.description}*\n\n` +
      `Este recordatorio lo creaste vos desde el chat. ¡Éxitos!`;

    try {
      await sendTextMessage(sendPhone, message);
      if (r.recurring) {
        // Recurring: skip to TOMORROW (not +1 from overdue date) to avoid catch-up spam
        const tomorrow = new Date(todayUtc);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        await prisma.patientSelfReminder.update({
          where: { id: r.id },
          data: { reminderDate: tomorrow },
        });
      } else {
        // One-time: mark as SENT
        await prisma.patientSelfReminder.update({
          where: { id: r.id },
          data: { status: SelfReminderStatus.SENT },
        });
      }
      sent++;
    } catch (err) {
      console.error(`[SelfReminder] Error sending to ${maskPhone(sendPhone)}:`, err);
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

/**
 * Fecha de hoy en Argentina como YYYY-MM-DD. La usa el flujo por keyword del
 * chat para crear recordatorios recurrentes diarios "a partir de hoy".
 */
export function todayArgentinaISO(): string {
  // en-CA produce el formato YYYY-MM-DD directamente.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
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
  // Match until closing }>>, allowing } inside JSON values (e.g. "Turno {sala 3}").
  // [\s\S] en vez de . para que descripciones con \n no rompan el match
  // (Claude a veces incluye newlines en values JSON — error-detective finding).
  const tagRegex = /<<SELF_REMINDER:(\{[\s\S]*?\})>>/;
  // Strip-all variant (audit #22): if AI accidentally emits multiple tags,
  // we still want NONE visible to the patient. We only act on the first one.
  const tagRegexGlobal = /<<SELF_REMINDER:\{[\s\S]*?\}>>/g;
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
      recurring: parsed.recurrente === true || parsed.recurring === true,
    };

    if (!data.description || !data.date || !data.time) {
      // Still strip the malformed tag so the patient doesn't see it.
      return { found: false, cleanResponse: aiResponse.replace(tagRegexGlobal, '').trim() };
    }

    // Strip ALL occurrences from the response
    const cleanResponse = aiResponse.replace(tagRegexGlobal, '').trim();
    return { found: true, data, cleanResponse };
  } catch {
    return { found: false, cleanResponse: aiResponse.replace(tagRegexGlobal, '').trim() };
  }
}

/**
 * Parses the AI response for a list-reminders tag.
 * Format: <<LIST_REMINDERS>>
 */
export function parseListRemindersTag(aiResponse: string): { found: boolean; cleanResponse: string } {
  // Use .includes() instead of regex.test() because /g regex.test() mutates
  // lastIndex and gives flaky results if the regex is ever hoisted to module scope.
  if (aiResponse.includes('<<LIST_REMINDERS>>')) {
    return { found: true, cleanResponse: aiResponse.replace(/<<LIST_REMINDERS>>/g, '').trim() };
  }
  return { found: false, cleanResponse: aiResponse };
}

/**
 * Parses the AI response for a cancel-reminder tag.
 * Soporta un índice o varios separados por coma:
 *   <<CANCEL_REMINDER:2>>  ó  <<CANCEL_REMINDER:1,2,3>>
 * Devuelve los índices (1-based, de-duplicados, en orden de aparición).
 */
export function parseCancelReminderTag(
  aiResponse: string
): { found: boolean; indices?: number[]; cleanResponse: string } {
  // Capturamos la lista de dígitos separados por coma (con espacios opcionales).
  const tagRegex = /<<CANCEL_REMINDER:(\d+(?:\s*,\s*\d+)*)>>/;
  const tagRegexGlobal = /<<CANCEL_REMINDER:\d+(?:\s*,\s*\d+)*>>/g;
  const match = aiResponse.match(tagRegex);

  if (!match) {
    return { found: false, cleanResponse: aiResponse };
  }

  const indices = Array.from(
    new Set(
      match[1]
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))
    )
  );

  // Strip all instances (audit #22 — don't leak duplicates to the patient).
  const cleanResponse = aiResponse.replace(tagRegexGlobal, '').trim();
  return { found: true, indices, cleanResponse };
}

/**
 * Parses the AI response for a cancel-ALL-reminders tag.
 * Format: <<CANCEL_ALL_REMINDERS>>
 */
export function parseCancelAllRemindersTag(
  aiResponse: string
): { found: boolean; cleanResponse: string } {
  if (aiResponse.includes('<<CANCEL_ALL_REMINDERS>>')) {
    return { found: true, cleanResponse: aiResponse.replace(/<<CANCEL_ALL_REMINDERS>>/g, '').trim() };
  }
  return { found: false, cleanResponse: aiResponse };
}

/**
 * Formats a list of reminders for display in WhatsApp.
 */
export function formatRemindersForWhatsApp(
  reminders: Array<{ description: string; reminderDate: Date; reminderHour: number; reminderMinute: number; recurring?: boolean }>
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
    const recurTag = r.recurring ? ' 🔁 (diario)' : '';
    return `${i + 1}. 📌 *${r.description}* — ${date} a las ${time}${recurTag}`;
  });

  return `Tus recordatorios activos:\n\n${lines.join('\n')}\n\nPara cancelar uno, decime "cancelar recordatorio" y el número.`;
}
