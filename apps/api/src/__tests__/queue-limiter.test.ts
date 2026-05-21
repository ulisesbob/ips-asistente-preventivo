import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── T3 — queue/limiter.ts ────────────────────────────────────────────────────
// Bottleneck configurado por env: reservoir = SEND_RATE_PER_SEC (default 40),
// refresh cada 1000ms, maxConcurrent = SEND_MAX_CONCURRENT (default 20).
// Con fake timers + reservoir chico, no se superan N ejecuciones por ventana.

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('queue/limiter — Bottleneck por env', () => {
  it('expone un limiter con schedule() (instancia de Bottleneck)', async () => {
    const { limiter } = await import('../queue/limiter');
    expect(typeof limiter.schedule).toBe('function');
  });

  it('no supera el reservoir por ventana de 1s (rate-limit con reservoir chico)', async () => {
    // Forzar un reservoir bajo para una aserción determinista con fake timers.
    process.env.SEND_RATE_PER_SEC = '3';
    process.env.SEND_MAX_CONCURRENT = '10';
    vi.resetModules();

    const { limiter } = await import('../queue/limiter');

    let executed = 0;
    const task = () => {
      executed += 1;
      return Promise.resolve(true);
    };

    // Encolar 6 tareas; con reservoir=3 sólo 3 deben ejecutar en la 1ª ventana.
    const jobs = Array.from({ length: 6 }, () => limiter.schedule(task));

    // Dejar correr microtasks/timers de la ventana inicial sin avanzar 1s.
    await vi.advanceTimersByTimeAsync(0);
    expect(executed).toBeLessThanOrEqual(3);
    const firstWindow = executed;

    // Avanzar una ventana de refresh (1000ms) → se reponen 3 más.
    await vi.advanceTimersByTimeAsync(1000);
    expect(executed).toBeGreaterThan(firstWindow);

    // Drenar todo.
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(jobs);
    expect(executed).toBe(6);

    delete process.env.SEND_RATE_PER_SEC;
    delete process.env.SEND_MAX_CONCURRENT;
  });
});
