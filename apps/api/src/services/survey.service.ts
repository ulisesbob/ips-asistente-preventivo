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
  // Find pending (uncompleted) survey for this patient
  const pending = await prisma.survey.findFirst({
    where: {
      patientId,
      completedAt: null,
    },
    orderBy: { sentAt: 'desc' },
    select: {
      id: true,
      attended: true,
    },
  });

  if (!pending) return null; // no pending survey

  const textLower = text.trim().toLowerCase();

  // Step 1: attended? (Sí/No)
  if (pending.attended === null) {
    if (textLower === 'si' || textLower === 'sí' || textLower === '1') {
      await prisma.survey.update({
        where: { id: pending.id },
        data: { attended: true },
      });
      return '¡Bien! ¿Cómo calificarías la atención? Respondé con un número del 1 al 5 (1=Mala, 5=Excelente).';
    } else if (textLower === 'no' || textLower === '2') {
      await prisma.survey.update({
        where: { id: pending.id },
        data: { attended: false, completedAt: new Date() },
      });
      return 'Lamentamos que no hayas podido asistir. Si necesitás reprogramar tu control, comuníquese al 0800-888-0109.';
    }
    // Didn't match yes/no — not a survey response
    return null;
  }

  // Step 2: rating (1-5)
  if (pending.attended === true) {
    const rating = parseInt(textLower);
    if (rating >= 1 && rating <= 5) {
      await prisma.survey.update({
        where: { id: pending.id },
        data: { rating, completedAt: new Date() },
      });
      return rating >= 4
        ? '¡Gracias por tu respuesta! Nos alegra que hayas tenido una buena experiencia.'
        : 'Gracias por tu respuesta. Vamos a trabajar para mejorar la atención.';
    }
    // Didn't match 1-5 — not a survey response
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
    prisma.survey.count({ where: { ...programFilter, attended: true } }),
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
