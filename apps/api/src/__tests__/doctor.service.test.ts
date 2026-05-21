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
  DoctorStatus: { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' },
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
import { prisma, DoctorStatus } from '@ips/db';
import * as doctorService from '../services/doctor.service';

const mockCreate = prisma.doctor.create as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.doctor.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.doctor.update as ReturnType<typeof vi.fn>;

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

  it('crea con status APPROVED (el admin da fe, no espera aprobación)', async () => {
    await doctorService.createDoctor({
      fullName: 'Dr X',
      email: 'x@ips.gob.ar',
      password: 'Seguro123!',
    });
    expect(mockCreate.mock.calls[0][0].data.status).toBe('APPROVED');
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

describe('doctorService.reviewDoctor (aprobar / rechazar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ id: 'd1', role: 'DOCTOR' });
    mockUpdate.mockResolvedValue({ id: 'd1', status: 'APPROVED' });
  });

  it('aprobar setea status APPROVED', async () => {
    await doctorService.reviewDoctor('d1', DoctorStatus.APPROVED);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe('APPROVED');
  });

  it('rechazar setea status REJECTED y revoca la sesión (bump tokenVersion)', async () => {
    await doctorService.reviewDoctor('d1', DoctorStatus.REJECTED);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe('REJECTED');
    expect(mockUpdate.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });
  });

  it('aprobar NO bumpea tokenVersion', async () => {
    await doctorService.reviewDoctor('d1', DoctorStatus.APPROVED);
    expect(mockUpdate.mock.calls[0][0].data.tokenVersion).toBeUndefined();
  });

  it('NO permite aprobar/rechazar a un administrador (evita lockout)', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'a1', role: 'ADMIN' });
    await expect(doctorService.reviewDoctor('a1', DoctorStatus.REJECTED)).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('lanza NotFound si el médico no existe', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(doctorService.reviewDoctor('x', DoctorStatus.APPROVED)).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
