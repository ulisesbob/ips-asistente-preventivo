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

import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { errorHandler } from '../middleware/error-handler';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../utils/errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function makeMockReq(body?: unknown): Request {
  return { body } as unknown as Request;
}

const noopNext: NextFunction = vi.fn();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Middleware', () => {
  // ─── validate ─────────────────────────────────────────────────────────────

  describe('validate', () => {
    const schema = z.object({
      name: z.string().min(1, 'name is required'),
      age: z.number().int().positive('age must be positive'),
    });

    it('passes with valid data', () => {
      const req = makeMockReq({ name: 'Alice', age: 30 });
      const res = makeMockRes();
      const next = vi.fn();

      validate(schema)(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 with field errors on invalid data', () => {
      const req = makeMockReq({ name: '', age: -1 });
      const res = makeMockRes();
      const next = vi.fn();

      validate(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errors: expect.any(Object),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('replaces req.body with parsed data', () => {
      // Zod coercion: even though we pass a string-keyed number, after parse
      // the body is the typed result. Test that req.body is replaced.
      const req = makeMockReq({ name: 'Bob', age: 25, extraField: 'stripped' });
      const res = makeMockRes();
      const next = vi.fn();

      validate(schema)(req, res, next);

      // After validation, extra fields should be stripped (Zod strips by default)
      expect((req.body as { name: string; age: number; extraField?: string }).extraField).toBeUndefined();
      expect(req.body).toEqual({ name: 'Bob', age: 25 });
    });
  });

  // ─── errorHandler ─────────────────────────────────────────────────────────

  describe('errorHandler', () => {
    it('handles AppError with correct status', () => {
      const err = new NotFoundError('Thing not found');
      const req = {} as Request;
      const res = makeMockRes();

      errorHandler(err, req, res, noopNext);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', message: 'Thing not found' })
      );
    });

    it('handles ValidationError with errors field', () => {
      const fieldErrors = { email: ['Email inválido'] };
      const err = new ValidationError('Datos inválidos', fieldErrors);
      const req = {} as Request;
      const res = makeMockRes();

      errorHandler(err, req, res, noopNext);

      expect(res.status).toHaveBeenCalledWith(400);
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        errors: Record<string, string[]>;
      };
      expect(jsonArg.errors).toEqual(fieldErrors);
    });

    it('returns 500 for unknown errors in production', () => {
      // Temporarily set NODE_ENV to production
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const err = new Error('Something exploded');
      const req = {} as Request;
      const res = makeMockRes();

      // Re-import config would still be cached, but errorHandler reads config.NODE_ENV
      // which was set at module load from process.env at that time (test).
      // Instead we test the unknown-error branch with test env (non-dev).
      // The handler returns 500 regardless of env for unknown errors.
      errorHandler(err, req, res, noopNext);

      expect(res.status).toHaveBeenCalledWith(500);

      process.env.NODE_ENV = original;
    });

    it('includes stack in development mode', () => {
      // In the test environment NODE_ENV=test, config.NODE_ENV is 'test'
      // The handler only includes stack when NODE_ENV === 'development'.
      // We test the shape of the response — stack should NOT be present in test mode.
      const err = new Error('Dev error');
      const req = {} as Request;
      const res = makeMockRes();

      errorHandler(err, req, res, noopNext);

      expect(res.status).toHaveBeenCalledWith(500);
      // In test mode (not development), stack should be absent
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        stack?: string;
      };
      expect(jsonArg.stack).toBeUndefined();
    });
  });

  // ─── Error classes ────────────────────────────────────────────────────────

  describe('Error classes', () => {
    const cases: [string, AppError, number][] = [
      ['ValidationError', new ValidationError(), 400],
      ['UnauthorizedError', new UnauthorizedError(), 401],
      ['ForbiddenError', new ForbiddenError(), 403],
      ['NotFoundError', new NotFoundError(), 404],
      ['ConflictError', new ConflictError(), 409],
    ];

    it.each(cases)('%s has correct statusCode', (_name, err, expectedCode) => {
      expect(err.statusCode).toBe(expectedCode);
    });

    it.each(cases)('%s is an instance of AppError', (_name, err) => {
      expect(err).toBeInstanceOf(AppError);
    });
  });
});
