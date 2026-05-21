import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T11 — Migración de Medicación (#2) a la cola pg-boss ──────────────────────
// Mismo patrón validado en followup. Particularidad de medicación: NO muta estado
// por envío (no hay lastSentAt). La idempotencia es 100% por singletonKey
// (medication:{reminderId}:{date}:{HH:MM}) + el hecho de que el cron matchea un
// único slot por día. Por eso el handler NO hace updateMany: solo guard + envío.
// Cubre:
//   - enqueueMedicationReminders(): desactiva vencidos primero (mismo side-effect
//     que el viejo), luego encola SIN tope (N>200 → N sends) con singletonKey +
//     retryLimit/backoff. NO envía. M2: enqueued cuenta encolados reales.
//   - makeMedicationHandler(): envía vía limiter; guard re-lee active + no vencido
//     + consent; si send=false → throw; QUEUE_SHADOW → ni envía.

const mockPrisma = {
  medicationReminder: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
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
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
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
  // Default: no vencidos por desactivar.
  mockPrisma.medicationReminder.updateMany.mockResolvedValue({ count: 0 });
});

function makeFakeBoss() {
  const send = vi.fn().mockResolvedValue('job-id');
  return { boss: { send } as any, send };
}

// ─── enqueueMedicationReminders ────────────────────────────────────────────────

describe('enqueueMedicationReminders — encola sin tope', () => {
  function medRow(i: number, over: Partial<{ phone: string | null }> = {}) {
    return {
      id: `med-${i}`,
      patientId: `pat-${i}`,
      patient: { phone: over.phone === undefined ? '+5493764125878' : over.phone },
    };
  }

  it('encola N jobs cuando hay N recordatorios (N>200, sin el take capado)', async () => {
    const N = 250;
    const meds = Array.from({ length: N }, (_, i) => medRow(i));
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce(meds).mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueMedicationReminders } = await import('../services/medication-reminder.service');
    const result = await enqueueMedicationReminders(boss);

    expect(send).toHaveBeenCalledTimes(N);
    expect(result.enqueued).toBe(N);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('desactiva los tratamientos vencidos ANTES de encolar (endDate < hoy)', async () => {
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([medRow(1)]).mockResolvedValue([]);
    mockPrisma.medicationReminder.updateMany.mockResolvedValue({ count: 3 });

    const { boss } = makeFakeBoss();
    const { enqueueMedicationReminders } = await import('../services/medication-reminder.service');
    await enqueueMedicationReminders(boss);

    // Un updateMany de desactivación de vencidos.
    expect(mockPrisma.medicationReminder.updateMany).toHaveBeenCalledTimes(1);
    const deactivateArg = mockPrisma.medicationReminder.updateMany.mock.calls[0][0];
    expect(deactivateArg.where).toMatchObject({ active: true });
    expect(deactivateArg.where.endDate).toBeDefined();
    expect(deactivateArg.data).toMatchObject({ active: false });
  });

  it('manda el singletonKey (medication:{id}:{date}:{HH:MM}) + retryLimit:5 + retryBackoff:true', async () => {
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([medRow(7)]).mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueMedicationReminders } = await import('../services/medication-reminder.service');
    await enqueueMedicationReminders(boss);

    expect(send).toHaveBeenCalledTimes(1);
    const [queueName, payload, opts] = send.mock.calls[0];
    expect(queueName).toBe('reminders:medication');
    expect(payload).toMatchObject({ reminderId: 'med-7', patientId: 'pat-7' });
    expect(payload.phone).toBeTypeOf('string');
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.reminderHour).toBeTypeOf('number');
    expect([0, 30]).toContain(payload.reminderMinute);
    expect(opts).toMatchObject({ retryLimit: 5, retryBackoff: true });
    // singletonKey: medication:med-7:YYYY-MM-DD:HH:MM
    expect(opts.singletonKey).toMatch(/^medication:med-7:\d{4}-\d{2}-\d{2}:\d{2}:\d{2}$/);
  });

  it('pagina por lotes hasta agotar (2 páginas llenas de 200 + cola)', async () => {
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => medRow(offset + i));
    mockPrisma.medicationReminder.findMany
      .mockResolvedValueOnce(page(200, 0))
      .mockResolvedValueOnce(page(200, 200))
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueMedicationReminders } = await import('../services/medication-reminder.service');
    const result = await enqueueMedicationReminders(boss);

    expect(result.enqueued).toBe(400);
    expect(send).toHaveBeenCalledTimes(400);
  });

  it('salta recordatorios de pacientes sin phone', async () => {
    mockPrisma.medicationReminder.findMany
      .mockResolvedValueOnce([medRow(1), medRow(2, { phone: null })])
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueMedicationReminders } = await import('../services/medication-reminder.service');
    const result = await enqueueMedicationReminders(boss);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(1);
  });

  it('M2: NO cuenta los jobs deduplicados por singletonKey (send → null)', async () => {
    mockPrisma.medicationReminder.findMany
      .mockResolvedValueOnce([medRow(1), medRow(2), medRow(3)])
      .mockResolvedValue([]);

    const send = vi
      .fn()
      .mockResolvedValueOnce('job-1')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('job-3');
    const boss = { send } as any;

    const { enqueueMedicationReminders } = await import('../services/medication-reminder.service');
    const result = await enqueueMedicationReminders(boss);

    expect(send).toHaveBeenCalledTimes(3);
    expect(result.enqueued).toBe(2);
  });
});

// ─── makeMedicationHandler ─────────────────────────────────────────────────────

describe('makeMedicationHandler — worker (sin mutación de estado)', () => {
  const payload = {
    reminderId: 'med-1',
    patientId: 'pat-1',
    phone: '543764125878',
    date: '2026-05-21',
    reminderHour: 8,
    reminderMinute: 0,
  };

  function medGuardRow(over: Partial<{ instructions: string | null }> = {}) {
    return {
      id: 'med-1',
      medicationName: 'Enalapril',
      dosage: '10mg',
      instructions: over.instructions === undefined ? null : over.instructions,
      patient: { fullName: 'Ana López' },
    };
  }

  it('envía cuando el guard pasa (active, no vencido, consent), SIN mutar estado', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][0]).toBe('543764125878');
    expect(mockSendTextMessage.mock.calls[0][1]).toContain('Enalapril');
    // Medicación NO muta estado por envío.
    expect(mockPrisma.medicationReminder.updateMany).not.toHaveBeenCalled();
  });

  it('incluye la línea de instrucciones cuando existe', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(
      medGuardRow({ instructions: 'Tomar con comida' })
    );

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage.mock.calls[0][1]).toContain('Tomar con comida');
  });

  it('C2: NO llama sendTextMessage dentro de una $transaction', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendCalledInsideTx).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('guard: el findFirst chequea active + consent + no-vencido', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    const guardWhere = mockPrisma.medicationReminder.findFirst.mock.calls[0][0].where;
    expect(guardWhere).toMatchObject({ id: 'med-1', active: true });
    expect(guardWhere.patient).toMatchObject({ consent: true });
    // No-vencido: endDate null OR >= hoy.
    expect(guardWhere.OR ?? guardWhere.AND).toBeDefined();
  });

  it('guard idempotente: si el recordatorio ya no es candidato (findFirst null) → NO envía', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(null);

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('hace throw cuando sendTextMessage devuelve false (pg-boss reintenta)', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());
    mockSendTextMessage.mockImplementation(async () => {
      if (txDepth > 0) sendCalledInsideTx = true;
      return false;
    });

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();

    await expect(handler([{ id: 'j1', data: payload }])).rejects.toThrow();
  });

  it('QUEUE_SHADOW=true: NO envía, solo loguea', async () => {
    mockConfig.QUEUE_SHADOW = true;
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('procesa cada job del batch (pg-boss v10 entrega arrays)', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([
      { id: 'j1', data: { ...payload, reminderId: 'med-1' } },
      { id: 'j2', data: { ...payload, reminderId: 'med-2' } },
    ]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
  });
});
