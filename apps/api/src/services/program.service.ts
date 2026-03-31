import { prisma, Role, PatientProgramStatus, Prisma } from '@ips/db';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../utils/errors';
import { scheduleSurvey } from './survey.service';

// ─── Helpers — Prisma error handling ────────────────────────────────────────

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProgramUpdateInput {
  description?: string;
  reminderFrequencyDays?: number;
  templateMessage?: string;
  centers?: Array<{ city: string; name: string; address: string }>;
}

export interface EnrollInput {
  programId: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getDoctorProgramIds(doctorId: string): Promise<string[]> {
  const doctorPrograms = await prisma.doctorProgram.findMany({
    where: { doctorId },
    select: { programId: true },
  });
  return doctorPrograms.map((dp) => dp.programId);
}

async function verifyPatientProgramAccess(
  patientProgramId: string,
  doctorId: string,
  role: Role
) {
  const pp = await prisma.patientProgram.findUnique({
    where: { id: patientProgramId },
    select: { id: true, programId: true, patientId: true, status: true },
  });

  if (!pp) {
    throw new NotFoundError('Inscripción no encontrada');
  }

  if (role === Role.DOCTOR) {
    const doctorProgramIds = await getDoctorProgramIds(doctorId);
    if (!doctorProgramIds.includes(pp.programId)) {
      throw new NotFoundError('Inscripción no encontrada');
    }
  }

  return pp;
}

// ─── GET /programs ──────────────────────────────────────────────────────────

export async function listPrograms(doctorId: string, role: Role) {
  const where: Prisma.ProgramWhereInput =
    role === Role.DOCTOR
      ? { doctorPrograms: { some: { doctorId } } }
      : {};

  const programs = await prisma.program.findMany({
    where,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      reminderFrequencyDays: true,
      templateMessage: true,
      centers: true,
      _count: {
        select: {
          patientPrograms: {
            where: { status: PatientProgramStatus.ACTIVE },
          },
        },
      },
    },
  });

  return programs.map((p) => ({
    ...p,
    activePatients: p._count.patientPrograms,
    _count: undefined,
  }));
}

// ─── GET /programs/:id ──────────────────────────────────────────────────────

export async function getProgramById(
  programId: string,
  doctorId: string,
  role: Role
) {
  // DOCTOR: verify they're assigned to this program
  if (role === Role.DOCTOR) {
    const doctorProgramIds = await getDoctorProgramIds(doctorId);
    if (!doctorProgramIds.includes(programId)) {
      throw new NotFoundError('Programa no encontrado');
    }
  }

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      patientPrograms: {
        orderBy: { enrolledAt: 'desc' },
        take: 50,
        select: {
          id: true,
          enrolledAt: true,
          lastControlDate: true,
          nextReminderDate: true,
          status: true,
          patient: {
            select: {
              id: true,
              fullName: true,
              dni: true,
              phone: true,
              consent: true,
            },
          },
          enrolledByDoctor: {
            select: { id: true, fullName: true },
          },
        },
      },
    },
  });

  if (!program) {
    throw new NotFoundError('Programa no encontrado');
  }

  return program;
}

// ─── PATCH /programs/:id ────────────────────────────────────────────────────

export async function updateProgram(programId: string, input: ProgramUpdateInput) {
  const exists = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true },
  });

  if (!exists) {
    throw new NotFoundError('Programa no encontrado');
  }

  const updated = await prisma.program.update({
    where: { id: programId },
    data: {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.reminderFrequencyDays !== undefined
        ? { reminderFrequencyDays: input.reminderFrequencyDays }
        : {}),
      ...(input.templateMessage !== undefined
        ? { templateMessage: input.templateMessage }
        : {}),
      ...(input.centers !== undefined ? { centers: input.centers } : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      reminderFrequencyDays: true,
      templateMessage: true,
      centers: true,
    },
  });

  return updated;
}

// ─── POST /patients/:patientId/programs — Inscribir ─────────────────────────

export async function enrollPatient(
  patientId: string,
  programId: string,
  enrolledByDoctorId: string,
  role: Role
) {
  // Verify patient exists
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true },
  });
  if (!patient) {
    throw new NotFoundError('Paciente no encontrado');
  }

  // Verify program exists and get frequency
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true, reminderFrequencyDays: true },
  });
  if (!program) {
    throw new NotFoundError('Programa no encontrado');
  }

  // DOCTOR: verify they're assigned to this program
  if (role === Role.DOCTOR) {
    const doctorProgramIds = await getDoctorProgramIds(enrolledByDoctorId);
    if (!doctorProgramIds.includes(programId)) {
      throw new ForbiddenError('No tiene permisos para inscribir en este programa');
    }
  }

  // Calculate nextReminderDate = today + frequency (UTC to avoid timezone drift)
  const now = new Date();
  const nextReminderDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  nextReminderDate.setUTCDate(nextReminderDate.getUTCDate() + program.reminderFrequencyDays);

  try {
    const enrollment = await prisma.patientProgram.create({
      data: {
        patientId,
        programId,
        enrolledByDoctorId,
        nextReminderDate,
      },
      include: {
        program: { select: { id: true, name: true } },
        patient: { select: { id: true, fullName: true, dni: true } },
      },
    });

    return enrollment;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new ConflictError('El paciente ya está inscripto en este programa');
    }
    throw err;
  }
}

// ─── POST /patient-programs/:id/control — Marcar control realizado ──────────

export async function markControl(
  patientProgramId: string,
  doctorId: string,
  role: Role
) {
  const pp = await verifyPatientProgramAccess(patientProgramId, doctorId, role);

  if (pp.status !== PatientProgramStatus.ACTIVE) {
    throw new ConflictError('Solo se puede marcar control en inscripciones activas');
  }

  // Get program frequency to recalculate next reminder
  const program = await prisma.program.findUnique({
    where: { id: pp.programId },
    select: { reminderFrequencyDays: true },
  });

  if (!program) {
    throw new NotFoundError('Programa no encontrado');
  }

  // Use UTC to avoid timezone drift (Railway default is UTC, Argentina is UTC-3)
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const nextReminderDate = new Date(today);
  nextReminderDate.setUTCDate(nextReminderDate.getUTCDate() + program.reminderFrequencyDays);

  const updated = await prisma.patientProgram.update({
    where: { id: patientProgramId },
    data: {
      lastControlDate: today,
      nextReminderDate,
    },
    include: {
      program: { select: { id: true, name: true } },
      patient: { select: { id: true, fullName: true } },
    },
  });

  // Schedule satisfaction survey (sent 24hs later by cron)
  await scheduleSurvey(patientProgramId, pp.patientId).catch((err) => {
    console.error('[Survey] Error scheduling survey:', err);
    // Don't fail the control marking if survey scheduling fails
  });

  return updated;
}

// ─── PATCH /patient-programs/:id/next-control — Editar fecha próximo control ─

const MAX_NEXT_CONTROL_YEARS = 2;

export async function updateNextControl(
  patientProgramId: string,
  nextControlDate: string,
  doctorId: string,
  role: Role
) {
  const pp = await verifyPatientProgramAccess(patientProgramId, doctorId, role);

  if (pp.status !== PatientProgramStatus.ACTIVE) {
    throw new ConflictError('Solo se puede cambiar la fecha en inscripciones activas');
  }

  // Parse and validate date — use UTC (LESSONS #11)
  const parsed = new Date(nextControlDate);
  if (isNaN(parsed.getTime())) {
    throw new ValidationError('Fecha inválida');
  }

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dateUTC = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));

  if (dateUTC <= todayUTC) {
    throw new ValidationError('La fecha debe ser futura');
  }

  const maxDate = new Date(todayUTC);
  maxDate.setUTCFullYear(maxDate.getUTCFullYear() + MAX_NEXT_CONTROL_YEARS);

  if (dateUTC > maxDate) {
    throw new ValidationError(`La fecha no puede superar ${MAX_NEXT_CONTROL_YEARS} años en el futuro`);
  }

  const updated = await prisma.patientProgram.update({
    where: { id: patientProgramId },
    data: { nextReminderDate: dateUTC },
    include: {
      program: { select: { id: true, name: true } },
      patient: { select: { id: true, fullName: true } },
    },
  });

  return updated;
}

// ─── PATCH /patient-programs/:id — Cambiar status ───────────────────────────

export async function updatePatientProgramStatus(
  patientProgramId: string,
  status: PatientProgramStatus,
  doctorId: string,
  role: Role
) {
  const pp = await verifyPatientProgramAccess(patientProgramId, doctorId, role);

  // When reactivating (PAUSED/COMPLETED → ACTIVE), recalculate nextReminderDate
  // to avoid firing an overdue reminder immediately
  let extraData = {};
  if (status === PatientProgramStatus.ACTIVE && pp.status !== PatientProgramStatus.ACTIVE) {
    const program = await prisma.program.findUnique({
      where: { id: pp.programId },
      select: { reminderFrequencyDays: true },
    });
    if (program) {
      const now = new Date();
      const nextReminderDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      nextReminderDate.setUTCDate(nextReminderDate.getUTCDate() + program.reminderFrequencyDays);
      extraData = { nextReminderDate };
    }
  }

  const updated = await prisma.patientProgram.update({
    where: { id: patientProgramId },
    data: { status, ...extraData },
    include: {
      program: { select: { id: true, name: true } },
      patient: { select: { id: true, fullName: true } },
    },
  });

  return updated;
}

// ─── DELETE /patient-programs/:id — Dar de baja ─────────────────────────────

export async function removePatientFromProgram(
  patientProgramId: string,
  doctorId: string,
  role: Role
) {
  await verifyPatientProgramAccess(patientProgramId, doctorId, role);

  await prisma.patientProgram.delete({
    where: { id: patientProgramId },
  });
}
