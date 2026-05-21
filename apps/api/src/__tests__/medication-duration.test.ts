import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tests para los campos nuevos de MedicationReminder: endDate (derivado de
// durationDays), instructions y sideEffects. Sigue el patrón de followup-flow:
// mockea @ips/db y messaging.service, setea respuestas y verifica side effects.

const mockPrisma = {
  medicationReminder: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  patient: {
    findUnique: vi.fn(),
  },
  doctorProgram: {
    findMany: vi.fn(),
  },
  patientProgram: {
    findFirst: vi.fn(),
  },
};

const mockSendTextMessage = vi.fn();

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
}));

vi.mock('../services/messaging.service', () => ({
  sendTextMessage: mockSendTextMessage,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// Medianoche UTC de hoy — el service debe derivar endDate desde acá.
function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcMidnightPlusDays(days: number): Date {
  const d = todayUtcMidnight();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ─── CREATE: durationDays → endDate ──────────────────────────────────────────

describe('createMedReminder — durationDays → endDate', () => {
  it('(a) create con durationDays calcula endDate = medianoche UTC (hoy + durationDays)', async () => {
    // ADMIN para saltear la verificación de programas
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.create.mockResolvedValueOnce({ id: 'med-1' });

    const { createMedReminder } = await import('../services/medication-reminder.service');
    await createMedReminder('pat-1', 'doc-1', 'ADMIN' as any, {
      medicationName: 'Metformina',
      dosage: '850mg',
      reminderHour: 8,
      durationDays: 30,
    });

    const callArg = mockPrisma.medicationReminder.create.mock.calls[0][0];
    const expected = utcMidnightPlusDays(30);
    expect(callArg.data.endDate).toBeInstanceOf(Date);
    expect((callArg.data.endDate as Date).getTime()).toBe(expected.getTime());
    // Es medianoche UTC exacta (sin shift de timezone)
    expect((callArg.data.endDate as Date).getUTCHours()).toBe(0);
    expect((callArg.data.endDate as Date).getUTCMinutes()).toBe(0);
    expect((callArg.data.endDate as Date).getUTCSeconds()).toBe(0);
    expect((callArg.data.endDate as Date).getUTCMilliseconds()).toBe(0);
  });

  it('(b) create sin durationDays → endDate null (tratamiento continuo)', async () => {
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.create.mockResolvedValueOnce({ id: 'med-1' });

    const { createMedReminder } = await import('../services/medication-reminder.service');
    await createMedReminder('pat-1', 'doc-1', 'ADMIN' as any, {
      medicationName: 'Enalapril',
      dosage: '10mg',
      reminderHour: 9,
    });

    const callArg = mockPrisma.medicationReminder.create.mock.calls[0][0];
    expect(callArg.data.endDate).toBeNull();
  });

  it('(d) create guarda instructions y sideEffects y los devuelve en el select', async () => {
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.create.mockResolvedValueOnce({
      id: 'med-1',
      medicationName: 'Metformina',
      dosage: '850mg',
      reminderHour: 8,
      reminderMinute: 0,
      active: true,
      endDate: utcMidnightPlusDays(30),
      instructions: 'Tomar con las comidas',
      sideEffects: 'Puede causar náuseas',
    });

    const { createMedReminder } = await import('../services/medication-reminder.service');
    const result = await createMedReminder('pat-1', 'doc-1', 'ADMIN' as any, {
      medicationName: 'Metformina',
      dosage: '850mg',
      reminderHour: 8,
      durationDays: 30,
      instructions: 'Tomar con las comidas',
      sideEffects: 'Puede causar náuseas',
    });

    const callArg = mockPrisma.medicationReminder.create.mock.calls[0][0];
    expect(callArg.data.instructions).toBe('Tomar con las comidas');
    expect(callArg.data.sideEffects).toBe('Puede causar náuseas');
    // El select pide los campos nuevos
    expect(callArg.select.endDate).toBe(true);
    expect(callArg.select.instructions).toBe(true);
    expect(callArg.select.sideEffects).toBe(true);
    // Y se devuelven al caller
    expect(result).toMatchObject({
      instructions: 'Tomar con las comidas',
      sideEffects: 'Puede causar náuseas',
    });
  });
});

// ─── UPDATE: durationDays nullable → endDate ─────────────────────────────────

describe('updateMedReminder — durationDays nullable → endDate', () => {
  it('(c) update con durationDays=null → endDate null (volver a continuo)', async () => {
    mockPrisma.medicationReminder.findUnique.mockResolvedValueOnce({ id: 'med-1', patientId: 'pat-1' });
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.update.mockResolvedValueOnce({ id: 'med-1' });

    const { updateMedReminder } = await import('../services/medication-reminder.service');
    await updateMedReminder('med-1', 'doc-1', 'ADMIN' as any, { durationDays: null });

    const callArg = mockPrisma.medicationReminder.update.mock.calls[0][0];
    expect(callArg.data.endDate).toBeNull();
  });

  it('update con durationDays numérico → endDate medianoche UTC (hoy + N)', async () => {
    mockPrisma.medicationReminder.findUnique.mockResolvedValueOnce({ id: 'med-1', patientId: 'pat-1' });
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.update.mockResolvedValueOnce({ id: 'med-1' });

    const { updateMedReminder } = await import('../services/medication-reminder.service');
    await updateMedReminder('med-1', 'doc-1', 'ADMIN' as any, { durationDays: 15 });

    const callArg = mockPrisma.medicationReminder.update.mock.calls[0][0];
    const expected = utcMidnightPlusDays(15);
    expect((callArg.data.endDate as Date).getTime()).toBe(expected.getTime());
  });

  it('update sin durationDays → no toca endDate', async () => {
    mockPrisma.medicationReminder.findUnique.mockResolvedValueOnce({ id: 'med-1', patientId: 'pat-1' });
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.update.mockResolvedValueOnce({ id: 'med-1' });

    const { updateMedReminder } = await import('../services/medication-reminder.service');
    await updateMedReminder('med-1', 'doc-1', 'ADMIN' as any, { dosage: '500mg' });

    const callArg = mockPrisma.medicationReminder.update.mock.calls[0][0];
    expect('endDate' in callArg.data).toBe(false);
  });

  it('(d) update guarda instructions y sideEffects', async () => {
    mockPrisma.medicationReminder.findUnique.mockResolvedValueOnce({ id: 'med-1', patientId: 'pat-1' });
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.update.mockResolvedValueOnce({ id: 'med-1' });

    const { updateMedReminder } = await import('../services/medication-reminder.service');
    await updateMedReminder('med-1', 'doc-1', 'ADMIN' as any, {
      instructions: 'Antes de dormir',
      sideEffects: 'Somnolencia',
    });

    const callArg = mockPrisma.medicationReminder.update.mock.calls[0][0];
    expect(callArg.data.instructions).toBe('Antes de dormir');
    expect(callArg.data.sideEffects).toBe('Somnolencia');
  });

  it('update con instructions=null las limpia', async () => {
    mockPrisma.medicationReminder.findUnique.mockResolvedValueOnce({ id: 'med-1', patientId: 'pat-1' });
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.update.mockResolvedValueOnce({ id: 'med-1' });

    const { updateMedReminder } = await import('../services/medication-reminder.service');
    await updateMedReminder('med-1', 'doc-1', 'ADMIN' as any, { instructions: null });

    const callArg = mockPrisma.medicationReminder.update.mock.calls[0][0];
    expect(callArg.data.instructions).toBeNull();
  });
});

// ─── LIST: incluye campos nuevos en el select ────────────────────────────────

describe('listMedReminders — select incluye campos nuevos', () => {
  it('el select pide endDate, instructions y sideEffects', async () => {
    mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([]);

    const { listMedReminders } = await import('../services/medication-reminder.service');
    await listMedReminders('pat-1', 'doc-1', 'ADMIN' as any);

    const callArg = mockPrisma.medicationReminder.findMany.mock.calls[0][0];
    expect(callArg.select.endDate).toBe(true);
    expect(callArg.select.instructions).toBe(true);
    expect(callArg.select.sideEffects).toBe(true);
  });
});

// ─── CRON: desactiva vencidos y filtra por endDate ──────────────────────────

describe('sendMedicationReminders — endDate handling', () => {
  it('(e) desactiva los vencidos (updateMany) antes de seleccionar el slot', async () => {
    mockPrisma.medicationReminder.updateMany.mockResolvedValueOnce({ count: 2 });
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([]);

    const { sendMedicationReminders } = await import('../services/medication-reminder.service');
    await sendMedicationReminders();

    expect(mockPrisma.medicationReminder.updateMany).toHaveBeenCalledTimes(1);
    const callArg = mockPrisma.medicationReminder.updateMany.mock.calls[0][0];
    expect(callArg.where.active).toBe(true);
    // Desactiva los que tienen endDate < hoy medianoche UTC
    expect(callArg.where.endDate.lt).toBeInstanceOf(Date);
    expect((callArg.where.endDate.lt as Date).getTime()).toBe(todayUtcMidnight().getTime());
    expect(callArg.data.active).toBe(false);
    // updateMany corre ANTES del findMany del slot
    const updateOrder = mockPrisma.medicationReminder.updateMany.mock.invocationCallOrder[0];
    const findOrder = mockPrisma.medicationReminder.findMany.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(findOrder);
  });

  it('(e) el findMany del slot filtra endDate null OR endDate >= hoy', async () => {
    mockPrisma.medicationReminder.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([]);

    const { sendMedicationReminders } = await import('../services/medication-reminder.service');
    await sendMedicationReminders();

    const callArg = mockPrisma.medicationReminder.findMany.mock.calls[0][0];
    const orClause = callArg.where.AND?.[0]?.OR ?? callArg.where.OR;
    expect(orClause).toBeDefined();
    const hasNull = orClause.some((c: any) => c.endDate === null);
    const hasGte = orClause.some((c: any) => c.endDate && c.endDate.gte instanceof Date);
    expect(hasNull).toBe(true);
    expect(hasGte).toBe(true);
    // El select trae instructions y sideEffects (para incluirlos en el recordatorio)
    expect(callArg.select.instructions).toBe(true);
    expect(callArg.select.sideEffects).toBe(true);
  });

  it('(f) el mensaje incluye 📋 instructions cuando existe', async () => {
    mockPrisma.medicationReminder.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([
      {
        id: 'med-1',
        medicationName: 'Metformina',
        dosage: '850mg',
        instructions: 'Tomar con las comidas',
        patient: { fullName: 'Juan Pérez', phone: '+5493764125878' },
      },
    ]);
    mockSendTextMessage.mockResolvedValueOnce(true);

    const { sendMedicationReminders } = await import('../services/medication-reminder.service');
    const result = await sendMedicationReminders();

    expect(result.sent).toBe(1);
    const sentMessage = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sentMessage).toContain('📋 Tomar con las comidas');
    expect(sentMessage).toContain('💊 *Metformina* — 850mg');
  });

  it('(f) sin instructions → el mensaje NO incluye la línea 📋', async () => {
    mockPrisma.medicationReminder.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([
      {
        id: 'med-2',
        medicationName: 'Enalapril',
        dosage: '10mg',
        instructions: null,
        patient: { fullName: 'Ana Gómez', phone: '+5493764125000' },
      },
    ]);
    mockSendTextMessage.mockResolvedValueOnce(true);

    const { sendMedicationReminders } = await import('../services/medication-reminder.service');
    await sendMedicationReminders();

    const sentMessage = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sentMessage).not.toContain('📋');
  });

  it('(f) el mensaje incluye ⚠️ los efectos secundarios cuando existen', async () => {
    mockPrisma.medicationReminder.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([
      {
        id: 'med-3',
        medicationName: 'Insulina',
        dosage: '2 UI',
        instructions: 'Tomar después de comer',
        sideEffects: 'Puede causar diarrea',
        patient: { fullName: 'Ulises', phone: '+5493764125878' },
      },
    ]);
    mockSendTextMessage.mockResolvedValueOnce(true);

    const { sendMedicationReminders } = await import('../services/medication-reminder.service');
    await sendMedicationReminders();

    const sentMessage = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sentMessage).toContain('⚠️ Posibles efectos: Puede causar diarrea');
    expect(sentMessage).toContain('📋 Tomar después de comer');
  });

  it('(f) sin sideEffects → el mensaje NO incluye la línea ⚠️', async () => {
    mockPrisma.medicationReminder.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.medicationReminder.findMany.mockResolvedValueOnce([
      {
        id: 'med-4',
        medicationName: 'Enalapril',
        dosage: '10mg',
        instructions: null,
        sideEffects: null,
        patient: { fullName: 'Ana', phone: '+5493764125000' },
      },
    ]);
    mockSendTextMessage.mockResolvedValueOnce(true);

    const { sendMedicationReminders } = await import('../services/medication-reminder.service');
    await sendMedicationReminders();

    const sentMessage = mockSendTextMessage.mock.calls[0][1] as string;
    expect(sentMessage).not.toContain('⚠️');
  });
});
