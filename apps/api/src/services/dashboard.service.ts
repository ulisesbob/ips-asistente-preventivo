import { prisma, Role, PatientProgramStatus } from '@ips/db';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalPatients: number;
  activePrograms: number;
  remindersSentToday: number;
  remindersSentWeek: number;
  remindersSentMonth: number;
  responseRate: number;
  patientsByProgram: { programName: string; count: number }[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysAgoUTC(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function getStats(doctorId: string, role: Role): Promise<DashboardStats> {
  const isAdmin = role === Role.ADMIN;

  // For DOCTOR role, get their assigned program IDs
  let doctorProgramIds: string[] = [];
  if (!isAdmin) {
    const assignments = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    doctorProgramIds = assignments.map((a) => a.programId);
  }

  // Build a reusable program filter
  const programFilter = isAdmin ? {} : { programId: { in: doctorProgramIds } };

  const todayStart = startOfTodayUTC();
  const weekAgo = daysAgoUTC(7);
  const monthAgo = daysAgoUTC(30);

  // Run all queries in parallel
  const [
    totalPatients,
    activePrograms,
    remindersSentToday,
    remindersSentWeek,
    remindersSentMonth,
    repliedMonth,
    patientsByProgram,
  ] = await Promise.all([
    // totalPatients
    isAdmin
      ? prisma.patient.count()
      : prisma.patient.count({
          where: {
            programs: {
              some: { ...programFilter, status: PatientProgramStatus.ACTIVE },
            },
          },
        }),

    // activePrograms
    prisma.patientProgram.count({
      where: { ...programFilter, status: PatientProgramStatus.ACTIVE },
    }),

    // remindersSentToday
    prisma.reminder.count({
      where: { ...programFilter, sentAt: { gte: todayStart } },
    }),

    // remindersSentWeek
    prisma.reminder.count({
      where: { ...programFilter, sentAt: { gte: weekAgo } },
    }),

    // remindersSentMonth (also used for response rate denominator)
    prisma.reminder.count({
      where: { ...programFilter, sentAt: { gte: monthAgo } },
    }),

    // replied reminders last 30 days
    prisma.reminder.count({
      where: { ...programFilter, sentAt: { gte: monthAgo }, patientReplied: true },
    }),

    // patientsByProgram (limit per LESSONS.md #13)
    prisma.patientProgram.groupBy({
      by: ['programId'],
      where: { ...programFilter, status: PatientProgramStatus.ACTIVE },
      _count: { id: true },
      orderBy: { programId: 'asc' },
      take: 20,
    }),
  ]);

  // Resolve program names
  const programIds = patientsByProgram.map((g) => g.programId);
  const programs =
    programIds.length > 0
      ? await prisma.program.findMany({
          where: { id: { in: programIds } },
          select: { id: true, name: true },
        })
      : [];

  const programNameMap = new Map(programs.map((p) => [p.id, p.name]));

  const responseRate = remindersSentMonth > 0 ? Math.round((repliedMonth / remindersSentMonth) * 10000) / 100 : 0;

  return {
    totalPatients,
    activePrograms,
    remindersSentToday,
    remindersSentWeek,
    remindersSentMonth,
    responseRate,
    patientsByProgram: patientsByProgram.map((g) => ({
      programName: programNameMap.get(g.programId) ?? 'Desconocido',
      count: g._count.id,
    })),
  };
}
