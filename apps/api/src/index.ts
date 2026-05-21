// Sentry primero: la instrumentación debe engancharse antes de cargar express.
import { Sentry } from './instrument';
// Must be imported first to validate env vars before anything else
import './config/env';

import { prisma } from '@ips/db';
import { config } from './config/env';
import { app } from './app';
import { startReminderCron, stopReminderCron } from './services/reminder.service';
import { startMedicationCron, stopMedicationCron } from './services/medication-cron';
import { startSurveyCron, stopSurveyCron } from './services/survey-cron';
import { startSelfReminderCron, stopSelfReminderCron } from './services/self-reminder-cron';
import { startFollowupCron, stopFollowupCron } from './services/followup-cron';
import { startBoss, stopBoss } from './queue/boss';
import { registerQueueWorkers } from './queue/register-workers';
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

  // Warm-up FIRST, then start crons. Si arrancamos crons antes y un cron dispara
  // en los primeros 3-5s mientras Neon despierta, podría tirar timeout (error-detective).
  warmUp()
    .catch((err) => {
      logger.warn('Warm-up failed (server still healthy)', {
        event: 'warmup',
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      // Start crons after warm-up regardless of success
      startReminderCron();
      startMedicationCron();
      startSurveyCron();
      startSelfReminderCron();
      startFollowupCron();

      // ─── Bloque B (T7): cola pg-boss, SOLO bajo QUEUE_ENABLED ────────────────
      // Con el master kill switch en false (default/prod actual) NO se arranca
      // NADA de pg-boss: los crons de arriba siguen mandando in-process. Recién
      // con QUEUE_ENABLED=true arrancamos boss + registramos los workers de las
      // colas cuyo flag esté ON (por ahora solo followup) + dead-letter.
      if (config.QUEUE_ENABLED) {
        startBoss()
          .then((boss) => registerQueueWorkers(boss))
          .then(() => {
            logger.info('pg-boss + workers listos', { event: 'queue', action: 'ready' });
          })
          .catch((err) => {
            // No tumbamos el web service si la cola no arranca: los crons viejos
            // (o el flag exclusivo) siguen cubriendo. Logueamos para alerta.
            logger.error('pg-boss falló al arrancar (web service sigue arriba)', {
              event: 'queue',
              action: 'start_failed',
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
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
  stopFollowupCron();
  server.close(async () => {
    // Flush de eventos pendientes en Sentry antes de salir. Render manda SIGTERM
    // en cada deploy; sin esto un error capturado en el último instante se pierde.
    // Con DSN desactivado (dev/test) es no-op seguro.
    await Sentry.close(2000);
    // Bloque B (T14): drenar pg-boss ANTES de cerrar Prisma. `wait: true` espera
    // a que terminen los jobs en vuelo para no cortar un envío a mitad. Solo si
    // QUEUE_ENABLED (con el flag off, stopBoss sería no-op igual, pero evitamos
    // tocar la cola en el camino de prod actual).
    if (config.QUEUE_ENABLED) {
      try {
        await stopBoss({ wait: true });
      } catch (err) {
        logger.error('pg-boss falló al detenerse en el shutdown', {
          event: 'server_shutdown',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
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
