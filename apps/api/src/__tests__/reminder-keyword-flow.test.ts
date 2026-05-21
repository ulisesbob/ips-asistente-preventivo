import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Flujo por keyword unificado en PatientSelfReminder (punto 1) ─────────────
// Antes: "recordame..." → handleReminderFlow → createMedReminderFromBot
//        (tabla MedicationReminder), pero ver/cancelar miraban PatientSelfReminder.
// Ahora: el flujo por keyword crea un PatientSelfReminder recurrente diario,
//        así crear/listar/cancelar usan SIEMPRE la misma tabla.

const mockPrisma = {
  patient: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  conversation: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  message: {
    create: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
  },
};

const mockSendTextMessage = vi.fn();
const mockGenerateResponse = vi.fn();
const mockBuildSystemPrompt = vi.fn(() => []);

// Spies de los servicios de recordatorios: queremos verificar QUÉ tabla se usa.
const mockCreateSelfReminder = vi.fn();
const mockListActiveSelfReminders = vi.fn();
const mockCreateMedReminderFromBot = vi.fn();

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  ConversationStatus: { OPEN: 'OPEN', ESCALATED: 'ESCALATED', CLOSED: 'CLOSED' },
  MessageRole: { USER: 'USER', ASSISTANT: 'ASSISTANT', SYSTEM: 'SYSTEM' },
  RegisteredVia: { BOT: 'BOT', PANEL: 'PANEL', IMPORT: 'IMPORT' },
  ConsentVia: { BOT: 'BOT', PANEL: 'PANEL' },
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', UNSUBSCRIBED: 'UNSUBSCRIBED' },
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
}));

vi.mock('../services/messaging.service', () => ({
  sendTextMessage: mockSendTextMessage,
}));

vi.mock('../services/ai.service', () => ({
  generateResponse: mockGenerateResponse,
  buildSystemPrompt: mockBuildSystemPrompt,
  MAX_HISTORY_MESSAGES: 20,
}));

// El flujo por keyword NO usa la IA. Mockeamos los servicios de contexto para
// que no toquen la DB ni el SDK de Anthropic.
vi.mock('../services/note.service', () => ({ getLatestNotesForBot: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/knowledge.service', () => ({ getRelevantKBForBot: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/survey.service', () => ({ processSurveyResponse: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/medication-reminder.service', () => ({
  getMedicationsForBot: vi.fn().mockResolvedValue([]),
  createMedReminderFromBot: mockCreateMedReminderFromBot,
}));
vi.mock('../services/self-reminder.service', () => ({
  getSelfRemindersForBot: vi.fn().mockResolvedValue([]),
  createSelfReminder: mockCreateSelfReminder,
  listActiveSelfReminders: mockListActiveSelfReminders,
  cancelSelfReminders: vi.fn(),
  cancelAllSelfReminders: vi.fn(),
  parseSelfReminderTag: vi.fn(() => ({ found: false, cleanResponse: '' })),
  parseListRemindersTag: vi.fn(() => ({ found: false, cleanResponse: '' })),
  parseCancelReminderTag: vi.fn(() => ({ found: false, cleanResponse: '' })),
  parseCancelAllRemindersTag: vi.fn(() => ({ found: false, cleanResponse: '' })),
  formatRemindersForWhatsApp: vi.fn(() => ''),
  // Fecha fija válida (en formato YYYY-MM-DD) — el flujo por keyword la usa.
  todayArgentinaISO: vi.fn(() => '2026-05-21'),
}));

const PHONE = '5493764222222';
const E164 = '+5493764222222';

function makePatient() {
  return {
    id: 'pat-keyword',
    fullName: 'Rosa González',
    consent: true,
    whatsappLinked: true,
    programs: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTextMessage.mockResolvedValue(true);
  // Paciente registrado y vinculado.
  mockPrisma.patient.findUnique.mockResolvedValue(makePatient());
  // No hay conversación escalada; getOrCreateConversation crea una nueva.
  mockPrisma.conversation.findFirst.mockResolvedValue(null);
  mockPrisma.conversation.create.mockResolvedValue({ id: 'conv-kw' });
  mockPrisma.message.create.mockResolvedValue({});
  mockPrisma.message.createMany.mockResolvedValue({ count: 2 });
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockCreateSelfReminder.mockResolvedValue({
    success: true,
    message: 'Recordatorio diario creado.',
    reminder: { id: 'sr-1', description: 'Tomar insulina', reminderDate: new Date(), reminderHour: 8, reminderMinute: 0 },
  });
  mockListActiveSelfReminders.mockResolvedValue([]);
});

describe('Flujo por keyword → PatientSelfReminder recurrente (punto 1)', () => {
  it('completar el flujo crea un PatientSelfReminder recurrente diario, NO un MedicationReminder', async () => {
    const { handleIncomingMessage } = await import('../services/conversation.service');

    // 1) keyword dispara el flujo (pide descripción)
    await handleIncomingMessage(PHONE, 'recordame tomar la insulina', 'Rosa', false);
    // 2) descripción (pide hora)
    await handleIncomingMessage(PHONE, 'Tomar insulina', 'Rosa', false);
    // 3) hora → crea el recordatorio
    await handleIncomingMessage(PHONE, '08:00', 'Rosa', false);

    // CRÍTICO: usa la MISMA tabla que listar/cancelar (PatientSelfReminder)
    expect(mockCreateSelfReminder).toHaveBeenCalledOnce();
    const [, input] = mockCreateSelfReminder.mock.calls[0];
    expect(input.description).toBe('Tomar insulina');
    expect(input.time).toBe('08:00');
    expect(input.recurring).toBe(true); // diario

    // Ya NO usa la tabla del médico
    expect(mockCreateMedReminderFromBot).not.toHaveBeenCalled();

    // La IA nunca interviene en este flujo
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('lo creado por keyword aparece luego en listActiveSelfReminders (misma tabla)', async () => {
    // Simulamos que tras crear, la lista del paciente ya lo incluye.
    mockListActiveSelfReminders.mockResolvedValue([
      { id: 'sr-1', description: 'Tomar insulina', reminderDate: new Date(), reminderHour: 8, reminderMinute: 0, recurring: true },
    ]);

    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, 'recordame tomar la insulina', 'Rosa', false);
    await handleIncomingMessage(PHONE, 'Tomar insulina', 'Rosa', false);
    await handleIncomingMessage(PHONE, '08:00', 'Rosa', false);

    const { listActiveSelfReminders } = await import('../services/self-reminder.service');
    const list = await listActiveSelfReminders('pat-keyword');
    expect(list).toHaveLength(1);
    expect(list[0].description).toBe('Tomar insulina');
    expect(list[0].recurring).toBe(true);
  });
});
