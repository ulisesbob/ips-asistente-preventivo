import { describe, it, expect } from 'vitest';
import { advanceNextReminderDate } from '../utils/schedule';

// Audit fix #15: el cron antes hacía `today + freq`, lo que desplazaba el
// cronograma cada vez que el server estaba caído. Ahora avanza desde la fecha
// ORIGINAL hasta llegar a future. Estos tests verifican esa propiedad.

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('advanceNextReminderDate', () => {
  it('caso normal: cron a tiempo, original = today, freq=30 → next = today+30', () => {
    const today = ymd(2026, 5, 19);
    const original = ymd(2026, 5, 19);
    const next = advanceNextReminderDate(original, 30, today);
    expect(next).toEqual(ymd(2026, 6, 18));
  });

  it('NO desplaza si cron corrió 1 día tarde (original=ayer, today=hoy, freq=30)', () => {
    // Si naively hiciera today+30 sería 2026-06-19. La cadencia se desplazaría +1.
    // Correcto: original (2026-05-18) + 30 = 2026-06-17.
    const today = ymd(2026, 5, 19);
    const original = ymd(2026, 5, 18);
    const next = advanceNextReminderDate(original, 30, today);
    expect(next).toEqual(ymd(2026, 6, 17));
  });

  it('caso anti-drift: server offline 5 días, freq=30 → next preserva cadencia', () => {
    const today = ymd(2026, 5, 19);
    const original = ymd(2026, 5, 14); // hace 5 días, no se envió
    const next = advanceNextReminderDate(original, 30, today);
    // Sin drift: original + 30 = 2026-06-13. Esto está en future así que ese es el next.
    expect(next).toEqual(ymd(2026, 6, 13));
  });

  it('server offline 6 meses con freq=30: while loop avanza hasta future', () => {
    const today = ymd(2026, 5, 19);
    const original = ymd(2025, 11, 19); // 6 meses atrás
    const next = advanceNextReminderDate(original, 30, today);
    // Debe estar estrictamente en future
    expect(next.getTime()).toBeGreaterThan(today.getTime());
    // Y debe respetar múltiplos de 30 desde la original
    const diffDays = (next.getTime() - original.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays % 30).toBe(0);
  });

  it('freq=1 día y 5 días overdue da fecha = today+1 (5 iteraciones + 1 final)', () => {
    const today = ymd(2026, 5, 19);
    const original = ymd(2026, 5, 14); // 5 días atrás, freq diaria
    const next = advanceNextReminderDate(original, 1, today);
    expect(next).toEqual(ymd(2026, 5, 20)); // mañana
  });

  it('rechaza freq=0 (loop infinito)', () => {
    expect(() => advanceNextReminderDate(ymd(2026, 5, 19), 0, ymd(2026, 5, 19))).toThrow(/freqDays/);
  });

  it('rechaza freq negativo', () => {
    expect(() => advanceNextReminderDate(ymd(2026, 5, 19), -5, ymd(2026, 5, 19))).toThrow(/freqDays/);
  });

  it('protege contra originalDate corrupto (año 1900) tirando excepción en vez de loopear infinito', () => {
    // 126 años de iteraciones excede MAX_ITERATIONS (10 años). El cron NO debe
    // colgar — debe tirar para que el operador investigue el dato corrupto.
    const today = ymd(2026, 5, 19);
    const corrupt = ymd(1900, 1, 1);
    expect(() => advanceNextReminderDate(corrupt, 30, today)).toThrow(/too many iterations/);
  });

  it('originalDate dentro de los últimos 10 años funciona OK aunque haya mucho overdue', () => {
    const today = ymd(2026, 5, 19);
    const original = ymd(2020, 1, 1); // ~6 años atrás
    const next = advanceNextReminderDate(original, 30, today);
    expect(next.getTime()).toBeGreaterThan(today.getTime());
  });

  it('originalDate exactamente igual a today, freq=7 → next = today+7', () => {
    const today = ymd(2026, 5, 19);
    const next = advanceNextReminderDate(today, 7, today);
    expect(next).toEqual(ymd(2026, 5, 26));
  });

  it('originalDate ayer, freq=1 → next = mañana (no today)', () => {
    const today = ymd(2026, 5, 19);
    const original = ymd(2026, 5, 18);
    const next = advanceNextReminderDate(original, 1, today);
    // Original + 1 = today, NOT in future → loop una vez más → today + 1
    expect(next).toEqual(ymd(2026, 5, 20));
  });

  it('respeta freq mensual para programa Diabetes (~ cada 3 meses)', () => {
    const today = ymd(2026, 6, 1);
    const original = ymd(2026, 3, 1);
    const next = advanceNextReminderDate(original, 90, today);
    // Original + 90 = 2026-05-30, in past. + 90 = 2026-08-28 in future.
    expect(next).toEqual(ymd(2026, 8, 28));
  });
});
