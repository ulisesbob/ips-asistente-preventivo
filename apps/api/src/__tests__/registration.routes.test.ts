// vi.mock calls are hoisted above imports.

vi.mock('@ips/db', () => ({
  prisma: {
    doctor: { findUnique: vi.fn() },
  },
  runWithAuditActor: (_actor: unknown, fn: () => unknown) => fn(),
  setAuditActor: vi.fn(),
  getAuditActor: () => ({ actorType: 'SYSTEM', actorId: null }),
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR' },
  RegisteredVia: { PANEL: 'PANEL', BOT: 'BOT', IMPORT: 'IMPORT' },
  ConsentVia: { PANEL: 'PANEL', BOT: 'BOT', IMPORT: 'IMPORT', UNKNOWN: 'UNKNOWN' },
  PatientProgramStatus: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED' },
  Gender: { M: 'M', F: 'F', OTRO: 'OTRO' },
  ConversationStatus: { OPEN: 'OPEN', ESCALATED: 'ESCALATED', CLOSED: 'CLOSED' },
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {},
    PrismaClientValidationError: class extends Error {},
  },
}));

// bcrypt nativo no carga en este entorno (WSL): app → auth.service lo importa.
// Lo mockeamos igual que el resto de la suite.
vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(async () => 'hashed'),
    hashSync: vi.fn(() => '$2b$04$mockedhashfortestingpurposesonly'),
  },
  compare: vi.fn(),
  hash: vi.fn(async () => 'hashed'),
  hashSync: vi.fn(() => '$2b$04$mockedhashfortestingpurposesonly'),
}));

// Aislamos la ruta del service: la lógica del service ya está cubierta en
// registration.service.test.ts. Acá testeamos wiring HTTP, validación y status.
vi.mock('../services/registration.service', () => ({
  registerDoctor: vi.fn(),
  verifyEmail: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import * as registrationService from '../services/registration.service';
import { ValidationError } from '../utils/errors';

const mockRegister = registrationService.registerDoctor as ReturnType<typeof vi.fn>;
const mockVerify = registrationService.verifyEmail as ReturnType<typeof vi.fn>;

const validBody = {
  fullName: 'Dr. Juan Perez',
  licenseNumber: 'MP-12345',
  email: 'juan.perez@ips.gob.ar',
  password: 'Seguro123!',
};

const GENERIC = { message: 'Si el email pertenece a IPS y no estaba registrado, te enviamos un link.' };

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegister.mockResolvedValue(GENERIC);
  });

  it('devuelve 201 con mensaje genérico y SIN tokens en el body', async () => {
    const res = await request(app).post('/api/auth/register').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ok');
    expect(res.body.data.message).toBeTruthy();
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
  });

  it('devuelve 400 si faltan campos (validación zod)', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'x@ips.gob.ar' });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('devuelve 400 si el email tiene formato inválido', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validBody, email: 'no-es-un-email' });

    expect(res.status).toBe(400);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('un role=ADMIN en el body no se refleja en la respuesta (no escala)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validBody, role: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('ADMIN');
  });

  it('propaga el 503 si el service falla al mandar el mail', async () => {
    const { ServiceUnavailableError } = await import('../utils/errors');
    mockRegister.mockRejectedValueOnce(new ServiceUnavailableError('mail caído'));

    const res = await request(app).post('/api/auth/register').send(validBody);
    expect(res.status).toBe(503);
  });
});

describe('POST /api/auth/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerify.mockResolvedValue(undefined);
  });

  it('devuelve 200 con token válido', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'a'.repeat(43) });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('devuelve 400 si falta el token', async () => {
    const res = await request(app).post('/api/auth/verify-email').send({});

    expect(res.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('devuelve 400 (genérico) si el token es inválido o expiró', async () => {
    mockVerify.mockRejectedValueOnce(new ValidationError('El link de verificación es inválido o expiró.'));

    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'b'.repeat(43) });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
  });
});
