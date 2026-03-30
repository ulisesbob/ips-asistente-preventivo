// Must be imported first to validate env vars before anything else
import './config/env';

import { prisma } from '@ips/db';
import { config } from './config/env';
import { app } from './app';
import { startReminderCron, stopReminderCron } from './services/reminder.service';
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

  // Start reminder cron after server is ready
  startReminderCron();
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Shutdown signal received: ${signal}`, { event: 'server_shutdown', signal });
  await stopReminderCron();
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
