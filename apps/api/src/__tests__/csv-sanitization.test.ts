import { describe, it, expect } from 'vitest';

// Extract CSV sanitization functions for testing (LESSONS #30)

function csvSafe(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function escapeCsvField(value: string): string {
  const safe = csvSafe(value);
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

describe('CSV injection sanitization (LESSONS #30)', () => {
  describe('csvSafe', () => {
    it('prefixes = with single quote', () => {
      expect(csvSafe('=CMD("calc")')).toBe("'=CMD(\"calc\")");
    });

    it('prefixes + with single quote', () => {
      expect(csvSafe('+5493764125878')).toBe("'+5493764125878");
    });

    it('prefixes - with single quote', () => {
      expect(csvSafe('-HYPERLINK("evil")')).toBe("'-HYPERLINK(\"evil\")");
    });

    it('prefixes @ with single quote', () => {
      expect(csvSafe('@SUM(A1)')).toBe("'@SUM(A1)");
    });

    it('prefixes tab with single quote', () => {
      expect(csvSafe('\tdata')).toBe("'\tdata");
    });

    it('prefixes carriage return with single quote', () => {
      expect(csvSafe('\rdata')).toBe("'\rdata");
    });

    it('does NOT modify normal text', () => {
      expect(csvSafe('Juan García')).toBe('Juan García');
    });

    it('does NOT modify numbers', () => {
      expect(csvSafe('12345678')).toBe('12345678');
    });

    it('does NOT modify empty string', () => {
      expect(csvSafe('')).toBe('');
    });
  });

  describe('escapeCsvField', () => {
    it('quotes fields with commas', () => {
      expect(escapeCsvField('García, Juan')).toBe('"García, Juan"');
    });

    it('escapes double quotes inside fields', () => {
      expect(escapeCsvField('He said "hello"')).toBe('"He said ""hello"""');
    });

    it('quotes fields with newlines', () => {
      expect(escapeCsvField('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });

    it('applies csvSafe AND quoting together', () => {
      const result = escapeCsvField('=CMD, "evil"');
      expect(result).toBe("\"'=CMD, \"\"evil\"\"\"");
    });

    it('passes through simple values unchanged', () => {
      expect(escapeCsvField('Diabetes')).toBe('Diabetes');
    });

    it('sanitizes phone numbers starting with +', () => {
      expect(escapeCsvField('+5493764125878')).toBe("'+5493764125878");
    });
  });
});
