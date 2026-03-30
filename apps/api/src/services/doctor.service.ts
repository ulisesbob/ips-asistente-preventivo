import bcrypt from 'bcrypt';
import { prisma, Role, Prisma } from '@ips/db';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DoctorCreateInput {
  fullName: string;
  email: string;
  password: string;
  role?: Role;
}

export interface DoctorUpdateInput {
  fullName?: string;
  email?: string;
  role?: Role;
}

const SALT_ROUNDS = 10;

// ─── GET /doctors ───────────────────────────────────────────────────────────

export async function listDoctors() {
  const doctors = await prisma.doctor.findMany({
    orderBy: { fullName: 'asc' },
    take: 100,
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      createdAt: true,
      programs: {
        select: {
          id: true,
          assignedAt: true,
          program: {
            select: { id: true, name: true },
          },
        },
        orderBy: { assignedAt: 'desc' },
      },
    },
  });

  return doctors;
}

// ─── POST /doctors ──────────────────────────────────────────────────────────

export async function createDoctor(input: DoctorCreateInput) {
  if (input.password.length < 8) {
    throw new ValidationError('La contraseña debe tener al menos 8 caracteres');
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const doctor = await prisma.doctor.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      passwordHash,
      role: input.role ?? Role.DOCTOR,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  return doctor;
}

// ─── PATCH /doctors/:id ─────────────────────────────────────────────────────

export async function updateDoctor(
  doctorId: string,
  input: DoctorUpdateInput,
  currentDoctorId: string
) {
  const exists = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: { id: true },
  });

  if (!exists) {
    throw new NotFoundError('Médico no encontrado');
  }

  // Prevent admin from changing their own role (self-demotion/lock-out risk)
  if (input.role !== undefined && doctorId === currentDoctorId) {
    throw new ValidationError('No puede cambiar su propio rol');
  }

  const updated = await prisma.doctor.update({
    where: { id: doctorId },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  return updated;
}

// ─── POST /doctors/:id/programs — Asignar a programa ────────────────────────

export async function assignDoctorToProgram(doctorId: string, programId: string) {
  // Verify doctor exists
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: { id: true },
  });
  if (!doctor) {
    throw new NotFoundError('Médico no encontrado');
  }

  // Verify program exists
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true, name: true },
  });
  if (!program) {
    throw new NotFoundError('Programa no encontrado');
  }

  try {
    const assignment = await prisma.doctorProgram.create({
      data: { doctorId, programId },
      include: {
        program: { select: { id: true, name: true } },
      },
    });

    return assignment;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('El médico ya está asignado a este programa');
    }
    throw err;
  }
}

// ─── DELETE /doctors/:id/programs/:programId — Desasignar ───────────────────

export async function unassignDoctorFromProgram(doctorId: string, programId: string) {
  const existing = await prisma.doctorProgram.findUnique({
    where: { doctorId_programId: { doctorId, programId } },
  });

  if (!existing) {
    throw new NotFoundError('El médico no está asignado a este programa');
  }

  await prisma.doctorProgram.delete({
    where: { doctorId_programId: { doctorId, programId } },
  });
}
