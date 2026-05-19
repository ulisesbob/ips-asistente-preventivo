import { prisma, PatientProgramStatus, RegisteredVia } from '@ips/db';
import { sendTextMessage } from './messaging.service';
import { toMetaSendablePhone } from '../utils/phone';
import { firstName, maskPhone } from '../utils/pii';
import { config } from '../config/env';

/**
 * Followup para pacientes registrados sin programa.
 *
 * Problema que cierra: si un paciente se registra via bot pero ningún médico
 * lo inscribe en un programa, antes quedaba en limbo silencioso (no recordatorios,
 * no seguimiento, nadie se enteraba). Ahora le mandamos hasta MAX_FOLLOWUPS
 * recordatorios espaciados para que se acerque al IPS a inscribirse.
 *
 * Reglas:
 * - Solo pacientes BOT-registrados (los CSV/PANEL ya tienen contacto presencial).
 * - Esperar GRACE_PERIOD_DAYS días desde el registro (dar tiempo al médico).
 * - Espaciar recordatorios al menos REMINDER_INTERVAL_DAYS días.
 * - Hasta MAX_FOLLOWUPS recordatorios. Después se marca como abandoned para alerta admin.
 * - Respetar consent + whatsappLinked + phone.
 */

export const GRACE_PERIOD_DAYS = 7;
export const REMINDER_INTERVAL_DAYS = 7;
export const MAX_FOLLOWUPS = 3;
const MAX_PER_RUN = 200;
const RATE_LIMIT_MS = 100;

/**
 * Pacientes candidatos a recibir un followup HOY.
 * Pure-ish (solo lee DB), exportada para testing y para dashboard alerts.
 */
export async function findPatientsNeedingFollowup() {
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const intervalCutoff = new Date(now.getTime() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  return prisma.patient.findMany({
    where: {
      registeredVia: RegisteredVia.BOT,
      whatsappLinked: true,
      consent: true,
      phone: { not: null },
      createdAt: { lt: graceCutoff },
      noProgramReminderCount: { lt: MAX_FOLLOWUPS },
      // No tiene ningún programa activo
      programs: { none: { status: PatientProgramStatus.ACTIVE } },
      // Nunca enviado, o último envío hace >= 7 días
      OR: [
        { lastNoProgramReminderAt: null },
        { lastNoProgramReminderAt: { lt: intervalCutoff } },
      ],
    },
    take: MAX_PER_RUN,
    select: {
      id: true,
      fullName: true,
      phone: true,
      noProgramReminderCount: true,
      createdAt: true,
    },
  });
}

/**
 * Pacientes que ya recibieron MAX_FOLLOWUPS sin enrolar — para alerta admin.
 * Estos quedan "abandoned": no se les manda más, alguien tiene que actuar.
 */
export async function findAbandonedPatients() {
  return prisma.patient.findMany({
    where: {
      registeredVia: RegisteredVia.BOT,
      whatsappLinked: true,
      consent: true,
      noProgramReminderCount: { gte: MAX_FOLLOWUPS },
      programs: { none: { status: PatientProgramStatus.ACTIVE } },
    },
    take: 500,
    select: {
      id: true,
      fullName: true,
      dni: true,
      phone: true,
      createdAt: true,
      lastNoProgramReminderAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Construye el mensaje según el número de followup (1, 2 o 3).
 * El último es más enfático y avisa que es el último.
 */
// Exportado solo para tests
export function buildFollowupMessage(name: string, attempt: number, daysSinceRegister: number): string {
  const greetName = firstName(name);
  const support = config.IPS_SUPPORT_PHONE;
  // Disclaimer reglamentario (CLAUDE.md regla #44).
  const disclaimer = `\n\nEsta información es orientativa. Comuníquese al ${support}.`;

  if (attempt >= MAX_FOLLOWUPS) {
    // Mensaje final (3rd) — voseo consistente, sin "comuníquese" en el cuerpo
    return (
      `Hola ${greetName}, último recordatorio: hace ${daysSinceRegister} días te ` +
      `registraste con nosotros pero todavía no estás inscripto en ningún programa de salud.\n\n` +
      `Si querés inscribirte, acercate al Área de Programas Especiales (Junín 177, Posadas) ` +
      `o a tu delegación más cercana con DNI y carnet de afiliado.\n\n` +
      `No vamos a enviarte más recordatorios sobre esto.` +
      disclaimer
    );
  }

  return (
    `Hola ${greetName}! Hace ${daysSinceRegister} días te registraste con nosotros ` +
    `pero todavía no estás inscripto en ningún programa de salud.\n\n` +
    `Para inscribirte:\n` +
    `- Acercate al Área de Programas Especiales (Junín 177, Posadas)\n` +
    `- Llevá tu DNI y carnet de afiliado\n` +
    `- Un médico te va a evaluar e inscribir` +
    disclaimer
  );
}

/**
 * Procesa todos los followups pendientes. Llamado por cron diario.
 */
export async function processFollowups(): Promise<{ sent: number; failed: number }> {
  const patients = await findPatientsNeedingFollowup();
  if (patients.length === 0) {
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const now = new Date();

  for (const p of patients) {
    if (!p.phone) continue;

    // Race fix: paciente puede haberse enrolado en algún programa entre la
    // query inicial y este iter (admin via panel). Re-chequear que sigue sin
    // programa activo antes de enviar — evita spam al paciente recién enrolado.
    const stillNoProgram = await prisma.patient.findFirst({
      where: {
        id: p.id,
        consent: true, // Tambien chequear consent — pudo dar BAJA mid-cron
        programs: { none: { status: PatientProgramStatus.ACTIVE } },
      },
      select: { id: true },
    });
    if (!stillNoProgram) {
      console.log(`[Followup] Skip ${p.id} — enrolled or opted-out between query and send`);
      continue;
    }

    const sendPhone = toMetaSendablePhone(p.phone);
    const daysSinceRegister = Math.floor(
      (now.getTime() - p.createdAt.getTime()) / (24 * 60 * 60 * 1000)
    );
    const attempt = p.noProgramReminderCount + 1;
    const message = buildFollowupMessage(p.fullName, attempt, daysSinceRegister);

    try {
      const ok = await sendTextMessage(sendPhone, message);
      if (ok) {
        await prisma.patient.update({
          where: { id: p.id },
          data: {
            lastNoProgramReminderAt: now,
            noProgramReminderCount: { increment: 1 },
          },
        });
        sent++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`[Followup] Error sending to ${maskPhone(sendPhone)}:`, err);
      failed++;
    }

    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
  }

  return { sent, failed };
}
