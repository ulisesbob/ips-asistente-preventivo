import { describe, it, expect } from 'vitest';

// Extract the survey response parsing logic for unit testing
// This mirrors the branching in processSurveyResponse

type PendingSurvey = { attended: boolean | null };

function parseSurveyStep1(text: string): 'yes' | 'no' | null {
  const textLower = text.trim().toLowerCase();
  if (textLower === 'si' || textLower === 'sí' || textLower === '1') return 'yes';
  if (textLower === 'no' || textLower === '2') return 'no';
  return null;
}

function parseSurveyStep2(text: string): number | null {
  const textLower = text.trim().toLowerCase();
  const rating = parseInt(textLower);
  if (rating >= 1 && rating <= 5) return rating;
  return null;
}

function processSurveyInput(pending: PendingSurvey | null, text: string): string | null {
  if (!pending) return null;

  if (pending.attended === null) {
    const answer = parseSurveyStep1(text);
    if (answer === 'yes') return 'rating_prompt';
    if (answer === 'no') return 'no_attend_response';
    return null;
  }

  if (pending.attended === true) {
    const rating = parseSurveyStep2(text);
    if (rating !== null) return rating >= 4 ? 'positive_feedback' : 'negative_feedback';
    return null;
  }

  return null;
}

describe('Survey response parsing', () => {
  describe('Step 1 — attended? (pending.attended === null)', () => {
    const pending: PendingSurvey = { attended: null };

    it('"si" → rating prompt', () => {
      expect(processSurveyInput(pending, 'si')).toBe('rating_prompt');
    });

    it('"Sí" (with accent + uppercase) → rating prompt', () => {
      expect(processSurveyInput(pending, 'Sí')).toBe('rating_prompt');
    });

    it('"SI" (uppercase) → rating prompt', () => {
      expect(processSurveyInput(pending, 'SI')).toBe('rating_prompt');
    });

    it('"sí" (lowercase with accent) → rating prompt', () => {
      expect(processSurveyInput(pending, 'sí')).toBe('rating_prompt');
    });

    it('"1" → rating prompt', () => {
      expect(processSurveyInput(pending, '1')).toBe('rating_prompt');
    });

    it('"no" → no-attend response', () => {
      expect(processSurveyInput(pending, 'no')).toBe('no_attend_response');
    });

    it('"No" (uppercase) → no-attend response', () => {
      expect(processSurveyInput(pending, 'No')).toBe('no_attend_response');
    });

    it('"NO" → no-attend response', () => {
      expect(processSurveyInput(pending, 'NO')).toBe('no_attend_response');
    });

    it('"2" → no-attend response', () => {
      expect(processSurveyInput(pending, '2')).toBe('no_attend_response');
    });

    it('"3" → null (not a valid step 1 answer)', () => {
      expect(processSurveyInput(pending, '3')).toBeNull();
    });

    it('"quiero cancelar" → null (does NOT swallow message)', () => {
      expect(processSurveyInput(pending, 'quiero cancelar')).toBeNull();
    });

    it('"  si  " (whitespace) → rating prompt', () => {
      expect(processSurveyInput(pending, '  si  ')).toBe('rating_prompt');
    });

    it('"" (empty) → null', () => {
      expect(processSurveyInput(pending, '')).toBeNull();
    });
  });

  describe('Step 2 — rating (pending.attended === true)', () => {
    const pending: PendingSurvey = { attended: true };

    it('"1" → negative feedback', () => {
      expect(processSurveyInput(pending, '1')).toBe('negative_feedback');
    });

    it('"3" → negative feedback', () => {
      expect(processSurveyInput(pending, '3')).toBe('negative_feedback');
    });

    it('"4" → positive feedback', () => {
      expect(processSurveyInput(pending, '4')).toBe('positive_feedback');
    });

    it('"5" → positive feedback', () => {
      expect(processSurveyInput(pending, '5')).toBe('positive_feedback');
    });

    it('"0" → null (below range)', () => {
      expect(processSurveyInput(pending, '0')).toBeNull();
    });

    it('"6" → null (above range)', () => {
      expect(processSurveyInput(pending, '6')).toBeNull();
    });

    it('"abc" → null (not a number)', () => {
      expect(processSurveyInput(pending, 'abc')).toBeNull();
    });

    it('" 3 " (whitespace) → negative feedback', () => {
      expect(processSurveyInput(pending, ' 3 ')).toBe('negative_feedback');
    });
  });

  describe('No pending survey', () => {
    it('null pending → null', () => {
      expect(processSurveyInput(null, 'si')).toBeNull();
    });

    it('null pending → null for any text', () => {
      expect(processSurveyInput(null, '5')).toBeNull();
    });
  });

  describe('attended === false (already completed — should not reach this)', () => {
    it('returns null', () => {
      expect(processSurveyInput({ attended: false }, 'si')).toBeNull();
    });
  });
});
