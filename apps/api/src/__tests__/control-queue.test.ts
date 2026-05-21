import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T13 — Migración de Controles (#1) a la cola pg-boss ───────────────────────
// El cron MÁS RIESGOSO: muta nextReminderDate y crea registros `reminder` (el
// historial del panel). Va con modo SHADOW primero (QUEUE_SHADOW: encola y loguea
// pero NO envía ni muta). Mismo patrón validado de followup + idempotencia reforzada:
//   - éxito → $transaction: advance CONDICIONAL de nextReminderDate (where reincluye
//     nextReminderDate<=today) que GATEA la creación del registro SENT. Si el advance
//     afecta 0 filas (ya avanzado por otro proceso/reintento) → NO crea el registro
//     → no duplica historial ni doble-avanza.
//   - send=false → throw (pg-boss reintenta; persistente → dead-letter). NO se crean
//     registros FAILED por reintento (diferencia deliberada con el viejo).
//   - frecuencia<1 → skip (igual que el viejo).
//
// singletonKey: control:{patientProgramId}:{date}.

const mockPrisma = {
  patientProgram: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  reminder: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
};

const mockSendTextMessage = vi.fn();
const mockSchedule = vi.fn();

let txDepth = 0;
let sendCalledInsideTx = false;

const mockConfig: { QUEUE_SHADOW: boolean } = { QUEUE_SHADOW: false };

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED' },
  ReminderStatus: { SENT: 'SENT', FAILED: 'FAILED' },
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
  // $transaction interactivo: ejecuta el callback con un tx que reusa los mocks.
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => {
    txDepth++;
    try {
      return await cb(mockPrisma);
    } finally {
      txDepth--;
    }
  });
  // Por defecto el advance afecta 1 fila (camino feliz).
  mockPrisma.patientProgram.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.reminder.create.mockResolvedValue({ id: 'rem-1' });
});

function makeFakeBoss() {
  const send = vi.fn().mockResolvedValue('job-id');
  return { boss: { send } as any, send };
}

// ─── enqueueControls ───────────────────────────────────────────────────────────

describe('enqueueControls — encola sin tope', () => {
  function enrollmentRow(i: number, over: Partial<{ phone: string | null }> = {}) {
    return {
      id: `pp-${i}`,
      patient: {
        id: `pat-${i}`,
        phone: over.phone === undefined ? '+5493764125878' : over.phone,
      },
    };
  }

  it('encola N jobs cuando hay N inscripciones (N>500, sin el take capado)', async () => {
    const N = 600;
    const rows = Array.from({ length: N }, (_, i) => enrollmentRow(i));
    mockPrisma.patientProgram.findMany.mockResolvedValueOnce(rows).mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueControls } = await import('../services/reminder.service');
    const result = await enqueueControls(boss);

    expect(send).toHaveBeenCalledTimes(N);
    expect(result.enqueued).toBe(N);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('manda el singletonKey (control:{id}:{date}) + retryLimit:5 + retryBackoff:true', async () => {
    mockPrisma.patientProgram.findMany.mockResolvedValueOnce([enrollmentRow(7)]).mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueControls } = await import('../services/reminder.service');
    await enqueueControls(boss);

    expect(send).toHaveBeenCalledTimes(1);
    const [queueName, payload, opts] = send.mock.calls[0];
    expect(queueName).toBe('reminders:control');
    expect(payload).toMatchObject({ patientProgramId: 'pp-7', patientId: 'pat-7' });
    expect(payload.phone).toBeTypeOf('string');
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opts).toMatchObject({ retryLimit: 5, retryBackoff: true });
    expect(opts.singletonKey).toMatch(/^control:pp-7:\d{4}-\d{2}-\d{2}$/);
  });

  it('pagina por lotes hasta agotar (2 páginas llenas de 200 + cola)', async () => {
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => enrollmentRow(offset + i));
    mockPrisma.patientProgram.findMany
      .mockResolvedValueOnce(page(200, 0))
      .mockResolvedValueOnce(page(200, 200))
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueControls } = await import('../services/reminder.service');
    const result = await enqueueControls(boss);

    expect(result.enqueued).toBe(400);
    expect(send).toHaveBeenCalledTimes(400);
  });

  it('salta inscripciones de pacientes sin phone', async () => {
    mockPrisma.patientProgram.findMany
      .mockResolvedValueOnce([enrollmentRow(1), enrollmentRow(2, { phone: null })])
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueControls } = await import('../services/reminder.service');
    const result = await enqueueControls(boss);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(1);
  });

  it('M2: NO cuenta los jobs deduplicados por singletonKey (send → null)', async () => {
    mockPrisma.patientProgram.findMany
      .mockResolvedValueOnce([enrollmentRow(1), enrollmentRow(2), enrollmentRow(3)])
      .mockResolvedValue([]);

    const send = vi
      .fn()
      .mockResolvedValueOnce('job-1')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('job-3');
    const boss = { send } as any;

    const { enqueueControls } = await import('../services/reminder.service');
    const result = await enqueueControls(boss);

    expect(send).toHaveBeenCalledTimes(3);
    expect(result.enqueued).toBe(2);
  });
});

// ─── makeControlHandler ────────────────────────────────────────────────────────

describe('makeControlHandler — worker idempotente (muta nextReminderDate + crea reminder)', () => {
  const payload = {
    patientProgramId: 'pp-1',
    patientId: 'pat-1',
    phone: '543764125878',
    date: '2026-05-21',
  };

  function guardRow(over: Partial<{ reminderFrequencyDays: number }> = {}) {
    return {
      id: 'pp-1',
      nextReminderDate: new Date('2026-05-20T00:00:00Z'),
      patient: { id: 'pat-1', fullName: 'Ana López' },
      program: {
        id: 'prog-1',
        name: 'Hipertensión',
        templateMessage: 'Hola {{nombre}}, te toca tu control de presión.',
        reminderFrequencyDays: over.reminderFrequencyDays ?? 30,
      },
    };
  }

  it('éxito: envía, avanza nextReminderDate y crea reminder SENT (en $transaction)', async () => {
    mockPrisma.patientProgram.findFirst.mockResolvedValue(guardRow());

    const { makeControlHandler } = await import('../services/reminder.service');
    const handler = makeControlHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][0]).toBe('543764125878');
    // El template se interpola con el nombre.
    expect(mockSendTextMessage.mock.calls[0][1]).toContain('Ana');
    // Advance condicional + create dentro de una $transaction.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.patientProgram.updateMany).toHaveBeenCalledTimes(1);
    const updArg = mockPrisma.patientProgram.updateMany.mock.calls[0][0];
    expect(updArg.where).toMatchObject({ id: 'pp-1', status: 'ACTIVE' });
    expect(updArg.where.nextReminderDate).toBeDefined(); // gate condicional
    expect(updArg.data.nextReminderDate).toBeInstanceOf(Date);
    expect(mockPrisma.reminder.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.reminder.create.mock.calls[0][0].data).toMatchObject({ status: 'SENT' });
  });

  it('idempotente: si el advance afecta 0 filas (ya avanzado) → NO crea reminder', async () => {
    mockPrisma.patientProgram.findFirst.mockResolvedValue(guardRow());
    mockPrisma.patientProgram.updateMany.mockResolvedValue({ count: 0 });

    const { makeControlHandler } = await import('../services/reminder.service');
    const handler = makeControlHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockPrisma.patientProgram.updateMany).toHaveBeenCalledTimes(1);
    // El gate impidió el doble historial.
    expect(mockPrisma.reminder.create).not.toHaveBeenCalled();
  });

  it('C2: el envío ocurre FUERA de la $transaction', async () => {
    mockPrisma.patientProgram.findFirst.mockResolvedValue(guardRow());

    const { makeControlHandler } = await import('../services/reminder.service');
    const handler = makeControlHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendCalledInsideTx).toBe(false);
  });

  it('guard idempotente: si ya no es candidato (findFirst null) → NO envía ni muta', async () => {
    mockPrisma.patientProgram.findFirst.mockResolvedValue(null);

    const { makeControlHandler } = await import('../services/reminder.service');
    const handler = makeControlHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('frecuencia<1: skip sin enviar ni mutar (evita loop infinito, igual que el viejo)', async () => {
    mockPrisma.patientProgram.findFirst.mockResolvedValue(
      guardRow({ reminderFrequencyDays: 0 })
    );

    const { makeControlHandler } = await import('../services/reminder.service');
    const handler = makeControlHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.reminder.create).not.toHaveBeenCalled();
  });

  it('send=false: throw (pg-boss reintenta), NO crea reminder ni avanza', async () => {
    mockPrisma.patientProgram.findFirst.mockResolvedValue(guardRow());
    mockSendTextMessage.mockImplementation(async () => {
      if (txDepth > 0) sendCalledInsideTx = true;
      return false;
    });

    const { makeControlHandler } = await import('../services/reminder.service');
    const handler = makeControlHandler();

    await expect(handler([{ id: 'j1', data: payload }])).rejects.toThrow();
    expect(mockPrisma.reminder.create).not.toHaveBeenCalled();
    expect(mockPrisma.patientProgram.updateMany).not.toHaveBeenCalled();
  });

  it('QUEUE_SHADOW=true: NO envía ni muta, solo loguea (modo sombra de controles)', async () => {
    mockConfig.QUEUE_SHADOW = true;
    mockPrisma.patientProgram.findFirst.mockResolvedValue(guardRow());

    const { makeControlHandler } = await import('../services/reminder.service');
    const handler = makeControlHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.reminder.create).not.toHaveBeenCalled();
  });

  it('procesa cada job del batch (pg-boss v10 entrega arrays)', async () => {
    mockPrisma.patientProgram.findFirst.mockResolvedValue(guardRow());

    const { makeControlHandler } = await import('../services/reminder.service');
    const handler = makeControlHandler();
    await handler([
      { id: 'j1', data: { ...payload, patientProgramId: 'pp-1' } },
      { id: 'j2', data: { ...payload, patientProgramId: 'pp-2' } },
    ]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.reminder.create).toHaveBeenCalledTimes(2);
  });
});
