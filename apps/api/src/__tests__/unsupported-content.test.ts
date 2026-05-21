import { describe, it, expect, vi, beforeEach } from 'vitest';

// BUG 1: el bot quedaba MUDO ante mensajes que no son texto (audio, imagen,
// sticker, ubicación, documento). Estos tests cubren las dos mitades del fix:
//
//   1. parseWebhookPayload (Meta) marca el contenido no-texto como
//      isUnsupported en vez de descartarlo en silencio.
//   2. handleIncomingMessage, ante isUnsupported, responde UNA vez con la guía
//      y NO dispara la IA ni el flujo de registro.

// ─── Mocks (mismo patrón que followup-flow.test.ts) ──────────────────────────

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

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTextMessage.mockResolvedValue(true);
  mockGenerateResponse.mockResolvedValue('respuesta IA que NO debería enviarse');
  // getOrCreateConversation: no hay conversación previa → crea una nueva.
  mockPrisma.conversation.findFirst.mockResolvedValue(null);
  mockPrisma.conversation.create.mockResolvedValue({ id: 'conv-1' });
  mockPrisma.message.create.mockResolvedValue({});
  mockPrisma.message.createMany.mockResolvedValue({ count: 2 });
});

// ─── parseWebhookPayload (Meta) ──────────────────────────────────────────────

describe('parseWebhookPayload — contenido no-texto (Meta)', () => {
  const baseEntry = (msg: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '549', phone_number_id: 'pid' },
              contacts: [{ profile: { name: 'Abuela Rosa' }, wa_id: '5493764111111' }],
              messages: [{ from: '5493764111111', id: 'wamid.1', timestamp: '123', ...msg }],
            },
          },
        ],
      },
    ],
  });

  it('mensaje de texto → isUnsupported = false', async () => {
    const { parseWebhookPayload } = await import('../services/whatsapp.service');
    const result = parseWebhookPayload(
      baseEntry({ type: 'text', text: { body: 'Hola, ¿cuándo es mi turno?' } }) as never
    );
    expect(result).toHaveLength(1);
    expect(result[0].isUnsupported).toBe(false);
    expect(result[0].text).toBe('Hola, ¿cuándo es mi turno?');
  });

  it.each([
    ['audio', { type: 'audio' }],
    ['voice', { type: 'audio', audio: { voice: true } }],
    ['image', { type: 'image' }],
    ['video', { type: 'video' }],
    ['document', { type: 'document' }],
    ['sticker', { type: 'sticker' }],
    ['location', { type: 'location' }],
    ['contacts', { type: 'contacts' }],
  ])('mensaje de %s → isUnsupported = true, sin texto', async (_label, msg) => {
    const { parseWebhookPayload } = await import('../services/whatsapp.service');
    const result = parseWebhookPayload(baseEntry(msg) as never);
    expect(result).toHaveLength(1);
    expect(result[0].isUnsupported).toBe(true);
    expect(result[0].text).toBe('');
    expect(result[0].messageId).toBe('wamid.1'); // se preserva para dedup
  });

  it('NO produce mensajes para webhooks que no son de tipo "messages" (status callbacks)', async () => {
    const { parseWebhookPayload } = await import('../services/whatsapp.service');
    const statusPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '549', phone_number_id: 'pid' },
                statuses: [{ id: 'wamid.x', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };
    const result = parseWebhookPayload(statusPayload as never);
    expect(result).toHaveLength(0);
  });
});

// ─── handleIncomingMessage — isUnsupported ───────────────────────────────────

describe('handleIncomingMessage — contenido no-texto', () => {
  const PHONE = '5493764111111';

  it('dispara el mensaje guía y NO llama a la IA', async () => {
    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, '', 'Abuela Rosa', true);

    // La IA NUNCA se invoca para contenido no-texto.
    expect(mockGenerateResponse).not.toHaveBeenCalled();

    // Responde exactamente una vez con la guía cálida de "solo texto".
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sentText).toContain('texto');
    expect(sentText).toContain('Escribime');

    // No busca al paciente (no procesa como texto / no entra a registro ni chat).
    expect(mockPrisma.patient.findUnique).not.toHaveBeenCalled();
  });

  it('persiste constancia del mensaje entrante no-texto', async () => {
    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, '', 'Abuela Rosa', true);

    // saveSystemMessage usa createMany (USER placeholder + SYSTEM guía).
    expect(mockPrisma.message.createMany).toHaveBeenCalledTimes(1);
  });

  it('si un operador atiende (ESCALATED reciente) NO responde, solo registra', async () => {
    // findFirst #1 (en handleUnsupportedMessage) → conversación ESCALATED activa,
    // con última actividad de operador hace 1 minuto (no stale).
    mockPrisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-esc',
      messages: [{ createdAt: new Date(Date.now() - 60 * 1000) }],
    });

    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage(PHONE, '', 'Abuela Rosa', true);

    // No se le pisa la conversación al operador con la guía automática.
    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    // Pero sí queda constancia del mensaje entrante.
    expect(mockPrisma.message.create).toHaveBeenCalledTimes(1);
  });

  it('teléfono inválido → no responde ni registra nada', async () => {
    const { handleIncomingMessage } = await import('../services/conversation.service');
    await handleIncomingMessage('abc', '', 'X', true);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockPrisma.conversation.findFirst).not.toHaveBeenCalled();
  });
});
