import type PgBoss from 'pg-boss';
import { prisma, Role } from '@ips/db';
import { config } from '../config/env';
import { sendTextMessage } from './messaging.service';
import { toMetaSendablePhone } from '../utils/phone';
import { maskPhone, maskId, firstName } from '../utils/pii';
import { logger } from '../utils/logger';
import { getBoss } from '../queue/boss';
import { limiter } from '../queue/limiter';
import {
  QUEUE_NAMES,
  surveySingletonKey,
  type SurveyJobPayload,
} from '../queue/queues';

// ─── Pure parser (exported for testing) ──────────────────────────────────────

/**
 * Normalize patient input (strip accents + punctuation + case).
 */
export function normalizeSurveyInput(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim();
}

// Lista corta de afirmaciones inequívocas. "ok"/"claro"/"listo" se removieron
// porque pueden ser ACK casual sin asistencia real (code-review feedback).
export const SURVEY_YES_WORDS = ['si', 'sip', 'sii', 'siii', 'dale', 'obvio', 'yes', '1'];
export const SURVEY_NO_WORDS = ['no', 'nop', 'nope', 'tampoco', '2'];

export type ParsedSurveyAnswer =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'rating'; value: number }
  | { kind: 'unknown' };

/**
 * Parse the patient's text given the current survey step.
 * - `awaitingAttended`: expecting yes/no
 * - `awaitingRating`: expecting 1-5
 *
 * Pure function — no DB, easy to unit test.
 */
export function parseSurveyAnswer(
  text: string,
  step: 'awaitingAttended' | 'awaitingRating'
): ParsedSurveyAnswer {
  const norm = normalizeSurveyInput(text);

  if (step === 'awaitingAttended') {
    if (SURVEY_YES_WORDS.includes(norm)) return { kind: 'yes' };
    if (SURVEY_NO_WORDS.includes(norm)) return { kind: 'no' };
    return { kind: 'unknown' };
  }

  // awaitingRating — require exact single digit so "3 de mayo" / "necesito 5"
  // don't get parsed as ratings.
  if (/^[1-5]$/.test(norm)) {
    return { kind: 'rating', value: parseInt(norm, 10) };
  }
  return { kind: 'unknown' };
}

// ─── Schedule survey after control ──────────────────────────────────────────

/**
 * @internal Called from program.service.ts after markControl.
 * Creates a survey record. The cron job will send the WA message 24hs later.
 */
export async function scheduleSurvey(
  patientProgramId: string,
  patientId: string
): Promise<void> {
  // Don't create duplicate survey for the same control marking
  const existing = await prisma.survey.findFirst({
    where: {
      patientProgramId,
      completedAt: null,
    },
  });

  if (existing) return; // already pending

  await prisma.survey.create({
    data: {
      patientProgramId,
      patientId,
    },
  });
}

// ─── Process survey response from bot ───────────────────────────────────────

export async function processSurveyResponse(
  patientId: string,
  text: string
): Promise<string | null> {
  // Find pending (uncompleted) survey that was ALREADY sent to the patient
  const pending = await prisma.survey.findFirst({
    where: {
      patientId,
      completedAt: null,
      dispatchedAt: { not: null }, // Only intercept if WA message was actually sent
    },
    orderBy: { dispatchedAt: 'desc' },
    select: {
      id: true,
      attended: true,
    },
  });

  if (!pending) return null; // no pending survey

  // Step 1: attended? (Sí/No)
  if (pending.attended === null) {
    const parsed = parseSurveyAnswer(text, 'awaitingAttended');
    if (parsed.kind === 'yes') {
      await prisma.survey.update({
        where: { id: pending.id },
        data: { attended: true },
      });
      return '¡Bien! ¿Cómo calificarías la atención? Respondé con un número del 1 al 5 (1=Mala, 5=Excelente).';
    }
    if (parsed.kind === 'no') {
      await prisma.survey.update({
        where: { id: pending.id },
        data: { attended: false, completedAt: new Date() },
      });
      return `Lamentamos que no hayas podido asistir. Si necesitás reprogramar tu control, comuníquese al ${config.IPS_SUPPORT_PHONE}.`;
    }
    return null; // not a survey response
  }

  // Step 2: rating (1-5)
  if (pending.attended === true) {
    const parsed = parseSurveyAnswer(text, 'awaitingRating');
    if (parsed.kind === 'rating') {
      await prisma.survey.update({
        where: { id: pending.id },
        data: { rating: parsed.value, completedAt: new Date() },
      });
      return parsed.value >= 4
        ? '¡Gracias por tu respuesta! Nos alegra que hayas tenido una buena experiencia.'
        : 'Gracias por tu respuesta. Vamos a trabajar para mejorar la atención.';
    }
    return null;
  }

  return null;
}

// ─── Dashboard stats ────────────────────────────────────────────────────────

export interface SurveyStats {
  totalSent: number;
  totalCompleted: number;
  attendanceRate: number;
  averageRating: number;
  ratingDistribution: { rating: number; count: number }[];
}

export async function getSurveyStats(
  doctorId: string,
  role: Role
): Promise<SurveyStats> {
  const isAdmin = role === Role.ADMIN;

  let doctorProgramIds: string[] = [];
  if (!isAdmin) {
    const assignments = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    doctorProgramIds = assignments.map((a) => a.programId);
  }

  const programFilter = isAdmin
    ? {}
    : { patientProgram: { programId: { in: doctorProgramIds } } };

  const [totalSent, totalCompleted, attended, ratings] = await Promise.all([
    prisma.survey.count({ where: programFilter }),
    prisma.survey.count({ where: { ...programFilter, completedAt: { not: null } } }),
    prisma.survey.count({ where: { ...programFilter, attended: true, completedAt: { not: null } } }),
    prisma.survey.groupBy({
      by: ['rating'],
      where: { ...programFilter, rating: { not: null } },
      _count: { id: true },
      orderBy: { rating: 'asc' },
    }),
  ]);

  const completedWithAttendance = totalCompleted;
  const attendanceRate = completedWithAttendance > 0
    ? Math.round((attended / completedWithAttendance) * 100)
    : 0;

  const totalRatings = ratings.reduce((sum, r) => sum + r._count.id, 0);
  const weightedSum = ratings.reduce((sum, r) => sum + (r.rating ?? 0) * r._count.id, 0);
  const averageRating = totalRatings > 0
    ? Math.round((weightedSum / totalRatings) * 10) / 10
    : 0;

  return {
    totalSent,
    totalCompleted,
    attendanceRate,
    averageRating,
    ratingDistribution: ratings.map((r) => ({
      rating: r.rating ?? 0,
      count: r._count.id,
    })),
  };
}

// ─── CRON dispatch: encuestas pendientes (control marcado >24h sin enviar) ─────
//
// Vive acá (no en survey-cron.ts) para que el camino viejo (processPendingSurveys)
// y el nuevo por cola (enqueueSurveys + makeSurveyHandler) compartan el MISMO
// `where` de candidatos — la cola procesa EXACTAMENTE la misma población que el
// cron viejo, sin el corte silencioso del `take`. Mismo patrón que followup.

const SURVEY_CUTOFF_MS = 24 * 60 * 60 * 1000; // 24h
const SURVEY_MAX_PER_RUN = 100; // tope del camino viejo (LESSONS #13)
const SURVEY_RATE_LIMIT_MS = 100;
// Tamaño de lote de la paginación del productor. No es un tope: itera hasta agotar.
const SURVEY_ENQUEUE_BATCH_SIZE = 200;

/**
 * `where` de encuestas a despachar HOY. Compartido entre el camino viejo (con
 * `take`) y el productor de la cola (paginado sin tope).
 */
function surveyCandidateWhere(now: Date) {
  const cutoff = new Date(now.getTime() - SURVEY_CUTOFF_MS);
  return {
    createdAt: { lt: cutoff },
    dispatchedAt: null,
    completedAt: null,
    patient: {
      consent: true,
      phone: { not: null },
    },
  };
}

/** Texto de la encuesta inicial. Puro (exportado para tests). */
export function buildSurveyMessage(name: string, programName: string): string {
  const greetName = firstName(name);
  return (
    `Hola ${greetName}! Queremos saber cómo te fue con tu control de *${programName}*.\n\n` +
    `¿Pudiste realizar tu control?\n` +
    `Respondé *Sí* o *No*`
  );
}

/**
 * Camino VIEJO (in-process, con tope): encuentra y despacha encuestas pendientes.
 * Intacto desde survey-cron.ts — sigue siendo el default de producción mientras
 * QUEUE_SURVEY esté en false.
 */
export async function processPendingSurveys(): Promise<{ sent: number; failed: number }> {
  const pendingSurveys = await prisma.survey.findMany({
    where: surveyCandidateWhere(new Date()),
    take: SURVEY_MAX_PER_RUN,
    select: {
      id: true,
      patient: { select: { fullName: true, phone: true } },
      patientProgram: { select: { program: { select: { name: true } } } },
    },
  });

  if (pendingSurveys.length === 0) {
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const survey of pendingSurveys) {
    if (!survey.patient.phone) continue;
    const sendPhone = toMetaSendablePhone(survey.patient.phone);
    const message = buildSurveyMessage(
      survey.patient.fullName,
      survey.patientProgram.program.name
    );

    try {
      await sendTextMessage(sendPhone, message);
      await prisma.survey.update({
        where: { id: survey.id },
        data: { dispatchedAt: new Date() },
      });
      sent++;
    } catch (err) {
      console.error(`[SurveyCron] Error sending to ${maskPhone(sendPhone)}:`, err);
      failed++;
    }

    await new Promise((resolve) => setTimeout(resolve, SURVEY_RATE_LIMIT_MS));
  }

  return { sent, failed };
}

// ─── Bloque B (T10): camino por cola pg-boss (detrás de QUEUE_SURVEY) ──────────
//
// PRODUCTOR: enqueueSurveys encola 1 job por encuesta (sin tope, paginando) y NO
// envía. CONSUMIDOR: makeSurveyHandler envía vía limiter + sendTextMessage y marca
// dispatchedAt de forma idempotente. Idempotencia en 2 capas:
//   1) singletonKey (survey:{surveyId}, SIN fecha: la encuesta se manda una sola
//      vez) → no se encola dos veces. Requiere policy 'short' en la cola.
//   2) guard en el handler (re-lee dispatchedAt null + completedAt null + consent)
//      + update con where CONDICIONAL que reincluye ese guard → un reintento no
//      re-despacha. El envío va FUERA de transacción.

/**
 * Productor: encola un job por CADA encuesta pendiente hoy, sin el tope `take`
 * del camino viejo. Pagina por cursor para acotar la memoria. NO envía nada.
 */
export async function enqueueSurveys(
  boss: PgBoss = getBoss()
): Promise<{ enqueued: number }> {
  const where = surveyCandidateWhere(new Date());

  let enqueued = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.survey.findMany({
      where,
      take: SURVEY_ENQUEUE_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        patientId: true,
        patient: { select: { phone: true } },
      },
    });

    if (batch.length === 0) break;

    for (const s of batch) {
      if (!s.patient.phone) continue;
      const payload: SurveyJobPayload = {
        surveyId: s.id,
        patientId: s.patientId,
        phone: toMetaSendablePhone(s.patient.phone),
      };
      const id = await boss.send(QUEUE_NAMES.survey, payload, {
        singletonKey: surveySingletonKey(s.id),
        retryLimit: 5,
        retryBackoff: true,
      });
      if (id) enqueued++;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < SURVEY_ENQUEUE_BATCH_SIZE) break;
  }

  logger.info('surveys encolados', {
    event: 'queue',
    action: 'enqueue_surveys',
    enqueued,
  });

  return { enqueued };
}

/** Forma mínima de un job que necesita el handler (compatible con PgBoss.Job). */
type JobLike<T> = { id: string; data: T };

/**
 * Consumidor: construye el handler del worker `reminders:survey`. Patrón C2 de
 * followup (leer guard, enviar FUERA de tx, update condicional).
 */
export function makeSurveyHandler(): (
  jobs: JobLike<SurveyJobPayload>[]
) => Promise<void> {
  return async (jobs: JobLike<SurveyJobPayload>[]): Promise<void> => {
    for (const job of jobs) {
      await processSurveyJob(job.data);
    }
  };
}

async function processSurveyJob(payload: SurveyJobPayload): Promise<void> {
  const { surveyId, phone } = payload;

  // 1) GUARD idempotente (capa 2): re-lee que la encuesta sigue sin despachar ni
  // completar y el paciente con consent. Si no → skip (no envía ni muta).
  const survey = await prisma.survey.findFirst({
    where: {
      id: surveyId,
      dispatchedAt: null,
      completedAt: null,
      patient: { consent: true },
    },
    select: {
      id: true,
      patient: { select: { fullName: true } },
      patientProgram: { select: { program: { select: { name: true } } } },
    },
  });

  if (!survey) {
    logger.info('survey skip — ya despachada / completada / sin consent', {
      event: 'queue',
      action: 'survey_skip',
      surveyId: maskId(surveyId),
    });
    return;
  }

  const message = buildSurveyMessage(
    survey.patient.fullName,
    survey.patientProgram.program.name
  );

  if (config.QUEUE_SHADOW) {
    logger.info('survey SHADOW — habría enviado', {
      event: 'queue',
      action: 'survey_shadow',
      surveyId: maskId(surveyId),
      phone: maskPhone(phone),
    });
    return;
  }

  // 2) ENVÍO FUERA de transacción.
  const ok = await limiter.schedule(() => sendTextMessage(phone, message));
  if (!ok) {
    throw new Error('send_failed');
  }

  // 3) UPDATE con where CONDICIONAL (reincluye el guard COMPLETO, incl. consent —
  // paridad estricta con followup): si otro proceso despachó/completó o el paciente
  // dio de baja entre el envío y el update, afecta 0 filas (sin error).
  await prisma.survey.updateMany({
    where: {
      id: survey.id,
      dispatchedAt: null,
      completedAt: null,
      patient: { consent: true },
    },
    data: { dispatchedAt: new Date() },
  });
}
