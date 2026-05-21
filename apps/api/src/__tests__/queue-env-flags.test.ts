import { describe, it, expect } from 'vitest';
import { config, boolFlag } from '../config/env';

// ─── T5 — config/env.ts (flags de cola) ───────────────────────────────────────
// Sin esas env vars (setup.ts NO las setea), todos los flags son false y los
// números toman sus defaults. Esto garantiza que la cola nace INERTE.

describe('config/env — flags de cola (default OFF, inerte)', () => {
  it('QUEUE_ENABLED default false (master kill)', () => {
    expect(config.QUEUE_ENABLED).toBe(false);
  });

  it('flags por cron default false', () => {
    expect(config.QUEUE_FOLLOWUP).toBe(false);
    expect(config.QUEUE_SURVEY).toBe(false);
    expect(config.QUEUE_MEDICATION).toBe(false);
    expect(config.QUEUE_SELF).toBe(false);
    expect(config.QUEUE_CONTROL).toBe(false);
  });

  it('QUEUE_SHADOW default false', () => {
    expect(config.QUEUE_SHADOW).toBe(false);
  });

  it('SEND_RATE_PER_SEC default 40 (número)', () => {
    expect(config.SEND_RATE_PER_SEC).toBe(40);
    expect(typeof config.SEND_RATE_PER_SEC).toBe('number');
  });

  it('SEND_MAX_CONCURRENT default 20 (número)', () => {
    expect(config.SEND_MAX_CONCURRENT).toBe(20);
    expect(typeof config.SEND_MAX_CONCURRENT).toBe('number');
  });
});

// El footgun evitado: z.coerce.boolean() convertiría "false" en true (string no
// vacío) y ROMPERÍA el rollback. boolFlag interpreta el valor de verdad.
describe('boolFlag — parser de flags rollback-safe', () => {
  it('"true"/"1"/"yes"/"on" (case-insensitive) = true', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
      expect(boolFlag.parse(v)).toBe(true);
    }
  });

  it('"false"/"0"/vacío/ausente/otro = false (el rollback con =false funciona)', () => {
    for (const v of ['false', 'FALSE', '0', '', 'cualquier']) {
      expect(boolFlag.parse(v)).toBe(false);
    }
    expect(boolFlag.parse(undefined)).toBe(false);
  });
});
