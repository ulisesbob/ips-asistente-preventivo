import { prisma, Role, Prisma } from '@ips/db';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_CONTENT_LENGTH = 500;
const CSV_INJECTION_REGEX = /^[=+\-@\t\r]/;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateNoteInput {
  content: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getDoctorProgramIds(doctorId: string): Promise<string[]> {
  const doctorPrograms = await prisma.doctorProgram.findMany({
    where: { doctorId },
    select: { programId: true },
  });
  return doctorPrograms.map((dp) => dp.programId);
}

async function verifyPatientAccess(
  patientId: string,
  doctorId: string,
  role: Role
): Promise<void> {
  if (role === Role.ADMIN) {
    // ADMIN: verify patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundError('Paciente no encontrado');
    }
    return;
  }

  // DOCTOR can only access patients in their assigned programs
  const doctorProgramIds = await getDoctorProgramIds(doctorId);

  const enrollment = await prisma.patientProgram.findFirst({
    where: {
      patientId,
      programId: { in: doctorProgramIds },
    },
  });

  if (!enrollment) {
    throw new NotFoundError('Paciente no encontrado');
  }
}

// ─── CREATE NOTE ────────────────────────────────────────────────────────────

export async function createNote(
  patientId: string,
  doctorId: string,
  role: Role,
  input: CreateNoteInput
) {
  // Check access (also validates patient exists for DOCTOR via enrollment check)
  // For ADMIN, we verify patient exists inside the transaction below via FK constraint
  await verifyPatientAccess(patientId, doctorId, role);

  // Validate content
  const content = input.content.trim();

  if (content.length === 0) {
    throw new ValidationError('El contenido de la nota es requerido');
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw new ValidationError(`La nota no puede superar ${MAX_CONTENT_LENGTH} caracteres`);
  }

  // Sanitize CSV injection (LESSONS #30)
  if (CSV_INJECTION_REGEX.test(content)) {
    throw new ValidationError(
      'La nota no puede comenzar con caracteres especiales (=, +, -, @)'
    );
  }

  try {
    const note = await prisma.patientNote.create({
      data: {
        patientId,
        doctorId,
        content,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        doctor: {
          select: { id: true, fullName: true },
        },
      },
    });

    return note;
  } catch (err) {
    // FK constraint violation → patient was deleted between access check and insert
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new NotFoundError('Paciente no encontrado');
    }
    throw err;
  }
}

// ─── LIST NOTES ─────────────────────────────────────────────────────────────

export async function listNotes(
  patientId: string,
  doctorId: string,
  role: Role,
  page: number,
  limit: number
) {
  // Verify patient exists
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true },
  });

  if (!patient) {
    throw new NotFoundError('Paciente no encontrado');
  }

  // Check access
  await verifyPatientAccess(patientId, doctorId, role);

  const [notes, total] = await Promise.all([
    prisma.patientNote.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        content: true,
        createdAt: true,
        doctor: {
          select: { id: true, fullName: true },
        },
      },
    }),
    prisma.patientNote.count({ where: { patientId } }),
  ]);

  return {
    notes,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

// ─── GET LATEST NOTES FOR BOT CONTEXT ───────────────────────────────────────

/**
 * @internal Bot context only — no access control.
 * Only call from conversation.service.ts for building AI system prompts.
 * Do NOT expose via API routes without adding authorization.
 */
export async function getLatestNotesForBot(patientId: string, take = 3) {
  return prisma.patientNote.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      content: true,
      createdAt: true,
      doctor: {
        select: { fullName: true },
      },
    },
  });
}
