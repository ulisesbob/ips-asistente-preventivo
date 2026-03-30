// Must be imported first to validate env vars before anything else
import './config/env';

import { prisma } from '@ips/db';
import { config } from './config/env';
import { app } from './app';

// ─── Server Start ─────────────────────────────────────────────────────────────

const PORT = parseInt(config.PORT, 10);

const server = app.listen(PORT, () => {
  console.log(`[API] Servidor corriendo en puerto ${PORT} (${config.NODE_ENV})`);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`[API] ${signal} recibido — cerrando servidor...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log('[API] Servidor cerrado correctamente');
    process.exit(0);
  });

  // Force exit after 10 seconds if connections don't drain
  setTimeout(() => {
    console.error('[API] Forzando cierre después de timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
