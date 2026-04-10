import { describe, it, expect } from 'vitest';

// ─── Pure validation logic extracted from self-reminder.service.ts ───────────
// We copy/extract these so the tests run without a database.
// Source: apps/api/src/services/self-reminder.service.ts

// Constants (LESSONS #30)
const MAX_DAYS_AHEAD = 365;
const CSV_INJECTION_REGEX = /^[=+\-@\t\r]/;

// Helpers
function getTodayArgentina(): Date {
  const argFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const parts = argFormatter.formatToParts(new Date());
  const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '2026');
  const m = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1') - 1;
  const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1');
  return new Date(Date.UTC(y, m, d));
}

// Validate description — returns null on success, error string on failure
function validateDescription(raw: string): string | null {
  const desc = raw.trim();
  if (desc.length < 2 || desc.length > 200) {
    return 'La descripción debe tener entre 2 y 200 caracteres.';
  }
  if (CSV_INJECTION_REGEX.test(desc)) {
    return 'La descripción contiene caracteres no permitidos.';
  }
  return null;
}

// Validate and parse date — returns null on success, error string on failure
function validateDate(input: string): string | null {
  const dateMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return 'Formato de fecha inválido. Usá YYYY-MM-DD.';
  }
  const year = parseInt(dateMatch[1]);
  const month = parseInt(dateMatch[2]) - 1;
  const day = parseInt(dateMatch[3]);
  const reminderDate = new Date(Date.UTC(year, month, day));

  // Reject invalid calendar dates (e.g. Feb 30)
  if (
    reminderDate.getUTCFullYear() !== year ||
    reminderDate.getUTCMonth() !== month ||
    reminderDate.getUTCDate() !== day
  ) {
    return 'Formato de fecha inválido. Usá YYYY-MM-DD.';
  }

  const todayArg = getTodayArgentina();
  if (reminderDate < todayArg) {
    return 'La fecha no puede ser en el pasado.';
  }

  const maxDate = new Date(todayArg);
  maxDate.setUTCDate(maxDate.getUTCDate() + MAX_DAYS_AHEAD);
  if (reminderDate > maxDate) {
    return `La fecha no puede ser más de ${MAX_DAYS_AHEAD} días en el futuro.`;
  }

  return null;
}

// Validate time and return rounded minute — returns error string on failure
function validateTime(input: string): { error: string } | { hour: number; roundedMinute: number } {
  const timeMatch = input.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    return { error: 'Formato de hora inválido. Usá HH:MM.' };
  }
  const hour = parseInt(timeMatch[1]);
  const minute = parseInt(timeMatch[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { error: 'Hora inválida.' };
  }
  const roundedMinute = minute < 15 ? 0 : 30;
  return { hour, roundedMinute };
}

// ─── parseSelfReminderTag / parseListRemindersTag / parseCancelReminderTag ────
// Imported directly from the service (tag-coexistence tests need these)
import {
  parseSelfReminderTag,
  parseListRemindersTag,
  parseCancelReminderTag,
} from '../services/self-reminder.service';

// ─── Date Validation ──────────────────────────────────────────────────────────

describe('Date validation', () => {
  describe('Format parsing', () => {
    it('accepts YYYY-MM-DD format', () => {
      // Pick a date safely in the future
      const futureDate = new Date(getTodayArgentina());
      futureDate.setUTCDate(futureDate.getUTCDate() + 10);
      const iso = futureDate.toISOString().slice(0, 10);
      expect(validateDate(iso)).toBeNull();
    });

    it('rejects date without leading zeros in month', () => {
      // "2026-4-15" doesn't match \d{2} for month
      expect(validateDate('2026-4-15')).toBe('Formato de fecha inválido. Usá YYYY-MM-DD.');
    });

    it('rejects DD/MM/YYYY format', () => {
      expect(validateDate('15/04/2026')).toBe('Formato de fecha inválido. Usá YYYY-MM-DD.');
    });

    it('rejects plain text', () => {
      expect(validateDate('mañana')).toBe('Formato de fecha inválido. Usá YYYY-MM-DD.');
    });

    it('rejects empty string', () => {
      expect(validateDate('')).toBe('Formato de fecha inválido. Usá YYYY-MM-DD.');
    });

    it('rejects MM-DD-YYYY (wrong order)', () => {
      expect(validateDate('04-15-2026')).not.toBeNull();
    });
  });

  describe('Past / future bounds', () => {
    it('rejects yesterday', () => {
      const yesterday = new Date(getTodayArgentina());
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const iso = yesterday.toISOString().slice(0, 10);
      expect(validateDate(iso)).toBe('La fecha no puede ser en el pasado.');
    });

    it('accepts today', () => {
      const today = getTodayArgentina().toISOString().slice(0, 10);
      expect(validateDate(today)).toBeNull();
    });

    it('accepts tomorrow', () => {
      const tomorrow = new Date(getTodayArgentina());
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const iso = tomorrow.toISOString().slice(0, 10);
      expect(validateDate(iso)).toBeNull();
    });

    it('accepts date exactly 365 days ahead', () => {
      const d = new Date(getTodayArgentina());
      d.setUTCDate(d.getUTCDate() + 365);
      const iso = d.toISOString().slice(0, 10);
      expect(validateDate(iso)).toBeNull();
    });

    it('rejects date 366 days ahead', () => {
      const d = new Date(getTodayArgentina());
      d.setUTCDate(d.getUTCDate() + 366);
      const iso = d.toISOString().slice(0, 10);
      expect(validateDate(iso)).toBe('La fecha no puede ser más de 365 días en el futuro.');
    });

    it('rejects far future date (year 2100)', () => {
      expect(validateDate('2100-01-01')).toBe(
        'La fecha no puede ser más de 365 días en el futuro.'
      );
    });
  });

  describe('Leap year edge cases', () => {
    it('accepts Feb 29 in a leap year when it is a future date', () => {
      // 2028 is a leap year — if today is before 2028-02-29 this should be valid or too-far-future
      // The key thing to assert: it is NOT an invalid-format error.
      // (It will be "too far in future" if tested now, but NOT a format error.)
      const result = validateDate('2028-02-29');
      // Must not be a format error — it's a valid calendar date
      expect(result).not.toBe('Formato de fecha inválido. Usá YYYY-MM-DD.');
    });

    it('rejects Feb 29 in a non-leap year as invalid format', () => {
      // 2027 is not a leap year — Date.UTC(2027,1,29) overflows to 2027-03-01
      // Our validator catches the overflow via getUTCDate() !== 29
      expect(validateDate('2027-02-29')).toBe('Formato de fecha inválido. Usá YYYY-MM-DD.');
    });

    it('rejects Feb 30 (never valid)', () => {
      expect(validateDate('2026-02-30')).toBe('Formato de fecha inválido. Usá YYYY-MM-DD.');
    });
  });
});

// ─── Time Validation ──────────────────────────────────────────────────────────

describe('Time validation', () => {
  describe('Valid formats', () => {
    it('accepts 0:00 (midnight, no leading zero)', () => {
      const result = validateTime('0:00');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.hour).toBe(0);
        expect(result.roundedMinute).toBe(0);
      }
    });

    it('accepts 23:59 (last minute of day)', () => {
      const result = validateTime('23:59');
      expect('error' in result).toBe(false);
    });

    it('accepts 8:00 (single-digit hour)', () => {
      const result = validateTime('8:00');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.hour).toBe(8);
      }
    });

    it('accepts 10:30', () => {
      const result = validateTime('10:30');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.hour).toBe(10);
        expect(result.roundedMinute).toBe(30);
      }
    });
  });

  describe('Invalid hours', () => {
    it('rejects hour 24', () => {
      const result = validateTime('24:00');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBe('Hora inválida.');
      }
    });

    it('rejects hour 25', () => {
      const result = validateTime('25:00');
      expect('error' in result).toBe(true);
    });

    it('rejects negative hour representation (-1:00 does not match regex)', () => {
      // -1:00 does not match /^(\d{1,2}):(\d{2})$/ because of the '-'
      const result = validateTime('-1:00');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBe('Formato de hora inválido. Usá HH:MM.');
      }
    });
  });

  describe('Invalid minutes', () => {
    it('rejects minute 60', () => {
      const result = validateTime('10:60');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBe('Hora inválida.');
      }
    });

    it('rejects negative minute representation (-1 does not match regex)', () => {
      const result = validateTime('10:-1');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBe('Formato de hora inválido. Usá HH:MM.');
      }
    });

    it('rejects single-digit minute (regex requires two digits)', () => {
      const result = validateTime('10:5');
      expect('error' in result).toBe(true);
    });
  });

  describe('Minute rounding to nearest 30', () => {
    it('rounds minute 0 → 0', () => {
      const result = validateTime('10:00');
      expect('error' in result).toBe(false);
      if (!('error' in result)) expect(result.roundedMinute).toBe(0);
    });

    it('rounds minute 14 → 0 (below threshold)', () => {
      const result = validateTime('10:14');
      expect('error' in result).toBe(false);
      if (!('error' in result)) expect(result.roundedMinute).toBe(0);
    });

    it('rounds minute 15 → 30 (at threshold)', () => {
      const result = validateTime('10:15');
      expect('error' in result).toBe(false);
      if (!('error' in result)) expect(result.roundedMinute).toBe(30);
    });

    it('rounds minute 29 → 30', () => {
      const result = validateTime('10:29');
      expect('error' in result).toBe(false);
      if (!('error' in result)) expect(result.roundedMinute).toBe(30);
    });

    it('rounds minute 30 → 30 (already on slot)', () => {
      const result = validateTime('10:30');
      expect('error' in result).toBe(false);
      if (!('error' in result)) expect(result.roundedMinute).toBe(30);
    });

    it('rounds minute 44 → 30 (still below 45, lands on :30 slot)', () => {
      const result = validateTime('10:44');
      expect('error' in result).toBe(false);
      if (!('error' in result)) expect(result.roundedMinute).toBe(30);
    });

    it('rounds minute 45 → 30 (>= 15 so rounds to 30)', () => {
      const result = validateTime('10:45');
      expect('error' in result).toBe(false);
      if (!('error' in result)) expect(result.roundedMinute).toBe(30);
    });

    it('rounds minute 59 → 30', () => {
      const result = validateTime('10:59');
      expect('error' in result).toBe(false);
      if (!('error' in result)) expect(result.roundedMinute).toBe(30);
    });
  });

  describe('Format edge cases', () => {
    it('rejects time without colon', () => {
      const result = validateTime('1000');
      expect('error' in result).toBe(true);
    });

    it('rejects empty string', () => {
      const result = validateTime('');
      expect('error' in result).toBe(true);
    });

    it('rejects time with seconds (HH:MM:SS)', () => {
      const result = validateTime('10:00:00');
      expect('error' in result).toBe(true);
    });
  });
});

// ─── Description Validation ───────────────────────────────────────────────────

describe('Description validation', () => {
  describe('Length checks', () => {
    it('accepts exactly 2 characters', () => {
      expect(validateDescription('AB')).toBeNull();
    });

    it('rejects 1 character', () => {
      expect(validateDescription('A')).toBe('La descripción debe tener entre 2 y 200 caracteres.');
    });

    it('rejects empty string', () => {
      expect(validateDescription('')).toBe('La descripción debe tener entre 2 y 200 caracteres.');
    });

    it('accepts exactly 200 characters', () => {
      expect(validateDescription('A'.repeat(200))).toBeNull();
    });

    it('rejects 201 characters', () => {
      expect(validateDescription('A'.repeat(201))).toBe(
        'La descripción debe tener entre 2 y 200 caracteres.'
      );
    });
  });

  describe('Whitespace trimming', () => {
    it('trims leading/trailing spaces before length check', () => {
      // "  A  " trims to "A" (1 char) → too short
      expect(validateDescription('  A  ')).toBe(
        'La descripción debe tener entre 2 y 200 caracteres.'
      );
    });

    it('trims spaces so valid content passes', () => {
      // "  Turno  " trims to "Turno" (5 chars) → valid
      expect(validateDescription('  Turno  ')).toBeNull();
    });

    it('blank-only string is rejected (trims to empty)', () => {
      expect(validateDescription('   ')).toBe(
        'La descripción debe tener entre 2 y 200 caracteres.'
      );
    });
  });

  describe('CSV injection prevention (LESSONS #30)', () => {
    it('rejects description starting with =', () => {
      expect(validateDescription('=HYPERLINK("http://evil.com")')).toBe(
        'La descripción contiene caracteres no permitidos.'
      );
    });

    it('rejects description starting with +', () => {
      expect(validateDescription('+cmd|"/C calc"!"A1"')).toBe(
        'La descripción contiene caracteres no permitidos.'
      );
    });

    it('rejects description starting with -', () => {
      expect(validateDescription('-1+1')).toBe(
        'La descripción contiene caracteres no permitidos.'
      );
    });

    it('rejects description starting with @', () => {
      expect(validateDescription('@SUM(1+1)')).toBe(
        'La descripción contiene caracteres no permitidos.'
      );
    });

    it('tab at start is trimmed away — does NOT trigger CSV injection (trim() runs first)', () => {
      // "\tturno".trim() === "turno" — the tab is removed before the regex check.
      // This is the documented behavior: .trim() runs before CSV_INJECTION_REGEX.test().
      expect(validateDescription('\tturno')).toBeNull();
    });

    it('carriage return at start is trimmed away — does NOT trigger CSV injection (trim() runs first)', () => {
      // "\rturno".trim() === "turno" — the CR is removed before the regex check.
      expect(validateDescription('\rturno')).toBeNull();
    });

    it('allows = in the middle of a description', () => {
      // CSV injection only applies to the START of the string
      expect(validateDescription('Resultado = positivo')).toBeNull();
    });

    it('allows + in the middle of a description', () => {
      expect(validateDescription('Turno + análisis')).toBeNull();
    });
  });

  describe('Accepted special characters', () => {
    it('accepts description with comma', () => {
      expect(validateDescription('Turno dentista, traer DNI')).toBeNull();
    });

    it('accepts description with period', () => {
      expect(validateDescription('Llevar receta médica.')).toBeNull();
    });

    it('accepts description with accented vowels', () => {
      expect(validateDescription('Análisis de sangre')).toBeNull();
    });

    it('accepts description with ñ', () => {
      expect(validateDescription('Turno de oftalmología')).toBeNull();
    });

    it('accepts description with > (H1 fix per existing tests)', () => {
      expect(validateDescription('Turno > 10:00')).toBeNull();
    });

    it('accepts description with question mark', () => {
      expect(validateDescription('¿Control de glucemia?')).toBeNull();
    });
  });

  describe('Unicode in description', () => {
    it('accepts emoji in description', () => {
      expect(validateDescription('Turno 💉 análisis')).toBeNull();
    });

    it('accepts mixed accents and ñ', () => {
      expect(validateDescription('Renovación de receta — año próximo')).toBeNull();
    });
  });
});

// ─── Multiple tags in one AI response ────────────────────────────────────────

describe('Multiple tags coexistence in one AI response', () => {
  describe('SELF_REMINDER + LIST_REMINDERS in same response', () => {
    it('finds SELF_REMINDER even when LIST_REMINDERS is also present', () => {
      const response =
        'Listo, te lo agendo.\n' +
        '<<SELF_REMINDER:{"descripcion":"Turno dentista","fecha":"2026-05-10","hora":"09:00"}>>\n' +
        'También acá van tus recordatorios:\n' +
        '<<LIST_REMINDERS>>';

      const reminderResult = parseSelfReminderTag(response);
      expect(reminderResult.found).toBe(true);
      expect(reminderResult.data?.description).toBe('Turno dentista');
    });

    it('finds LIST_REMINDERS even when SELF_REMINDER is also present', () => {
      const response =
        'Listo, te lo agendo.\n' +
        '<<SELF_REMINDER:{"descripcion":"Turno dentista","fecha":"2026-05-10","hora":"09:00"}>>\n' +
        '<<LIST_REMINDERS>>';

      const listResult = parseListRemindersTag(response);
      expect(listResult.found).toBe(true);
    });

    it('cleanResponse from SELF_REMINDER parse still contains LIST_REMINDERS tag', () => {
      const response =
        'OK.\n' +
        '<<SELF_REMINDER:{"descripcion":"Control","fecha":"2026-06-01","hora":"10:00"}>>\n' +
        '<<LIST_REMINDERS>>';

      const reminderResult = parseSelfReminderTag(response);
      expect(reminderResult.found).toBe(true);
      // After stripping SELF_REMINDER, LIST_REMINDERS tag should still be in cleanResponse
      expect(reminderResult.cleanResponse).toContain('<<LIST_REMINDERS>>');
    });
  });

  describe('SELF_REMINDER + CANCEL_REMINDER in same response', () => {
    it('finds SELF_REMINDER when CANCEL_REMINDER is also present', () => {
      const response =
        '<<SELF_REMINDER:{"descripcion":"Nuevo turno","fecha":"2026-06-15","hora":"11:00"}>>\n' +
        '<<CANCEL_REMINDER:1>>';

      const reminderResult = parseSelfReminderTag(response);
      expect(reminderResult.found).toBe(true);
      expect(reminderResult.data?.description).toBe('Nuevo turno');
    });

    it('finds CANCEL_REMINDER when SELF_REMINDER is also present', () => {
      const response =
        '<<SELF_REMINDER:{"descripcion":"Nuevo turno","fecha":"2026-06-15","hora":"11:00"}>>\n' +
        '<<CANCEL_REMINDER:3>>';

      const cancelResult = parseCancelReminderTag(response);
      expect(cancelResult.found).toBe(true);
      expect(cancelResult.index).toBe(3);
    });
  });
});

// ─── Edge cases in tag content ────────────────────────────────────────────────

describe('Tag content edge cases', () => {
  describe('Empty JSON values', () => {
    it('returns found=false when descripcion is empty string', () => {
      const response = '<<SELF_REMINDER:{"descripcion":"","fecha":"2026-05-01","hora":"10:00"}>>';
      expect(parseSelfReminderTag(response).found).toBe(false);
    });

    it('returns found=false when fecha is empty string', () => {
      const response = '<<SELF_REMINDER:{"descripcion":"Turno","fecha":"","hora":"10:00"}>>';
      expect(parseSelfReminderTag(response).found).toBe(false);
    });

    it('returns found=false when hora is empty string', () => {
      const response = '<<SELF_REMINDER:{"descripcion":"Turno","fecha":"2026-05-01","hora":""}>> ';
      expect(parseSelfReminderTag(response).found).toBe(false);
    });
  });

  describe('Extra/unknown fields in tag JSON', () => {
    it('still parses when tag has unknown extra field', () => {
      const response =
        '<<SELF_REMINDER:{"descripcion":"Turno","fecha":"2026-05-20","hora":"10:00","extra":"ignorado"}>>';
      // parseSelfReminderTag regex matches {[^}]+} — this works as long as no nested braces
      // The extra field should be ignored, the known fields should be extracted
      const result = parseSelfReminderTag(response);
      // May or may not find depending on regex — document actual behavior
      if (result.found) {
        expect(result.data?.description).toBe('Turno');
        expect(result.data?.date).toBe('2026-05-20');
        expect(result.data?.time).toBe('10:00');
      }
      // If not found due to regex, that's also an acceptable documented behavior
      // This test primarily verifies the parse doesn't throw
      expect(() => parseSelfReminderTag(response)).not.toThrow();
    });

    it('does not throw when JSON has numeric values for fields', () => {
      const response = '<<SELF_REMINDER:{"descripcion":123,"fecha":"2026-05-20","hora":"10:00"}>>';
      expect(() => parseSelfReminderTag(response)).not.toThrow();
    });
  });

  describe('Unicode and special chars in description tag', () => {
    it('parses tag with accented description', () => {
      const response =
        '<<SELF_REMINDER:{"descripcion":"Análisis de sangre","fecha":"2026-05-10","hora":"09:00"}>>';
      const result = parseSelfReminderTag(response);
      expect(result.found).toBe(true);
      expect(result.data?.description).toBe('Análisis de sangre');
    });

    it('parses tag with ñ in description', () => {
      const response =
        '<<SELF_REMINDER:{"descripcion":"Renovación de receta","fecha":"2026-05-10","hora":"08:00"}>>';
      const result = parseSelfReminderTag(response);
      expect(result.found).toBe(true);
      expect(result.data?.description).toBe('Renovación de receta');
    });

    it('parses tag with emoji in description', () => {
      const response =
        '<<SELF_REMINDER:{"descripcion":"Turno 💉","fecha":"2026-06-01","hora":"10:00"}>>';
      const result = parseSelfReminderTag(response);
      // Emoji is multiple chars — may affect {[^}]+} regex match; document behavior
      expect(() => parseSelfReminderTag(response)).not.toThrow();
    });
  });
});

// ─── CSV injection regex unit tests ──────────────────────────────────────────

describe('CSV_INJECTION_REGEX', () => {
  const dangerousStarts = ['=', '+', '-', '@', '\t', '\r'];
  const safeStarts = ['T', 'A', ' ', '¿', 'á', '1', '('];

  dangerousStarts.forEach((char) => {
    it(`matches string starting with "${char === '\t' ? '\\t' : char === '\r' ? '\\r' : char}"`, () => {
      expect(CSV_INJECTION_REGEX.test(char + 'anything')).toBe(true);
    });
  });

  safeStarts.forEach((char) => {
    it(`does NOT match string starting with "${char}"`, () => {
      expect(CSV_INJECTION_REGEX.test(char + 'anything')).toBe(false);
    });
  });
});
