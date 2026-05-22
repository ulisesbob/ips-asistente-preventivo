import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Anti-duplicados: las vías de alta guardan DNI/teléfono en forma CANÓNICA ──
// Garantía: el mismo número/DNI en distinto formato se guarda con el MISMO string,
// para que el @unique de la DB impida el duplicado "bajo cualquier circunstancia".
// Usamos las utils REALES de normalización; sólo mockeamos prisma.

const mockPrisma = {
  patient: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('@ips/db', () => ({
  prisma: mockPrisma,
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
  RegisteredVia: { PANEL: 'PANEL', BOT: 'BOT', IMPORT: 'IMPORT' },
  ConsentVia: { PANEL: 'PANEL', BOT: 'BOT', IMPORT: 'IMPORT', UNKNOWN: 'UNKNOWN' },
  Gender: { M: 'M', F: 'F', OTRO: 'OTRO' },
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED' },
  SelfReminderStatus: { PENDING: 'PENDING', SENT: 'SENT', CANCELLED: 'CANCELLED' },
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.patient.findUnique.mockResolvedValue(null);
  mockPrisma.patient.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'p1', ...data })
  );
  mockPrisma.patient.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'p1', ...data })
  );
});

describe('upsertPatientByDni guarda en forma canónica', () => {
  it('teléfono AR sin el 9 se guarda como +549... (igual que lo guarda el bot)', async () => {
    const { upsertPatientByDni } = await import('../services/patient.service');
    await upsertPatientByDni({ fullName: 'Ana López', dni: '30111222', phone: '+543764125878' });

    const created = mockPrisma.patient.create.mock.calls[0][0].data;
    expect(created.phone).toBe('+5493764125878'); // canónico, no el +543764... tipeado
  });

  it('DNI con puntos se busca y guarda sin puntos', async () => {
    const { upsertPatientByDni } = await import('../services/patient.service');
    await upsertPatientByDni({ fullName: 'Ana López', dni: '30.111.222', phone: '+5493764125878' });

    // El lookup de dedup usa el DNI canónico…
    expect(mockPrisma.patient.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dni: '30111222' } })
    );
    // …y se guarda igual.
    expect(mockPrisma.patient.create.mock.calls[0][0].data.dni).toBe('30111222');
  });

  it('dos formatos del MISMO número producen el MISMO string almacenado', async () => {
    const { upsertPatientByDni } = await import('../services/patient.service');

    await upsertPatientByDni({ fullName: 'A', dni: '30111222', phone: '+543764125878' });
    await upsertPatientByDni({ fullName: 'B', dni: '30111333', phone: '+5493764125878' });

    const phone1 = mockPrisma.patient.create.mock.calls[0][0].data.phone;
    const phone2 = mockPrisma.patient.create.mock.calls[1][0].data.phone;
    expect(phone1).toBe(phone2); // → el @unique de phone los detecta como el mismo
  });

  it('una colisión de teléfono (P2002) se traduce a 409, no a 500', async () => {
    const { upsertPatientByDni } = await import('../services/patient.service');
    const { ConflictError } = await import('../utils/errors');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await import('@ips/db')) as any;

    const p2002 = new db.Prisma.PrismaClientKnownRequestError('unique', {});
    p2002.code = 'P2002';
    p2002.meta = { target: ['phone'] };
    mockPrisma.patient.create.mockRejectedValue(p2002);

    await expect(
      upsertPatientByDni({ fullName: 'C', dni: '30111444', phone: '+5493764125878' })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
