import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T11 — Migración de Medicación (#2) a la cola pg-boss ──────────────────────
// Mismo patrón validado en followup, con idempotencia de 2 capas (C-1 resuelto):
// medicación marca `lastSentAt` tras enviar, así un reintento de LOTE de pg-boss no
// re-envía (el guard descarta los ya enviados hoy). Cubre:
//   - enqueueMedicationReminders(): desactiva vencidos primero (mismo side-effect
//     que el viejo), excluye los ya enviados hoy (lastSentAt), luego encola SIN tope
//     (N>200 → N sends) con singletonKey + retryLimit/backoff. NO envía.
//   - makeMedicationHandler(): guard re-lee active + no vencido + consent + NO
//     enviado hoy; envía vía limiter; MARCA lastSentAt (updateMany condicional); si
//     send=false → throw (sin marcar); QUEUE_SHADOW → ni envía ni marca.

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

const mockConfig: { QUEUE_SHADOW: boolean; SEND_MAX_CONCURRENT: number } = { QUEUE_SHADOW: false, SEND_MAX_CONCURRENT: 20 };

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

  it('el productor EXCLUYE los ya enviados hoy (where con lastSentAt) — C-1', async () => {
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([medRow(1)]).mockResolvedValue([]);

    const { boss } = makeFakeBoss();
    const { enqueueMedicationReminders } = await import('../services/medication-reminder.service');
    await enqueueMedicationReminders(boss);

    // La query de candidatos (segundo updateMany es la de deactivate; findMany es el barrido)
    const whereArg = mockPrisma.medicationReminder.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(whereArg)).toContain('lastSentAt');
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

describe('makeMedicationHandler — worker idempotente vía lastSentAt (C-1)', () => {
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

  it('envía y MARCA lastSentAt (idempotencia C-1) con updateMany condicional', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());
    mockPrisma.medicationReminder.updateMany.mockResolvedValue({ count: 1 });

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][0]).toBe('543764125878');
    expect(mockSendTextMessage.mock.calls[0][1]).toContain('Enalapril');
    // Ahora SÍ muta: marca lastSentAt para que un reintento de lote no re-envíe.
    expect(mockPrisma.medicationReminder.updateMany).toHaveBeenCalledTimes(1);
    const upd = mockPrisma.medicationReminder.updateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: 'med-1', active: true });
    expect(upd.data.lastSentAt).toBeInstanceOf(Date);
    // El where condicional reincluye la condición de lastSentAt (no re-marcar en carrera).
    expect(JSON.stringify(upd.where)).toContain('lastSentAt');
  });

  it('incluye la línea de instrucciones cuando existe', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(
      medGuardRow({ instructions: 'Tomar con comida' })
    );
    mockPrisma.medicationReminder.updateMany.mockResolvedValue({ count: 1 });

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage.mock.calls[0][1]).toContain('Tomar con comida');
  });

  it('C2: el envío ocurre FUERA de la $transaction', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendCalledInsideTx).toBe(false);
  });

  it('guard: el findFirst chequea active + consent + no-vencido + lastSentAt (no enviado hoy)', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    const guardWhere = mockPrisma.medicationReminder.findFirst.mock.calls[0][0].where;
    expect(guardWhere).toMatchObject({ id: 'med-1', active: true });
    expect(guardWhere.patient).toMatchObject({ consent: true });
    // El guard reincluye la condición de lastSentAt (null OR < hoy) — clave de C-1:
    // si ya se envió hoy, un reintento de lote NO vuelve a enviar.
    expect(JSON.stringify(guardWhere)).toContain('lastSentAt');
  });

  it('el guard usa la forma exacta del OR de lastSentAt (null OR < cutoff de hoy)', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    const guardWhere = mockPrisma.medicationReminder.findFirst.mock.calls[0][0].where;
    const clause = guardWhere.AND.find(
      (c: any) => Array.isArray(c.OR) && c.OR.some((o: any) => 'lastSentAt' in o)
    );
    expect(clause).toBeDefined();
    expect(clause.OR).toEqual([
      { lastSentAt: null },
      { lastSentAt: { lt: expect.any(Date) } },
    ]);
  });

  it('updateMany de marca devuelve count 0 (otro worker ya marcó) → no rompe', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());
    mockPrisma.medicationReminder.updateMany.mockResolvedValue({ count: 0 });

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    // No debe lanzar aunque el updateMany condicional no afecte filas (carrera).
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockPrisma.medicationReminder.updateMany).toHaveBeenCalledTimes(1);
  });

  it('C-1: ya enviado hoy (findFirst null) → NO envía NI re-marca', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(null);

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.medicationReminder.updateMany).not.toHaveBeenCalled();
  });

  it('hace throw cuando sendTextMessage devuelve false (pg-boss reintenta), NO marca', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());
    mockSendTextMessage.mockImplementation(async () => {
      if (txDepth > 0) sendCalledInsideTx = true;
      return false;
    });

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();

    await expect(handler([{ id: 'j1', data: payload }])).rejects.toThrow();
    expect(mockPrisma.medicationReminder.updateMany).not.toHaveBeenCalled();
  });

  it('QUEUE_SHADOW=true: NO envía ni marca, solo loguea', async () => {
    mockConfig.QUEUE_SHADOW = true;
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.medicationReminder.updateMany).not.toHaveBeenCalled();
  });

  it('procesa cada job del batch (pg-boss v10 entrega arrays)', async () => {
    mockPrisma.medicationReminder.findFirst.mockResolvedValue(medGuardRow());
    mockPrisma.medicationReminder.updateMany.mockResolvedValue({ count: 1 });

    const { makeMedicationHandler } = await import('../services/medication-reminder.service');
    const handler = makeMedicationHandler();
    await handler([
      { id: 'j1', data: { ...payload, reminderId: 'med-1' } },
      { id: 'j2', data: { ...payload, reminderId: 'med-2' } },
    ]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.medicationReminder.updateMany).toHaveBeenCalledTimes(2);
  });
});
