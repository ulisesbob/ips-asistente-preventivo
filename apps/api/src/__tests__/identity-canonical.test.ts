import { describe, it, expect } from 'vitest';
import { canonicalPhone, canonicalDni } from '../utils/phone';

// ─── Normalización canónica de DNI y teléfono ────────────────────────────────
// Objetivo: el MISMO documento / número, en cualquier formato de entrada (bot,
// panel, CSV), debe producir SIEMPRE el mismo string almacenado, para que el
// @unique de la DB impida duplicados "bajo cualquier circunstancia".

describe('canonicalDni', () => {
  it('saca puntos y espacios → solo dígitos', () => {
    expect(canonicalDni('12.345.678')).toBe('12345678');
    expect(canonicalDni(' 12 345 678 ')).toBe('12345678');
    expect(canonicalDni('12345678')).toBe('12345678');
  });

  it('es idempotente', () => {
    expect(canonicalDni(canonicalDni('30.111.222'))).toBe('30111222');
  });
});

describe('canonicalPhone — quirk argentino del 9', () => {
  it('un móvil AR con y sin 9 colapsa al MISMO string canónico (+549...)', () => {
    const con9 = canonicalPhone('+5493764125878'); // como lo manda Twilio
    const sin9 = canonicalPhone('+543764125878'); // como lo tipea un admin en el panel
    expect(con9).toBe('+5493764125878');
    expect(sin9).toBe('+5493764125878');
    expect(con9).toBe(sin9); // ← la clave: misma persona, mismo string
  });

  it('acepta separadores y los limpia', () => {
    expect(canonicalPhone('+54 9 3764 12-58-78')).toBe('+5493764125878');
    expect(canonicalPhone('549 3764 125878')).toBe('+5493764125878');
  });

  it('agrega + si falta', () => {
    expect(canonicalPhone('5493764125878')).toBe('+5493764125878');
  });

  it('CABA (549 11) se mantiene', () => {
    expect(canonicalPhone('+5491123456789')).toBe('+5491123456789');
  });

  it('no rompe números no argentinos', () => {
    expect(canonicalPhone('+12025550123')).toBe('+12025550123');
  });

  it('es idempotente', () => {
    expect(canonicalPhone(canonicalPhone('+543764125878'))).toBe('+5493764125878');
  });
});
