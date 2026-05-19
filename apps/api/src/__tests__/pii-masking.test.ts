import { describe, it, expect } from 'vitest';
import { maskId, maskPhone, firstName } from '../utils/pii';

// Audit fix #24: production logs en Render son visibles para cualquiera con
// acceso al dashboard. Estos helpers garantizan que nunca filtramos PII completa.

describe('maskId', () => {
  it('trunca UUIDs largos a 8 chars + ellipsis', () => {
    expect(maskId('abc12345-def-6789-ghij-klmnopqrstuv')).toBe('abc12345…');
  });

  it('deja IDs cortos sin modificar', () => {
    expect(maskId('short')).toBe('short');
  });

  it('maneja string vacío', () => {
    expect(maskId('')).toBe('(no id)');
  });

  it('maneja null', () => {
    expect(maskId(null)).toBe('(no id)');
  });

  it('maneja undefined', () => {
    expect(maskId(undefined)).toBe('(no id)');
  });
});

describe('maskPhone', () => {
  it('enmascara con últimos 4 dígitos', () => {
    expect(maskPhone('+5493764125878')).toBe('***5878');
  });

  it('enmascara sin prefijo +', () => {
    expect(maskPhone('5413764125878')).toBe('***5878');
  });

  it('maneja phone corto (<4 chars)', () => {
    expect(maskPhone('123')).toBe('***');
  });

  it('maneja null/undefined', () => {
    expect(maskPhone(null)).toBe('(no phone)');
    expect(maskPhone(undefined)).toBe('(no phone)');
  });

  it('NUNCA expone el número completo', () => {
    const full = '+5493764125878';
    const masked = maskPhone(full);
    expect(masked).not.toContain('1258'); // dígitos 5-8 desde el fin
    expect(masked).not.toContain('3764'); // código de área
  });
});

describe('firstName', () => {
  it('extrae primer nombre de fullName multi-palabra', () => {
    expect(firstName('Juan Pérez García')).toBe('Juan');
  });

  it('devuelve el string completo si es una sola palabra', () => {
    expect(firstName('Juan')).toBe('Juan');
  });

  it('maneja null/undefined', () => {
    expect(firstName(null)).toBe('(no name)');
    expect(firstName(undefined)).toBe('(no name)');
  });

  it('maneja string vacío', () => {
    expect(firstName('')).toBe('(no name)');
  });

  it('NUNCA expone apellidos', () => {
    const masked = firstName('Juan Carlos Pérez Fernández García');
    expect(masked).toBe('Juan');
    expect(masked).not.toContain('Pérez');
    expect(masked).not.toContain('García');
  });
});
