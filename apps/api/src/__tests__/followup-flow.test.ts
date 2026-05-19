import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockeo de @ips/db y messaging — testea la lógica del flow completo sin DB real.
// Patrón: cada test setea las respuestas de los mocks y verifica los side effects.

const mockPrisma = {
  patient: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

const mockSendTextMessage = vi.fn();

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', UNSUBSCRIBED: 'UNSUBSCRIBED' },
  RegisteredVia: { BOT: 'BOT', PANEL: 'PANEL', IMPORT: 'IMPORT' },
}));

vi.mock('../services/messaging.service', () => ({
  sendTextMessage: mockSendTextMessage,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const makePatient = (overrides = {}) => ({
  id: 'pat-1',
  fullName: 'Juan Pérez',
  phone: '+5493764125878',
  noProgramReminderCount: 0,
  createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // hace 8 días
  ...overrides,
});

describe('processFollowups — happy path', () => {
  it('paciente elegible → envía mensaje + incrementa count + setea lastNoProgramReminderAt', async () => {
    const patient = makePatient();
    mockPrisma.patient.findMany.mockResolvedValueOnce([patient]);
    mockPrisma.patient.findFirst.mockResolvedValueOnce({ id: patient.id }); // race-check pasa
    mockSendTextMessage.mockResolvedValueOnce(true);
    mockPrisma.patient.update.mockResolvedValueOnce({});

    const { processFollowups } = await import('../services/patient-followup.service');
    const result = await processFollowups();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockSendTextMessage).toHaveBeenCalledOnce();
    // Phone se envía normalizado para Meta (sin + y sin el 9 mobile AR)
    expect(mockSendTextMessage.mock.calls[0][0]).toBe('543764125878');
    // El mensaje contiene firstName + días desde registro
    expect(mockSendTextMessage.mock.calls[0][1]).toContain('Juan');
    expect(mockSendTextMessage.mock.calls[0][1]).toContain('8 días');
    // Update incrementa el counter
    expect(mockPrisma.patient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          noProgramReminderCount: { increment: 1 },
        }),
      })
    );
  });

  it('cero pacientes elegibles → no envía nada', async () => {
    mockPrisma.patient.findMany.mockResolvedValueOnce([]);

    const { processFollowups } = await import('../services/patient-followup.service');
    const result = await processFollowups();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.patient.update).not.toHaveBeenCalled();
  });
});

describe('processFollowups — race condition fix', () => {
  it('si paciente fue enrolado entre query y send → skip + NO envía', async () => {
    const patient = makePatient();
    mockPrisma.patient.findMany.mockResolvedValueOnce([patient]);
    // Race-check devuelve null = ya tiene programa o dio BAJA → skip
    mockPrisma.patient.findFirst.mockResolvedValueOnce(null);

    const { processFollowups } = await import('../services/patient-followup.service');
    const result = await processFollowups();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.patient.update).not.toHaveBeenCalled();
  });
});

describe('processFollowups — error handling', () => {
  it('sendTextMessage retorna false → falla pero no rompe el cron', async () => {
    const patient = makePatient();
    mockPrisma.patient.findMany.mockResolvedValueOnce([patient]);
    mockPrisma.patient.findFirst.mockResolvedValueOnce({ id: patient.id });
    mockSendTextMessage.mockResolvedValueOnce(false); // Meta/Twilio falló

    const { processFollowups } = await import('../services/patient-followup.service');
    const result = await processFollowups();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(mockPrisma.patient.update).not.toHaveBeenCalled(); // no incrementa counter
  });

  it('paciente sin phone (raro pero defensivo) → skip silencioso', async () => {
    const patient = makePatient({ phone: null });
    mockPrisma.patient.findMany.mockResolvedValueOnce([patient]);

    const { processFollowups } = await import('../services/patient-followup.service');
    const result = await processFollowups();

    expect(result.sent).toBe(0);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });
});

describe('processFollowups — escalamiento de mensaje según attempt', () => {
  it('attempt 3 (count=2 → 3) usa el mensaje de "último recordatorio"', async () => {
    const patient = makePatient({ noProgramReminderCount: 2 });
    mockPrisma.patient.findMany.mockResolvedValueOnce([patient]);
    mockPrisma.patient.findFirst.mockResolvedValueOnce({ id: patient.id });
    mockSendTextMessage.mockResolvedValueOnce(true);
    mockPrisma.patient.update.mockResolvedValueOnce({});

    const { processFollowups } = await import('../services/patient-followup.service');
    await processFollowups();

    const sentMessage = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sentMessage).toContain('último recordatorio');
    expect(sentMessage).toContain('No vamos a enviarte más recordatorios');
  });

  it('attempt 1 (count=0 → 1) NO menciona "último"', async () => {
    const patient = makePatient({ noProgramReminderCount: 0 });
    mockPrisma.patient.findMany.mockResolvedValueOnce([patient]);
    mockPrisma.patient.findFirst.mockResolvedValueOnce({ id: patient.id });
    mockSendTextMessage.mockResolvedValueOnce(true);
    mockPrisma.patient.update.mockResolvedValueOnce({});

    const { processFollowups } = await import('../services/patient-followup.service');
    await processFollowups();

    const sentMessage = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sentMessage).not.toContain('último');
    expect(sentMessage).toContain('Para inscribirte');
  });
});

describe('processFollowups — múltiples pacientes', () => {
  it('procesa 3 pacientes secuencialmente con rate limit', async () => {
    const patients = [
      makePatient({ id: 'p1' }),
      makePatient({ id: 'p2' }),
      makePatient({ id: 'p3' }),
    ];
    mockPrisma.patient.findMany.mockResolvedValueOnce(patients);
    mockPrisma.patient.findFirst
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({ id: 'p2' })
      .mockResolvedValueOnce({ id: 'p3' });
    mockSendTextMessage.mockResolvedValue(true);
    mockPrisma.patient.update.mockResolvedValue({});

    const { processFollowups } = await import('../services/patient-followup.service');
    const result = await processFollowups();

    expect(result.sent).toBe(3);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(3);
    expect(mockPrisma.patient.update).toHaveBeenCalledTimes(3);
  });

  it('si uno de 3 falla, los otros 2 igual se envían', async () => {
    const patients = [
      makePatient({ id: 'p1' }),
      makePatient({ id: 'p2' }),
      makePatient({ id: 'p3' }),
    ];
    mockPrisma.patient.findMany.mockResolvedValueOnce(patients);
    mockPrisma.patient.findFirst
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({ id: 'p2' })
      .mockResolvedValueOnce({ id: 'p3' });
    mockSendTextMessage
      .mockResolvedValueOnce(true)   // p1 OK
      .mockResolvedValueOnce(false)  // p2 falla
      .mockResolvedValueOnce(true);  // p3 OK
    mockPrisma.patient.update.mockResolvedValue({});

    const { processFollowups } = await import('../services/patient-followup.service');
    const result = await processFollowups();

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(mockPrisma.patient.update).toHaveBeenCalledTimes(2); // solo p1 y p3
  });
});
