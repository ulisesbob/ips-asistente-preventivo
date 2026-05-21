import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T13 — Branch del cron de controles según QUEUE_CONTROL ────────────────────
// runControlCron(): exclusivo. Como vive en el mismo módulo que processDueReminders
// y enqueueControls (no se pueden mockear funciones del propio módulo), distinguimos
// qué camino corrió por la query: el viejo ordena por nextReminderDate (prioriza los
// más vencidos), el productor ordena por id (cursor de paginación) y usa getBoss().
//   - QUEUE_CONTROL=false (default/prod) → processDueReminders() (viejo).
//   - QUEUE_CONTROL=true                 → enqueueControls() (cola).

const mockPrisma = {
  patientProgram: { findMany: vi.fn() },
};
const mockSend = vi.fn().mockResolvedValue('job-id');
const mockGetBoss = vi.fn(() => ({ send: mockSend }));
const mockConfig: { QUEUE_CONTROL: boolean } = { QUEUE_CONTROL: false };

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED' },
  ReminderStatus: { SENT: 'SENT', FAILED: 'FAILED' },
}));
vi.mock('../config/env', () => ({ config: mockConfig }));
vi.mock('../services/messaging.service', () => ({ sendTextMessage: vi.fn() }));
vi.mock('../queue/limiter', () => ({ limiter: { schedule: (fn: () => unknown) => fn() } }));
vi.mock('../queue/boss', () => ({ getBoss: mockGetBoss }));

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.QUEUE_CONTROL = false;
  mockSend.mockResolvedValue('job-id');
  mockGetBoss.mockReturnValue({ send: mockSend });
  // Sin candidatos: ambos caminos cortan temprano, alcanza para ver QUÉ query corrió.
  mockPrisma.patientProgram.findMany.mockResolvedValue([]);
});

describe('runControlCron — branch exclusivo por flag', () => {
  it('flag OFF (default): corre el camino viejo (orderBy nextReminderDate), NO toca la cola', async () => {
    const { runControlCron } = await import('../services/reminder.service');
    await runControlCron();

    expect(mockPrisma.patientProgram.findMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.patientProgram.findMany.mock.calls[0][0];
    expect(arg.orderBy).toMatchObject({ nextReminderDate: 'asc' });
    expect(mockGetBoss).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('flag ON: corre el productor (orderBy id para el cursor) usando getBoss()', async () => {
    mockConfig.QUEUE_CONTROL = true;
    const { runControlCron } = await import('../services/reminder.service');
    await runControlCron();

    expect(mockGetBoss).toHaveBeenCalledTimes(1);
    expect(mockPrisma.patientProgram.findMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.patientProgram.findMany.mock.calls[0][0];
    expect(arg.orderBy).toMatchObject({ id: 'asc' });
  });
});
