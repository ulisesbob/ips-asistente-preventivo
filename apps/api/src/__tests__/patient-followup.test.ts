import { describe, it, expect } from 'vitest';

// Tests pure-function del followup. Las funciones que tocan DB requieren mock
// de Prisma (próxima tanda). Acá probamos solo la lógica del mensaje y constantes.

describe('Constantes de followup', () => {
  it('GRACE_PERIOD_DAYS = 7 (alcanza para que un médico atienda)', async () => {
    const mod = await import('../services/patient-followup.service');
    expect(mod.GRACE_PERIOD_DAYS).toBe(7);
  });

  it('MAX_FOLLOWUPS = 3 (3 recordatorios espaciados antes de marcar abandoned)', async () => {
    const mod = await import('../services/patient-followup.service');
    expect(mod.MAX_FOLLOWUPS).toBe(3);
  });

  it('REMINDER_INTERVAL_DAYS = 7 (mismo intervalo que el grace period)', async () => {
    const mod = await import('../services/patient-followup.service');
    expect(mod.REMINDER_INTERVAL_DAYS).toBe(7);
  });
});

describe('patient-followup.service exports', () => {
  it('exporta processFollowups, findPatientsNeedingFollowup, findAbandonedPatients, buildFollowupMessage', async () => {
    const mod = await import('../services/patient-followup.service');
    expect(typeof mod.processFollowups).toBe('function');
    expect(typeof mod.findPatientsNeedingFollowup).toBe('function');
    expect(typeof mod.findAbandonedPatients).toBe('function');
    expect(typeof mod.buildFollowupMessage).toBe('function');
  });
});

describe('buildFollowupMessage', () => {
  it('intento 1 — saludo con primer nombre + pasos + disclaimer', async () => {
    const { buildFollowupMessage } = await import('../services/patient-followup.service');
    const msg = buildFollowupMessage('Juan Pérez García', 1, 7);
    expect(msg).toContain('Hola Juan!');
    expect(msg).toContain('Hace 7 días te registraste');
    expect(msg).toContain('Área de Programas Especiales');
    expect(msg).toContain('Esta información es orientativa');
    expect(msg).not.toContain('último recordatorio');
  });

  it('intento 3 (último) — incluye "último recordatorio" + cierre claro', async () => {
    const { buildFollowupMessage } = await import('../services/patient-followup.service');
    const msg = buildFollowupMessage('María', 3, 21);
    expect(msg).toContain('Hola María');
    expect(msg).toContain('último recordatorio');
    expect(msg).toContain('hace 21 días');
    expect(msg).toContain('No vamos a enviarte más recordatorios');
    expect(msg).toContain('Esta información es orientativa');
  });

  it('NUNCA mezcla voseo con tuteo ("tú/tienes")', async () => {
    const { buildFollowupMessage } = await import('../services/patient-followup.service');
    const msg = buildFollowupMessage('Roberto', 2, 14);
    expect(msg).not.toMatch(/\btú\b/);
    expect(msg).not.toMatch(/\btienes\b/);
    expect(msg).not.toMatch(/\bpuedes\b/);
    expect(msg).toContain('te registraste');
  });

  it('maneja nombre con apellido — usa solo el primero', async () => {
    const { buildFollowupMessage } = await import('../services/patient-followup.service');
    const msg = buildFollowupMessage('Roberto Carlos Fernández', 1, 7);
    expect(msg).toContain('Hola Roberto!');
    expect(msg).not.toContain('Carlos');
    expect(msg).not.toContain('Fernández');
  });
});
