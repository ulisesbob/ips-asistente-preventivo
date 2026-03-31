// vi.mock calls are hoisted by Vitest to the top of the file (before imports).

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
  PatientProgramStatus: {
    ACTIVE: 'ACTIVE',
    PAUSED: 'PAUSED',
    COMPLETED: 'COMPLETED',
  },
  Gender: {
    M: 'M',
    F: 'F',
    OTRO: 'OTRO',
  },
  ConversationStatus: {
    OPEN: 'OPEN',
    ESCALATED: 'ESCALATED',
    CLOSED: 'CLOSED',
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
import request from 'supertest';
import bcrypt from 'bcrypt';
import { prisma } from '@ips/db';
import { app } from '../app';
import {
  testDoctor,
  validAccessToken,
  validRefreshToken,
  expiredAccessToken,
} from './helpers/fixtures';

const mockFindUnique = prisma.doctor.findUnique as ReturnType<typeof vi.fn>;
const mockBcryptCompare = bcrypt.compare as ReturnType<typeof vi.fn>;

describe('Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── POST /api/auth/login ─────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns 200 with accessToken and doctor on valid login', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testDoctor.email, password: 'Test1234!' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.doctor.email).toBe(testDoctor.email);
    });

    it('sets httpOnly refreshToken cookie', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testDoctor.email, password: 'Test1234!' });

      const cookies: string[] = res.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      const refreshCookie = cookies.find((c: string) => c.startsWith('refreshToken='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
    });

    it('does NOT include refreshToken in response body', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testDoctor.email, password: 'Test1234!' });

      expect(res.body.data.refreshToken).toBeUndefined();
    });

    it('returns 401 on wrong password', async () => {
      mockFindUnique.mockResolvedValueOnce(testDoctor);
      mockBcryptCompare.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testDoctor.email, password: 'WrongPassword!' });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('error');
    });

    it('returns 401 on non-existent email', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockBcryptCompare.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@ips.com', password: 'Test1234!' });

      expect(res.status).toBe(401);
    });

    it('returns 400 on missing email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'Test1234!' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('returns 400 on missing password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testDoctor.email });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('returns 400 on invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'not-an-email', password: 'Test1234!' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });
  });

  // ─── POST /api/auth/refresh ───────────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('returns 200 with new accessToken from cookie', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: testDoctor.id,
        email: testDoctor.email,
        role: testDoctor.role,
      });

      const refreshToken = validRefreshToken();

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`])
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
    });

    it('returns 401 without refresh token', async () => {
      const res = await request(app).post('/api/auth/refresh').send({});

      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', ['refreshToken=invalidtoken'])
        .send({});

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /api/auth/me ────────────────────────────────────────────────────

  describe('GET /api/auth/me', () => {
    it('returns 200 with doctor profile when authenticated', async () => {
      const profile = {
        id: testDoctor.id,
        fullName: testDoctor.fullName,
        email: testDoctor.email,
        role: testDoctor.role,
      };
      // requireAuth calls findUnique, then getMe calls findUnique again
      mockFindUnique
        .mockResolvedValueOnce(profile) // requireAuth lookup
        .mockResolvedValueOnce(profile); // getMe lookup

      const token = validAccessToken();

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.doctor.email).toBe(testDoctor.email);
    });

    it('returns 401 without token', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
    });

    it('returns 401 with expired token', async () => {
      const token = expiredAccessToken();

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
    });

    it('returns 401 with refresh token (wrong type)', async () => {
      const refreshToken = validRefreshToken();

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshToken}`);

      expect(res.status).toBe(401);
    });
  });
});
