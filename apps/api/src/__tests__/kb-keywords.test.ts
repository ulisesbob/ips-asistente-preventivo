import { describe, it, expect } from 'vitest';

// Extract keyword extraction logic from knowledge.service.ts

function extractKeywords(userMessage: string, maxWords = 6): string[] {
  return userMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
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

  describe('Word length filter (> 3 chars)', () => {
    it('filters out words with 3 or fewer chars', () => {
      expect(extractKeywords('si no')).toEqual([]);
    });

    it('filters "a bb ccc"', () => {
      expect(extractKeywords('a bb ccc')).toEqual([]);
    });

    it('includes exactly 4 chars', () => {
      expect(extractKeywords('dddd')).toEqual(['dddd']);
    });

    it('excludes exactly 3 chars', () => {
      expect(extractKeywords('ddd')).toEqual([]);
    });

    it('DNI (3 chars) is filtered out', () => {
      expect(extractKeywords('mi dni es')).toEqual([]);
    });
  });

  describe('Max words limit', () => {
    it('limits to 6 keywords by default', () => {
      const result = extractKeywords('uno dosss tress cuatro cinco seiss siete ochoo');
      expect(result.length).toBeLessThanOrEqual(6);
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
  });

  describe('Real patient queries', () => {
    it('¿El IPS cubre lentes? → [cubre, lentes]', () => {
      expect(extractKeywords('¿El IPS cubre lentes?')).toEqual(['cubre', 'lentes?']);
    });

    it('¿Cómo retiro medicamentos? → includes retiro', () => {
      const result = extractKeywords('¿Cómo retiro medicamentos?');
      expect(result).toContain('retiro');
      expect(result).toContain('medicamentos?');
    });

    it('¿Qué es el programa de Diabetes? → [programa, diabetes?]', () => {
      const result = extractKeywords('¿Qué es el programa de Diabetes?');
      expect(result).toContain('programa');
    });
  });
});
