import { prisma, Role, RegisteredVia, Gender, PatientProgramStatus, Prisma } from '@ips/db';
import { NotFoundError, ValidationError } from '../utils/errors';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PatientListFilters {
  search?: string;
  programId?: string;
  status?: PatientProgramStatus;
  page: number;
  limit: number;
}

export interface PatientCreateInput {
  fullName: string;
  dni: string;
  phone?: string;
  birthDate?: string;
  gender?: Gender;
  consent?: boolean;
}

export interface PatientUpdateInput {
  fullName?: string;
  phone?: string;
  birthDate?: string;
  gender?: Gender;
  consent?: boolean;
}

export interface CsvRow {
  fullName: string;
  dni: string;
  phone?: string;
  birthDate?: string;
  gender?: Gender;
}

export interface ImportResult {
  created: number;
  updated: number;
  total: number;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function parseDateOrUndefined(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

// ─── GET list ────────────────────────────────────────────────────────────────

export async function listPatients(
  doctorId: string,
  role: Role,
  filters: PatientListFilters
) {
  const { search, programId, status, page, limit } = filters;
  const skip = (page - 1) * limit;

  // DOCTOR role — restrict to their programs' patients
  let doctorProgramIds: string[] | undefined;
  if (role === Role.DOCTOR) {
    const doctorPrograms = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    doctorProgramIds = doctorPrograms.map((dp) => dp.programId);
  }

  // For DOCTOR: if programId filter is provided, it must be one of their programs
  let effectiveProgramIds: string[] | undefined;
  if (doctorProgramIds !== undefined) {
    if (programId) {
      // DOCTOR filtering by a specific program — must be one they're assigned to
      effectiveProgramIds = doctorProgramIds.includes(programId) ? [programId] : [];
    } else {
      effectiveProgramIds = doctorProgramIds;
    }
  } else if (programId) {
    // ADMIN filtering by a specific program
    effectiveProgramIds = [programId];
  }

  // Build the where clause
  const where: Prisma.PatientWhereInput = {
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { dni: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
    // Patient must have at least one PatientProgram matching the constraints
    ...(effectiveProgramIds !== undefined || status
      ? {
          programs: {
            some: {
              ...(effectiveProgramIds !== undefined
                ? { programId: { in: effectiveProgramIds } }
                : {}),
              ...(status ? { status } : {}),
            },
          },
        }
      : {}),
  };

  const [patients, total] = await prisma.$transaction([
    prisma.patient.findMany({
      where,
      skip,
      take: limit,
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        dni: true,
        phone: true,
        birthDate: true,
        gender: true,
        consent: true,
        registeredVia: true,
        whatsappLinked: true,
        createdAt: true,
        _count: {
          select: {
            programs: {
              where: { status: PatientProgramStatus.ACTIVE },
            },
          },
        },
      },
    }),
    prisma.patient.count({ where }),
  ]);

  return {
    patients: patients.map((p) => ({
      ...p,
      activeProgramsCount: p._count.programs,
      _count: undefined,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

// ─── GET by ID ───────────────────────────────────────────────────────────────

export async function getPatientById(patientId: string, doctorId: string, role: Role) {
  // For DOCTOR role, resolve their program IDs and check access
  let doctorProgramIds: string[] | undefined;
  if (role === Role.DOCTOR) {
    const doctorPrograms = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    doctorProgramIds = doctorPrograms.map((dp) => dp.programId);

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

  // DOCTOR: filter programs and reminders to only their assigned programs
  const programFilter = doctorProgramIds
    ? { programId: { in: doctorProgramIds } }
    : {};

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      programs: {
        where: programFilter,
        include: {
          program: {
            select: { id: true, name: true, reminderFrequencyDays: true },
          },
          enrolledByDoctor: {
            select: { fullName: true },
          },
        },
        orderBy: { enrolledAt: 'desc' },
      },
      reminders: {
        where: programFilter,
        orderBy: { scheduledFor: 'desc' },
        take: 10,
        select: {
          id: true,
          scheduledFor: true,
          sentAt: true,
          status: true,
          patientReplied: true,
          program: {
            select: { name: true },
          },
        },
      },
      conversations: {
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          startedAt: true,
          closedAt: true,
          _count: {
            select: { messages: true },
          },
        },
      },
    },
  });

  if (!patient) {
    throw new NotFoundError('Paciente no encontrado');
  }

  return patient;
}

// ─── CREATE / UPSERT by DNI ──────────────────────────────────────────────────

export async function upsertPatientByDni(
  input: PatientCreateInput,
  registeredVia: RegisteredVia = RegisteredVia.PANEL
): Promise<{ patient: Awaited<ReturnType<typeof prisma.patient.findUnique>>; created: boolean }> {
  const existing = await prisma.patient.findUnique({
    where: { dni: input.dni },
  });

  if (existing) {
    // Update only fields that are currently null/missing
    const updated = await prisma.patient.update({
      where: { dni: input.dni },
      data: {
        ...(input.phone && !existing.phone ? { phone: input.phone } : {}),
        ...(input.birthDate && !existing.birthDate
          ? { birthDate: parseDateOrUndefined(input.birthDate) }
          : {}),
        ...(input.gender && !existing.gender ? { gender: input.gender } : {}),
      },
    });
    return { patient: updated, created: false };
  }

  const created = await prisma.patient.create({
    data: {
      fullName: input.fullName,
      dni: input.dni,
      phone: input.phone ?? null,
      birthDate: parseDateOrUndefined(input.birthDate) ?? null,
      gender: input.gender ?? null,
      consent: input.consent ?? true,
      registeredVia,
    },
  });

  return { patient: created, created: true };
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────

export async function updatePatient(
  patientId: string,
  doctorId: string,
  role: Role,
  input: PatientUpdateInput
) {
  // DOCTOR role — check access
  if (role === Role.DOCTOR) {
    const doctorPrograms = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    const programIds = doctorPrograms.map((dp) => dp.programId);

    const enrollment = await prisma.patientProgram.findFirst({
      where: {
        patientId,
        programId: { in: programIds },
      },
    });

    if (!enrollment) {
      throw new NotFoundError('Paciente no encontrado');
    }
  } else {
    // ADMIN — just verify patient exists
    const exists = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Paciente no encontrado');
  }

  const updated = await prisma.patient.update({
    where: { id: patientId },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.birthDate !== undefined
        ? { birthDate: parseDateOrUndefined(input.birthDate) ?? null }
        : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      ...(input.consent !== undefined ? { consent: input.consent } : {}),
    },
  });

  return updated;
}

// ─── CSV IMPORT ───────────────────────────────────────────────────────────────

const DNI_REGEX = /^\d{7,8}$/;
const PHONE_E164_REGEX = /^\+[1-9]\d{1,14}$/;

interface CsvImportRow {
  rowNumber: number;
  data: CsvRow;
}

interface CsvRowError {
  row: number;
  errors: string[];
}

const MAX_CSV_ROWS = 5000;

export async function importPatientsFromCsv(csvContent: string): Promise<ImportResult> {
  const lines = csvContent.split('\n').map((l) => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    throw new ValidationError('El CSV debe tener al menos una fila de encabezado y una de datos');
  }

  if (lines.length - 1 > MAX_CSV_ROWS) {
    throw new ValidationError(`El CSV no puede tener más de ${MAX_CSV_ROWS} filas de datos`);
  }

  const header = lines[0].toLowerCase();
  const headerCols = header.split(',').map((c) => c.trim());

  // Validate header columns are present in expected order
  const hasRequiredCols =
    headerCols[0] === 'fullname' && headerCols[1] === 'dni';
  if (!hasRequiredCols) {
    throw new ValidationError('El CSV debe comenzar con columnas: fullName,dni,phone,birthDate,gender');
  }

  const dataLines = lines.slice(1);
  const validRows: CsvImportRow[] = [];
  const rowErrors: CsvRowError[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const rowNumber = i + 2; // 1-indexed, header is row 1
    const cols = dataLines[i].split(',').map((c) => c.trim());
    const errors: string[] = [];

    const fullName = cols[0] ?? '';
    const dni = cols[1] ?? '';
    const phone = cols[2] || undefined;
    const birthDate = cols[3] || undefined;
    const genderRaw = cols[4] || undefined;

    if (!fullName || fullName.length < 2) {
      errors.push('fullName es requerido (mínimo 2 caracteres)');
    } else if (/^[=+\-@\t\r]/.test(fullName)) {
      errors.push('fullName no puede comenzar con =, +, -, @ (prevención de inyección de fórmulas)');
    }
    if (!DNI_REGEX.test(dni)) {
      errors.push('DNI inválido (debe tener 7 u 8 dígitos)');
    }
    if (phone && !PHONE_E164_REGEX.test(phone)) {
      errors.push('Teléfono inválido (debe estar en formato E.164, ej: +5491123456789)');
    }

    let gender: Gender | undefined;
    if (genderRaw) {
      const upperGender = genderRaw.toUpperCase();
      if (upperGender === 'M' || upperGender === 'F' || upperGender === 'OTRO') {
        gender = upperGender as Gender;
      } else {
        errors.push('Género inválido (valores aceptados: M, F, OTRO)');
      }
    }

    if (errors.length > 0) {
      rowErrors.push({ row: rowNumber, errors });
    } else {
      validRows.push({
        rowNumber,
        data: { fullName, dni, phone, birthDate, gender },
      });
    }
  }

  // Check for duplicate DNIs within the CSV
  const seenDnis = new Map<string, number>();
  const seenPhones = new Map<string, number>();
  for (const { rowNumber, data } of validRows) {
    if (seenDnis.has(data.dni)) {
      rowErrors.push({
        row: rowNumber,
        errors: [`DNI ${data.dni} duplicado en el CSV (también en fila ${seenDnis.get(data.dni)})`],
      });
    } else {
      seenDnis.set(data.dni, rowNumber);
    }

    if (data.phone) {
      if (seenPhones.has(data.phone)) {
        rowErrors.push({
          row: rowNumber,
          errors: [`Teléfono ${data.phone} duplicado en el CSV (también en fila ${seenPhones.get(data.phone)})`],
        });
      } else {
        seenPhones.set(data.phone, rowNumber);
      }
    }
  }

  // ALL-or-nothing: if any row has errors, reject the entire import
  if (rowErrors.length > 0) {
    const errorDetails: Record<string, string[]> = {};
    for (const re of rowErrors) {
      const key = `fila_${re.row}`;
      if (errorDetails[key]) {
        errorDetails[key].push(...re.errors);
      } else {
        errorDetails[key] = re.errors;
      }
    }
    throw new ValidationError('El CSV contiene errores. No se importó ningún registro.', errorDetails);
  }

  // Bulk upsert inside a transaction — atomicity guaranteed
  let createdCount = 0;
  let updatedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const { data } of validRows) {
      const existing = await tx.patient.findUnique({
        where: { dni: data.dni },
        select: { id: true, phone: true, birthDate: true, gender: true },
      });

      if (existing) {
        const updates: Record<string, unknown> = {};
        if (data.phone && !existing.phone) updates.phone = data.phone;
        if (data.birthDate && !existing.birthDate) updates.birthDate = parseDateOrUndefined(data.birthDate);
        if (data.gender && !existing.gender) updates.gender = data.gender;

        if (Object.keys(updates).length > 0) {
          await tx.patient.update({
            where: { dni: data.dni },
            data: updates,
          });
          updatedCount++;
        }
      } else {
        await tx.patient.create({
          data: {
            fullName: data.fullName,
            dni: data.dni,
            phone: data.phone ?? null,
            birthDate: parseDateOrUndefined(data.birthDate) ?? null,
            gender: data.gender ?? null,
            consent: true,
            registeredVia: RegisteredVia.IMPORT,
          },
        });
        createdCount++;
      }
    }
  });

  return {
    created: createdCount,
    updated: updatedCount,
    total: validRows.length,
  };
}

// ─── EXPORT CSV ─────────────────────────────────────────────────────────────

export interface ExportFilters {
  programId?: string;
  status?: PatientProgramStatus;
}

// LESSONS #30: sanitize CSV injection — prefix dangerous chars with single quote
function csvSafe(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function escapeCsvField(value: string): string {
  const safe = csvSafe(value);
  // Quote fields containing comma, quote, or newline
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatDateAR(d: Date | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(d));
}

export async function exportPatientsCsv(
  doctorId: string,
  role: Role,
  filters: ExportFilters
): Promise<string> {
  // Resolve program filter (same logic as listPatients)
  let doctorProgramIds: string[] | undefined;
  if (role === Role.DOCTOR) {
    const doctorPrograms = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    doctorProgramIds = doctorPrograms.map((dp) => dp.programId);
  }

  let effectiveProgramIds: string[] | undefined;
  if (doctorProgramIds !== undefined) {
    if (filters.programId) {
      effectiveProgramIds = doctorProgramIds.includes(filters.programId)
        ? [filters.programId]
        : [];
    } else {
      effectiveProgramIds = doctorProgramIds;
    }
  } else if (filters.programId) {
    effectiveProgramIds = [filters.programId];
  }

  const where: Prisma.PatientWhereInput = {
    ...(effectiveProgramIds !== undefined || filters.status
      ? {
          programs: {
            some: {
              ...(effectiveProgramIds ? { programId: { in: effectiveProgramIds } } : {}),
              ...(filters.status ? { status: filters.status } : {}),
            },
          },
        }
      : {}),
  };

  const patients = await prisma.patient.findMany({
    where,
    take: 5000, // LESSONS #13
    orderBy: { fullName: 'asc' },
    select: {
      fullName: true,
      dni: true,
      phone: true,
      programs: {
        where: {
          ...(effectiveProgramIds ? { programId: { in: effectiveProgramIds } } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        select: {
          status: true,
          lastControlDate: true,
          nextReminderDate: true,
          program: { select: { name: true } },
        },
      },
    },
  });

  // Build CSV
  const header = 'Nombre,DNI,Teléfono,Programa,Último Control,Próximo Control,Estado';
  const rows: string[] = [header];

  for (const p of patients) {
    if (p.programs.length === 0) {
      // Patient with no matching programs (edge case)
      rows.push(
        [
          escapeCsvField(p.fullName),
          escapeCsvField(p.dni),
          p.phone || '',
          '',
          '',
          '',
          '',
        ].join(',')
      );
    } else {
      for (const pp of p.programs) {
        rows.push(
          [
            escapeCsvField(p.fullName),
            escapeCsvField(p.dni),
            p.phone || '',
            escapeCsvField(pp.program.name),
            formatDateAR(pp.lastControlDate),
            formatDateAR(pp.nextReminderDate),
            pp.status,
          ].join(',')
        );
      }
    }
  }

  return rows.join('\n');
}
