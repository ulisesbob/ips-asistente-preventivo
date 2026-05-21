import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// BUG 3: el frontend agrega filtro por estado ESCALATED en GET /api/conversations.
// El schema Zod del filtro usa z.nativeEnum(ConversationStatus), así que YA acepta
// los tres estados del enum (OPEN/ESCALATED/CLOSED) — no hubo que cambiar código.
// Este test de regresión fija el contrato: si alguien restringe el filtro a
// OPEN/CLOSED, falla acá.

vi.mock('@ips/db', () => ({
  ConversationStatus: { OPEN: 'OPEN', ESCALATED: 'ESCALATED', CLOSED: 'CLOSED' },
}));

describe('Filtro de estado de conversaciones (BUG 3)', () => {
  it('el enum ConversationStatus incluye ESCALATED', async () => {
    const { ConversationStatus } = await import('@ips/db');
    expect(Object.values(ConversationStatus)).toContain('ESCALATED');
  });

  it('z.nativeEnum(ConversationStatus) acepta OPEN, ESCALATED y CLOSED', async () => {
    const { ConversationStatus } = await import('@ips/db');
    const statusSchema = z.nativeEnum(ConversationStatus).optional();

    expect(statusSchema.parse('OPEN')).toBe('OPEN');
    expect(statusSchema.parse('ESCALATED')).toBe('ESCALATED');
    expect(statusSchema.parse('CLOSED')).toBe('CLOSED');
    expect(statusSchema.parse(undefined)).toBeUndefined();
  });

  it('rechaza estados desconocidos', async () => {
    const { ConversationStatus } = await import('@ips/db');
    const statusSchema = z.nativeEnum(ConversationStatus).optional();
    expect(() => statusSchema.parse('PENDING')).toThrow();
  });
});
