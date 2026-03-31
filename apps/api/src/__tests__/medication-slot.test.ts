import { describe, it, expect } from 'vitest';

// Extract the slot calculation logic from medication-reminder.service.ts

function calcSlot(argMinute: number): 0 | 30 {
  return argMinute < 15 ? 0 : 30;
}

// Extract Intl timezone extraction
function getArgentinaTime(date: Date): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: 'numeric', hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const parts = formatter.formatToParts(date);
  return {
    hour: parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0'),
    minute: parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0'),
  };
}

describe('Medication cron slot matching', () => {
  describe('calcSlot — minute → slot mapping', () => {
    it('minute 0 → slot 0', () => expect(calcSlot(0)).toBe(0));
    it('minute 14 → slot 0 (boundary)', () => expect(calcSlot(14)).toBe(0));
    it('minute 15 → slot 30 (boundary)', () => expect(calcSlot(15)).toBe(30));
    it('minute 29 → slot 30', () => expect(calcSlot(29)).toBe(30));
    it('minute 30 → slot 30', () => expect(calcSlot(30)).toBe(30));
    it('minute 44 → slot 30', () => expect(calcSlot(44)).toBe(30));
    it('minute 45 → slot 30', () => expect(calcSlot(45)).toBe(30));
    it('minute 59 → slot 30', () => expect(calcSlot(59)).toBe(30));
  });

  describe('getArgentinaTime — Intl timezone extraction', () => {
    it('15:00 UTC → 12:00 Argentina', () => {
      const { hour, minute } = getArgentinaTime(new Date('2026-03-30T15:00:00Z'));
      expect(hour).toBe(12);
      expect(minute).toBe(0);
    });

    it('15:30 UTC → 12:30 Argentina', () => {
      const { hour, minute } = getArgentinaTime(new Date('2026-03-30T15:30:00Z'));
      expect(hour).toBe(12);
      expect(minute).toBe(30);
    });

    it('00:00 UTC → 21:00 Argentina (previous day)', () => {
      const { hour, minute } = getArgentinaTime(new Date('2026-03-30T00:00:00Z'));
      expect(hour).toBe(21);
      expect(minute).toBe(0);
    });

    it('02:59 UTC → 23:59 Argentina', () => {
      const { hour, minute } = getArgentinaTime(new Date('2026-03-30T02:59:00Z'));
      expect(hour).toBe(23);
      expect(minute).toBe(59);
    });

    it('11:00 UTC → 08:00 Argentina (common medication time)', () => {
      const { hour, minute } = getArgentinaTime(new Date('2026-03-30T11:00:00Z'));
      expect(hour).toBe(8);
      expect(minute).toBe(0);
    });
  });

  describe('End-to-end: UTC time → Argentina time → slot', () => {
    it('11:00 UTC → Argentina 08:00 → slot 0', () => {
      const { hour, minute } = getArgentinaTime(new Date('2026-03-30T11:00:00Z'));
      expect(hour).toBe(8);
      expect(calcSlot(minute)).toBe(0);
    });

    it('11:30 UTC → Argentina 08:30 → slot 30', () => {
      const { hour, minute } = getArgentinaTime(new Date('2026-03-30T11:30:00Z'));
      expect(hour).toBe(8);
      expect(calcSlot(minute)).toBe(30);
    });
  });
});
