import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Tests de servicio con DB mockeada (patrón followup-flow.test.ts) ─────────
// Cubren: dedupe al crear, cancel por múltiples índices y cancelar todos.
// El resultado de cancelación SIEMPRE viene del conteo REAL en DB (no de la IA).

const mockPrisma = {
  patientSelfReminder: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};

const mockSendTextMessage = vi.fn();

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  SelfReminderStatus: { PENDING: 'PENDING', SENT: 'SENT', CANCELLED: 'CANCELLED' },
}));

vi.mock('../services/messaging.service', () => ({
  sendTextMessage: mockSendTextMessage,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTextMessage.mockResolvedValue(true);
});

// Fecha de hoy en Argentina en YYYY-MM-DD (createSelfReminder rechaza el pasado).
function todayISO(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
  return parts; // en-CA da YYYY-MM-DD
}

// ─── createSelfReminder: dedupe ───────────────────────────────────────────────

describe('createSelfReminder — dedupe (punto 6)', () => {
  it('NO crea un duplicado exacto (misma descripción + hora + recurrencia, activo)', async () => {
    mockPrisma.patientSelfReminder.count.mockResolvedValue(1);
    // Ya existe un PENDING idéntico → findFirst lo encuentra
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue({
      id: 'existing-1',
      description: 'Tomar insulina',
      reminderDate: new Date(),
      reminderHour: 8,
      reminderMinute: 0,
      recurring: true,
    });

    const { createSelfReminder } = await import('../services/self-reminder.service');
    const result = await createSelfReminder('pat-1', {
      description: 'Tomar insulina',
      date: todayISO(),
      time: '08:00',
      recurring: true,
    });

    // No debe crear otro registro
    expect(mockPrisma.patientSelfReminder.create).not.toHaveBeenCalled();
    // Debe devolver éxito (idempotente) y referenciar el existente
    expect(result.success).toBe(true);
    expect(result.reminder?.id).toBe('existing-1');
  });

  it('crea normalmente cuando NO hay duplicado', async () => {
    mockPrisma.patientSelfReminder.count.mockResolvedValue(0);
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(null);
    mockPrisma.patientSelfReminder.create.mockResolvedValue({
      id: 'new-1',
      description: 'Tomar insulina',
      reminderDate: new Date(),
      reminderHour: 8,
      reminderMinute: 0,
      recurring: true,
    });

    const { createSelfReminder } = await import('../services/self-reminder.service');
    const result = await createSelfReminder('pat-1', {
      description: 'Tomar insulina',
      date: todayISO(),
      time: '08:00',
      recurring: true,
    });

    expect(mockPrisma.patientSelfReminder.create).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.reminder?.id).toBe('new-1');
  });
});

// ─── cancelSelfReminders: múltiples índices ───────────────────────────────────

describe('cancelSelfReminders — múltiples índices (punto 4)', () => {
  const threeReminders = [
    { id: 'r1', description: 'Uno', reminderDate: new Date(), reminderHour: 8, reminderMinute: 0, recurring: true },
    { id: 'r2', description: 'Dos', reminderDate: new Date(), reminderHour: 9, reminderMinute: 0, recurring: true },
    { id: 'r3', description: 'Tres', reminderDate: new Date(), reminderHour: 10, reminderMinute: 0, recurring: true },
  ];

  it('cancela 2 de 3 por índice y reporta el conteo REAL', async () => {
    mockPrisma.patientSelfReminder.findMany.mockResolvedValue(threeReminders);
    mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 2 });

    const { cancelSelfReminders } = await import('../services/self-reminder.service');
    const result = await cancelSelfReminders('pat-1', [1, 3]);

    expect(result.cancelledCount).toBe(2);
    // Sólo se mandan a cancelar los IDs reales que corresponden a esos índices
    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['r1', 'r3'] } }),
        data: { status: 'CANCELLED' },
      })
    );
  });

  it('índice inexistente no rompe y no cancela nada de más', async () => {
    mockPrisma.patientSelfReminder.findMany.mockResolvedValue(threeReminders);
    mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 0 });

    const { cancelSelfReminders } = await import('../services/self-reminder.service');
    const result = await cancelSelfReminders('pat-1', [99]);

    expect(result.cancelledCount).toBe(0);
    // No hay IDs válidos → no se llama updateMany (o se llama con lista vacía → 0)
    expect(result.invalidIndices).toContain(99);
  });

  it('lista vacía de recordatorios → cancelledCount 0, no crashea', async () => {
    mockPrisma.patientSelfReminder.findMany.mockResolvedValue([]);

    const { cancelSelfReminders } = await import('../services/self-reminder.service');
    const result = await cancelSelfReminders('pat-1', [1, 2]);

    expect(result.cancelledCount).toBe(0);
  });
});

// ─── cancelAllSelfReminders ───────────────────────────────────────────────────

describe('cancelAllSelfReminders — cancelar todos (punto 4)', () => {
  it('cancela todos los PENDING y reporta el conteo real', async () => {
    mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 4 });

    const { cancelAllSelfReminders } = await import('../services/self-reminder.service');
    const result = await cancelAllSelfReminders('pat-1');

    expect(result.cancelledCount).toBe(4);
    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'pat-1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
    );
  });

  it('sin recordatorios activos → cancelledCount 0', async () => {
    mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 0 });

    const { cancelAllSelfReminders } = await import('../services/self-reminder.service');
    const result = await cancelAllSelfReminders('pat-1');

    expect(result.cancelledCount).toBe(0);
  });
});
