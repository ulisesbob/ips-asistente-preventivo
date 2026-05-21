import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T12 — Branch del cron de self-reminders según QUEUE_SELF ──────────────────
// runSelfReminderCron(): exclusivo.
//   - QUEUE_SELF=false (default/prod) → processDueSelfReminders() (viejo).
//   - QUEUE_SELF=true                 → enqueueSelfReminders() (cola).
// NUNCA ambos. Con flag OFF el comportamiento de producción no cambia.

const mockProcessDueSelfReminders = vi.fn();
const mockEnqueueSelfReminders = vi.fn();

const mockConfig: { QUEUE_SELF: boolean } = { QUEUE_SELF: false };

vi.mock('../config/env', () => ({ config: mockConfig }));

vi.mock('../services/self-reminder.service', () => ({
  processDueSelfReminders: mockProcessDueSelfReminders,
  enqueueSelfReminders: mockEnqueueSelfReminders,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.QUEUE_SELF = false;
  mockProcessDueSelfReminders.mockResolvedValue({ sent: 0, failed: 0 });
  mockEnqueueSelfReminders.mockResolvedValue({ enqueued: 0 });
});

describe('runSelfReminderCron — branch exclusivo por flag', () => {
  it('flag OFF (default): llama processDueSelfReminders (viejo), NO enqueue', async () => {
    const { runSelfReminderCron } = await import('../services/self-reminder-cron');
    await runSelfReminderCron();

    expect(mockProcessDueSelfReminders).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSelfReminders).not.toHaveBeenCalled();
  });

  it('flag ON: llama enqueueSelfReminders (cola), NO processDueSelfReminders', async () => {
    mockConfig.QUEUE_SELF = true;
    const { runSelfReminderCron } = await import('../services/self-reminder-cron');
    await runSelfReminderCron();

    expect(mockEnqueueSelfReminders).toHaveBeenCalledTimes(1);
    expect(mockProcessDueSelfReminders).not.toHaveBeenCalled();
  });
});
