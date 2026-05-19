import { prisma, Role } from '@ips/db';

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
      return 'Lamentamos que no hayas podido asistir. Si necesitás reprogramar tu control, comuníquese al 0800-888-0109.';
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
