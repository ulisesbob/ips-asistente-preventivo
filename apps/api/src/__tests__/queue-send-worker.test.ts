import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T6 — queue/send-worker.ts ────────────────────────────────────────────────
// makeSendHandler(buildMessage): toma el payload del job, llama
// limiter.schedule(() => sendTextMessage(phone, text)).
//   - sendTextMessage=false → throw new Error('send_failed') (retriable)
//   - sendTextMessage=true  → ok (no throw)
// registerDeadLetterHandler(boss): registra un worker en la cola dead que loguea.

const mockSendTextMessage = vi.fn();
const mockSchedule = vi.fn();

vi.mock('../services/messaging.service', () => ({
  sendTextMessage: mockSendTextMessage,
}));

// Mockeamos el limiter para verificar que el handler PASA por él (rate-limit).
vi.mock('../queue/limiter', () => ({
  limiter: {
    schedule: mockSchedule,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTextMessage.mockResolvedValue(true);
  // El limiter real ejecuta la fn que recibe; el mock hace lo mismo.
  mockSchedule.mockImplementation((fn: () => Promise<unknown>) => fn());
});

interface DemoPayload {
  phone: string;
  name: string;
}

describe('queue/send-worker — makeSendHandler', () => {
  it('NO hace throw cuando sendTextMessage devuelve true', async () => {
    const { makeSendHandler } = await import('../queue/send-worker');
    const handler = makeSendHandler<DemoPayload>((p) => ({
      phone: p.phone,
      text: `Hola ${p.name}`,
    }));

    await expect(
      handler([{ id: 'j1', data: { phone: '549111', name: 'Ana' } }])
    ).resolves.not.toThrow();

    expect(mockSendTextMessage).toHaveBeenCalledWith('549111', 'Hola Ana');
  });

  it('hace throw("send_failed") cuando sendTextMessage devuelve false (retriable)', async () => {
    mockSendTextMessage.mockResolvedValue(false);
    const { makeSendHandler } = await import('../queue/send-worker');
    const handler = makeSendHandler<DemoPayload>((p) => ({
      phone: p.phone,
      text: `Hola ${p.name}`,
    }));

    await expect(
      handler([{ id: 'j1', data: { phone: '549111', name: 'Ana' } }])
    ).rejects.toThrow('send_failed');
  });

  it('pasa el envío por el limiter (rate-limit aplicado)', async () => {
    const { makeSendHandler } = await import('../queue/send-worker');
    const handler = makeSendHandler<DemoPayload>((p) => ({
      phone: p.phone,
      text: `Hola ${p.name}`,
    }));

    await handler([{ id: 'j1', data: { phone: '549111', name: 'Ana' } }]);

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledWith(expect.any(Function));
  });

  it('procesa cada job del batch (pg-boss v10 entrega arrays)', async () => {
    const { makeSendHandler } = await import('../queue/send-worker');
    const handler = makeSendHandler<DemoPayload>((p) => ({
      phone: p.phone,
      text: `Hola ${p.name}`,
    }));

    await handler([
      { id: 'j1', data: { phone: '549111', name: 'Ana' } },
      { id: 'j2', data: { phone: '549222', name: 'Beto' } },
    ]);

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockSendTextMessage).toHaveBeenCalledWith('549111', 'Hola Ana');
    expect(mockSendTextMessage).toHaveBeenCalledWith('549222', 'Hola Beto');
  });
});

describe('queue/send-worker — registerDeadLetterHandler', () => {
  it('registra un worker en la cola dead (reminders:dead)', async () => {
    const { registerDeadLetterHandler } = await import('../queue/send-worker');
    const { QUEUE_NAMES } = await import('../queue/queues');

    const work = vi.fn().mockResolvedValue('worker-id');
    const boss = { work } as unknown as import('pg-boss');

    await registerDeadLetterHandler(boss);

    expect(work).toHaveBeenCalledTimes(1);
    expect(work.mock.calls[0][0]).toBe(QUEUE_NAMES.dead);
  });

  it('el handler de dead-letter NO hace throw (no re-encola, sólo loguea)', async () => {
    const { registerDeadLetterHandler } = await import('../queue/send-worker');

    let registered: ((jobs: unknown[]) => Promise<unknown>) | undefined;
    const work = vi.fn().mockImplementation((_name: string, handler: (jobs: unknown[]) => Promise<unknown>) => {
      registered = handler;
      return Promise.resolve('worker-id');
    });
    const boss = { work } as unknown as import('pg-boss');

    await registerDeadLetterHandler(boss);
    expect(registered).toBeDefined();

    await expect(
      registered!([{ id: 'd1', data: { phone: 'x' } }])
    ).resolves.not.toThrow();
  });
});
