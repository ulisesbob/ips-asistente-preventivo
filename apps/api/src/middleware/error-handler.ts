import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Prisma } from '@ips/db';
import { AppError } from '../utils/errors';
import { config } from '../config/env';

// ─── Async Handler Wrapper ─────────────────────────────────────────────────

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

export function asyncHandler(fn: AsyncRouteHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ─── Global Error Handler ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Operational errors — known AppError instances
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      ...(err.errors ? { errors: err.errors } : {}),
    });
    return;
  }

  // Prisma known request errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint violation → 409 Conflict
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[] | undefined) ?? [];
      const isDev = config.NODE_ENV === 'development';
      res.status(409).json({
        status: 'error',
        message: isDev
          ? `Ya existe un registro con ese valor en: ${fields.join(', ')}`
          : 'Ya existe un registro con ese valor',
      });
      return;
    }

    // Record not found → 404
    if (err.code === 'P2025') {
      res.status(404).json({
        status: 'error',
        message: 'Recurso no encontrado',
      });
      return;
    }
  }

  // Prisma validation errors → 400
  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      status: 'error',
      message: 'Error de validación en la base de datos',
    });
    return;
  }

  // Unknown / programming errors
  const isDev = config.NODE_ENV === 'development';
  const message = isDev && err instanceof Error ? err.message : 'Error interno del servidor';

  if (config.NODE_ENV !== 'test') {
    console.error('[Unhandled Error]', err);
  }

  res.status(500).json({
    status: 'error',
    message,
    ...(isDev && err instanceof Error ? { stack: err.stack } : {}),
  });
}
