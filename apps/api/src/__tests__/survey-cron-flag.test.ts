import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T10 — Branch del cron de survey según QUEUE_SURVEY ────────────────────────
// runSurveyCron(): exclusivo.
//   - QUEUE_SURVEY=false (default/prod) → processPendingSurveys() (código viejo).
//   - QUEUE_SURVEY=true                 → enqueueSurveys() (cola nueva).
// NUNCA ambos. Con flag OFF el comportamiento de producción no cambia.

const mockProcessPendingSurveys = vi.fn();
const mockEnqueueSurveys = vi.fn();

const mockConfig: { QUEUE_SURVEY: boolean } = { QUEUE_SURVEY: false };

vi.mock('../config/env', () => ({ config: mockConfig }));

vi.mock('../services/survey.service', () => ({
  processPendingSurveys: mockProcessPendingSurveys,
  enqueueSurveys: mockEnqueueSurveys,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.QUEUE_SURVEY = false;
  mockProcessPendingSurveys.mockResolvedValue({ sent: 0, failed: 0 });
  mockEnqueueSurveys.mockResolvedValue({ enqueued: 0 });
});

describe('runSurveyCron — branch exclusivo por flag', () => {
  it('flag OFF (default): llama processPendingSurveys (código viejo), NO enqueue', async () => {
    const { runSurveyCron } = await import('../services/survey-cron');
    await runSurveyCron();

    expect(mockProcessPendingSurveys).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSurveys).not.toHaveBeenCalled();
  });

  it('flag ON: llama enqueueSurveys (cola), NO processPendingSurveys', async () => {
    mockConfig.QUEUE_SURVEY = true;
    const { runSurveyCron } = await import('../services/survey-cron');
    await runSurveyCron();

    expect(mockEnqueueSurveys).toHaveBeenCalledTimes(1);
    expect(mockProcessPendingSurveys).not.toHaveBeenCalled();
  });
});
