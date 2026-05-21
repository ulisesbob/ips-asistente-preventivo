import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T7 — Branch del cron de followup según QUEUE_FOLLOWUP ─────────────────────
// runFollowupCron(): exclusivo.
//   - QUEUE_FOLLOWUP=false (default/prod) → llama processFollowups() (código viejo).
//   - QUEUE_FOLLOWUP=true                 → llama enqueueFollowups() (cola nueva).
// NUNCA ambos. Verifica la regla de oro: con flag OFF el comportamiento no cambia.

const mockProcessFollowups = vi.fn();
const mockEnqueueFollowups = vi.fn();

const mockConfig: { QUEUE_FOLLOWUP: boolean } = { QUEUE_FOLLOWUP: false };

vi.mock('../config/env', () => ({ config: mockConfig }));

// Mockeamos el propio service: queremos verificar QUÉ función llama el branch,
// no su implementación (ya cubierta en followup-queue.test.ts).
vi.mock('../services/patient-followup.service', () => ({
  processFollowups: mockProcessFollowups,
  enqueueFollowups: mockEnqueueFollowups,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.QUEUE_FOLLOWUP = false;
  mockProcessFollowups.mockResolvedValue({ sent: 0, failed: 0 });
  mockEnqueueFollowups.mockResolvedValue({ enqueued: 0 });
});

describe('runFollowupCron — branch exclusivo por flag', () => {
  it('flag OFF (default): llama processFollowups (código viejo), NO enqueue', async () => {
    const { runFollowupCron } = await import('../services/followup-cron');
    await runFollowupCron();

    expect(mockProcessFollowups).toHaveBeenCalledTimes(1);
    expect(mockEnqueueFollowups).not.toHaveBeenCalled();
  });

  it('flag ON: llama enqueueFollowups (cola), NO processFollowups', async () => {
    mockConfig.QUEUE_FOLLOWUP = true;
    const { runFollowupCron } = await import('../services/followup-cron');
    await runFollowupCron();

    expect(mockEnqueueFollowups).toHaveBeenCalledTimes(1);
    expect(mockProcessFollowups).not.toHaveBeenCalled();
  });
});
