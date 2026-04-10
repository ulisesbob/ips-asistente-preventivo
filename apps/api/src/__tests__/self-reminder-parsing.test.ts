import { describe, it, expect } from 'vitest';
import {
  parseSelfReminderTag,
  parseListRemindersTag,
  parseCancelReminderTag,
  formatRemindersForWhatsApp,
} from '../services/self-reminder.service';

// ─── parseSelfReminderTag ────────────────────────────────────────────────────

describe('parseSelfReminderTag', () => {
  it('parses a valid reminder tag with Spanish keys', () => {
    const response =
      'Listo, te voy a recordar lo del turno.\n' +
      '<<SELF_REMINDER:{"descripcion":"Turno del dentista","fecha":"2026-04-15","hora":"10:00"}>>';

    const result = parseSelfReminderTag(response);
    expect(result.found).toBe(true);
    expect(result.data).toEqual({
      description: 'Turno del dentista',
      date: '2026-04-15',
      time: '10:00',
    });
    expect(result.cleanResponse).toBe('Listo, te voy a recordar lo del turno.');
  });

  it('parses a valid reminder tag with English keys', () => {
    const response =
      'OK!\n<<SELF_REMINDER:{"description":"Doctor visit","date":"2026-05-01","time":"14:30"}>>';

    const result = parseSelfReminderTag(response);
    expect(result.found).toBe(true);
    expect(result.data?.description).toBe('Doctor visit');
    expect(result.data?.date).toBe('2026-05-01');
    expect(result.data?.time).toBe('14:30');
  });

  it('returns found=false when no tag present', () => {
    const result = parseSelfReminderTag('Solo un mensaje normal sin tag');
    expect(result.found).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.cleanResponse).toBe('Solo un mensaje normal sin tag');
  });

  it('returns found=false when JSON is malformed', () => {
    const response = '<<SELF_REMINDER:{broken json}>>';
    const result = parseSelfReminderTag(response);
    expect(result.found).toBe(false);
  });

  it('returns found=false when required fields are missing', () => {
    const response = '<<SELF_REMINDER:{"descripcion":"Test"}>>';
    const result = parseSelfReminderTag(response);
    expect(result.found).toBe(false);
  });

  it('strips tag from middle of response', () => {
    const response =
      'Te lo agendo.\n' +
      '<<SELF_REMINDER:{"descripcion":"Análisis","fecha":"2026-04-20","hora":"08:00"}>>\n' +
      '¡Éxitos!';

    const result = parseSelfReminderTag(response);
    expect(result.found).toBe(true);
    expect(result.cleanResponse).toBe('Te lo agendo.\n\n¡Éxitos!');
  });

  it('trims whitespace from description', () => {
    const response = '<<SELF_REMINDER:{"descripcion":"  Turno  ","fecha":"2026-04-15","hora":"09:00"}>>';
    const result = parseSelfReminderTag(response);
    expect(result.data?.description).toBe('Turno');
  });

  it('handles description containing > character (H1 fix)', () => {
    const response = '<<SELF_REMINDER:{"descripcion":"Turno > 10:00","fecha":"2026-04-15","hora":"10:00"}>>';
    const result = parseSelfReminderTag(response);
    expect(result.found).toBe(true);
    expect(result.data?.description).toBe('Turno > 10:00');
  });
});

// ─── parseListRemindersTag ───────────────────────────────────────────────────

describe('parseListRemindersTag', () => {
  it('detects LIST_REMINDERS tag', () => {
    const response = 'Acá van tus recordatorios:\n<<LIST_REMINDERS>>';
    const result = parseListRemindersTag(response);
    expect(result.found).toBe(true);
    expect(result.cleanResponse).toBe('Acá van tus recordatorios:');
  });

  it('returns found=false when no tag', () => {
    const result = parseListRemindersTag('Mensaje normal');
    expect(result.found).toBe(false);
  });
});

// ─── parseCancelReminderTag ──────────────────────────────────────────────────

describe('parseCancelReminderTag', () => {
  it('detects CANCEL_REMINDER tag with number', () => {
    const response = 'Listo, lo cancelo.\n<<CANCEL_REMINDER:2>>';
    const result = parseCancelReminderTag(response);
    expect(result.found).toBe(true);
    expect(result.index).toBe(2);
    expect(result.cleanResponse).toBe('Listo, lo cancelo.');
  });

  it('handles single digit', () => {
    const result = parseCancelReminderTag('OK <<CANCEL_REMINDER:1>>');
    expect(result.index).toBe(1);
  });

  it('handles double digit', () => {
    const result = parseCancelReminderTag('<<CANCEL_REMINDER:10>>');
    expect(result.index).toBe(10);
  });

  it('returns found=false when no tag', () => {
    const result = parseCancelReminderTag('No hay tag acá');
    expect(result.found).toBe(false);
    expect(result.index).toBeUndefined();
  });
});

// ─── formatRemindersForWhatsApp ──────────────────────────────────────────────

describe('formatRemindersForWhatsApp', () => {
  it('returns empty message when no reminders', () => {
    const result = formatRemindersForWhatsApp([]);
    expect(result).toContain('No tenés recordatorios activos');
    expect(result).toContain('Recordame');
  });

  it('formats single reminder', () => {
    const result = formatRemindersForWhatsApp([
      {
        description: 'Turno dentista',
        reminderDate: new Date(Date.UTC(2026, 3, 15)), // April 15
        reminderHour: 10,
        reminderMinute: 0,
      },
    ]);
    expect(result).toContain('1.');
    expect(result).toContain('Turno dentista');
    expect(result).toContain('10:00');
    expect(result).toContain('cancelar recordatorio');
  });

  it('formats multiple reminders with correct numbering', () => {
    const result = formatRemindersForWhatsApp([
      {
        description: 'Turno 1',
        reminderDate: new Date(Date.UTC(2026, 3, 15)),
        reminderHour: 9,
        reminderMinute: 0,
      },
      {
        description: 'Turno 2',
        reminderDate: new Date(Date.UTC(2026, 3, 20)),
        reminderHour: 14,
        reminderMinute: 30,
      },
    ]);
    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('Turno 1');
    expect(result).toContain('Turno 2');
    expect(result).toContain('14:30');
  });

  it('pads hours and minutes correctly', () => {
    const result = formatRemindersForWhatsApp([
      {
        description: 'Test',
        reminderDate: new Date(Date.UTC(2026, 0, 5)),
        reminderHour: 8,
        reminderMinute: 0,
      },
    ]);
    expect(result).toContain('08:00');
  });
});
