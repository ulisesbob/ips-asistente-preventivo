import { describe, it, expect } from 'vitest';

// Mirror the BOT_STOPWORDS and extraction logic from knowledge.service.ts
// Keep in sync when updating the source.

const BOT_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'en', 'con', 'por', 'para', 'sin',
  'que', 'es', 'son', 'fue', 'ser', 'hay', 'mas', 'pero',
  'como', 'este', 'esta', 'ese', 'esa', 'esto', 'eso',
  'yo', 'tu', 'nos', 'les', 'me', 'te', 'se', 'lo',
  'si', 'no', 'ya', 'muy', 'bien', 'mal', 'hola', 'buen',
  'quiero', 'tengo', 'puede', 'puedo', 'saber', 'decir',
  'sobre', 'donde', 'cuando', 'cual', 'tiene', 'hacer',
  'gracias', 'buenas', 'buena', 'tardes', 'noches', 'dias',
  'necesito', 'quisiera', 'ayuda', 'pregunta', 'duda',
  'favor', 'informacion', 'queria', 'consulta',
]);

function extractKeywords(userMessage: string, maxWords = 6): string[] {
  return userMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !BOT_STOPWORDS.has(w))
    .slice(0, maxWords);
}

describe('Knowledge base keyword extraction', () => {
  describe('Accent stripping', () => {
    it('strips accents from Spanish words', () => {
      expect(extractKeywords('turno médico')).toEqual(['turno', 'medico']);
    });

    it('strips accents + lowercases', () => {
      expect(extractKeywords('Diabetes Hipertensión')).toEqual(['diabetes', 'hipertension']);
    });

    it('handles multiple diacritics', () => {
      expect(extractKeywords('Müller café naïve')).toEqual(['muller', 'cafe', 'naive']);
    });
  });

  describe('Punctuation stripping', () => {
    it('strips question marks', () => {
      expect(extractKeywords('¿IPS?')).toEqual(['ips']);
    });

    it('strips commas and periods', () => {
      expect(extractKeywords('turno, medico.')).toEqual(['turno', 'medico']);
    });

    it('strips exclamation marks', () => {
      expect(extractKeywords('¡Hola! diabetes')).toEqual(['diabetes']);
    });

    it('preserves numbers in words', () => {
      expect(extractKeywords('0800')).toEqual(['0800']);
    });
  });

  describe('Stopword filtering', () => {
    it('filters out Spanish articles', () => {
      expect(extractKeywords('el la los las')).toEqual([]);
    });

    it('filters out prepositions', () => {
      expect(extractKeywords('de del al en con por para sin')).toEqual([]);
    });

    it('filters out greetings', () => {
      expect(extractKeywords('hola buenas tardes')).toEqual([]);
    });

    it('filters out polite phrases', () => {
      expect(extractKeywords('gracias por favor')).toEqual([]);
    });

    it('filters common request verbs', () => {
      expect(extractKeywords('necesito quisiera queria consulta')).toEqual([]);
    });

    it('keeps non-stopword short words', () => {
      expect(extractKeywords('ips')).toEqual(['ips']);
      expect(extractKeywords('dni')).toEqual(['dni']);
      expect(extractKeywords('hiv')).toEqual(['hiv']);
    });
  });

  describe('Word length filter (>= 3 chars)', () => {
    it('filters out words with fewer than 3 chars', () => {
      expect(extractKeywords('a bb')).toEqual([]);
    });

    it('includes exactly 3 chars (non-stopword)', () => {
      expect(extractKeywords('ips')).toEqual(['ips']);
    });

    it('includes 4+ chars (non-stopword)', () => {
      expect(extractKeywords('turno')).toEqual(['turno']);
    });
  });

  describe('Max words limit', () => {
    it('limits to 6 keywords by default', () => {
      const result = extractKeywords('diabetes hipertension osteoporosis oncologico celiacos colon materno turno');
      expect(result.length).toBeLessThanOrEqual(6);
    });

    it('respects custom maxWords', () => {
      const result = extractKeywords('diabetes hipertension osteoporosis oncologico', 2);
      expect(result).toHaveLength(2);
    });
  });

  describe('Edge cases', () => {
    it('empty string → empty array', () => {
      expect(extractKeywords('')).toEqual([]);
    });

    it('whitespace only → empty array', () => {
      expect(extractKeywords('   ')).toEqual([]);
    });

    it('leading/trailing whitespace handled', () => {
      expect(extractKeywords('  turno  ')).toEqual(['turno']);
    });

    it('multiple spaces between words', () => {
      expect(extractKeywords('turno    medico')).toEqual(['turno', 'medico']);
    });

    it('only stopwords → empty array', () => {
      expect(extractKeywords('hola buenas tardes quiero saber sobre')).toEqual([]);
    });

    it('only punctuation → empty array', () => {
      expect(extractKeywords('¿? ¡! ...')).toEqual([]);
    });
  });

  describe('REGRESSION: Bug #50 — short domain words must NOT be discarded', () => {
    it('IPS (3 chars) is preserved without punctuation', () => {
      expect(extractKeywords('¿Qué es el IPS?')).toContain('ips');
    });

    it('DNI (3 chars) is preserved', () => {
      const result = extractKeywords('mi DNI es 12345678');
      expect(result).toContain('dni');
      expect(result).toContain('12345678');
    });

    it('"¿Qué es el IPS?" produces keywords (not empty)', () => {
      const result = extractKeywords('¿Qué es el IPS?');
      expect(result.length).toBeGreaterThan(0);
    });

    it('"Necesito turno" → keeps turno, filters necesito', () => {
      expect(extractKeywords('Necesito turno')).toEqual(['turno']);
    });

    it('"Hola buenas tardes, turnos" → keeps turnos only', () => {
      expect(extractKeywords('Hola buenas tardes, turnos')).toEqual(['turnos']);
    });

    it('"si" and "no" (2 chars) are filtered by both length and stopword', () => {
      expect(extractKeywords('si no')).toEqual([]);
    });
  });

  describe('Real patient queries', () => {
    it('¿El IPS cubre lentes? → includes ips, cubre, lentes', () => {
      const result = extractKeywords('¿El IPS cubre lentes?');
      expect(result).toContain('ips');
      expect(result).toContain('cubre');
      expect(result).toContain('lentes');
    });

    it('¿Cómo retiro medicamentos? → includes retiro, medicamentos', () => {
      const result = extractKeywords('¿Cómo retiro medicamentos?');
      expect(result).toContain('retiro');
      expect(result).toContain('medicamentos');
    });

    it('¿Qué es el programa de Diabetes? → includes programa, diabetes', () => {
      const result = extractKeywords('¿Qué es el programa de Diabetes?');
      expect(result).toContain('programa');
      expect(result).toContain('diabetes');
    });

    it('¿Cuánto cubre el IPS en lentes? → includes cuanto, cubre, ips, lentes', () => {
      const result = extractKeywords('¿Cuánto cubre el IPS en lentes?');
      expect(result).toContain('cubre');
      expect(result).toContain('ips');
      expect(result).toContain('lentes');
    });

    it('¿Dónde hago el control de diabetes? → includes control, diabetes', () => {
      const result = extractKeywords('¿Dónde hago el control de diabetes?');
      expect(result).toContain('control');
      expect(result).toContain('diabetes');
    });

    it('Quiero saber sobre el programa materno infantil → includes programa, materno, infantil', () => {
      const result = extractKeywords('Quiero saber sobre el programa materno infantil');
      expect(result).toContain('programa');
      expect(result).toContain('materno');
      expect(result).toContain('infantil');
    });

    it('Buenas tardes, necesito información sobre celíacos → includes celiacos', () => {
      const result = extractKeywords('Buenas tardes, necesito información sobre celíacos');
      expect(result).toContain('celiacos');
    });
  });
});
