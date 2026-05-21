import { describe, it, expect } from 'vitest';
import {
  SYNTHETIC_DNI_PREFIX,
  syntheticDni,
  syntheticPhone,
  isSyntheticDni,
  buildSyntheticPatient,
  GRACE_DAYS_AHEAD_OF_FOLLOWUP,
} from '../loadtest/synthetic';

// ─── Harness 40k — builders de pacientes sintéticos (puros) ────────────────────

describe('synthetic builders', () => {
  it('syntheticDni: lleva el prefijo LOADTEST y es estable por índice', () => {
    expect(syntheticDni(0)).toBe(`${SYNTHETIC_DNI_PREFIX}00000000`);
    expect(syntheticDni(42)).toBe(`${SYNTHETIC_DNI_PREFIX}00000042`);
  });

  it('syntheticDni / syntheticPhone: únicos a lo largo de 40k', () => {
    const N = 40000;
    const dnis = new Set<string>();
    const phones = new Set<string>();
    for (let i = 0; i < N; i++) {
      dnis.add(syntheticDni(i));
      phones.add(syntheticPhone(i));
    }
    expect(dnis.size).toBe(N);
    expect(phones.size).toBe(N);
  });

  it('isSyntheticDni: true para sintéticos, false para DNIs reales (numéricos)', () => {
    expect(isSyntheticDni(syntheticDni(7))).toBe(true);
    // Los DNIs reales argentinos son numéricos → nunca colisionan con el prefijo.
    expect(isSyntheticDni('30123456')).toBe(false);
    expect(isSyntheticDni('')).toBe(false);
  });

  it('syntheticPhone: no parece un teléfono real (rango reservado)', () => {
    // Arranca con un prefijo reservado imposible para un móvil argentino real.
    expect(syntheticPhone(1).startsWith('5490')).toBe(true);
  });

  it('buildSyntheticPatient: cumple las condiciones de candidato a followup', () => {
    const now = new Date('2026-05-21T12:00:00Z');
    const p = buildSyntheticPatient(5, now);

    expect(p.dni).toBe(syntheticDni(5));
    expect(p.consent).toBe(true);
    expect(p.whatsappLinked).toBe(true);
    expect(p.registeredVia).toBe('BOT');
    expect(p.phone).toBe(syntheticPhone(5));
    // createdAt debe estar MÁS allá del grace de followup (>7d), para ser candidato hoy.
    const daysAgo = (now.getTime() - p.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(7);
    expect(daysAgo).toBeGreaterThanOrEqual(GRACE_DAYS_AHEAD_OF_FOLLOWUP);
  });
});
