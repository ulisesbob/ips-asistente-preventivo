import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Menú inicial de 3 opciones (fase 1) ─────────────────────────────────────
// Caracteriza el comportamiento del menú que ve un número NUEVO/desconocido:
//   1) consulta, 2) registrarme en un programa, 3) turno (placeholder).
// Reglas clave:
//   - Número desconocido → ve el menú. Conocido → chat directo (no se le impone).
//   - "menú"/"opciones" re-muestra el menú en cualquier momento.
//   - Opción 1: consulta. Conocido → handleChat (con sus datos); desconocido →
//     chat general (KB del IPS, sin datos de paciente).
//   - Opción 2: inscripción (registro si es desconocido / info si es conocido).
//   - Opción 3: placeholder de turnos, sigue eligible.
//   - El estado del menú vive en memoria con TTL (30 min) → tras expirar se
//     re-muestra el menú.
//
// Estado de módulo (menuState/registrationState son Maps a nivel módulo): cada
// test usa un teléfono ÚNICO para no arrastrar estado entre casos.

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
  patientSelfReminder: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  // Fase 2: la opción 2 (conocido) lista programas → conversation.service usa
  // program.service, que toca estas tablas. Las mockeamos para que no rompa.
  program: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  patientProgram: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
};

const mockSendTextMessage = vi.fn();
const mockGenerateResponse = vi.fn();
const mockGetRelevantKBForBot = vi.fn();

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

vi.mock('../services/messaging.service', () => ({
  sendTextMessage: mockSendTextMessage,
}));

vi.mock('../services/ai.service', () => ({
  generateResponse: mockGenerateResponse,
  buildSystemPrompt: vi.fn(() => []),
  MAX_HISTORY_MESSAGES: 20,
}));

vi.mock('../services/note.service', () => ({ getLatestNotesForBot: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/knowledge.service', () => ({ getRelevantKBForBot: mockGetRelevantKBForBot }));
vi.mock('../services/survey.service', () => ({ processSurveyResponse: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/medication-reminder.service', () => ({
  getMedicationsForBot: vi.fn().mockResolvedValue([]),
  createMedReminderFromBot: vi.fn(),
}));

// Phones: cada test usa el suyo para aislar el estado en memoria.
function makeKnownPatient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pat-known',
    fullName: 'Carlos Díaz',
    consent: true,
    whatsappLinked: true,
    programs: [],
    ...overrides,
  };
}

async function importHandler() {
  const mod = await import('../services/conversation.service');
  return mod.handleIncomingMessage;
}

/** Texto del último envío de WhatsApp. */
function lastSent(): string {
  const calls = mockSendTextMessage.mock.calls;
  return calls[calls.length - 1][1] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTextMessage.mockResolvedValue(true);
  mockGenerateResponse.mockResolvedValue('Respuesta de Ana.');
  mockGetRelevantKBForBot.mockResolvedValue([]);
  mockPrisma.patient.findUnique.mockResolvedValue(null); // por defecto: desconocido
  mockPrisma.conversation.findFirst.mockResolvedValue(null);
  mockPrisma.conversation.create.mockResolvedValue({ id: 'conv-1' });
  mockPrisma.message.create.mockResolvedValue({});
  mockPrisma.message.createMany.mockResolvedValue({ count: 2 });
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.patientSelfReminder.findMany.mockResolvedValue([]);
  mockPrisma.program.findMany.mockResolvedValue([{ id: 'prog-diab', name: 'Diabetes' }]);
  mockPrisma.program.findUnique.mockResolvedValue({ id: 'prog-diab', name: 'Diabetes', reminderFrequencyDays: 90 });
  mockPrisma.patientProgram.findMany.mockResolvedValue([]);
  mockPrisma.patientProgram.create.mockResolvedValue({ id: 'pp-1' });
});

// ─── Número nuevo ve el menú ─────────────────────────────────────────────────

describe('Número desconocido → ve el menú de 3 opciones', () => {
  it('el primer mensaje de un número nuevo dispara el menú', async () => {
    const PHONE = '5493764000001';
    const handle = await importHandler();
    await handle(PHONE, 'hola', 'Nuevo', false);

    expect(mockSendTextMessage).toHaveBeenCalledOnce();
    const sent = lastSent();
    expect(sent).toContain('Tengo una consulta');
    expect(sent).toContain('registrarme en un programa');
    expect(sent).toContain('sacar un turno');
    // No invoca la IA todavía — solo muestra el menú.
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });
});

// ─── Paciente conocido NO ve el menú ─────────────────────────────────────────

describe('Paciente conocido → chat directo, sin menú impuesto', () => {
  it('un paciente conocido va directo a handleChat (no ve el menú)', async () => {
    const PHONE = '5493764000002';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();
    await handle(PHONE, 'tengo una duda con mi medicación', 'Carlos', false);

    expect(mockGenerateResponse).toHaveBeenCalledOnce();
    const sent = lastSent();
    expect(sent).toBe('Respuesta de Ana.');
    expect(sent).not.toContain('Tengo una consulta'); // no es el menú
  });

  it('"menú" re-muestra el menú aunque sea un paciente conocido', async () => {
    const PHONE = '5493764000003';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();
    await handle(PHONE, 'menú', 'Carlos', false);

    const sent = lastSent();
    expect(sent).toContain('Tengo una consulta');
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });
});

// ─── Opción 1 — consulta ─────────────────────────────────────────────────────

describe('Opción 1 (consulta)', () => {
  it('desconocido: 1 entra en consulta y el siguiente mensaje va a chat general (KB IPS, sin paciente)', async () => {
    const PHONE = '5493764000004';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false); // muestra menú
    await handle(PHONE, '1', 'Nuevo', false); // elige consulta
    expect(lastSent().toLowerCase()).toContain('consulta');
    expect(mockGenerateResponse).not.toHaveBeenCalled(); // todavía no preguntó nada

    await handle(PHONE, '¿el IPS cubre análisis de sangre?', 'Nuevo', false);
    expect(mockGenerateResponse).toHaveBeenCalledOnce();
    expect(mockGetRelevantKBForBot).toHaveBeenCalled(); // consulta la KB del IPS
    expect(lastSent()).toBe('Respuesta de Ana.');
  });

  it('conocido: tras "menú" → 1 entra en consulta y usa handleChat con sus datos', async () => {
    const PHONE = '5493764000005';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '1', 'Carlos', false);
    await handle(PHONE, 'mi pregunta', 'Carlos', false);

    expect(mockGenerateResponse).toHaveBeenCalledOnce();
    expect(lastSent()).toBe('Respuesta de Ana.');
  });
});

// ─── Opción 2 — registro / inscripción ───────────────────────────────────────

describe('Opción 2 (registrarme en un programa)', () => {
  it('desconocido: 2 inicia el registro pidiendo el nombre', async () => {
    const PHONE = '5493764000006';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false); // menú
    await handle(PHONE, '2', 'Nuevo', false); // registrarme

    expect(lastSent().toLowerCase()).toContain('nombre');
  });

  it('conocido: 2 ofrece la lista de programas para autoinscribirse (fase 2)', async () => {
    const PHONE = '5493764000007';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '2', 'Carlos', false);

    const sent = lastSent();
    expect(sent).toContain('Diabetes'); // un programa de la lista
    expect(sent.toLowerCase()).toContain('número');
  });
});

// ─── Opción 3 — placeholder de turnos ────────────────────────────────────────

describe('Opción 3 (turno) → placeholder', () => {
  it('responde que turnos no está disponible y sigue eligible', async () => {
    const PHONE = '5493764000008';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false); // menú
    await handle(PHONE, '3', 'Nuevo', false); // turno
    expect(lastSent().toLowerCase()).toContain('turno');

    // Sigue en el menú: puede elegir 1 a continuación.
    await handle(PHONE, '1', 'Nuevo', false);
    expect(lastSent().toLowerCase()).toContain('consulta');
  });
});

// ─── Entrada inválida ────────────────────────────────────────────────────────

describe('Entrada inválida en el menú', () => {
  it('un texto que no es 1/2/3 pide reintentar con un número', async () => {
    const PHONE = '5493764000009';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false); // menú
    await handle(PHONE, 'quiero saber algo', 'Nuevo', false); // no es número

    const sent = lastSent();
    expect(sent.toLowerCase()).toContain('número');
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });
});

// ─── TTL: el menú se re-muestra tras expirar ─────────────────────────────────

describe('TTL del menú (30 min)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tras expirar la sesión, "1" vuelve a mostrar el menú en vez de tomarse como elección', async () => {
    const PHONE = '5493764000010';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T10:00:00Z'));

    const handle = await importHandler();
    await handle(PHONE, 'hola', 'Nuevo', false); // menú a T0 (AWAITING_CHOICE)
    expect(lastSent()).toContain('Tengo una consulta');

    // Avanza 31 minutos → la entrada del menú expiró (TTL 30 min).
    vi.setSystemTime(new Date('2026-05-21T10:31:00Z'));

    mockSendTextMessage.mockClear();
    await handle(PHONE, '1', 'Nuevo', false);
    // No se interpreta "1" como consulta: se re-muestra el menú.
    expect(lastSent()).toContain('Tengo una consulta');
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });
});

// ─── Escalación: un conocido que pide humano no queda atrapado en el menú ─────

describe('Escalación tiene prioridad sobre el menú (paciente conocido)', () => {
  it('un conocido que escribe "operador" escala aunque venga del menú', async () => {
    const PHONE = '5493764000011';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    mockPrisma.conversation.update.mockResolvedValue({});
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false); // muestra menú
    await handle(PHONE, 'quiero hablar con un operador', 'Carlos', false);

    // Marca la conversación como ESCALATED y avisa la derivación.
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ESCALATED' }) })
    );
    expect(lastSent().toLowerCase()).toContain('operador');
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });
});

// ─── Review A2/A3: desconocido pide humano → soporte (con normalización NFD) ───

describe('Desconocido que pide ayuda humana en el menú', () => {
  it('"necesito ayuda" → lo deriva al teléfono de soporte (no "no te entendí")', async () => {
    const PHONE = '5493764000012';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false); // menú
    await handle(PHONE, 'necesito ayuda', 'Nuevo', false); // keyword de escalación

    const sent = lastSent();
    expect(sent).toContain('0800-888-0109'); // teléfono de soporte
    expect(sent).not.toContain('No te entendí');
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('detecta el keyword aun con tilde ("atención humana") gracias a NFD', async () => {
    const PHONE = '5493764000013';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false);
    await handle(PHONE, 'quiero atención humana', 'Nuevo', false);

    expect(lastSent()).toContain('0800-888-0109');
  });
});

// ─── Review C1: opción 1 no avanza a IN_CONSULTA si el envío falla ────────────

describe('Opción 1 con fallo de envío (LESSONS #31)', () => {
  it('si la confirmación de "1" no se envía, no queda atrapado en consulta', async () => {
    const PHONE = '5493764000014';
    const handle = await importHandler();

    mockSendTextMessage.mockReset();
    mockSendTextMessage.mockResolvedValueOnce(true); // menú OK
    mockSendTextMessage.mockResolvedValueOnce(false); // confirmación de "1" FALLA
    mockSendTextMessage.mockResolvedValue(true); // resto OK

    await handle(PHONE, 'hola', 'Nuevo', false); // menú
    await handle(PHONE, '1', 'Nuevo', false); // confirmación falla → NO avanza a IN_CONSULTA
    await handle(PHONE, 'mi consulta libre', 'Nuevo', false);

    // Como sigue en AWAITING_CHOICE, el texto libre se trata como opción inválida
    // (reintento), NO se manda al LLM como consulta.
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(lastSent().toLowerCase()).toContain('número');
  });
});

// ─── Security C-1: el chat anónimo NO reutiliza la conversación de un paciente ─

describe('Aislamiento del chat anónimo (security C-1)', () => {
  it('busca/crea la conversación con patientId=null (no la de un paciente del mismo número)', async () => {
    const PHONE = '5493764000015';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false); // menú
    await handle(PHONE, '1', 'Nuevo', false); // consulta
    await handle(PHONE, '¿qué centros hay en Posadas?', 'Nuevo', false); // chat general

    // Toda búsqueda de conversación del flujo anónimo (getOrCreateConversation)
    // filtra por patientId: null. Excluimos el check de pausa del modo híbrido,
    // que busca por teléfono+estado (no por paciente) y lleva botPausedUntil.
    const findCalls = mockPrisma.conversation.findFirst.mock.calls.filter(
      (c) => !('botPausedUntil' in (c[0]?.where ?? {}))
    );
    expect(findCalls.length).toBeGreaterThan(0);
    for (const call of findCalls) {
      expect(call[0].where).toEqual(expect.objectContaining({ patientId: null }));
    }
    // Y si crea, la crea sin paciente.
    for (const call of mockPrisma.conversation.create.mock.calls) {
      expect(call[0].data).toEqual(expect.objectContaining({ patientId: null }));
    }
  });
});

// ─── Security A-1: rate limit del chat anónimo ───────────────────────────────

describe('Rate limit del chat anónimo (security A-1)', () => {
  it('tras 30 consultas en la ventana, la siguiente NO llega al LLM y deriva a soporte', async () => {
    const PHONE = '5493764000016';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false); // menú
    await handle(PHONE, '1', 'Nuevo', false); // entra en consulta

    for (let i = 0; i < 30; i++) {
      await handle(PHONE, `consulta ${i}`, 'Nuevo', false);
    }
    expect(mockGenerateResponse).toHaveBeenCalledTimes(30); // las 30 permitidas

    mockGenerateResponse.mockClear();
    await handle(PHONE, 'consulta 31 (de más)', 'Nuevo', false);
    expect(mockGenerateResponse).not.toHaveBeenCalled(); // bloqueada
    expect(lastSent()).toContain('0800-888-0109'); // deriva a soporte
  });
});
