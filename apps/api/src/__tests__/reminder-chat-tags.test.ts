import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── handleChat: el CÓDIGO es la única fuente de listas y confirmaciones ──────
// Puntos 2, 3 y 4:
//  - La IA pone texto introductorio + tag, el código inyecta la lista (una sola).
//  - Cancelar: el texto de confirmación lo arma el código según el conteo REAL.
//  - "cancelar todos": idem.
//
// Usamos los parsers REALES de self-reminder.service (no los mockeamos), y sólo
// mockeamos prisma para las operaciones de DB.

const mockPrisma = {
  patient: {
    findUnique: vi.fn(),
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
  patientSelfReminder: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};

const mockSendTextMessage = vi.fn();
const mockGenerateResponse = vi.fn();

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  ConversationStatus: { OPEN: 'OPEN', ESCALATED: 'ESCALATED', CLOSED: 'CLOSED' },
  MessageRole: { USER: 'USER', ASSISTANT: 'ASSISTANT', SYSTEM: 'SYSTEM' },
  RegisteredVia: { BOT: 'BOT', PANEL: 'PANEL', IMPORT: 'IMPORT' },
  ConsentVia: { BOT: 'BOT', PANEL: 'PANEL' },
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', UNSUBSCRIBED: 'UNSUBSCRIBED' },
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
  SelfReminderStatus: { PENDING: 'PENDING', SENT: 'SENT', CANCELLED: 'CANCELLED' },
}));

vi.mock('../services/messaging.service', () => ({
  sendTextMessage: mockSendTextMessage,
}));

// Mockeamos ai.service completo (no cargamos el SDK de Anthropic). Este test
// verifica el procesamiento de TAGS por el código, no el contenido del prompt.
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

const PHONE = '5493764333333';

function makePatient() {
  return {
    id: 'pat-chat',
    fullName: 'Carlos Díaz',
    consent: true,
    whatsappLinked: true,
    programs: [],
  };
}

const activeReminders = [
  { id: 'r1', description: 'Tomar insulina', reminderDate: new Date(Date.UTC(2026, 5, 1)), reminderHour: 8, reminderMinute: 0, recurring: true },
  { id: 'r2', description: 'Turno cardiólogo', reminderDate: new Date(Date.UTC(2026, 5, 10)), reminderHour: 9, reminderMinute: 30, recurring: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTextMessage.mockResolvedValue(true);
  mockPrisma.patient.findUnique.mockResolvedValue(makePatient());
  mockPrisma.conversation.findFirst.mockResolvedValue(null);
  mockPrisma.conversation.create.mockResolvedValue({ id: 'conv-chat' });
  mockPrisma.message.create.mockResolvedValue({});
  mockPrisma.message.createMany.mockResolvedValue({ count: 2 });
  mockPrisma.message.findMany.mockResolvedValue([]);
});

// ─── Listar: una sola lista, sin "no tenés" cuando hay ───────────────────────

describe('Ver recordatorios → una sola lista (puntos 2 y 3)', () => {
  it('IA pone intro + <<LIST_REMINDERS>>; el código inyecta UNA lista', async () => {
    mockGenerateResponse.mockResolvedValue('Estos son tus recordatorios:\n<<LIST_REMINDERS>>');
    mockPrisma.patientSelfReminder.findMany.mockResolvedValue(activeReminders);

    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, 'qué recordatorios tengo', 'Carlos', false);

    expect(mockSendTextMessage).toHaveBeenCalledOnce();
    const sent = mockSendTextMessage.mock.calls[0][1] as string;

    // El tag no se filtra
    expect(sent).not.toContain('LIST_REMINDERS');
    // Aparecen los recordatorios (los inyecta el código vía formatRemindersForWhatsApp)
    expect(sent).toContain('Tomar insulina');
    expect(sent).toContain('Turno cardiólogo');
    // UNA sola lista: el marcador "1." de la lista del código aparece exactamente una vez
    const firstItemOccurrences = (sent.match(/1\.\s*📌/g) || []).length;
    expect(firstItemOccurrences).toBe(1);
    // No dice "no tenés" cuando hay
    expect(sent).not.toContain('No tenés recordatorios activos');
  });

  it('sin recordatorios → muestra el mensaje vacío del código (única fuente)', async () => {
    mockGenerateResponse.mockResolvedValue('Estos son tus recordatorios:\n<<LIST_REMINDERS>>');
    mockPrisma.patientSelfReminder.findMany.mockResolvedValue([]);

    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, 'mis recordatorios', 'Carlos', false);

    const sent = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sent).toContain('No tenés recordatorios activos');
  });
});

// ─── Cancelar por índice: confirmación armada por el código ───────────────────

describe('Cancelar por índice → el código confirma con el resultado REAL (punto 4)', () => {
  it('cancela el #1 en DB y la confirmación refleja el conteo real', async () => {
    mockGenerateResponse.mockResolvedValue('Listo.\n<<CANCEL_REMINDER:1>>');
    mockPrisma.patientSelfReminder.findMany.mockResolvedValue(activeReminders);
    mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 1 });

    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, 'cancelar recordatorio 1', 'Carlos', false);

    // Se canceló de verdad en DB
    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['r1'] } }),
        data: { status: 'CANCELLED' },
      })
    );
    const sent = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sent).not.toContain('CANCEL_REMINDER');
    // El código confirma (1 cancelado)
    expect(sent.toLowerCase()).toContain('cancel');
    expect(sent).toContain('1');
  });

  it('cancelar varios índices: confirmación según conteo real', async () => {
    mockGenerateResponse.mockResolvedValue('Ok.\n<<CANCEL_REMINDER:1,2>>');
    mockPrisma.patientSelfReminder.findMany.mockResolvedValue(activeReminders);
    mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 2 });

    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, 'cancelar recordatorios 1 y 2', 'Carlos', false);

    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['r1', 'r2'] } }),
      })
    );
    const sent = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sent).toContain('2');
  });

  it('cancelar inexistente → no rompe, mensaje claro de "no se encontró"', async () => {
    mockGenerateResponse.mockResolvedValue('Ok.\n<<CANCEL_REMINDER:99>>');
    mockPrisma.patientSelfReminder.findMany.mockResolvedValue(activeReminders);
    // updateMany no debería cancelar nada (sin ids válidos)
    mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 0 });

    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, 'cancelar recordatorio 99', 'Carlos', false);

    const sent = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sent).not.toContain('CANCEL_REMINDER');
    // El bot NO alucina "cancelado": avisa que no encontró ese número
    expect(sent.toLowerCase()).toMatch(/no.*(existe|encontr|ningún|valido|válido)/);
  });
});

// ─── Cancelar todos ──────────────────────────────────────────────────────────

describe('Cancelar todos → <<CANCEL_ALL_REMINDERS>> (punto 4)', () => {
  it('cancela todos los PENDING y confirma el conteo real', async () => {
    mockGenerateResponse.mockResolvedValue('Listo, cancelo todos.\n<<CANCEL_ALL_REMINDERS>>');
    mockPrisma.patientSelfReminder.updateMany.mockResolvedValue({ count: 3 });

    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, 'cancelá todos mis recordatorios', 'Carlos', false);

    expect(mockPrisma.patientSelfReminder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'pat-chat', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
    );
    const sent = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sent).not.toContain('CANCEL_ALL_REMINDERS');
    expect(sent).toContain('3');
  });
});
