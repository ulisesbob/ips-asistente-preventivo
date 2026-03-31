import { describe, it, expect } from 'vitest';

// Extract escalation detection logic for testing

const ESCALATION_KEYWORDS = [
  'operador', 'operadora', 'hablar con alguien', 'persona real',
  'quiero hablar', 'agente', 'humano', 'atencion humana',
  'necesito ayuda', 'no me sirve', 'reclamar', 'reclamo', 'queja',
];

function detectEscalation(text: string): boolean {
  const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ESCALATION_KEYWORDS.some((kw) => textLower.includes(kw));
}

describe('Escalation detection', () => {
  describe('Positive matches (should escalate)', () => {
    it('detects "operador"', () => {
      expect(detectEscalation('Quiero hablar con un operador')).toBe(true);
    });

    it('detects "operadora"', () => {
      expect(detectEscalation('Pasame con la operadora')).toBe(true);
    });

    it('detects "hablar con alguien"', () => {
      expect(detectEscalation('Necesito hablar con alguien de verdad')).toBe(true);
    });

    it('detects "reclamo"', () => {
      expect(detectEscalation('Quiero hacer un reclamo')).toBe(true);
    });

    it('detects "queja"', () => {
      expect(detectEscalation('Tengo una queja')).toBe(true);
    });

    it('detects with accents in input (accent stripping)', () => {
      expect(detectEscalation('Quiero atención humana')).toBe(true);
    });

    it('detects uppercase input', () => {
      expect(detectEscalation('QUIERO HABLAR CON UN OPERADOR')).toBe(true);
    });

    it('detects "necesito ayuda"', () => {
      expect(detectEscalation('Necesito ayuda urgente')).toBe(true);
    });

    it('detects "no me sirve"', () => {
      expect(detectEscalation('Esto no me sirve para nada')).toBe(true);
    });
  });

  describe('Negative matches (should NOT escalate)', () => {
    it('does NOT escalate normal questions', () => {
      expect(detectEscalation('Cuándo es mi próximo turno?')).toBe(false);
    });

    it('does NOT escalate greetings', () => {
      expect(detectEscalation('Hola buenos días')).toBe(false);
    });

    it('does NOT escalate BAJA command', () => {
      expect(detectEscalation('BAJA')).toBe(false);
    });

    it('does NOT escalate medical questions', () => {
      expect(detectEscalation('¿El IPS cubre lentes?')).toBe(false);
    });

    it('does NOT escalate empty messages', () => {
      expect(detectEscalation('')).toBe(false);
    });
  });
});
