import { describe, it, expect, vi, beforeEach } from 'vitest';

// FIX: orden de mensajes en el panel del médico.
// Antes la carga inicial (page 1) traía los mensajes MÁS VIEJOS (orderBy asc +
// skip/take), así que en conversaciones largas (>50) el médico veía el principio
// de la charla en vez del último mensaje del paciente.
//
// CONTRATO nuevo de getConversationMessages:
//   - La query usa orderBy: { createdAt: 'desc' } + skip/take.
//       page 1 -> los `limit` mensajes MÁS RECIENTES (skip 0).
//       page 2 -> los `limit` anteriores (skip = limit), etc.
//   - El array `messages` se DEVUELVE en orden CRONOLÓGICO ASCENDENTE
//     (viejo→nuevo) DENTRO de cada página (el service revierte el bloque desc).
//   - pagination.{page,limit,total,pages} permite saber si hay más.

const mockPrisma = {
  conversation: {
    findUnique: vi.fn(),
  },
  doctorProgram: {
    findMany: vi.fn(),
  },
  message: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
  ConversationStatus: { OPEN: 'OPEN', ESCALATED: 'ESCALATED', CLOSED: 'CLOSED' },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-1';

// Dataset cronológico ascendente: msg-0 (más viejo) … msg-(n-1) (más reciente).
function makeMessages(n: number) {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01T00:00:00Z
  return Array.from({ length: n }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `mensaje ${i}`,
    createdAt: new Date(base + i * 60_000), // +1 min por mensaje
  }));
}

// Simula el findMany de Prisma respetando orderBy createdAt + skip/take
// sobre el dataset ascendente `all`.
function fakeFindMany(all: ReturnType<typeof makeMessages>) {
  return ({ orderBy, skip = 0, take }: { orderBy: { createdAt: 'asc' | 'desc' }; skip?: number; take?: number }) => {
    const sorted = [...all].sort((a, b) =>
      orderBy.createdAt === 'asc'
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const sliced = take == null ? sorted.slice(skip) : sorted.slice(skip, skip + take);
    return Promise.resolve(sliced);
  };
}

function mockConversationFound() {
  mockPrisma.conversation.findUnique.mockResolvedValue({
    id: CONV_ID,
    phone: '+5493700000000',
    status: 'OPEN',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    patient: {
      id: 'pat-1',
      fullName: 'Paciente Uno',
      dni: '12345678',
      programs: [{ programId: 'prog-1' }],
    },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('getConversationMessages — orden estilo chat', () => {
  it('page 1 trae los 50 mensajes MÁS RECIENTES, en orden cronológico ascendente', async () => {
    const all = makeMessages(120); // conversación larga
    mockConversationFound();
    mockPrisma.message.findMany.mockImplementation(fakeFindMany(all));
    mockPrisma.message.count.mockResolvedValue(120);

    const { getConversationMessages } = await import('../services/conversation-panel.service');
    const { Role } = await import('@ips/db');

    const res = await getConversationMessages(CONV_ID, 'admin-1', Role.ADMIN, 1, 50);

    // La query debe pedir DESC con skip 0 / take 50.
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: CONV_ID },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
      }),
    );

    expect(res.messages).toHaveLength(50);
    // Page 1 = los más recientes: msg-70 … msg-119.
    expect(res.messages[0].id).toBe('msg-70');
    expect(res.messages[res.messages.length - 1].id).toBe('msg-119');

    // Devueltos en orden cronológico ASCENDENTE.
    const times = res.messages.map((m) => m.createdAt.getTime());
    const sortedAsc = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sortedAsc);

    expect(res.pagination).toMatchObject({ page: 1, limit: 50, total: 120, pages: 3 });
  });

  it('page 2 trae los 50 ANTERIORES a la página 1, también en orden ascendente', async () => {
    const all = makeMessages(120);
    mockConversationFound();
    mockPrisma.message.findMany.mockImplementation(fakeFindMany(all));
    mockPrisma.message.count.mockResolvedValue(120);

    const { getConversationMessages } = await import('../services/conversation-panel.service');
    const { Role } = await import('@ips/db');

    const res = await getConversationMessages(CONV_ID, 'admin-1', Role.ADMIN, 2, 50);

    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        skip: 50,
        take: 50,
      }),
    );

    expect(res.messages).toHaveLength(50);
    // Page 2 = los anteriores: msg-20 … msg-69.
    expect(res.messages[0].id).toBe('msg-20');
    expect(res.messages[res.messages.length - 1].id).toBe('msg-69');

    // Todos los de page 2 son ANTERIORES (más viejos) que el primero de page 1 (msg-70).
    const newestPage2 = res.messages[res.messages.length - 1].createdAt.getTime();
    const oldestPage1 = all[70].createdAt.getTime();
    expect(newestPage2).toBeLessThan(oldestPage1);
  });

  it('conversación corta (<50) devuelve TODOS los mensajes en orden cronológico', async () => {
    const all = makeMessages(8);
    mockConversationFound();
    mockPrisma.message.findMany.mockImplementation(fakeFindMany(all));
    mockPrisma.message.count.mockResolvedValue(8);

    const { getConversationMessages } = await import('../services/conversation-panel.service');
    const { Role } = await import('@ips/db');

    const res = await getConversationMessages(CONV_ID, 'admin-1', Role.ADMIN, 1, 50);

    expect(res.messages).toHaveLength(8);
    expect(res.messages.map((m) => m.id)).toEqual([
      'msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5', 'msg-6', 'msg-7',
    ]);
    expect(res.pagination).toMatchObject({ page: 1, total: 8, pages: 1 });
  });
});
