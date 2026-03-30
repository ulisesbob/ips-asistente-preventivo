import { prisma, Role, ConversationStatus, Prisma } from '@ips/db';
import { NotFoundError } from '../utils/errors';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConversationListFilters {
  search?: string;
  status?: ConversationStatus;
  page: number;
  limit: number;
}

// ─── GET /conversations — List for panel ────────────────────────────────────

export async function listConversations(
  doctorId: string,
  role: Role,
  filters: ConversationListFilters,
) {
  const { search, status, page, limit } = filters;

  // Build conditions as an AND array to avoid key collisions (LESSONS.md #10)
  const conditions: Prisma.ConversationWhereInput[] = [];

  if (status) {
    conditions.push({ status });
  }

  // Search by patient name, DNI, or phone
  if (search) {
    conditions.push({
      OR: [
        { phone: { contains: search } },
        { patient: { fullName: { contains: search, mode: 'insensitive' } } },
        { patient: { dni: { contains: search } } },
      ],
    });
  }

  // DOCTOR: only see conversations from patients in their programs
  if (role === Role.DOCTOR) {
    const doctorPrograms = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    const programIds = doctorPrograms.map((dp) => dp.programId);

    conditions.push({
      patient: {
        programs: { some: { programId: { in: programIds } } },
      },
    });
  }

  const where: Prisma.ConversationWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        phone: true,
        status: true,
        startedAt: true,
        closedAt: true,
        patient: {
          select: {
            id: true,
            fullName: true,
            dni: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    }),
    prisma.conversation.count({ where }),
  ]);

  return {
    conversations,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

// ─── GET /conversations/:id/messages — Messages for panel ───────────────────

export async function getConversationMessages(
  conversationId: string,
  doctorId: string,
  role: Role,
  page: number,
  limit: number,
) {
  // Verify conversation exists
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      phone: true,
      status: true,
      startedAt: true,
      patient: {
        select: {
          id: true,
          fullName: true,
          dni: true,
          programs: {
            select: { programId: true },
          },
        },
      },
    },
  });

  if (!conversation) {
    throw new NotFoundError('Conversación no encontrada');
  }

  // DOCTOR: verify access via patient programs
  if (role === Role.DOCTOR) {
    if (!conversation.patient) {
      throw new NotFoundError('Conversación no encontrada');
    }
    const doctorPrograms = await prisma.doctorProgram.findMany({
      where: { doctorId },
      select: { programId: true },
    });
    const doctorProgramIds = new Set(doctorPrograms.map((dp) => dp.programId));
    const hasAccess = conversation.patient.programs.some(
      (p) => doctorProgramIds.has(p.programId),
    );

    if (!hasAccess) {
      throw new NotFoundError('Conversación no encontrada');
    }
  }

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    }),
    prisma.message.count({ where: { conversationId } }),
  ]);

  return {
    conversation: {
      id: conversation.id,
      phone: conversation.phone,
      status: conversation.status,
      startedAt: conversation.startedAt,
      patientName: conversation.patient?.fullName ?? null,
    },
    messages,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}
