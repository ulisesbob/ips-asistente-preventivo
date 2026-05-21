import type PgBoss from 'pg-boss';
import { prisma, PatientProgramStatus, RegisteredVia } from '@ips/db';
import { sendTextMessage } from './messaging.service';
import { toMetaSendablePhone } from '../utils/phone';
import { firstName, maskId, maskPhone } from '../utils/pii';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getBoss } from '../queue/boss';
import { limiter } from '../queue/limiter';
import { runJobBatch } from '../queue/send-worker';
import {
  QUEUE_NAMES,
  followupSingletonKey,
  type FollowupJobPayload,
} from '../queue/queues';

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
// Tamaño de lote para la paginación de enqueueFollowups (cola). No es un tope:
// se itera hasta agotar. Acota la memoria por iteración (hasta 40k pacientes).
const ENQUEUE_BATCH_SIZE = 200;

/**
 * Construye el `where` de candidatos a followup HOY. Compartido entre el camino
 * viejo (`findPatientsNeedingFollowup`, con `take`) y el nuevo encolado sin tope
 * (`enqueueFollowups`, paginado): así la cola procesa EXACTAMENTE la misma
 * población que el cron viejo, sin el corte silencioso del `take`.
 */
function followupCandidateWhere(now: Date) {
  const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const intervalCutoff = new Date(now.getTime() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  return {
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
  };
}

/**
 * Condiciones del GUARD idempotente del handler (capa 2). Coherente con
 * `followupCandidateWhere` pero SIN las condiciones del productor (registeredVia /
 * whatsappLinked / phone / grace period), que ya se filtraron al encolar y no
 * cambian. Re-chequea lo que SÍ puede cambiar entre encolado y consumo:
 *   - consent (el paciente pudo dar de baja),
 *   - sin programa activo (un admin pudo enrolarlo via panel),
 *   - count < MAX_FOLLOWUPS (un reintento que ya aplicó el efecto),
 *   - lastNoProgramReminderAt null OR < cutoff de 7 días (M1: un reintento al día
 *     siguiente NO debe reenviar antes del intervalo).
 *
 * Se usa TANTO en el findFirst (lectura del guard, fuera de tx) COMO en el `where`
 * del update condicional (atomicidad sin la red dentro de la tx): si entre el
 * envío y el update otro proceso cambió el estado, el update no toca ninguna fila.
 */
function followupGuardConditions(now: Date) {
  const intervalCutoff = new Date(now.getTime() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  return {
    consent: true,
    noProgramReminderCount: { lt: MAX_FOLLOWUPS },
    programs: { none: { status: PatientProgramStatus.ACTIVE } },
    OR: [
      { lastNoProgramReminderAt: null },
      { lastNoProgramReminderAt: { lt: intervalCutoff } },
    ],
  };
}

/** Fecha de hoy en Argentina como YYYY-MM-DD (ventana del singletonKey diario). */
function todayArgentinaISO(): string {
  // en-CA produce el formato YYYY-MM-DD directamente.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

/**
 * Pacientes candidatos a recibir un followup HOY.
 * Pure-ish (solo lee DB), exportada para testing y para dashboard alerts.
 */
export async function findPatientsNeedingFollowup() {
  return prisma.patient.findMany({
    where: followupCandidateWhere(new Date()),
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

// ─── Bloque B (T7): camino por cola pg-boss (detrás de QUEUE_FOLLOWUP) ─────────
//
// PRODUCTOR: enqueueFollowups encola 1 job por paciente (sin tope, paginando) y
// NO envía. CONSUMIDOR: makeFollowupHandler envía vía limiter + sendTextMessage y
// muta el contador de forma idempotente. La idempotencia es de 2 capas:
//   1) singletonKey (followup:{patientId}:{date}) → no se encola dos veces el día.
//      Requiere policy 'short' en la cola (ver createQueues en register-workers).
//   2) guard en el handler (re-lee sin-programa + consent + count<3 + intervalo 7d)
//      + update con where CONDICIONAL que reincluye ese guard → un reintento de
//      pg-boss no aplica el efecto dos veces. El envío va FUERA de transacción
//      (la red no debe mantener un lock abierto: riesgo P2028 → reintento → reenvío).

/**
 * Productor: encola un job de followup por CADA paciente candidato hoy, sin el
 * tope de `take` del camino viejo (procesa hasta los ~40k). Pagina por lotes con
 * cursor para acotar la memoria. NO envía nada acá — solo encola.
 *
 * @param boss instancia de pg-boss (default: singleton). Inyectable para tests.
 * @returns cuántos jobs se encolaron.
 */
export async function enqueueFollowups(
  boss: PgBoss = getBoss()
): Promise<{ enqueued: number }> {
  const now = new Date();
  const where = followupCandidateWhere(now);
  const date = todayArgentinaISO();

  let enqueued = 0;
  let cursor: string | undefined;

  // Paginación por cursor estable (id). El estado no cambia DURANTE el encolado
  // (no mutamos acá), así que cada paciente entra una vez; el guard del handler
  // cubre cualquier carrera con el panel.
  for (;;) {
    const batch = await prisma.patient.findMany({
      where,
      take: ENQUEUE_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        fullName: true,
        phone: true,
        noProgramReminderCount: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    for (const p of batch) {
      if (!p.phone) continue;
      const payload: FollowupJobPayload = {
        patientId: p.id,
        phone: toMetaSendablePhone(p.phone),
        date,
      };
      // M2: boss.send retorna null cuando el singletonKey deduplica (ya hay un job
      // en cola ese día). Solo contamos los ENCOLADOS reales — la métrica gatea el
      // test de migración (comparar contra el camino viejo).
      const id = await boss.send(QUEUE_NAMES.followup, payload, {
        singletonKey: followupSingletonKey(p.id, date),
        retryLimit: 5,
        retryBackoff: true,
      });
      if (id) enqueued++;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < ENQUEUE_BATCH_SIZE) break;
  }

  logger.info('followups encolados', {
    event: 'queue',
    action: 'enqueue_followups',
    enqueued,
  });

  return { enqueued };
}

/** Forma mínima de un job que necesita el handler (compatible con PgBoss.Job). */
type JobLike<T> = { id: string; data: T };

/**
 * Consumidor: construye el handler del worker `reminders:followup`.
 *
 * Por cada job (C2 — patrón "leer guard, enviar FUERA de tx, update condicional"):
 *   1) GUARD (findFirst, sin tx larga): re-lee que sigue siendo candidato
 *      (sin programa activo, con consent, count<3, lastNoProgramReminderAt
 *      null OR <7d). Si no → skip (no envía ni muta).
 *   2) ENVÍO FUERA de transacción, vía limiter + sendTextMessage. NUNCA dentro de
 *      una tx: mantener tx + lock abiertos durante la latencia de red arriesga
 *      P2028 timeout → reintento → reenvío. (El camino viejo `processFollowups`
 *      ya lo hace así.)
 *   3) UPDATE con un `where` CONDICIONAL que reincluye las condiciones del guard
 *      (consent / sin programa activo / count<3 / lastNoProgramReminderAt). Si
 *      entre el envío y el update otro proceso cambió el estado, el update no toca
 *      ninguna fila → atomicidad sin la red adentro de la tx.
 *
 *   - sendTextMessage=false → throw → pg-boss reintenta (no se descarta en silencio).
 *   - QUEUE_SHADOW=true → NO envía ni muta, solo loguea "habría enviado a X".
 *   - guard falla (enrolado / opt-out / ya en 3 / <7d) → skip sin enviar ni mutar.
 */
export function makeFollowupHandler(): (
  jobs: JobLike<FollowupJobPayload>[]
) => Promise<void> {
  return async (jobs: JobLike<FollowupJobPayload>[]): Promise<void> => {
    // Concurrencia ACOTADA (runJobBatch): pg-boss entrega lotes grandes
    // (batchSize); procesarlos TODOS a la vez agota el pool de Prisma. El
    // limiter (Bottleneck) gobierna el RATE de envío. Serial toparía en ~1/latencia.
    await runJobBatch(jobs, config.SEND_MAX_CONCURRENT, (data) => processFollowupJob(data));
  };
}

async function processFollowupJob(payload: FollowupJobPayload): Promise<void> {
  const { patientId, phone } = payload;
  const now = new Date();
  const guard = followupGuardConditions(now);

  // 1) GUARD idempotente (capa 2), SIN transacción larga: re-leer que sigue
  // siendo candidato. Si no, skip — evita spam al recién enrolado y evita
  // re-mutar en un reintento que ya aplicó el efecto.
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, ...guard },
    select: {
      id: true,
      fullName: true,
      noProgramReminderCount: true,
      createdAt: true,
    },
  });

  if (!patient) {
    logger.info('followup skip — ya no es candidato (enrolado / opt-out / max / <7d)', {
      event: 'queue',
      action: 'followup_skip',
      patientId: maskId(patientId),
    });
    return;
  }

  const daysSinceRegister = Math.floor(
    (now.getTime() - patient.createdAt.getTime()) / (24 * 60 * 60 * 1000)
  );
  const attempt = patient.noProgramReminderCount + 1;
  const message = buildFollowupMessage(patient.fullName, attempt, daysSinceRegister);

  // Modo sombra: NO envía ni muta. Solo loguea para comparar conteos contra el
  // camino viejo sin doble envío.
  if (config.QUEUE_SHADOW) {
    logger.info('followup SHADOW — habría enviado', {
      event: 'queue',
      action: 'followup_shadow',
      patientId: maskId(patientId),
      phone: maskPhone(phone),
      attempt,
    });
    return;
  }

  // 2) ENVÍO FUERA de transacción (la llamada de red NO debe tener un lock abierto).
  const ok = await limiter.schedule(() => sendTextMessage(phone, message));
  if (!ok) {
    // Retriable: pg-boss reintenta. NO mutamos (el guard re-leerá igual).
    throw new Error('send_failed');
  }

  // 3) UPDATE con where CONDICIONAL: reincluye el guard para mantener atomicidad
  // sin la red adentro. Usamos `updateMany` (no `update`) A PROPÓSITO: con campos
  // NO únicos en el where (consent / programs / OR), `update` lanzaría P2025 si 0
  // filas matchean (otro proceso enroló/dio de baja entre el envío y el update),
  // lo que haría throw → pg-boss reintenta → reenvío. `updateMany` simplemente
  // afecta 0 filas en ese caso, sin error.
  await prisma.patient.updateMany({
    where: { id: patient.id, ...guard },
    data: {
      lastNoProgramReminderAt: now,
      noProgramReminderCount: { increment: 1 },
    },
  });
}
