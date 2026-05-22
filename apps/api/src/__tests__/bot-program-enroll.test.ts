import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Fase 2 — autoinscripción a un programa por chat (opción 2 del menú) ───────
// Un paciente CONOCIDO que elige "2" recibe la lista de programas en los que NO
// está inscripto, elige por número, y el bot crea un PatientProgram marcado como
// autoinscripción del bot (enrolledVia=BOT, sin médico, reviewedAt=null) para que
// el equipo lo revise. Un número DESCONOCIDO se registra primero y, al terminar,
// recibe la lista (intent enhebrado en el registro).
//
// Usamos los servicios REALES (conversation + program) y sólo mockeamos prisma y
// mensajería/IA. Teléfonos únicos por test (estado en memoria a nivel módulo).

class MockPrismaKnownError extends Error {
  code: string;
  constructor(code: string) {
    super('mock prisma error');
    this.code = code;
  }
}

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
  },
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

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  Prisma: { PrismaClientKnownRequestError: MockPrismaKnownError },
  ConversationStatus: { OPEN: 'OPEN', ESCALATED: 'ESCALATED', CLOSED: 'CLOSED' },
  MessageRole: { USER: 'USER', ASSISTANT: 'ASSISTANT', SYSTEM: 'SYSTEM' },
  RegisteredVia: { BOT: 'BOT', PANEL: 'PANEL', IMPORT: 'IMPORT' },
  ConsentVia: { BOT: 'BOT', PANEL: 'PANEL' },
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED' },
  EnrolledVia: { DOCTOR: 'DOCTOR', BOT: 'BOT' },
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
  SelfReminderStatus: { PENDING: 'PENDING', SENT: 'SENT', CANCELLED: 'CANCELLED' },
}));

vi.mock('../services/messaging.service', () => ({ sendTextMessage: mockSendTextMessage }));
vi.mock('../services/ai.service', () => ({
  generateResponse: vi.fn().mockResolvedValue('Respuesta de Ana.'),
  buildSystemPrompt: vi.fn(() => []),
  MAX_HISTORY_MESSAGES: 20,
}));
vi.mock('../services/note.service', () => ({ getLatestNotesForBot: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/knowledge.service', () => ({ getRelevantKBForBot: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/survey.service', () => ({
  processSurveyResponse: vi.fn().mockResolvedValue(null),
  scheduleSurvey: vi.fn(),
}));
vi.mock('../services/medication-reminder.service', () => ({
  getMedicationsForBot: vi.fn().mockResolvedValue([]),
  createMedReminderFromBot: vi.fn(),
}));

const PROGRAMS = [
  { id: 'prog-diab', name: 'Diabetes', reminderFrequencyDays: 90 },
  { id: 'prog-hta', name: 'PREDHICAR / Hipertensión', reminderFrequencyDays: 30 },
  { id: 'prog-onco', name: 'Oncológico', reminderFrequencyDays: 90 },
];

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
  return (await import('../services/conversation.service')).handleIncomingMessage;
}

function lastSent(): string {
  const calls = mockSendTextMessage.mock.calls;
  return calls[calls.length - 1][1] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTextMessage.mockResolvedValue(true);
  mockPrisma.patient.findUnique.mockResolvedValue(null);
  mockPrisma.patient.create.mockResolvedValue({ id: 'pat-new' });
  mockPrisma.conversation.findFirst.mockResolvedValue(null);
  mockPrisma.conversation.create.mockResolvedValue({ id: 'conv-1' });
  mockPrisma.conversation.update.mockResolvedValue({});
  mockPrisma.message.create.mockResolvedValue({});
  mockPrisma.message.createMany.mockResolvedValue({ count: 2 });
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.patientSelfReminder.findMany.mockResolvedValue([]);
  // Lista de programas (orden alfabético como en el service real)
  mockPrisma.program.findMany.mockResolvedValue(PROGRAMS.map((p) => ({ id: p.id, name: p.name })));
  mockPrisma.program.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(PROGRAMS.find((p) => p.id === where.id) ?? null)
  );
  mockPrisma.patientProgram.findMany.mockResolvedValue([]); // sin inscripciones previas
  mockPrisma.patientProgram.create.mockResolvedValue({ id: 'pp-new' });
});

// ─── Conocido elige 2 → lista de programas ───────────────────────────────────

describe('Opción 2 (conocido) → lista de programas para autoinscribirse', () => {
  it('lista los programas numerados y queda esperando el número', async () => {
    const PHONE = '5493764100001';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '2', 'Carlos', false);

    const sent = lastSent();
    expect(sent).toContain('Diabetes');
    expect(sent).toContain('PREDHICAR / Hipertensión');
    expect(sent).toContain('Oncológico');
    expect(sent.toLowerCase()).toContain('número');
    // Ofrece salir del flujo.
    expect(sent.toLowerCase()).toContain('menú');
  });
});

// ─── Multi-programa: tras inscribir, re-ofrece los que quedan ─────────────────

describe('Un paciente puede estar en 2+ programas', () => {
  it('tras inscribir en uno, vuelve a ofrecer los programas restantes', async () => {
    const PHONE = '5493764100008';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '2', 'Carlos', false); // lista
    await handle(PHONE, '1', 'Carlos', false); // inscribe en Diabetes

    expect(mockPrisma.patientProgram.create).toHaveBeenCalledTimes(1);
    const sent = lastSent();
    // Confirma la inscripción Y vuelve a ofrecer la lista para sumar otro.
    expect(sent).toContain('Diabetes'); // confirmación
    expect(sent.toLowerCase()).toContain('número'); // re-ofrece elegir otro
    expect(sent.toLowerCase()).toContain('menú'); // o salir
  });
});

// ─── Conocido elige un programa → crea PatientProgram marcado BOT ─────────────

describe('Elegir un programa → crea la autoinscripción (BOT, sin médico, a revisar)', () => {
  it('crea PatientProgram con enrolledVia=BOT, enrolledByDoctorId=null, reviewedAt=null', async () => {
    const PHONE = '5493764100002';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '2', 'Carlos', false); // lista (prog-diab=1, prog-hta=2, prog-onco=3)
    await handle(PHONE, '2', 'Carlos', false); // elige PREDHICAR / Hipertensión

    expect(mockPrisma.patientProgram.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.patientProgram.create.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.objectContaining({
        patientId: 'pat-known',
        programId: 'prog-hta',
        enrolledByDoctorId: null,
        enrolledVia: 'BOT',
        reviewedAt: null,
      })
    );
    // nextReminderDate calculado (es una fecha)
    expect(data.nextReminderDate).toBeInstanceOf(Date);

    const sent = lastSent();
    expect(sent).toContain('PREDHICAR / Hipertensión');
    expect(sent.toLowerCase()).toMatch(/pre-?inscrib|revis|confirm/);
    expect(sent).toContain('0800-888-0109'); // disclaimer
  });

  it('nextReminderDate = hoy + frecuencia del programa (UTC)', async () => {
    const PHONE = '5493764100003';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '2', 'Carlos', false);
    await handle(PHONE, '1', 'Carlos', false); // Diabetes, freq 90

    const data = mockPrisma.patientProgram.create.mock.calls[0][0].data;
    const now = new Date();
    const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    expected.setUTCDate(expected.getUTCDate() + 90);
    expect((data.nextReminderDate as Date).toISOString().slice(0, 10)).toBe(
      expected.toISOString().slice(0, 10)
    );
  });
});

// ─── Número inválido ─────────────────────────────────────────────────────────

describe('Número de programa inválido', () => {
  it('fuera de rango → pide reintentar y NO crea inscripción', async () => {
    const PHONE = '5493764100004';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '2', 'Carlos', false); // 3 programas
    await handle(PHONE, '9', 'Carlos', false); // fuera de rango

    expect(mockPrisma.patientProgram.create).not.toHaveBeenCalled();
    expect(lastSent().toLowerCase()).toContain('número');
  });
});

// ─── Ya inscripto (carrera con unique constraint) ────────────────────────────

describe('Autoinscripción a un programa que ya tenía', () => {
  it('si el create choca con el unique, responde sin romper', async () => {
    const PHONE = '5493764100005';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    mockPrisma.patientProgram.create.mockRejectedValue(new MockPrismaKnownError('P2002'));
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '2', 'Carlos', false);
    await handle(PHONE, '1', 'Carlos', false);

    const sent = lastSent();
    expect(sent.toLowerCase()).toMatch(/ya (ten|esta|está)/);
  });
});

// ─── Ya está en todos los programas ──────────────────────────────────────────

describe('Paciente ya inscripto en todos los programas', () => {
  it('no muestra lista vacía: avisa que ya está en todos', async () => {
    const PHONE = '5493764100006';
    mockPrisma.patient.findUnique.mockResolvedValue(makeKnownPatient());
    // Ya tiene los 3 → la lista de "enrollables" queda vacía
    mockPrisma.patientProgram.findMany.mockResolvedValue(
      PROGRAMS.map((p) => ({ programId: p.id }))
    );
    const handle = await importHandler();

    await handle(PHONE, 'menú', 'Carlos', false);
    await handle(PHONE, '2', 'Carlos', false);

    expect(mockPrisma.patientProgram.create).not.toHaveBeenCalled();
    expect(lastSent().toLowerCase()).toContain('todos');
  });
});

// ─── Desconocido elige 2 → registro → lista al terminar (intent) ─────────────

describe('Opción 2 (desconocido) → registra y luego ofrece la lista', () => {
  it('tras nombre + DNI, recibe la lista de programas (intent enhebrado)', async () => {
    const PHONE = '5493764100007';
    const handle = await importHandler();

    await handle(PHONE, 'hola', 'Nuevo', false); // menú
    await handle(PHONE, '2', 'Nuevo', false); // registrarme → pide nombre
    expect(lastSent().toLowerCase()).toContain('nombre');

    await handle(PHONE, 'María Gómez', 'Nuevo', false); // pide DNI
    expect(lastSent().toLowerCase()).toContain('dni');

    await handle(PHONE, '30111222', 'Nuevo', false); // completa registro → ofrece lista

    // Se creó el paciente y se ofreció la lista de programas.
    expect(mockPrisma.patient.create).toHaveBeenCalledTimes(1);
    const sent = lastSent();
    expect(sent).toContain('Diabetes');
    expect(sent.toLowerCase()).toContain('número');
  });
});
