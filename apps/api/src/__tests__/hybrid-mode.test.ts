import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Modo híbrido: el operador escribe en OPEN, el bot se pausa ───────────────
// - sendOperatorReply permitido en OPEN y ESCALATED (rechaza CLOSED); en OPEN
//   pausa el bot (botPausedUntil = now + 30 min).
// - handleIncomingMessage: con la pausa vigente, guarda el mensaje del paciente y
//   NO auto-responde (ni siquiera procesa encuesta). Al expirar, el bot retoma.
// - resumeBot limpia la pausa. Acceso por programa (IDOR) en ambas acciones.

const mockPrisma = {
  patient: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  doctorProgram: { findMany: vi.fn() },
  message: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  patientSelfReminder: { findMany: vi.fn() },
};

const mockSendTextMessage = vi.fn();
const mockGenerateResponse = vi.fn();

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  ConversationStatus: { OPEN: 'OPEN', ESCALATED: 'ESCALATED', CLOSED: 'CLOSED' },
  MessageRole: { USER: 'USER', ASSISTANT: 'ASSISTANT', SYSTEM: 'SYSTEM' },
  RegisteredVia: { BOT: 'BOT', PANEL: 'PANEL', IMPORT: 'IMPORT' },
  ConsentVia: { BOT: 'BOT', PANEL: 'PANEL' },
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED' },
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
  SelfReminderStatus: { PENDING: 'PENDING', SENT: 'SENT', CANCELLED: 'CANCELLED' },
}));

vi.mock('../services/messaging.service', () => ({ sendTextMessage: mockSendTextMessage }));
vi.mock('../services/ai.service', () => ({
  generateResponse: mockGenerateResponse,
  buildSystemPrompt: vi.fn(() => []),
  MAX_HISTORY_MESSAGES: 20,
}));
vi.mock('../services/note.service', () => ({ getLatestNotesForBot: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/knowledge.service', () => ({ getRelevantKBForBot: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/survey.service', () => ({ processSurveyResponse: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/medication-reminder.service', () => ({
  getMedicationsForBot: vi.fn().mockResolvedValue([]),
  createMedReminderFromBot: vi.fn(),
}));

const PHONE = '5493764555000';
const E164 = '+5493764555000';

function makePatient() {
  return { id: 'pat-1', fullName: 'Carlos Díaz', consent: true, whatsappLinked: true, programs: [] };
}
// Conversación para verifyConversationAccess: paciente del programa 'p1'.
function makeConvAccess(status: string) {
  return { id: 'conv-1', phone: E164, status, patientId: 'pat-1', patient: { programs: [{ programId: 'p1' }] } };
}

async function load() {
  return import('../services/conversation.service');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTextMessage.mockResolvedValue(true);
  mockGenerateResponse.mockResolvedValue('Respuesta de Ana.');
  mockPrisma.patient.findUnique.mockResolvedValue(null);
  mockPrisma.conversation.findFirst.mockResolvedValue(null);
  mockPrisma.conversation.findUnique.mockResolvedValue(null);
  mockPrisma.conversation.create.mockResolvedValue({ id: 'conv-1' });
  mockPrisma.conversation.update.mockResolvedValue({});
  mockPrisma.doctorProgram.findMany.mockResolvedValue([]);
  mockPrisma.message.create.mockResolvedValue({});
  mockPrisma.message.createMany.mockResolvedValue({ count: 2 });
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.patientSelfReminder.findMany.mockResolvedValue([]);
});

// ─── sendOperatorReply ───────────────────────────────────────────────────────

describe('sendOperatorReply (modo híbrido)', () => {
  it('OPEN: no tira error, guarda [Operador], envía y pausa el bot ~30 min', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(makeConvAccess('OPEN'));
    const { sendOperatorReply } = await load();

    const before = Date.now();
    await sendOperatorReply('conv-1', 'Hola, soy Juana del IPS', 'doc-1', 'ADMIN');

    // guarda como SYSTEM con prefijo [Operador]
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'SYSTEM', content: '[Operador] Hola, soy Juana del IPS' }) })
    );
    // pausa el bot
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1' }, data: expect.objectContaining({ botPausedUntil: expect.any(Date) }) })
    );
    const pausedUntil = (mockPrisma.conversation.update.mock.calls[0][0].data.botPausedUntil as Date).getTime();
    expect(pausedUntil).toBeGreaterThan(before + 29 * 60 * 1000);
    expect(pausedUntil).toBeLessThan(before + 31 * 60 * 1000);
    // envía por WhatsApp
    expect(mockSendTextMessage).toHaveBeenCalled();
  });

  it('ESCALATED: sigue funcionando (envía) y NO toca botPausedUntil', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(makeConvAccess('ESCALATED'));
    const { sendOperatorReply } = await load();
    await sendOperatorReply('conv-1', 'respuesta', 'doc-1', 'ADMIN');
    expect(mockSendTextMessage).toHaveBeenCalled();
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
  });

  it('CLOSED: rechaza con error claro', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(makeConvAccess('CLOSED'));
    const { sendOperatorReply } = await load();
    await expect(sendOperatorReply('conv-1', 'x', 'doc-1', 'ADMIN')).rejects.toThrow(/cerrada/i);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('IDOR: un DOCTOR de otro programa no puede responder (NotFoundError)', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(makeConvAccess('OPEN')); // paciente en 'p1'
    mockPrisma.doctorProgram.findMany.mockResolvedValue([{ programId: 'p2' }]); // doctor en 'p2'
    const { sendOperatorReply } = await load();
    const { NotFoundError } = await import('../utils/errors');
    await expect(sendOperatorReply('conv-1', 'x', 'doc-1', 'DOCTOR')).rejects.toBeInstanceOf(NotFoundError);
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });
});

// ─── resumeBot ───────────────────────────────────────────────────────────────

describe('resumeBot (devolver al bot)', () => {
  it('limpia botPausedUntil', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(makeConvAccess('OPEN'));
    const { resumeBot } = await load();
    await resumeBot('conv-1', 'doc-1', 'ADMIN');
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1' }, data: { botPausedUntil: null } })
    );
  });

  it('IDOR: DOCTOR ajeno no puede devolver al bot (NotFoundError)', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(makeConvAccess('OPEN'));
    mockPrisma.doctorProgram.findMany.mockResolvedValue([{ programId: 'p2' }]);
    const { resumeBot } = await load();
    const { NotFoundError } = await import('../utils/errors');
    await expect(resumeBot('conv-1', 'doc-1', 'DOCTOR')).rejects.toBeInstanceOf(NotFoundError);
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
  });
});

// ─── handleIncomingMessage con bot en pausa ──────────────────────────────────

describe('handleIncomingMessage: bot en pausa (operador atendiendo)', () => {
  it('pausa vigente → guarda el mensaje del paciente y NO auto-responde', async () => {
    mockPrisma.patient.findUnique.mockResolvedValue(makePatient());
    // El query de pausa (status OPEN + botPausedUntil > now) devuelve la conversación
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'conv-paused' });
    const { handleIncomingMessage } = await load();

    await handleIncomingMessage(PHONE, 'una duda', 'Carlos', false);

    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conversationId: 'conv-paused', role: 'USER', content: 'una duda' }) })
    );
    expect(mockGenerateResponse).not.toHaveBeenCalled(); // el bot queda callado
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('sin pausa (expirada/ninguna) → el bot responde normalmente', async () => {
    mockPrisma.patient.findUnique.mockResolvedValue(makePatient());
    mockPrisma.conversation.findFirst.mockResolvedValue(null); // pausa no vigente
    const { handleIncomingMessage } = await load();

    await handleIncomingMessage(PHONE, 'hola Ana', 'Carlos', false);

    expect(mockGenerateResponse).toHaveBeenCalledOnce();
    expect(mockSendTextMessage).toHaveBeenCalled();
  });
});
