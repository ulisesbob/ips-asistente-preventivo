import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T10 — Migración de Survey (#5) a la cola pg-boss ──────────────────────────
// Mismo patrón validado en followup (followup-queue.test.ts). Cubre:
//   - enqueueSurveys(): encola SIN tope (N>100 → N sends), con singletonKey
//     (survey:{surveyId}, SIN fecha: se manda una sola vez) + retryLimit/backoff.
//     NO envía (solo encola). M2: enqueued cuenta encolados reales (send→null dedup).
//   - makeSurveyHandler(): el worker envía vía limiter + sendTextMessage; si OK
//     marca dispatchedAt con un updateMany CONDICIONAL (where reincluye el guard:
//     dispatchedAt null + completedAt null). Si send=false → throw (pg-boss reintenta).
//     QUEUE_SHADOW=true → ni envía ni muta, loguea. Guard: si ya despachada o
//     completada (otro proceso) → skip.
//
// Mock de Prisma + messaging + limiter (patrón followup-queue.test.ts).

const mockPrisma = {
  survey: {
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

const mockConfig: { QUEUE_SHADOW: boolean; IPS_SUPPORT_PHONE: string } = {
  QUEUE_SHADOW: false,
  IPS_SUPPORT_PHONE: '0800-888-0109',
};

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
});

function makeFakeBoss() {
  const send = vi.fn().mockResolvedValue('job-id');
  return { boss: { send } as any, send };
}

// ─── enqueueSurveys ────────────────────────────────────────────────────────────

describe('enqueueSurveys — encola sin tope', () => {
  function surveyRow(i: number, over: Partial<{ phone: string | null }> = {}) {
    return {
      id: `survey-${i}`,
      patientId: `pat-${i}`,
      patient: { phone: over.phone === undefined ? '+5493764125878' : over.phone },
    };
  }

  it('encola N jobs cuando hay N encuestas (N>100, sin el take capado)', async () => {
    const N = 150;
    const surveys = Array.from({ length: N }, (_, i) => surveyRow(i));
    mockPrisma.survey.findMany.mockResolvedValueOnce(surveys).mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueSurveys } = await import('../services/survey.service');
    const result = await enqueueSurveys(boss);

    expect(send).toHaveBeenCalledTimes(N);
    expect(result.enqueued).toBe(N);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('manda el singletonKey (survey:{id}, sin fecha) + retryLimit:5 + retryBackoff:true', async () => {
    mockPrisma.survey.findMany.mockResolvedValueOnce([surveyRow(7)]).mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueSurveys } = await import('../services/survey.service');
    await enqueueSurveys(boss);

    expect(send).toHaveBeenCalledTimes(1);
    const [queueName, payload, opts] = send.mock.calls[0];
    expect(queueName).toBe('reminders:survey');
    expect(payload).toMatchObject({ surveyId: 'survey-7', patientId: 'pat-7' });
    expect(payload.phone).toBeTypeOf('string');
    // Survey NO lleva fecha en el payload (se manda una sola vez).
    expect(payload.date).toBeUndefined();
    expect(opts).toMatchObject({ retryLimit: 5, retryBackoff: true });
    expect(opts.singletonKey).toBe('survey:survey-7');
  });

  it('pagina por lotes hasta agotar (2 páginas llenas de 200 + cola)', async () => {
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => surveyRow(offset + i));
    mockPrisma.survey.findMany
      .mockResolvedValueOnce(page(200, 0))
      .mockResolvedValueOnce(page(200, 200))
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueSurveys } = await import('../services/survey.service');
    const result = await enqueueSurveys(boss);

    expect(result.enqueued).toBe(400);
    expect(send).toHaveBeenCalledTimes(400);
  });

  it('salta encuestas de pacientes sin phone (no encola jobs sin destino)', async () => {
    mockPrisma.survey.findMany
      .mockResolvedValueOnce([surveyRow(1), surveyRow(2, { phone: null })])
      .mockResolvedValue([]);

    const { boss, send } = makeFakeBoss();
    const { enqueueSurveys } = await import('../services/survey.service');
    const result = await enqueueSurveys(boss);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(1);
  });

  it('M2: NO cuenta los jobs deduplicados por singletonKey (send → null)', async () => {
    mockPrisma.survey.findMany
      .mockResolvedValueOnce([surveyRow(1), surveyRow(2), surveyRow(3)])
      .mockResolvedValue([]);

    const send = vi
      .fn()
      .mockResolvedValueOnce('job-1')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('job-3');
    const boss = { send } as any;

    const { enqueueSurveys } = await import('../services/survey.service');
    const result = await enqueueSurveys(boss);

    expect(send).toHaveBeenCalledTimes(3);
    expect(result.enqueued).toBe(2);
  });
});

// ─── makeSurveyHandler ─────────────────────────────────────────────────────────

describe('makeSurveyHandler — worker idempotente', () => {
  const payload = { surveyId: 'survey-1', patientId: 'pat-1', phone: '543764125878' };

  function surveyGuardRow() {
    return {
      id: 'survey-1',
      patient: { fullName: 'Ana López' },
      patientProgram: { program: { name: 'Hipertensión' } },
    };
  }

  it('envía y marca dispatchedAt cuando el guard pasa (sin despachar, sin completar)', async () => {
    mockPrisma.survey.findFirst.mockResolvedValue(surveyGuardRow());
    mockPrisma.survey.updateMany.mockResolvedValue({ count: 1 });

    const { makeSurveyHandler } = await import('../services/survey.service');
    const handler = makeSurveyHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][0]).toBe('543764125878');
    // El mensaje incluye el nombre del programa.
    expect(mockSendTextMessage.mock.calls[0][1]).toContain('Hipertensión');
    expect(mockPrisma.survey.updateMany).toHaveBeenCalledTimes(1);
    const updateArg = mockPrisma.survey.updateMany.mock.calls[0][0];
    expect(updateArg.where).toMatchObject({
      id: 'survey-1',
      dispatchedAt: null,
      completedAt: null,
    });
    expect(updateArg.data.dispatchedAt).toBeInstanceOf(Date);
  });

  it('C2: NO llama sendTextMessage dentro de una $transaction', async () => {
    mockPrisma.survey.findFirst.mockResolvedValue(surveyGuardRow());
    mockPrisma.survey.updateMany.mockResolvedValue({ count: 1 });

    const { makeSurveyHandler } = await import('../services/survey.service');
    const handler = makeSurveyHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendCalledInsideTx).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('guard idempotente: si ya fue despachada/completada (findFirst null) → NO envía ni muta', async () => {
    mockPrisma.survey.findFirst.mockResolvedValue(null);

    const { makeSurveyHandler } = await import('../services/survey.service');
    const handler = makeSurveyHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.survey.updateMany).not.toHaveBeenCalled();
  });

  it('hace throw cuando sendTextMessage devuelve false (pg-boss reintenta), NO muta', async () => {
    mockPrisma.survey.findFirst.mockResolvedValue(surveyGuardRow());
    mockSendTextMessage.mockImplementation(async () => {
      if (txDepth > 0) sendCalledInsideTx = true;
      return false;
    });

    const { makeSurveyHandler } = await import('../services/survey.service');
    const handler = makeSurveyHandler();

    await expect(handler([{ id: 'j1', data: payload }])).rejects.toThrow();
    expect(mockPrisma.survey.updateMany).not.toHaveBeenCalled();
  });

  it('QUEUE_SHADOW=true: NO envía ni muta, solo loguea', async () => {
    mockConfig.QUEUE_SHADOW = true;
    mockPrisma.survey.findFirst.mockResolvedValue(surveyGuardRow());

    const { makeSurveyHandler } = await import('../services/survey.service');
    const handler = makeSurveyHandler();
    await handler([{ id: 'j1', data: payload }]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.survey.updateMany).not.toHaveBeenCalled();
  });

  it('procesa cada job del batch (pg-boss v10 entrega arrays)', async () => {
    mockPrisma.survey.findFirst.mockResolvedValue(surveyGuardRow());
    mockPrisma.survey.updateMany.mockResolvedValue({ count: 1 });

    const { makeSurveyHandler } = await import('../services/survey.service');
    const handler = makeSurveyHandler();
    await handler([
      { id: 'j1', data: { ...payload, surveyId: 'survey-1' } },
      { id: 'j2', data: { ...payload, surveyId: 'survey-2' } },
    ]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.survey.updateMany).toHaveBeenCalledTimes(2);
  });
});
