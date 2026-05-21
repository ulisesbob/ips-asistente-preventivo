import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../services/ai.service';

// ─── Optimización de prompt caching del bot ────────────────────────────────────
// Hallazgo: Sonnet 4.6 cachea con mínimo 2048 tokens de prefijo. El bloque estable
// (BASE_RULES+DISCLAIMER) mide ~1.8k tokens → SOLO no cachea. Y la KB se filtra por
// mensaje (cambia siempre), así que mezclarla con los datos del paciente rompía el
// cache. Fix: bloque estable (cache) + datos ESTABLES del paciente (cache, así el
// prefijo combinado supera 2048 y cachea por conversación) + KB dinámica al FINAL
// SIN cache. Neutro en comportamiento (mismo texto, misma orden).

const patient = {
  fullName: 'Ana López',
  programs: [
    {
      name: 'Diabetes',
      centers: [],
      reminderFrequencyDays: 30,
      lastControlDate: null,
      nextReminderDate: new Date('2026-06-15T00:00:00Z'),
    },
  ],
  notes: [],
  medications: [],
  selfReminders: [],
  knowledgeBase: [
    { category: 'Horarios', question: '¿Horario de atención?', answer: 'De 8 a 16 hs.' },
  ],
};

describe('buildSystemPrompt — estructura de prompt caching', () => {
  it('bloque[0] estable (sin datos del paciente) con cache_control', () => {
    const blocks = buildSystemPrompt(patient);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    // El bloque estable NO debe contener datos del paciente (sería per-paciente).
    expect(blocks[0].text).not.toContain('Ana López');
  });

  it('datos ESTABLES del paciente en un bloque CON cache_control (prefijo > 2048 → cachea)', () => {
    const blocks = buildSystemPrompt(patient);
    const staticBlock = blocks.find((b) => b.text.includes('DATOS DEL PACIENTE'));
    expect(staticBlock).toBeDefined();
    expect(staticBlock!.cache_control).toEqual({ type: 'ephemeral' });
    expect(staticBlock!.text).toContain('Ana López');
    // La KB (dinámica por mensaje) NO va en el bloque cacheado.
    expect(staticBlock!.text).not.toContain('BASE DE CONOCIMIENTO');
  });

  it('la KB (dinámica por mensaje) va en el ÚLTIMO bloque SIN cache_control', () => {
    const blocks = buildSystemPrompt(patient);
    const last = blocks[blocks.length - 1];
    expect(last.text).toContain('BASE DE CONOCIMIENTO');
    expect(last.text).toContain('De 8 a 16 hs.');
    expect(last.cache_control).toBeUndefined();
  });

  it('sin KB: no deja un bloque dinámico colgado; el último bloque sigue cacheado', () => {
    const blocks = buildSystemPrompt({ ...patient, knowledgeBase: [] });
    const last = blocks[blocks.length - 1];
    expect(last.cache_control).toEqual({ type: 'ephemeral' });
    expect(last.text).not.toContain('BASE DE CONOCIMIENTO');
  });

  it('preserva el contenido completo (neutro en comportamiento)', () => {
    const all = buildSystemPrompt(patient).map((b) => b.text).join('\n');
    expect(all).toContain('Ana López');
    expect(all).toContain('Diabetes');
    expect(all).toContain('De 8 a 16 hs.');
  });

  it('paciente no identificado: un bloque con cache_control (modo registro)', () => {
    const blocks = buildSystemPrompt();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
