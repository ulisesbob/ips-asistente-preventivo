import { prisma, Role, PatientProgramStatus, ReminderStatus, RegisteredVia, Prisma } from '@ips/db';
import { MAX_FOLLOWUPS, GRACE_PERIOD_DAYS } from './patient-followup.service';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AlertPatient {
  id: string;
  fullName: string;
  dni: string;
  programName: string;
  daysOverdue?: number;
  missedReminders?: number;
}

export interface NoProgramPatient {
  id: string;
  fullName: string;
  dni: string;
  daysSinceRegister: number;
  reminderCount: number;
}

export interface DashboardAlerts {
  overdueWarning: AlertPatient[];   // >30 days, <=60 days
  overdueCritical: AlertPatient[];  // >60 days
  noResponse: AlertPatient[];       // 3+ reminders without reply
  optedOut: AlertPatient[];         // consent = false
  // Followup alerts (pacientes que se registraron pero ningún médico los inscribió):
  noProgramRecent: NoProgramPatient[];     // registrados >7 días sin programa, todavía recibiendo recordatorios
  noProgramAbandoned: NoProgramPatient[];  // ya recibieron 3 recordatorios sin enrolar — requieren acción admin
}

export interface DashboardStats {
  totalPatients: number;
  activePrograms: number;
  remindersSentToday: number;
  remindersSentWeek: number;
  remindersSentMonth: number;
  responseRate: number;
  patientsByProgram: { programName: string; count: number }[];
}

// ─── Cache in-memory (finding #37) ────────────────────────────────────────────
//
// getStats y getAlerts corren ~7+ queries cada una y el panel las re-ejecuta en
// cada refresh. Con muchos médicos refrescando se generan cientos de queries/s.
// Cacheamos el resultado por clave durante un TTL corto para colapsar esa carga.
//
// LIMITACIONES (es solo optimización, no fuente de verdad):
//  - Cache POR INSTANCIA del proceso. Si la API corre en varias instancias detrás
//    de un load balancer, cada una mantiene su propia copia: puede haber hasta
//    `TTL` ms de inconsistencia entre instancias. Aceptable para un dashboard.
//  - Se pierde si el proceso reinicia. No pasa nada: el próximo request recalcula.
//  - No comparte datos entre médicos: la clave incluye role + doctorId, así que
//    cada médico ve únicamente lo suyo (un DOCTOR nunca lee la entrada de otro).

// TTL corto: 30s es suficiente para que un panel que se refresca seguido pegue
// al cache la enorme mayoría de las veces, pero los datos nunca quedan más de
// 30s desactualizados (overdue/alertas se mueven en escala de días, no segundos).
const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // epoch ms
}

// Un store por tipo de resultado para no mezclar shapes. Las claves se construyen
// con cacheKey() incluyendo TODOS los parámetros que cambian el resultado.
const statsCache = new Map<string, CacheEntry<DashboardStats>>();
const alertsCache = new Map<string, CacheEntry<DashboardAlerts>>();

// La clave incluye role + doctorId porque son los únicos params que alteran el
// resultado (programId/programFilter se derivan de doctorId vía doctorProgram).
// Para ADMIN el doctorId no afecta el resultado, pero incluirlo igual es seguro.
function cacheKey(doctorId: string, role: Role): string {
  return `${role}:${doctorId}`;
}

// Devuelve el valor cacheado si sigue vigente; si expiró lo elimina y devuelve null.
function cacheGet<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key); // limpieza perezosa al leer una entrada vencida
    return null;
  }
  return entry.value;
}

function cacheSet<T>(store: Map<string, CacheEntry<T>>, key: string, value: T): void {
  store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Invalidación manual: llamar tras una mutación que afecte el dashboard
// (inscribir/dar de baja pacientes, cambio de consentimiento, etc.).
// Sin argumentos limpia todo; con doctorId/role limpia solo esa entrada.
export function invalidateDashboardCache(doctorId?: string, role?: Role): void {
  if (doctorId !== undefined && role !== undefined) {
    const key = cacheKey(doctorId, role);
    statsCache.delete(key);
    alertsCache.delete(key);
    return;
  }
  statsCache.clear();
  alertsCache.clear();
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
  // Cache hit corto: evita re-correr ~7 queries en cada refresh del panel.
  const key = cacheKey(doctorId, role);
  const cached = cacheGet(statsCache, key);
  if (cached) return cached;

  const result = await computeStats(doctorId, role);
  cacheSet(statsCache, key, result);
  return result;
}

async function computeStats(doctorId: string, role: Role): Promise<DashboardStats> {
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

    // remindersSentToday — only count SENT, not FAILED
    prisma.reminder.count({
      where: { ...programFilter, status: ReminderStatus.SENT, sentAt: { gte: todayStart } },
    }),

    // remindersSentWeek
    prisma.reminder.count({
      where: { ...programFilter, status: ReminderStatus.SENT, sentAt: { gte: weekAgo } },
    }),

    // remindersSentMonth (also used for response rate denominator)
    prisma.reminder.count({
      where: { ...programFilter, status: ReminderStatus.SENT, sentAt: { gte: monthAgo } },
    }),

    // replied reminders last 30 days
    prisma.reminder.count({
      where: { ...programFilter, status: ReminderStatus.SENT, sentAt: { gte: monthAgo }, patientReplied: true },
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

// ─── Alerts ────────────────────────────────────────────────────────────────

const OVERDUE_WARNING_DAYS = 30;
const OVERDUE_CRITICAL_DAYS = 60;
const NO_RESPONSE_THRESHOLD = 3;

export async function getAlerts(doctorId: string, role: Role): Promise<DashboardAlerts> {
  // Cache hit corto: getAlerts corre varias queries pesadas (overdue split,
  // no-response groupBy, opted-out, followups). El panel la re-pega en cada refresh.
  const key = cacheKey(doctorId, role);
  const cached = cacheGet(alertsCache, key);
  if (cached) return cached;

  const result = await computeAlerts(doctorId, role);
  cacheSet(alertsCache, key, result);
  return result;
}

async function computeAlerts(doctorId: string, role: Role): Promise<DashboardAlerts> {
  const isAdmin = role === Role.ADMIN;

  // For DOCTOR, restrict to their programs
  let doctorProgramIds: string[] = [];
  if (!isAdmin) {
    const assignments = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    doctorProgramIds = assignments.map((a) => a.programId);
  }

  const ppProgramFilter: Prisma.PatientProgramWhereInput = isAdmin
    ? {}
    : { programId: { in: doctorProgramIds } };

  const reminderProgramFilter: Prisma.ReminderWhereInput = isAdmin
    ? {}
    : { programId: { in: doctorProgramIds } };

  const todayUTC = startOfTodayUTC();
  const warningDate = daysAgoUTC(OVERDUE_WARNING_DAYS);
  const criticalDate = daysAgoUTC(OVERDUE_CRITICAL_DAYS);

  // Fix #3: Split overdue into 2 separate queries so take limits don't mix categories
  const activePatientFilter = { consent: true, phone: { not: null as string | null } };

  const [overdueCriticalResults, overdueWarningResults, optedOutResults] = await Promise.all([
    // Critical: nextReminderDate > 60 days ago
    prisma.patientProgram.findMany({
      where: {
        ...ppProgramFilter,
        status: PatientProgramStatus.ACTIVE,
        nextReminderDate: { lt: criticalDate },
        patient: activePatientFilter,
      },
      take: 50, // LESSONS #13
      orderBy: { nextReminderDate: 'asc' },
      select: {
        id: true,
        nextReminderDate: true,
        patient: { select: { id: true, fullName: true, dni: true } },
        program: { select: { name: true } },
      },
    }),

    // Warning: nextReminderDate between 30 and 60 days ago
    prisma.patientProgram.findMany({
      where: {
        ...ppProgramFilter,
        status: PatientProgramStatus.ACTIVE,
        nextReminderDate: { gte: criticalDate, lt: warningDate },
        patient: activePatientFilter,
      },
      take: 50, // LESSONS #13
      orderBy: { nextReminderDate: 'asc' },
      select: {
        id: true,
        nextReminderDate: true,
        patient: { select: { id: true, fullName: true, dni: true } },
        program: { select: { name: true } },
      },
    }),

    // Fix #5: Opted out — only patients with ACTIVE program enrollments
    prisma.patient.findMany({
      where: {
        consent: false,
        programs: {
          some: {
            ...(isAdmin ? {} : { programId: { in: doctorProgramIds } }),
            status: PatientProgramStatus.ACTIVE,
          },
        },
      },
      take: 50, // LESSONS #13
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        dni: true,
        programs: {
          where: { ...ppProgramFilter, status: PatientProgramStatus.ACTIVE },
          take: 1,
          orderBy: { enrolledAt: 'desc' }, // Fix #8: deterministic program name
          select: { program: { select: { name: true } } },
        },
      },
    }),
  ]);

  // Map overdue results to AlertPatient
  function mapOverdue(results: typeof overdueCriticalResults): AlertPatient[] {
    return results.map((pp) => ({
      id: pp.patient.id,
      fullName: pp.patient.fullName,
      dni: pp.patient.dni,
      programName: pp.program.name,
      daysOverdue: Math.floor(
        (todayUTC.getTime() - new Date(pp.nextReminderDate).getTime()) / (1000 * 60 * 60 * 24)
      ),
    }));
  }

  const overdueCritical = mapOverdue(overdueCriticalResults);
  const overdueWarning = mapOverdue(overdueWarningResults);

  // Fix #4: No-response with 90-day time window to avoid stale alerts
  const noResponseWindow = daysAgoUTC(90);

  const noResponseGroups = await prisma.reminder.groupBy({
    by: ['patientId'],
    where: {
      ...reminderProgramFilter,
      status: ReminderStatus.SENT,
      patientReplied: false,
      sentAt: { gte: noResponseWindow },
    },
    _count: { id: true },
    having: {
      id: { _count: { gte: NO_RESPONSE_THRESHOLD } },
    },
    orderBy: { patientId: 'asc' },
    take: 50, // LESSONS #13
  });

  let noResponse: AlertPatient[] = [];
  if (noResponseGroups.length > 0) {
    const patientIds = noResponseGroups.map((g) => g.patientId);
    const patients = await prisma.patient.findMany({
      where: { id: { in: patientIds } },
      select: {
        id: true,
        fullName: true,
        dni: true,
        programs: {
          where: { ...ppProgramFilter, status: PatientProgramStatus.ACTIVE },
          take: 1,
          orderBy: { enrolledAt: 'desc' }, // Fix #8: deterministic program name
          select: { program: { select: { name: true } } },
        },
      },
    });

    const countMap = new Map(noResponseGroups.map((g) => [g.patientId, g._count.id]));

    noResponse = patients.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      dni: p.dni,
      programName: p.programs[0]?.program.name ?? '—',
      missedReminders: countMap.get(p.id) ?? NO_RESPONSE_THRESHOLD,
    }));
  }

  // Format opted out
  const optedOut: AlertPatient[] = optedOutResults.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    dni: p.dni,
    programName: p.programs[0]?.program.name ?? '—',
  }));

  // Followup alerts: pacientes registrados sin programa.
  // Solo visibles para ADMIN — los DOCTOR no necesitan ver estas (no son
  // pacientes de sus programas porque aún no tienen ninguno).
  let noProgramRecent: NoProgramPatient[] = [];
  let noProgramAbandoned: NoProgramPatient[] = [];

  if (isAdmin) {
    const graceCutoff = daysAgoUTC(GRACE_PERIOD_DAYS);
    const noProgramPatients = await prisma.patient.findMany({
      where: {
        registeredVia: RegisteredVia.BOT,
        whatsappLinked: true,
        consent: true,
        createdAt: { lt: graceCutoff },
        programs: { none: { status: PatientProgramStatus.ACTIVE } },
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fullName: true,
        dni: true,
        createdAt: true,
        noProgramReminderCount: true,
      },
    });

    const mapNoProgram = (p: typeof noProgramPatients[number]): NoProgramPatient => ({
      id: p.id,
      fullName: p.fullName,
      dni: p.dni,
      daysSinceRegister: Math.floor(
        (todayUTC.getTime() - p.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      ),
      reminderCount: p.noProgramReminderCount,
    });

    noProgramAbandoned = noProgramPatients
      .filter((p) => p.noProgramReminderCount >= MAX_FOLLOWUPS)
      .map(mapNoProgram);
    noProgramRecent = noProgramPatients
      .filter((p) => p.noProgramReminderCount < MAX_FOLLOWUPS)
      .map(mapNoProgram);
  }

  return {
    overdueWarning,
    overdueCritical,
    noResponse,
    optedOut,
    noProgramRecent,
    noProgramAbandoned,
  };
}
