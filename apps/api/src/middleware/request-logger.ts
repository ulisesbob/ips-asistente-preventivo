import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * HTTP request logging middleware.
 *
 * Logs every request after the response finishes, with method, path,
 * status code, and duration. Skips /health to avoid log spam from
 * uptime monitors hitting it every 60 seconds.
 *
 * Place this BEFORE routes but AFTER body parsing middleware.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip health endpoints — UptimeRobot hits these frequently
  if (req.path.startsWith('/health')) {
    next();
    return;
  }

  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;

    logger.http({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      contentLength: Number(res.getHeader('content-length')) || undefined,
    });
  });

  next();
}
