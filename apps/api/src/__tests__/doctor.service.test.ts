// vi.mock calls are hoisted above imports.

vi.mock('@ips/db', () => ({
  prisma: {
    doctor: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {},
  },
}));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async () => 'hashed'), hashSync: vi.fn(() => 'x') },
  hash: vi.fn(async () => 'hashed'),
  hashSync: vi.fn(() => 'x'),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@ips/db';
import * as doctorService from '../services/doctor.service';

const mockCreate = prisma.doctor.create as ReturnType<typeof vi.fn>;

describe('doctorService.createDoctor (alta por admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'd1' });
  });

  // Regresión del gate de login: un médico creado por admin NO pasa por la
  // verificación de mail, así que debe nacer verificado o quedaría bloqueado.
  it('marca el médico como verificado (emailVerifiedAt seteado)', async () => {
    await doctorService.createDoctor({
      fullName: 'Dr X',
      email: 'x@ips.gob.ar',
      password: 'Seguro123!',
    });
    expect(mockCreate.mock.calls[0][0].data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('normaliza el email a lowercase', async () => {
    await doctorService.createDoctor({
      fullName: 'Dr X',
      email: 'X.Y@IPS.GOB.AR',
      password: 'Seguro123!',
    });
    expect(mockCreate.mock.calls[0][0].data.email).toBe('x.y@ips.gob.ar');
  });

  it('fuerza el hash de la contraseña y rechaza passwords cortas', async () => {
    await expect(
      doctorService.createDoctor({ fullName: 'Dr X', email: 'x@ips.gob.ar', password: '123' })
    ).rejects.toThrow();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
