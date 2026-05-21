import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T7 — queue/register-workers.ts ───────────────────────────────────────────
// registerQueueWorkers(boss): registra los workers de las colas cuyo flag está
// ON + el dead-letter handler. Diseñado para sumar colas en etapas siguientes sin
// tocar index.ts. Por ahora: solo followup (si QUEUE_FOLLOWUP).
//   - QUEUE_FOLLOWUP=false → NO registra worker de followup (solo dead-letter).
//   - QUEUE_FOLLOWUP=true  → boss.work(reminders:followup, handler) + dead-letter.

const mockConfig: {
  QUEUE_FOLLOWUP: boolean;
  QUEUE_SURVEY: boolean;
  QUEUE_MEDICATION: boolean;
} = {
  QUEUE_FOLLOWUP: false,
  QUEUE_SURVEY: false,
  QUEUE_MEDICATION: false,
};
const mockMakeFollowupHandler = vi.fn(() => async () => undefined);
const mockMakeSurveyHandler = vi.fn(() => async () => undefined);
const mockMakeMedicationHandler = vi.fn(() => async () => undefined);
const mockRegisterDeadLetterHandler = vi.fn().mockResolvedValue(undefined);

vi.mock('../config/env', () => ({ config: mockConfig }));

vi.mock('../services/patient-followup.service', () => ({
  makeFollowupHandler: mockMakeFollowupHandler,
}));

vi.mock('../services/survey.service', () => ({
  makeSurveyHandler: mockMakeSurveyHandler,
}));

vi.mock('../services/medication-reminder.service', () => ({
  makeMedicationHandler: mockMakeMedicationHandler,
}));

vi.mock('../queue/send-worker', () => ({
  registerDeadLetterHandler: mockRegisterDeadLetterHandler,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.QUEUE_FOLLOWUP = false;
  mockConfig.QUEUE_SURVEY = false;
  mockConfig.QUEUE_MEDICATION = false;
});

function makeFakeBoss() {
  const work = vi.fn().mockResolvedValue('worker-id');
  const createQueue = vi.fn().mockResolvedValue(undefined);
  return { boss: { work, createQueue } as any, work, createQueue };
}

describe('registerQueueWorkers', () => {
  it('flag followup OFF: NO registra worker de followup (pero sí dead-letter)', async () => {
    const { boss, work } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    // No se registró ningún worker de cola de envío.
    const followupCalls = work.mock.calls.filter((c) => c[0] === 'reminders:followup');
    expect(followupCalls).toHaveLength(0);
    // El dead-letter SIEMPRE se registra.
    expect(mockRegisterDeadLetterHandler).toHaveBeenCalledTimes(1);
  });

  it('flag followup ON: registra worker de reminders:followup con su handler', async () => {
    mockConfig.QUEUE_FOLLOWUP = true;
    const { boss, work } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    const followupCalls = work.mock.calls.filter((c) => c[0] === 'reminders:followup');
    expect(followupCalls).toHaveLength(1);
    expect(mockMakeFollowupHandler).toHaveBeenCalledTimes(1);
    // El handler pasado a work() es el que devolvió makeFollowupHandler.
    expect(typeof followupCalls[0][1]).toBe('function');
    expect(mockRegisterDeadLetterHandler).toHaveBeenCalledTimes(1);
  });

  // ─── C1: createQueue ANTES de cualquier work/send ──────────────────────────
  // pg-boss v10 NO autocrea colas. insertJob hace INNER JOIN contra pgboss.queue;
  // sin la cola, boss.send retorna null y el job se descarta EN SILENCIO. Hay que
  // crear las colas explícitamente (idempotente) antes de registrar workers.

  it('C1: crea la cola dead-letter SIEMPRE (aunque followup esté OFF)', async () => {
    const { boss, createQueue } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    const deadCalls = createQueue.mock.calls.filter((c) => c[0] === 'reminders:dead');
    expect(deadCalls).toHaveLength(1);
  });

  it('C1: con followup ON, crea reminders:followup con deadLetter → reminders:dead', async () => {
    mockConfig.QUEUE_FOLLOWUP = true;
    const { boss, createQueue } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    const followupCalls = createQueue.mock.calls.filter((c) => c[0] === 'reminders:followup');
    expect(followupCalls).toHaveLength(1);
    // El dead-letter se configura A NIVEL DE COLA (sin esto el dead-letter handler
    // nunca recibe nada).
    expect(followupCalls[0][1]).toMatchObject({ deadLetter: 'reminders:dead' });
  });

  it('C1: la cola followup usa policy "short" para que el singletonKey deduplique en cola', async () => {
    mockConfig.QUEUE_FOLLOWUP = true;
    const { boss, createQueue } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    const followupCalls = createQueue.mock.calls.filter((c) => c[0] === 'reminders:followup');
    // Con policy 'standard' (default de pg-boss) el singletonKey NO deduplica:
    // los índices únicos de singleton aplican solo a short/singleton/stately.
    expect(followupCalls[0][1]).toMatchObject({ policy: 'short' });
  });

  it('C1: con followup OFF, NO crea la cola followup (solo dead)', async () => {
    const { boss, createQueue } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    const followupCalls = createQueue.mock.calls.filter((c) => c[0] === 'reminders:followup');
    expect(followupCalls).toHaveLength(0);
  });

  // ─── T10: Survey ────────────────────────────────────────────────────────────

  it('survey OFF: NO registra worker ni crea cola de survey', async () => {
    const { boss, work, createQueue } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    expect(work.mock.calls.filter((c) => c[0] === 'reminders:survey')).toHaveLength(0);
    expect(createQueue.mock.calls.filter((c) => c[0] === 'reminders:survey')).toHaveLength(0);
  });

  it('survey ON: crea cola reminders:survey (short + deadLetter) y registra su worker', async () => {
    mockConfig.QUEUE_SURVEY = true;
    const { boss, work, createQueue } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    const createCalls = createQueue.mock.calls.filter((c) => c[0] === 'reminders:survey');
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][1]).toMatchObject({ policy: 'short', deadLetter: 'reminders:dead' });

    const workCalls = work.mock.calls.filter((c) => c[0] === 'reminders:survey');
    expect(workCalls).toHaveLength(1);
    expect(mockMakeSurveyHandler).toHaveBeenCalledTimes(1);
  });

  // ─── T11: Medicación ─────────────────────────────────────────────────────────

  it('medication OFF: NO registra worker ni crea cola de medication', async () => {
    const { boss, work, createQueue } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    expect(work.mock.calls.filter((c) => c[0] === 'reminders:medication')).toHaveLength(0);
    expect(createQueue.mock.calls.filter((c) => c[0] === 'reminders:medication')).toHaveLength(0);
  });

  it('medication ON: crea cola reminders:medication (short + deadLetter) y registra su worker', async () => {
    mockConfig.QUEUE_MEDICATION = true;
    const { boss, work, createQueue } = makeFakeBoss();
    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    const createCalls = createQueue.mock.calls.filter((c) => c[0] === 'reminders:medication');
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][1]).toMatchObject({ policy: 'short', deadLetter: 'reminders:dead' });

    const workCalls = work.mock.calls.filter((c) => c[0] === 'reminders:medication');
    expect(workCalls).toHaveLength(1);
    expect(mockMakeMedicationHandler).toHaveBeenCalledTimes(1);
  });

  it('C1: createQueue de followup ocurre ANTES de work(followup)', async () => {
    mockConfig.QUEUE_FOLLOWUP = true;
    const order: string[] = [];
    const createQueue = vi.fn((name: string) => {
      order.push(`create:${name}`);
      return Promise.resolve();
    });
    const work = vi.fn((name: string) => {
      order.push(`work:${name}`);
      return Promise.resolve('worker-id');
    });
    const boss = { createQueue, work } as any;

    const { registerQueueWorkers } = await import('../queue/register-workers');
    await registerQueueWorkers(boss);

    const createIdx = order.indexOf('create:reminders:followup');
    const workIdx = order.indexOf('work:reminders:followup');
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(workIdx).toBeGreaterThan(createIdx);
  });
});
