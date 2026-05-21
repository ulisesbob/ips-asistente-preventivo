import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T2 — queue/boss.ts ───────────────────────────────────────────────────────
// Singleton wrapper sobre pg-boss. startBoss idempotente (no arranca dos veces),
// stopBoss llama boss.stop(). Usa DATABASE_URL crudo (no el cliente Prisma).
//
// pg-boss es CommonJS (`export = PgBoss`, una clase). El mock devuelve una
// instancia falsa con start/stop espiables y captura las opciones del constructor.

const mockStart = vi.fn();
const mockStop = vi.fn();
const mockOn = vi.fn();
const constructorSpy = vi.fn();

vi.mock('pg-boss', () => {
  class FakePgBoss {
    start = mockStart;
    stop = mockStop;
    on = mockOn;
    constructor(opts: unknown) {
      constructorSpy(opts);
    }
  }
  // pg-boss usa `export = PgBoss`; con esmodule interop el default es la clase.
  return { default: FakePgBoss };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockStart.mockResolvedValue(undefined);
  mockStop.mockResolvedValue(undefined);
});

describe('queue/boss — singleton', () => {
  it('getBoss devuelve la MISMA instancia en llamadas repetidas', async () => {
    const { getBoss } = await import('../queue/boss');
    const a = getBoss();
    const b = getBoss();
    expect(a).toBe(b);
  });

  it('startBoss llama boss.start() UNA sola vez aunque se invoque 2 veces', async () => {
    const { startBoss } = await import('../queue/boss');
    await startBoss();
    await startBoss();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('startBoss es idempotente bajo concurrencia (dos awaits en paralelo → 1 start)', async () => {
    const { startBoss } = await import('../queue/boss');
    await Promise.all([startBoss(), startBoss()]);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('construye pg-boss con la connectionString de DATABASE_URL y pool chico (max:4)', async () => {
    const { startBoss } = await import('../queue/boss');
    await startBoss();
    expect(constructorSpy).toHaveBeenCalledTimes(1);
    const opts = constructorSpy.mock.calls[0][0] as { connectionString?: string; max?: number };
    expect(opts.connectionString).toBe(process.env.DATABASE_URL);
    expect(opts.max).toBe(4);
  });

  it('stopBoss llama boss.stop()', async () => {
    const { startBoss, stopBoss } = await import('../queue/boss');
    await startBoss();
    await stopBoss();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('stopBoss tras stop permite volver a startBoss (reinicio limpio)', async () => {
    const { startBoss, stopBoss } = await import('../queue/boss');
    await startBoss();
    await stopBoss();
    await startBoss();
    expect(mockStart).toHaveBeenCalledTimes(2);
  });
});
