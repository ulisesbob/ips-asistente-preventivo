// Must be imported first to validate env vars before anything else
import './config/env';

import { prisma } from '@ips/db';
import { config } from './config/env';
import { app } from './app';
import { startReminderCron, stopReminderCron } from './services/reminder.service';
import { startMedicationCron, stopMedicationCron } from './services/medication-cron';
import { startSurveyCron, stopSurveyCron } from './services/survey-cron';
import { startSelfReminderCron, stopSelfReminderCron } from './services/self-reminder-cron';
import { logger } from './utils/logger';

// ─── Server Start ─────────────────────────────────────────────────────────────

const PORT = parseInt(config.PORT, 10);

const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`, {
    event: 'server_start',
    port: PORT,
    env: config.NODE_ENV,
    whatsappConfigured: !!(config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID),
    aiConfigured: !!config.ANTHROPIC_API_KEY,
  });

  // Start crons after server is ready
  startReminderCron();
  startMedicationCron();
  startSurveyCron();
  startSelfReminderCron();

  // Warm-up post-listen: pegarle a la DB (despierta Neon serverless ~3-5s) y
  // cargar la KB en cache. Sin esto el primer paciente del día espera 5s al
  // recibir respuesta del bot (Render duerme + Neon cold start).
  // Fire-and-forget: si falla, el server arranca igual y se recupera al primer request.
  warmUp().catch((err) => {
    logger.warn('Warm-up failed (server still healthy)', {
      event: 'warmup',
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

async function warmUp(): Promise<void> {
  const start = Date.now();
  // Ping DB para despertar Neon
  await prisma.$queryRaw`SELECT 1`;
  // Cargar KB en cache (1 query DB, evita el round-trip en el primer mensaje del bot)
  const { getRelevantKBForBot } = await import('./services/knowledge.service');
  await getRelevantKBForBot('warmup');
  logger.info(`Warm-up complete in ${Date.now() - start}ms`, { event: 'warmup' });
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Shutdown signal received: ${signal}`, { event: 'server_shutdown', signal });
  await stopReminderCron();
  stopMedicationCron();
  stopSurveyCron();
  stopSelfReminderCron();
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Server shut down cleanly', { event: 'server_shutdown' });
    process.exit(0);
  });

  // Force exit after 10 seconds if connections don't drain
  setTimeout(() => {
    logger.error('Forcing shutdown after timeout', { event: 'server_shutdown' });
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
