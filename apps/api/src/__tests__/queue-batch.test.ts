import { describe, it, expect, vi } from 'vitest';

// ─── runJobBatch — procesamiento de lote con concurrencia ACOTADA ──────────────
// Cubre lo que los tests de los handlers NO ejercitan (ahí el limiter está mockeado
// y los lotes son de 1-2 jobs): reparto sin saltear/duplicar, cota de concurrencia,
// throw-si-falla-alguno-PERO-todos-intentados, y el borde de `limit`.

// El módulo importa messaging/limiter al cargar; los mockeamos para aislar runJobBatch
// (que NO los usa: es una función pura de orquestación).
vi.mock('../services/messaging.service', () => ({ sendTextMessage: vi.fn() }));
vi.mock('../queue/limiter', () => ({ limiter: { schedule: (fn: () => unknown) => fn() } }));

import { runJobBatch } from '../queue/send-worker';

const makeJobs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `j${i}`, data: i }));

describe('runJobBatch', () => {
  it('procesa TODOS los jobs exactamente una vez, sin saltear ni duplicar', async () => {
    const seen: number[] = [];
    await runJobBatch(makeJobs(50), 5, async (data) => {
      seen.push(data);
    });
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50); // únicos
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('respeta la cota de concurrencia (nunca más de `limit` en vuelo)', async () => {
    let active = 0;
    let max = 0;
    await runJobBatch(makeJobs(50), 5, async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
    });
    expect(max).toBeLessThanOrEqual(5);
    expect(max).toBeGreaterThan(1); // de verdad corrió en paralelo
  });

  it('si falla algún job: hace throw PERO igual intenta TODOS (no corta en el primero)', async () => {
    const attempted: number[] = [];
    const fn = vi.fn(async (data: number) => {
      attempted.push(data);
      if (data === 3) throw new Error('boom');
    });

    await expect(runJobBatch(makeJobs(10), 4, fn)).rejects.toThrow();
    // Todos los 10 se intentaron (el fallo de uno no corta el resto).
    expect(attempted).toHaveLength(10);
    expect(new Set(attempted).size).toBe(10);
  });

  it('cuenta múltiples fallos y reporta el total en el mensaje', async () => {
    await expect(
      runJobBatch(makeJobs(10), 3, async (data) => {
        if (data % 2 === 0) throw new Error('boom');
      })
    ).rejects.toThrow(/5\/10/); // 5 pares (0,2,4,6,8) fallan de 10
  });

  it('limit <= 0 o NaN cae a 1 worker (no se cuelga ni queda en 0)', async () => {
    const seen: number[] = [];
    await runJobBatch(makeJobs(6), 0, async (data) => {
      seen.push(data);
    });
    expect(seen).toHaveLength(6);
  });

  it('lote vacío: no hace nada y resuelve', async () => {
    const fn = vi.fn();
    await runJobBatch([], 10, fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
