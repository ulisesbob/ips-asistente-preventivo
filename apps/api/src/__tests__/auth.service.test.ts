// vi.mock calls are hoisted by Vitest to the top of the file (before imports),
// so the mocks are in place when the module under test is first imported.

vi.mock('@ips/db', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  Role: {
    ADMIN: 'ADMIN',
    DOCTOR: 'DOCTOR',
  },
  DoctorStatus: { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      meta?: Record<string, unknown>;
      constructor(
        message: string,
        { code, meta }: { code: string; meta?: Record<string, unknown> }
      ) {
        super(message);
        this.code = code;
        this.meta = meta;
      }
    },
    PrismaClientValidationError: class PrismaClientValidationError extends Error {},
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hashSync: vi.fn(() => '$2b$04$mockedhashfortestingpurposesonly'),
  },
  compare: vi.fn(),
  hashSync: vi.fn(() => '$2b$04$mockedhashfortestingpurposesonly'),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '@ips/db';
import * as authService from '../services/auth.service';
import { UnauthorizedError, NotFoundError, ForbiddenError } from '../utils/errors';
import { testDoctor, unverifiedDoctor, TEST_JWT_SECRET } from './helpers/fixtures';

// Typed shorthand for the mock
const mockFindUnique = prisma.doctor.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.doctor.update as ReturnType<typeof vi.fn>;
const mockBcryptCompare = bcrypt.compare as ReturnType<typeof vi.fn>;

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── login ────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns tokens and doctor profile on valid credentials', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true);

      const result = await authService.login(testDoctor.email, 'Test1234!');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.doctor).toEqual({
        id: testDoctor.id,
        fullName: testDoctor.fullName,
        email: testDoctor.email,
        role: testDoctor.role,
      });
    });

    it('throws UnauthorizedError on wrong password', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(false);

      await expect(authService.login(testDoctor.email, 'WrongPass!')).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('normaliza el email (trim + lowercase) antes de buscar', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true);

      await authService.login('  MARIA.GARCIA@IPS.COM  ', 'Test1234!');

      expect(mockFindUnique.mock.calls[0][0].where.email).toBe('maria.garcia@ips.com');
    });

    it('rechaza login con ForbiddenError si el email NO está verificado', async () => {
      mockFindUnique.mockResolvedValueOnce(unverifiedDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true); // password correcta

      await expect(
        authService.login(unverifiedDoctor.email, 'Test1234!')
      ).rejects.toThrow(ForbiddenError);
    });

    it('rechaza login con ForbiddenError si verificó el email pero NO está aprobado', async () => {
      mockFindUnique.mockResolvedValueOnce({ ...testDoctor, status: 'PENDING' });
      mockBcryptCompare.mockResolvedValueOnce(true); // password correcta + email verificado

      await expect(authService.login(testDoctor.email, 'Test1234!')).rejects.toThrow(ForbiddenError);
    });

    it('permite login si el email está verificado y el status es APPROVED', async () => {
      mockFindUnique.mockResolvedValueOnce({
        ...testDoctor,
        emailVerifiedAt: new Date(),
        status: 'APPROVED',
      });
      mockBcryptCompare.mockResolvedValueOnce(true);

      const result = await authService.login(testDoctor.email, 'Test1234!');
      expect(result.accessToken).toBeDefined();
      expect(result.doctor.email).toBe(testDoctor.email);
    });

    it('email no verificado + password incorrecta falla como UnauthorizedError (no revela el motivo)', async () => {
      mockFindUnique.mockResolvedValueOnce(unverifiedDoctor);
      mockBcryptCompare.mockResolvedValueOnce(false);

      await expect(
        authService.login(unverifiedDoctor.email, 'WrongPass!')
      ).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError on non-existent email (timing attack safe)', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      // bcrypt.compare still runs against the DUMMY_HASH
      mockBcryptCompare.mockResolvedValueOnce(false);

      await expect(authService.login('ghost@ips.com', 'AnyPass123!')).rejects.toThrow(
        UnauthorizedError
      );

      // bcrypt.compare MUST still be called even when doctor is null
      expect(mockBcryptCompare).toHaveBeenCalledTimes(1);
    });

    it('access token contains type: "access"', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true);

      const result = await authService.login(testDoctor.email, 'Test1234!');
      const decoded = jwt.verify(result.accessToken, TEST_JWT_SECRET) as Record<string, unknown>;

      expect(decoded['type']).toBe('access');
    });

    it('refresh token contains type: "refresh"', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true);

      const result = await authService.login(testDoctor.email, 'Test1234!');
      const decoded = jwt.verify(result.refreshToken, TEST_JWT_SECRET) as Record<string, unknown>;

      expect(decoded['type']).toBe('refresh');
    });

    it('tokens contain correct payload (sub, email, role)', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true);

      const result = await authService.login(testDoctor.email, 'Test1234!');
      const decoded = jwt.verify(result.accessToken, TEST_JWT_SECRET) as Record<string, unknown>;

      expect(decoded['sub']).toBe(testDoctor.id);
      expect(decoded['email']).toBe(testDoctor.email);
      expect(decoded['role']).toBe(testDoctor.role);
    });
  });

  // ─── refreshAccessToken ───────────────────────────────────────────────────

  describe('refreshAccessToken', () => {
    function makeRefreshToken(overrides?: Record<string, unknown>): string {
      return jwt.sign(
        {
          sub: testDoctor.id,
          email: testDoctor.email,
          role: testDoctor.role,
          type: 'refresh',
          ...overrides,
        },
        TEST_JWT_SECRET,
        { expiresIn: '7d' }
      );
    }

    it('returns new access token for valid refresh token', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: testDoctor.id,
        email: testDoctor.email,
        role: testDoctor.role,
        status: 'APPROVED',
        emailVerifiedAt: new Date(),
      });

      const refreshToken = makeRefreshToken();
      const newAccessToken = await authService.refreshAccessToken(refreshToken);

      expect(newAccessToken).toBeDefined();
      const decoded = jwt.verify(newAccessToken, TEST_JWT_SECRET) as Record<string, unknown>;
      expect(decoded['type']).toBe('access');
      expect(decoded['sub']).toBe(testDoctor.id);
    });

    it('throws UnauthorizedError for expired refresh token', async () => {
      const expiredToken = jwt.sign(
        { sub: testDoctor.id, email: testDoctor.email, role: testDoctor.role, type: 'refresh' },
        TEST_JWT_SECRET,
        { expiresIn: -1 }
      );

      await expect(authService.refreshAccessToken(expiredToken)).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError for access token used as refresh', async () => {
      const accessToken = jwt.sign(
        { sub: testDoctor.id, email: testDoctor.email, role: testDoctor.role, type: 'access' },
        TEST_JWT_SECRET,
        { expiresIn: '15m' }
      );

      await expect(authService.refreshAccessToken(accessToken)).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError if doctor no longer exists', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const refreshToken = makeRefreshToken();

      await expect(authService.refreshAccessToken(refreshToken)).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError if token version is stale (revocado por logout)', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: testDoctor.id,
        email: testDoctor.email,
        role: testDoctor.role,
        tokenVersion: 1, // el doctor ya bumpeó su versión (hizo logout)
      });

      const refreshToken = makeRefreshToken({ tv: 0 }); // token viejo

      await expect(authService.refreshAccessToken(refreshToken)).rejects.toThrow(UnauthorizedError);
    });

    it('returns access token when token version matches', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: testDoctor.id,
        email: testDoctor.email,
        role: testDoctor.role,
        tokenVersion: 3,
        status: 'APPROVED',
        emailVerifiedAt: new Date(),
      });

      const refreshToken = makeRefreshToken({ tv: 3 });
      const newAccessToken = await authService.refreshAccessToken(refreshToken);
      const decoded = jwt.verify(newAccessToken, TEST_JWT_SECRET) as Record<string, unknown>;

      expect(decoded['tv']).toBe(3);
      expect(decoded['type']).toBe('access');
    });
  });

  // ─── logout (revocación de sesiones) ──────────────────────────────────────

  describe('logout', () => {
    it('incrementa tokenVersion para revocar todas las sesiones', async () => {
      mockUpdate.mockResolvedValueOnce({});
      const refreshToken = jwt.sign(
        { sub: testDoctor.id, email: testDoctor.email, role: testDoctor.role, type: 'refresh', tv: 0 },
        TEST_JWT_SECRET,
        { expiresIn: '7d' }
      );

      await authService.logout(refreshToken);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: testDoctor.id },
        data: { tokenVersion: { increment: 1 } },
      });
    });

    it('es no-op si el token falta o es inválido', async () => {
      await authService.logout(undefined);
      await authService.logout('garbage-token');

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  // ─── getMe ────────────────────────────────────────────────────────────────

  describe('getMe', () => {
    it('returns doctor profile', async () => {
      const profile = {
        id: testDoctor.id,
        fullName: testDoctor.fullName,
        email: testDoctor.email,
        role: testDoctor.role,
      };
      mockFindUnique.mockResolvedValueOnce(profile);

      const result = await authService.getMe(testDoctor.id);

      expect(result).toEqual(profile);
    });

    it('throws NotFoundError for non-existent doctor', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      await expect(authService.getMe('non-existent-id')).rejects.toThrow(NotFoundError);
    });
  });
});
