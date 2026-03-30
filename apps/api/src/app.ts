// app.ts — Express app setup without server start (importable in tests)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { prisma } from '@ips/db';
import { config } from './config/env';
import { router } from './routes';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { getCronStatus } from './services/reminder.service';

const app = express();

// Track server start time for uptime reporting in health checks
const SERVER_START_TIME = new Date().toISOString();

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

app.get('/health/cron', (req, res) => {
  const healthToken = process.env.HEALTH_TOKEN;
  const providedToken = req.headers['x-health-token'];

  if (!healthToken || typeof providedToken !== 'string' ||
      healthToken.length !== providedToken.length ||
      !crypto.timingSafeEqual(Buffer.from(healthToken), Buffer.from(providedToken))) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const cronStatus = getCronStatus();
  res.json({
    ...cronStatus,
    upSince: SERVER_START_TIME,
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use(router);

// ─── Global Error Handler (must be last) ─────────────────────────────────────

app.use(errorHandler);

export { app };
