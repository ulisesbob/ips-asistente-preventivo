import { describe, it, expect } from 'vitest';
import { evaluateQueueResult } from '../loadtest/verify';

// ─── Harness 40k — lógica pura de verificación (encolados == completados, 0 perdidos) ─

describe('evaluateQueueResult', () => {
  it('PASA cuando completados == encolados y no hay fallidos ni en vuelo ni perdidos', () => {
    const r = evaluateQueueResult(40000, { completed: 40000 });
    expect(r.pass).toBe(true);
    expect(r.completed).toBe(40000);
    expect(r.lost).toBe(0);
    expect(r.reasons).toHaveLength(0);
  });

  it('FALLA si hay jobs en estado failed', () => {
    const r = evaluateQueueResult(40000, { completed: 39990, failed: 10 });
    expect(r.pass).toBe(false);
    expect(r.failed).toBe(10);
    expect(r.reasons.join(' ')).toMatch(/failed/i);
  });

  it('FALLA si quedaron jobs sin terminar (created/active/retry)', () => {
    const r = evaluateQueueResult(40000, { completed: 39000, active: 500, created: 400, retry: 100 });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/sin terminar/i);
  });

  it('FALLA si hay jobs perdidos (encolados > presentes en pgboss.job/archive)', () => {
    // Se encolaron 40000 pero solo aparecen 39995 en total → 5 perdidos.
    const r = evaluateQueueResult(40000, { completed: 39995 });
    expect(r.pass).toBe(false);
    expect(r.lost).toBe(5);
    expect(r.reasons.join(' ')).toMatch(/perdidos/i);
  });

  it('cuenta el total sumando todos los estados', () => {
    const r = evaluateQueueResult(100, { completed: 90, failed: 5, active: 3, created: 1, retry: 1 });
    expect(r.total).toBe(100);
    expect(r.lost).toBe(0);
  });

  it('FALLA si no se encoló nada (enqueued=0) — un load test vacío no pasa', () => {
    const r = evaluateQueueResult(0, {});
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no se encoló/i);
  });

  it('FALLA con lost negativo (contaminación de corrida previa)', () => {
    const r = evaluateQueueResult(100, { completed: 150 });
    expect(r.pass).toBe(false);
    expect(r.lost).toBe(-50);
    expect(r.reasons.join(' ')).toMatch(/de MÁS|contaminación/i);
  });

  it('total ignora estados no enumerados sin contarlos como perdidos', () => {
    // `cancelled` no está en la lista nombrada pero debe sumar al total.
    const r = evaluateQueueResult(100, { completed: 99, cancelled: 1 });
    expect(r.total).toBe(100);
    expect(r.lost).toBe(0);
  });
});
