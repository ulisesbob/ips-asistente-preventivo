// vi.mock calls are hoisted by Vitest to the top of the file (before imports),
// so the mocks are in place when the module under test is first imported.

vi.mock('@ips/db', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
  },
  Role: {
    ADMIN: 'ADMIN',
    DOCTOR: 'DOCTOR',
  },
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
import { UnauthorizedError, NotFoundError } from '../utils/errors';
import { testDoctor, TEST_JWT_SECRET } from './helpers/fixtures';

// Typed shorthand for the mock
const mockFindUnique = prisma.doctor.findUnique as ReturnType<typeof vi.fn>;
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
