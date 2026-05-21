// app.ts — Express app setup without server start (importable in tests)
import express from 'express';
import * as Sentry from '@sentry/node';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { prisma } from '@ips/db';
import { config } from './config/env';
import { router } from './routes';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { auditContextMiddleware } from './middleware/audit-context';
import { getCronStatus } from './services/reminder.service';
import { getBoss } from './queue/boss';
import { getQueueDepth } from './queue/queue-depth';
import { logger } from './utils/logger';

const app = express();

// Track server start time for uptime reporting in health checks
const SERVER_START_TIME = new Date().toISOString();

// Render (and most PaaS) sit behind a proxy. Without this, req.protocol is always
// "http" and req.ip is the proxy IP, which breaks webhook URL reconstruction
// (Twilio signature verification) and per-IP rate limiting.
app.set('trust proxy', 1);

// ─── Security & Parsing Middleware ────────────────────────────────────────────

app.use(helmet());

app.use(
  cors({
    origin: config.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Store raw body for webhook signature verification (WhatsApp HMAC-SHA256)
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Request Logging ─────────────────────────────────────────────────────────
// Structured JSON logs for every request (except /health, to avoid log spam)

app.use(requestLogger);

// ─── Health Check (Liveness) ─────────────────────────────────────────────────
// UptimeRobot hits this every 60s. Returns 200 if the process is alive.
// Intentionally lightweight — no DB call, no external dependency.

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    upSince: SERVER_START_TIME,
  });
});

// ─── Deep Health (Readiness) ─────────────────────────────────────────────────
// Verifies DB connectivity. NOT for high-frequency UptimeRobot polling
// (a transient DB timeout should not page you at 3 AM).

app.get('/health/deep', async (_req, res) => {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      db: 'connected',
      dbLatencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
      upSince: SERVER_START_TIME,
    });
  } catch {
    res.status(503).json({
      status: 'error',
      db: 'disconnected',
      timestamp: new Date().toISOString(),
      upSince: SERVER_START_TIME,
    });
  }
});

// ─── Cron Health (protected — requires auth token or internal header) ────────
// Returns last cron run result. Protected because it exposes patient volume data.

app.get('/health/cron', async (req, res) => {
  const healthToken = process.env.HEALTH_TOKEN;
  const providedToken = req.headers['x-health-token'];

  if (!healthToken || typeof providedToken !== 'string' ||
      healthToken.length !== providedToken.length ||
      !crypto.timingSafeEqual(Buffer.from(healthToken), Buffer.from(providedToken))) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const cronStatus = getCronStatus();

  // Bloque B (T9): profundidad de la cola por estado, SOLO si QUEUE_ENABLED.
  // Con el flag off omitimos esta parte sin romper (prod actual no consulta
  // pgboss). Si la consulta falla, no tumbamos el health: devolvemos el error
  // de cola adjunto y seguimos con el status del cron.
  let queue: Awaited<ReturnType<typeof getQueueDepth>> | { error: string } | undefined;
  if (config.QUEUE_ENABLED) {
    try {
      queue = await getQueueDepth(getBoss());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('/health/cron — fallo al leer profundidad de cola', {
        event: 'queue',
        action: 'depth_failed',
        error: message,
      });
      queue = { error: message };
    }
  }

  res.json({
    ...cronStatus,
    ...(queue !== undefined ? { queue } : {}),
    upSince: SERVER_START_TIME,
    timestamp: new Date().toISOString(),
  });
});

// ─── Audit context (trazabilidad ley 25.326) ────────────────────────────────
// Abre el contexto de auditoría para las rutas de la API. requireAuth eleva el
// actor al médico autenticado; el resto queda como SYSTEM.

app.use(auditContextMiddleware);

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use(router);

// ─── Captura de errores en Sentry ────────────────────────────────────────────
// Va DESPUÉS de las rutas y ANTES del handler que formatea la respuesta. Captura
// los 5xx con contexto del request (sin PII, ver instrument.ts) y hace next(err).
// Solo si hay DSN configurado (en tests/dev sin DSN no se monta).
if (config.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ─── Global Error Handler (must be last) ─────────────────────────────────────

app.use(errorHandler);

export { app };
