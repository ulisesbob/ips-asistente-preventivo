import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T11 — Branch del cron de medicación según QUEUE_MEDICATION ────────────────
// runMedicationCron(): exclusivo.
//   - QUEUE_MEDICATION=false (default/prod) → sendMedicationReminders() (viejo).
//   - QUEUE_MEDICATION=true                 → enqueueMedicationReminders() (cola).
// NUNCA ambos. Con flag OFF el comportamiento de producción no cambia.

const mockSendMedicationReminders = vi.fn();
const mockEnqueueMedicationReminders = vi.fn();

const mockConfig: { QUEUE_MEDICATION: boolean } = { QUEUE_MEDICATION: false };

vi.mock('../config/env', () => ({ config: mockConfig }));

vi.mock('../services/medication-reminder.service', () => ({
  sendMedicationReminders: mockSendMedicationReminders,
  enqueueMedicationReminders: mockEnqueueMedicationReminders,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.QUEUE_MEDICATION = false;
  mockSendMedicationReminders.mockResolvedValue({ sent: 0, failed: 0 });
  mockEnqueueMedicationReminders.mockResolvedValue({ enqueued: 0 });
});

describe('runMedicationCron — branch exclusivo por flag', () => {
  it('flag OFF (default): llama sendMedicationReminders (viejo), NO enqueue', async () => {
    const { runMedicationCron } = await import('../services/medication-cron');
    await runMedicationCron();

    expect(mockSendMedicationReminders).toHaveBeenCalledTimes(1);
    expect(mockEnqueueMedicationReminders).not.toHaveBeenCalled();
  });

  it('flag ON: llama enqueueMedicationReminders (cola), NO sendMedicationReminders', async () => {
    mockConfig.QUEUE_MEDICATION = true;
    const { runMedicationCron } = await import('../services/medication-cron');
    await runMedicationCron();

    expect(mockEnqueueMedicationReminders).toHaveBeenCalledTimes(1);
    expect(mockSendMedicationReminders).not.toHaveBeenCalled();
  });
});
