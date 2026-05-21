import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T12 — Migración de Self-reminders (#3) a la cola pg-boss ──────────────────
// Mismo patrón validado en followup, con las particularidades de self:
//   - El guard RE-LEE status PENDING (race con cancelación desde el bot — el viejo
//     ya lo hacía) + reincluye la ventana temporal, para que un reintento tras un
//     bump (recurring) o SENT (one-time) NO reenvíe.
//   - Tras enviar: recurring → bump reminderDate a mañana; one-time → status SENT.
//     Ambos con updateMany CONDICIONAL (where reincluye el guard).
//   - send=false: si el recordatorio está >48h vencido → CANCELLED (se rinde, sin
//     throw, igual que el viejo); si no → throw (pg-boss reintenta).
//
// singletonKey: self:{selfReminderId}:{date}.

const mockPrisma = {
  patientSelfReminder: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

const mockSendTextMessage = vi.fn();
const mockSchedule = vi.fn();

let txDepth = 0;
let sendCalledInsideTx = false;

const mockConfig: { QUEUE_SHADOW: boolean; SEND_MAX_CONCURRENT: number } = { QUEUE_SHADOW: false, SEND_MAX_CONCURRENT: 20 };

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  SelfReminderStatus: { PENDING: 'PENDING', SENT: 'SENT', CANCELLED: 'CANCELLED' },
}));

vi.mock('../services/messaging.service', () => ({
  sendTextMessage: mockSendTextMessage,
}));

vi.mock('../queue/limiter', () => ({
  limiter: { schedule: mockSchedule },
}));

vi.mock('../config/env', () => ({
  config: mockConfig,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.QUEUE_SHADOW = false;
  txDepth = 0;
  sendCalledInsideTx = false;
  mockSendTextMessage.mockImplementation(async () => {
    if (txDepth > 0) sendCalledInsideTx = true;
    return true;
  });
  mockSchedule.mockImplementation((fn: () => Promise<unknown>) => fn());
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => {
    txDepth++;
    try {
      return await cb(mockPrisma);
    } finally {
      txDepth--;
    }
  });
  mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 1 });
});

function makeFakeBoss() {
  const send = vi.fn().mockResolvedValue('job-id');
  return { boss: { send } as any, send };
}

// ─── enqueueSelfReminders ──────────────────────────────────────────────────────

describe('enqueueSelfReminders — encola sin tope', () => {
  function reminderRow(i: number, over: Partial<{ phone: string | null }> = {}) {
    return {
      id: `self-${i}`,
      patientId: `pat-${i}`,
      patient: { phone: over.phone === undefined ? '+5493764125878' : over.phone },
    };
  }

  it('encola N jobs cuando hay N recordatorios (N>200, sin el take capado)', async () => {
    const N = 250;
    const rows = Array.from({ length: N }, (_, i) => reminderRow(i));
    mockPrisma.patientSelfReminder.findMany.mockResolvedValueOnce(rows).mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueSelfReminders } = await import('../services/self-reminder.service');
    const result = await enqueueSelfReminders(boss);

    expect(send).toHaveBeenCalledTimes(N);
    expect(result.enqueued).toBe(N);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('manda el singletonKey (self:{id}:{date}) + retryLimit:5 + retryBackoff:true', async () => {
    mockPrisma.patientSelfReminder.findMany
      .mockResolvedValueOnce([reminderRow(7)])
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueSelfReminders } = await import('../services/self-reminder.service');
    await enqueueSelfReminders(boss);

    expect(send).toHaveBeenCalledTimes(1);
    const [queueName, payload, opts] = send.mock.calls[0];
    expect(queueName).toBe('reminders:self');
    expect(payload).toMatchObject({ selfReminderId: 'self-7', patientId: 'pat-7' });
    expect(payload.phone).toBeTypeOf('string');
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opts).toMatchObject({ retryLimit: 5, retryBackoff: true });
    expect(opts.singletonKey).toMatch(/^self:self-7:\d{4}-\d{2}-\d{2}$/);
  });

  it('pagina por lotes hasta agotar (2 páginas llenas de 200 + cola)', async () => {
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => reminderRow(offset + i));
    mockPrisma.patientSelfReminder.findMany
      .mockResolvedValueOnce(page(200, 0))
      .mockResolvedValueOnce(page(200, 200))
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueSelfReminders } = await import('../services/self-reminder.service');
    const result = await enqueueSelfReminders(boss);

    expect(result.enqueued).toBe(400);
    expect(send).toHaveBeenCalledTimes(400);
  });

  it('salta recordatorios de pacientes sin phone', async () => {
    mockPrisma.patientSelfReminder.findMany
      .mockResolvedValueOnce([reminderRow(1), reminderRow(2, { phone: null })])
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueSelfReminders } = await import('../services/self-reminder.service');
    const result = await enqueueSelfReminders(boss);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(1);
  });

  it('M2: NO cuenta los jobs deduplicados por singletonKey (send → null)', async () => {
    mockPrisma.patientSelfReminder.findMany
      .mockResolvedValueOnce([reminderRow(1), reminderRow(2), reminderRow(3)])
      .mockResolvedValue([]);

    const send = vi
      .fn()
      .mockResolvedValueOnce('job-1')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('job-3');
    const boss = { send } as any;

    const { enqueueSelfReminders } = await import('../services/self-reminder.service');
    const result = await enqueueSelfReminders(boss);

    expect(send).toHaveBeenCalledTimes(3);
    expect(result.enqueued).toBe(2);
  });
});

// ─── makeSelfReminderHandler ───────────────────────────────────────────────────

describe('makeSelfReminderHandler — worker idempotente', () => {
  const payload = {
    selfReminderId: 'self-1',
    patientId: 'pat-1',
    phone: '543764125878',
    date: '2026-05-21',
  };

  function guardRow(over: Partial<{ recurring: boolean; reminderDate: Date }> = {}) {
    return {
      id: 'self-1',
      description: 'Turno con el dentista',
      recurring: over.recurring ?? false,
      reminderDate: over.reminderDate ?? new Date('2026-05-21T00:00:00Z'),
      patient: { fullName: 'Ana López' },
    };
  }

  it('one-time: envía y marca SENT con updateMany condicional (where reincluye status PENDING)', async () => {
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(guardRow({ recurring: false }));

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][0]).toBe('543764125878');
    expect(mockSendTextMessage.mock.calls[0][1]).toContain('Turno con el dentista');
    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.patientSelfReminder.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'self-1', status: 'PENDING' });
    expect(arg.data).toMatchObject({ status: 'SENT' });
  });

  it('recurring: envía y reprograma reminderDate (no marca SENT)', async () => {
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(guardRow({ recurring: true }));

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.patientSelfReminder.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'self-1', status: 'PENDING' });
    // BLINDAJE: el where condicional DEBE reincluir la ventana temporal (OR). Es lo
    // que hace idempotente al bump (tras reprogramar a mañana, un reintento ya no
    // matchea). Si alguien borra este OR en un refactor, el recurring duplicaría.
    expect(Array.isArray(arg.where.OR)).toBe(true);
    expect(arg.where.OR.length).toBe(2);
    expect(arg.data.reminderDate).toBeInstanceOf(Date);
    expect(arg.data.status).toBeUndefined(); // recurring NO marca SENT
  });

  it('C2: NO llama sendTextMessage dentro de una $transaction', async () => {
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(guardRow());

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(sendCalledInsideTx).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('guard: el findFirst chequea status PENDING + consent (race con cancelación)', async () => {
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(guardRow());

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();
    await handler([{ id: 'j1', data: payload }]);

    const guardWhere = mockPrisma.patientSelfReminder.findFirst.mock.calls[0][0].where;
    expect(guardWhere).toMatchObject({ id: 'self-1', status: 'PENDING' });
    expect(guardWhere.patient).toMatchObject({ consent: true });
  });

  it('guard idempotente: si ya no está PENDING (findFirst null) → NO envía ni muta', async () => {
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(null);

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.patientSelfReminder.updateMany).not.toHaveBeenCalled();
  });

  it('send=false NO vencido: hace throw (pg-boss reintenta), NO cancela', async () => {
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(
      guardRow({ reminderDate: new Date() }) // hoy, no vencido
    );
    mockSendTextMessage.mockImplementation(async () => {
      if (txDepth > 0) sendCalledInsideTx = true;
      return false;
    });

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();

    await expect(handler([{ id: 'j1', data: payload }])).rejects.toThrow();
    expect(mockPrisma.patientSelfReminder.updateMany).not.toHaveBeenCalled();
  });

  it('send=false y >48h vencido: CANCELLED sin throw (se rinde, igual que el viejo)', async () => {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72h atrás
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(
      guardRow({ reminderDate: old })
    );
    mockSendTextMessage.mockImplementation(async () => {
      if (txDepth > 0) sendCalledInsideTx = true;
      return false;
    });

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();

    // NO debe hacer throw (se rinde).
    await handler([{ id: 'j1', data: payload }]);

    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.patientSelfReminder.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'self-1', status: 'PENDING' });
    expect(arg.data).toMatchObject({ status: 'CANCELLED' });
  });

  it('envío que LANZA excepción y >48h vencido: CANCELLED sin propagar (paridad con el viejo)', async () => {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000);
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(guardRow({ reminderDate: old }));
    mockSendTextMessage.mockImplementation(async () => {
      throw new Error('Twilio 500');
    });

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();

    // La excepción se normaliza a fallo → como está >48h vencido, cancela sin throw.
    await handler([{ id: 'j1', data: payload }]);

    const arg = mockPrisma.patientSelfReminder.updateMany.mock.calls[0][0];
    expect(arg.data).toMatchObject({ status: 'CANCELLED' });
  });

  it('envío que LANZA excepción y NO vencido: re-lanza (pg-boss reintenta)', async () => {
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(
      guardRow({ reminderDate: new Date() })
    );
    mockSendTextMessage.mockImplementation(async () => {
      throw new Error('Twilio 500');
    });

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();

    await expect(handler([{ id: 'j1', data: payload }])).rejects.toThrow();
    expect(mockPrisma.patientSelfReminder.updateMany).not.toHaveBeenCalled();
  });

  it('QUEUE_SHADOW=true: NO envía ni muta, solo loguea', async () => {
    mockConfig.QUEUE_SHADOW = true;
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(guardRow());

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.patientSelfReminder.updateMany).not.toHaveBeenCalled();
  });

  it('procesa cada job del batch (pg-boss v10 entrega arrays)', async () => {
    mockPrisma.patientSelfReminder.findFirst.mockResolvedValue(guardRow());

    const { makeSelfReminderHandler } = await import('../services/self-reminder.service');
    const handler = makeSelfReminderHandler();
    await handler([
      { id: 'j1', data: { ...payload, selfReminderId: 'self-1' } },
      { id: 'j2', data: { ...payload, selfReminderId: 'self-2' } },
    ]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledTimes(2);
  });
});
