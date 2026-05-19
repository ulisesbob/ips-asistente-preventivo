import { prisma, Role } from '@ips/db';

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

  // Normalize: lowercase + strip accents + strip punctuation/whitespace.
  // Audit #20: previously only "si"/"sí"/"1"/"no"/"2" matched — patients
  // saying "sip", "dale", "obvio", "nop" got dropped to AI flow and the survey
  // never completed, inflating "no respondió" metrics.
  const textNorm = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim();

  // Lista corta de afirmaciones inequívocas. "ok"/"claro"/"listo" se removieron
  // porque pueden ser ACK casual sin asistencia real (code-review feedback).
  const YES_WORDS = ['si', 'sip', 'sii', 'siii', 'dale', 'obvio', 'yes', '1'];
  const NO_WORDS = ['no', 'nop', 'nope', 'tampoco', '2'];

  // Step 1: attended? (Sí/No)
  if (pending.attended === null) {
    if (YES_WORDS.includes(textNorm)) {
      await prisma.survey.update({
        where: { id: pending.id },
        data: { attended: true },
      });
      return '¡Bien! ¿Cómo calificarías la atención? Respondé con un número del 1 al 5 (1=Mala, 5=Excelente).';
    }
    if (NO_WORDS.includes(textNorm)) {
      await prisma.survey.update({
        where: { id: pending.id },
        data: { attended: false, completedAt: new Date() },
      });
      return 'Lamentamos que no hayas podido asistir. Si necesitás reprogramar tu control, comuníquese al 0800-888-0109.';
    }
    return null; // not a survey response
  }

  // Step 2: rating (1-5). Require EXACT single digit so messages like
  // "3 de mayo" or "necesito turno para el 5" don't get parsed as ratings
  // (audit #20).
  if (pending.attended === true) {
    if (/^[1-5]$/.test(textNorm)) {
      const rating = parseInt(textNorm, 10);
      await prisma.survey.update({
        where: { id: pending.id },
        data: { rating, completedAt: new Date() },
      });
      return rating >= 4
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
