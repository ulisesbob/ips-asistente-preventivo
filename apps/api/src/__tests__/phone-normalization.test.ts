import { describe, it, expect } from 'vitest';

// Test the normalizePhoneForSend function directly
// We extract the logic to test it in isolation

function normalizePhoneForSend(phone: string): string {
  let p = phone.startsWith('+') ? phone.slice(1) : phone;
  if (p.startsWith('549') && p.length === 13) {
    return '54' + p.slice(3);
  }
  return p;
}

function toSendablePhone(phone: string): string {
  let p = phone.startsWith('+') ? phone.slice(1) : phone;
  if (p.startsWith('549') && p.length === 13) {
    p = '54' + p.slice(3);
  }
  return p;
}

describe('Phone normalization — Argentina (LESSONS #40)', () => {
  describe('normalizePhoneForSend (whatsapp.service.ts)', () => {
    it('strips + prefix from E.164 number', () => {
      expect(normalizePhoneForSend('+5493764125878')).toBe('543764125878');
    });

    it('converts Argentine mobile 549 → 54 (13 digits)', () => {
      expect(normalizePhoneForSend('5493764125878')).toBe('543764125878');
    });

    it('converts Argentine mobile with + prefix', () => {
      expect(normalizePhoneForSend('+5493764125878')).toBe('543764125878');
    });

    it('does NOT modify non-Argentine numbers', () => {
      expect(normalizePhoneForSend('+5511999887766')).toBe('5511999887766');
    });

    it('does NOT modify Argentine landline (no 9)', () => {
      expect(normalizePhoneForSend('+543764125878')).toBe('543764125878');
    });

    it('does NOT modify short numbers', () => {
      expect(normalizePhoneForSend('549376412')).toBe('549376412');
    });

    it('handles number without + that is already normalized', () => {
      expect(normalizePhoneForSend('543764125878')).toBe('543764125878');
    });
  });

  describe('toSendablePhone (conversation.service.ts)', () => {
    it('strips + and converts 549 for Argentine mobile', () => {
      expect(toSendablePhone('+5493764125878')).toBe('543764125878');
    });

    it('works without + prefix', () => {
      expect(toSendablePhone('5493764125878')).toBe('543764125878');
    });

    it('passes through already-normalized numbers', () => {
      expect(toSendablePhone('543764125878')).toBe('543764125878');
    });
  });

  describe('Double normalization safety', () => {
    it('applying normalizePhoneForSend twice is safe (no-op on second pass)', () => {
      const first = normalizePhoneForSend('+5493764125878');
      const second = normalizePhoneForSend(first);
      expect(second).toBe('543764125878');
    });

    it('toSendablePhone then normalizePhoneForSend is safe', () => {
      const first = toSendablePhone('+5493764125878');
      const second = normalizePhoneForSend(first);
      expect(second).toBe('543764125878');
    });
  });
});
