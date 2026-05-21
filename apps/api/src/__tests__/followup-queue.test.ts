import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T7 — Migración de Followup (#4) a la cola pg-boss ─────────────────────────
// Cubre:
//   - enqueueFollowups(): encola SIN tope (N>200 → N sends), con singletonKey +
//     retryLimit/retryBackoff. NO envía (solo encola).
//   - makeFollowupHandler(): el worker envía vía limiter + sendTextMessage; si OK
//     muta noProgramReminderCount/lastNoProgramReminderAt de forma IDEMPOTENTE
//     (guard re-lee sin programa + count<3 dentro de $transaction). Si send=false
//     → throw (pg-boss reintenta). QUEUE_SHADOW=true → ni envía ni muta, loguea.
//
// Mock de Prisma + messaging + limiter (patrón self-reminder-service.test.ts).

const mockPrisma = {
  patient: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

const mockSendTextMessage = vi.fn();
const mockSchedule = vi.fn();

// C2: tracker para detectar si sendTextMessage se llamó MIENTRAS había una
// $transaction abierta. El send (llamada de red) NO debe ocurrir dentro de la tx
// — eso mantendría tx + lock abiertos durante la latencia de red (riesgo P2028 →
// reintento → reenvío). Se setea en el beforeEach.
let txDepth = 0;
let sendCalledInsideTx = false;

// Flags mutables por test. config se importa del módulo real, pero lo mockeamos
// para poder togglear QUEUE_SHADOW sin tocar process.env entre tests.
const mockConfig: { QUEUE_SHADOW: boolean; SEND_MAX_CONCURRENT: number; IPS_SUPPORT_PHONE: string } = {
  QUEUE_SHADOW: false, SEND_MAX_CONCURRENT: 20,
  IPS_SUPPORT_PHONE: '0800-888-0109',
};

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED' },
  RegisteredVia: { BOT: 'BOT', CSV: 'CSV', PANEL: 'PANEL' },
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
  // El send marca si fue invocado dentro de una tx abierta (C2).
  mockSendTextMessage.mockImplementation(async () => {
    if (txDepth > 0) sendCalledInsideTx = true;
    return true;
  });
  // El limiter real ejecuta la fn; el mock hace lo mismo.
  mockSchedule.mockImplementation((fn: () => Promise<unknown>) => fn());
  // $transaction: marca entrada/salida para que el tracker sepa cuándo está
  // abierta, y ejecuta el callback con un "tx" que reusa los mocks de patient.
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => {
    txDepth++;
    try {
      return await cb(mockPrisma);
    } finally {
      txDepth--;
    }
  });
});

// Helper: construye un fake boss que captura los send().
function makeFakeBoss() {
  const send = vi.fn().mockResolvedValue('job-id');
  return { boss: { send } as any, send };
}

// ─── enqueueFollowups ─────────────────────────────────────────────────────────

describe('enqueueFollowups — encola sin tope', () => {
  it('encola N jobs cuando hay N pacientes (N>200, sin el take capado)', async () => {
    const N = 250;
    const patients = Array.from({ length: N }, (_, i) => ({
      id: `pat-${i}`,
      fullName: `Paciente ${i}`,
      phone: '+5493764125878',
      noProgramReminderCount: 0,
      createdAt: new Date('2026-01-01'),
    }));
    // Una sola página: la 2da llamada devuelve [] para cortar el loop.
    mockPrisma.patient.findMany
      .mockResolvedValueOnce(patients)
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueFollowups } = await import('../services/patient-followup.service');
    const result = await enqueueFollowups(boss);

    expect(send).toHaveBeenCalledTimes(N);
    expect(result.enqueued).toBe(N);
    // NO envía nada acá (solo encola).
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('manda el singletonKey + retryLimit:5 + retryBackoff:true por job', async () => {
    mockPrisma.patient.findMany
      .mockResolvedValueOnce([
        {
          id: 'pat-x',
          fullName: 'Ana López',
          phone: '+5493764125878',
          noProgramReminderCount: 1,
          createdAt: new Date('2026-01-01'),
        },
      ])
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueFollowups } = await import('../services/patient-followup.service');
    await enqueueFollowups(boss);

    expect(send).toHaveBeenCalledTimes(1);
    const [queueName, payload, opts] = send.mock.calls[0];
    expect(queueName).toBe('reminders:followup');
    expect(payload).toMatchObject({ patientId: 'pat-x' });
    expect(payload.phone).toBeTypeOf('string');
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opts).toMatchObject({ retryLimit: 5, retryBackoff: true });
    expect(opts.singletonKey).toContain('followup:pat-x:');
  });

  it('pagina por lotes hasta agotar (sin descartar) — 2 páginas llenas + cola', async () => {
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `pat-${offset + i}`,
        fullName: `P ${offset + i}`,
        phone: '+5493764125878',
        noProgramReminderCount: 0,
        createdAt: new Date('2026-01-01'),
      }));
    // Tamaño de lote interno = 200. Dos lotes llenos + uno vacío.
    mockPrisma.patient.findMany
      .mockResolvedValueOnce(page(200, 0))
      .mockResolvedValueOnce(page(200, 200))
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueFollowups } = await import('../services/patient-followup.service');
    const result = await enqueueFollowups(boss);

    expect(result.enqueued).toBe(400);
    expect(send).toHaveBeenCalledTimes(400);
  });

  it('salta pacientes sin phone (no encola jobs sin destino)', async () => {
    mockPrisma.patient.findMany
      .mockResolvedValueOnce([
        { id: 'p1', fullName: 'Con Tel', phone: '+5493764125878', noProgramReminderCount: 0, createdAt: new Date('2026-01-01') },
        { id: 'p2', fullName: 'Sin Tel', phone: null, noProgramReminderCount: 0, createdAt: new Date('2026-01-01') },
      ])
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueFollowups } = await import('../services/patient-followup.service');
    const result = await enqueueFollowups(boss);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(1);
  });

  // ─── M2: enqueued cuenta ENCOLADOS reales, no intentos ──────────────────────
  // boss.send retorna null cuando el singletonKey deduplica (ya hay un job en cola
  // ese día). enqueued NO debe contar esos: la métrica gatea el test de migración.
  it('M2: NO cuenta los jobs deduplicados por singletonKey (send → null)', async () => {
    mockPrisma.patient.findMany
      .mockResolvedValueOnce([
        { id: 'p1', fullName: 'A', phone: '+5493764125878', noProgramReminderCount: 0, createdAt: new Date('2026-01-01') },
        { id: 'p2', fullName: 'B', phone: '+5493764125878', noProgramReminderCount: 0, createdAt: new Date('2026-01-01') },
        { id: 'p3', fullName: 'C', phone: '+5493764125878', noProgramReminderCount: 0, createdAt: new Date('2026-01-01') },
      ])
      .mockResolvedValue([]);

    const send = vi
      .fn()
      .mockResolvedValueOnce('job-1') // encolado
      .mockResolvedValueOnce(null) // deduplicado (singletonKey)
      .mockResolvedValueOnce('job-3'); // encolado
    const boss = { send } as any;

    const { enqueueFollowups } = await import('../services/patient-followup.service');
    const result = await enqueueFollowups(boss);

    // 3 intentos de send, pero solo 2 encolados reales.
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.enqueued).toBe(2);
  });
});

// ─── makeFollowupHandler ──────────────────────────────────────────────────────

describe('makeFollowupHandler — worker idempotente', () => {
  const payload = {
    patientId: 'pat-1',
    phone: '543764125878',
    date: '2026-05-21',
  };

  function patientRow(over: Partial<{ noProgramReminderCount: number }> = {}) {
    return {
      id: 'pat-1',
      fullName: 'Ana López',
      phone: '543764125878',
      noProgramReminderCount: 0,
      createdAt: new Date('2026-01-01'),
      ...over,
    };
  }

  it('envía y muta count+lastAt cuando el guard pasa (sin programa, count<3)', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(patientRow());
    mockPrisma.patient.updateMany.mockResolvedValue({ count: 1 });

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    // El envío usa el phone del payload.
    expect(mockSendTextMessage.mock.calls[0][0]).toBe('543764125878');
    // Muta de forma idempotente (increment + lastAt) vía updateMany (where condicional).
    expect(mockPrisma.patient.updateMany).toHaveBeenCalledTimes(1);
    const updateArg = mockPrisma.patient.updateMany.mock.calls[0][0];
    expect(updateArg.where).toMatchObject({ id: 'pat-1' });
    expect(updateArg.data).toMatchObject({
      noProgramReminderCount: { increment: 1 },
    });
    expect(updateArg.data.lastNoProgramReminderAt).toBeInstanceOf(Date);
  });

  // ─── C2: la red (sendTextMessage) NO va dentro de $transaction ──────────────
  // Mantener tx + lock abiertos durante la latencia de red arriesga P2028 timeout
  // → reintento → reenvío. El send debe ocurrir FUERA de toda tx; el update va
  // después con un where condicional que reincluye el guard (atomicidad sin red
  // adentro).
  it('C2: NO llama sendTextMessage dentro de una $transaction', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(patientRow());
    mockPrisma.patient.updateMany.mockResolvedValue({ count: 1 });

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    // Lo importante: el send NO ocurrió mientras una tx estaba abierta.
    expect(sendCalledInsideTx).toBe(false);
    // El handler NO debe envolver el envío en una $transaction larga.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('C2: el update post-envío usa un where CONDICIONAL que reincluye el guard', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(patientRow());
    mockPrisma.patient.updateMany.mockResolvedValue({ count: 1 });

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const { MAX_FOLLOWUPS } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([{ id: 'j1', data: payload }]);

    const updateArg = mockPrisma.patient.updateMany.mock.calls[0][0];
    // El where reincluye las condiciones del guard para mantener atomicidad sin
    // la red adentro de la tx (otro proceso pudo enrolar / dar de baja mientras
    // viajaba el mensaje).
    expect(updateArg.where).toMatchObject({
      id: 'pat-1',
      consent: true,
      noProgramReminderCount: { lt: MAX_FOLLOWUPS },
      programs: { none: { status: 'ACTIVE' } },
    });
  });

  // ─── M1: el guard re-chequea lastNoProgramReminderAt (intervalo de 7 días) ──
  // Un reintento al día siguiente no debe reenviar si el último envío fue <7 días.
  it('M1: el guard (findFirst) chequea lastNoProgramReminderAt (null OR < cutoff 7d)', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(patientRow());
    mockPrisma.patient.updateMany.mockResolvedValue({ count: 1 });

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([{ id: 'j1', data: payload }]);

    const guardWhere = mockPrisma.patient.findFirst.mock.calls[0][0].where;
    expect(guardWhere.OR).toEqual([
      { lastNoProgramReminderAt: null },
      { lastNoProgramReminderAt: { lt: expect.any(Date) } },
    ]);
    // El cutoff es ~7 días atrás.
    const cutoff = guardWhere.OR[1].lastNoProgramReminderAt.lt as Date;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const diff = Date.now() - cutoff.getTime();
    expect(diff).toBeGreaterThan(sevenDaysMs - 60_000);
    expect(diff).toBeLessThan(sevenDaysMs + 60_000);
  });

  it('M1: el where condicional del update también re-chequea lastNoProgramReminderAt', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(patientRow());
    mockPrisma.patient.updateMany.mockResolvedValue({ count: 1 });

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([{ id: 'j1', data: payload }]);

    const updateWhere = mockPrisma.patient.updateMany.mock.calls[0][0].where;
    expect(updateWhere.OR).toEqual([
      { lastNoProgramReminderAt: null },
      { lastNoProgramReminderAt: { lt: expect.any(Date) } },
    ]);
  });

  it('M1: si el guard ya envió <7 días (findFirst null), NO reenvía', async () => {
    // El where del guard excluye a quien recibió followup hace <7d → findFirst null.
    mockPrisma.patient.findFirst.mockResolvedValue(null);

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.patient.updateMany).not.toHaveBeenCalled();
  });

  it('hace throw cuando sendTextMessage devuelve false (pg-boss reintenta)', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(patientRow());
    mockSendTextMessage.mockImplementation(async () => {
      if (txDepth > 0) sendCalledInsideTx = true;
      return false;
    });

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();

    await expect(handler([{ id: 'j1', data: payload }])).rejects.toThrow();
    // NO muta si el envío falló.
    expect(mockPrisma.patient.updateMany).not.toHaveBeenCalled();
  });

  it('guard idempotente: si el paciente ya se enroló o count>=3, NO envía ni muta', async () => {
    // findFirst (re-read dentro del guard) devuelve null → ya no candidato.
    mockPrisma.patient.findFirst.mockResolvedValue(null);

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.patient.updateMany).not.toHaveBeenCalled();
  });

  it('QUEUE_SHADOW=true: NO envía ni muta, solo loguea (habría enviado)', async () => {
    mockConfig.QUEUE_SHADOW = true;
    mockPrisma.patient.findFirst.mockResolvedValue(patientRow());

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.patient.updateMany).not.toHaveBeenCalled();
  });

  it('procesa cada job del batch (pg-boss v10 entrega arrays)', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(patientRow());
    mockPrisma.patient.updateMany.mockResolvedValue({ count: 1 });

    const { makeFollowupHandler } = await import('../services/patient-followup.service');
    const handler = makeFollowupHandler();
    await handler([
      { id: 'j1', data: { ...payload, patientId: 'pat-1' } },
      { id: 'j2', data: { ...payload, patientId: 'pat-2' } },
    ]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.patient.updateMany).toHaveBeenCalledTimes(2);
  });
});
