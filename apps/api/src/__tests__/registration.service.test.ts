// vi.mock calls are hoisted above imports.

vi.mock('@ips/db', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
  DoctorStatus: { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      meta?: Record<string, unknown>;
      constructor(message: string, { code, meta }: { code: string; meta?: Record<string, unknown> }) {
        super(message);
        this.code = code;
        this.meta = meta;
      }
    },
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async () => 'hashed-password'),
    hashSync: vi.fn(() => '$2b$04$mockedhashfortestingpurposesonly'),
  },
  hash: vi.fn(async () => 'hashed-password'),
  hashSync: vi.fn(() => '$2b$04$mockedhashfortestingpurposesonly'),
}));

vi.mock('../services/email.service', () => ({
  sendVerificationEmail: vi.fn(async () => undefined),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma, Prisma } from '@ips/db';
import * as registration from '../services/registration.service';
import { sendVerificationEmail } from '../services/email.service';
import { ValidationError, ServiceUnavailableError } from '../utils/errors';
import { registerDoctorInput } from './helpers/fixtures';

const mockFindUnique = prisma.doctor.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.doctor.findFirst as ReturnType<typeof vi.fn>;
const mockCreate = prisma.doctor.create as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.doctor.update as ReturnType<typeof vi.fn>;
const mockDelete = prisma.doctor.delete as ReturnType<typeof vi.fn>;
const mockSendEmail = sendVerificationEmail as ReturnType<typeof vi.fn>;

const DOMAINS = ['ips.gob.ar', 'salud.misiones.gob.ar'];

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: 'new-doctor-id' });
  mockUpdate.mockResolvedValue({});
  mockDelete.mockResolvedValue({});
  mockSendEmail.mockResolvedValue(undefined);
});

// ─── A. Validación de dominio (función pura) ──────────────────────────────────

describe('isInstitutionalEmail (allowlist de dominio)', () => {
  it.each([
    ['juan@ips.gob.ar', true, 'dominio exacto permitido'],
    ['juan@IPS.GOB.AR', true, 'dominio en mayúsculas (case-insensitive)'],
    ['Juan.Perez@Ips.Gob.Ar', true, 'mixed case'],
    ['  juan@ips.gob.ar  ', true, 'con espacios alrededor (se trimea)'],
    ['juan+test@ips.gob.ar', true, 'sub-addressing dentro del dominio permitido'],
    ['juan@salud.misiones.gob.ar', true, 'segundo dominio de la lista'],
    ['juan@gmail.com', false, 'dominio no permitido'],
    ['juan@ips.gob.ar.evil.com', false, 'sufijo malicioso tras el dominio permitido'],
    ['juan@evilips.gob.ar', false, 'dominio que sólo contiene el string permitido'],
    ['juan@sub.ips.gob.ar', false, 'subdominio no autorizado (match exacto, sin wildcard)'],
    ['juan+ips.gob.ar@evil.com', false, 'tag que simula el dominio permitido'],
    ['evil.com\n@ips.gob.ar', false, 'CRLF injection'],
    ['juanips.gob.ar', false, 'sin @'],
    ['juan@ips.gob.ar@evil.com', false, 'doble @'],
    ['juan@ірs.gob.ar', false, 'homoglyph unicode (cirílico)'],
    ['', false, 'vacío'],
  ])('%s → %s (%s)', (email, expected) => {
    expect(registration.isInstitutionalEmail(email as string, DOMAINS)).toBe(expected);
  });

  it('fail-closed: con lista de dominios vacía rechaza todo', () => {
    expect(registration.isInstitutionalEmail('juan@ips.gob.ar', [])).toBe(false);
  });

  it('rechaza email no-string sin tirar excepción', () => {
    expect(registration.isInstitutionalEmail(null as unknown as string, DOMAINS)).toBe(false);
    expect(registration.isInstitutionalEmail(123 as unknown as string, DOMAINS)).toBe(false);
  });
});

describe('parseAllowedDomains', () => {
  it('parsea, trimea, lowercasea y filtra vacíos', () => {
    expect(registration.parseAllowedDomains('ips.gob.ar , Salud.Misiones.gob.ar ,')).toEqual([
      'ips.gob.ar',
      'salud.misiones.gob.ar',
    ]);
  });
  it('lista vacía si no está configurado', () => {
    expect(registration.parseAllowedDomains(undefined)).toEqual([]);
    expect(registration.parseAllowedDomains('')).toEqual([]);
  });
});

describe('isValidEmailFormat', () => {
  it('acepta cualquier email bien formado (gmail incluido)', () => {
    expect(registration.isValidEmailFormat('juan@gmail.com')).toBe(true);
    expect(registration.isValidEmailFormat('  Juan.Perez@hotmail.com ')).toBe(true);
  });
  it('rechaza formatos inválidos', () => {
    expect(registration.isValidEmailFormat('no-es-email')).toBe(false);
    expect(registration.isValidEmailFormat('a@b@c.com')).toBe(false);
    expect(registration.isValidEmailFormat('a@b.com\nx')).toBe(false);
    expect(registration.isValidEmailFormat('')).toBe(false);
  });
});

// ─── B. registerDoctor: password, rol, creación ───────────────────────────────

describe('registerDoctor', () => {
  it('rechaza dominio no permitido y NO crea', async () => {
    await expect(registration.registerDoctor(registerDoctorInput({ email: 'x@gmail.com' }))).rejects.toThrow(
      ValidationError
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rechaza password de menos de 8 chars y NO crea', async () => {
    await expect(registration.registerDoctor(registerDoctorInput({ password: '1234567' }))).rejects.toThrow(
      ValidationError
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('acepta password de exactamente 8 chars', async () => {
    await expect(registration.registerDoctor(registerDoctorInput({ password: 'aaaaaaaa' }))).resolves.toBeTruthy();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('FUERZA role DOCTOR aunque el body mande role=ADMIN', async () => {
    await registration.registerDoctor(registerDoctorInput({ role: 'ADMIN' } as Record<string, unknown>));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].data.role).toBe('DOCTOR');
  });

  it('crea con emailVerifiedAt null y NUNCA guarda el password plano', async () => {
    await registration.registerDoctor(registerDoctorInput());
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.emailVerifiedAt).toBeNull();
    expect(data.passwordHash).toBe('hashed-password');
    expect(data).not.toHaveProperty('password');
  });

  it('crea con status PENDING (espera aprobación de un admin)', async () => {
    await registration.registerDoctor(registerDoctorInput());
    expect(mockCreate.mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('guarda sólo el HASH del token (sha256, 64 hex), nunca el token plano', async () => {
    await registration.registerDoctor(registerDoctorInput());
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.verificationCodeHash).toMatch(/^[a-f0-9]{64}$/);
    // el link del mail lleva el token plano, que NO debe igualar al hash guardado
    const urlArg = mockSendEmail.mock.calls[0][0].verifyUrl as string;
    expect(urlArg).toContain('/verificar-email?token=');
    const plainToken = urlArg.split('token=')[1];
    expect(plainToken).not.toBe(data.verificationCodeHash);
    expect(plainToken.length).toBeGreaterThanOrEqual(40);
  });

  it('normaliza el email a lowercase antes de buscar duplicados y crear', async () => {
    await registration.registerDoctor(registerDoctorInput({ email: 'Juan.Perez@IPS.GOB.AR' }));
    expect(mockFindUnique.mock.calls[0][0].where.email).toBe('juan.perez@ips.gob.ar');
    expect(mockCreate.mock.calls[0][0].data.email).toBe('juan.perez@ips.gob.ar');
  });

  it('manda el mail de verificación una vez al email normalizado', async () => {
    await registration.registerDoctor(registerDoctorInput());
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe('juan.perez@ips.gob.ar');
  });

  // ─── C. Duplicados / enumeración / rollback ────────────────────────────────

  it('email ya verificado: respuesta genérica, NO crea ni reenvía (anti-enumeración)', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'existing', emailVerifiedAt: new Date() });
    const res = await registration.registerDoctor(registerDoctorInput());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res.message).toBeTruthy();
  });

  it('email existente SIN verificar: regenera token y reenvía (update, no create)', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'existing', emailVerifiedAt: null });
    await registration.registerDoctor(registerDoctorInput());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].data.verificationCodeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('respuesta idéntica para email nuevo vs ya verificado (no enumera)', async () => {
    const resNew = await registration.registerDoctor(registerDoctorInput());
    mockFindUnique.mockResolvedValueOnce({ id: 'existing', emailVerifiedAt: new Date() });
    const resExisting = await registration.registerDoctor(registerDoctorInput());
    expect(resExisting).toEqual(resNew);
  });

  it('si falla el envío de mail tras crear, BORRA el doctor y tira 503', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('smtp down'));
    await expect(registration.registerDoctor(registerDoctorInput())).rejects.toThrow(ServiceUnavailableError);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'new-doctor-id' } });
  });

  it('traduce la race P2002 (doble submit) a respuesta genérica, no 500', async () => {
    mockCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' })
    );
    const res = await registration.registerDoctor(registerDoctorInput());
    expect(res.message).toBeTruthy();
  });
});

// ─── D. verifyEmail ───────────────────────────────────────────────────────────

describe('verifyEmail', () => {
  it('verifica un token válido y no vencido: marca verificado y limpia el código (single-use)', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'doc-1',
      verificationExpiresAt: new Date(Date.now() + 60_000),
    });
    await registration.verifyEmail('a'.repeat(43));
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data.verificationCodeHash).toBeNull();
    expect(data.verificationExpiresAt).toBeNull();
  });

  it('busca por el HASH del token, nunca por el token plano', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'doc-1', verificationExpiresAt: new Date(Date.now() + 60_000) });
    const token = 'b'.repeat(43);
    await registration.verifyEmail(token);
    const where = mockFindFirst.mock.calls[0][0].where;
    expect(where.verificationCodeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(where.verificationCodeHash).not.toBe(token);
  });

  it('rechaza token vencido sin marcar verificado', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'doc-1',
      verificationExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(registration.verifyEmail('c'.repeat(43))).rejects.toThrow(ValidationError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rechaza token inexistente (mismo error genérico que vencido)', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    await expect(registration.verifyEmail('d'.repeat(43))).rejects.toThrow(ValidationError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rechaza token vacío / malformado sin tocar la DB', async () => {
    await expect(registration.verifyEmail('')).rejects.toThrow(ValidationError);
    await expect(registration.verifyEmail('short')).rejects.toThrow(ValidationError);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
