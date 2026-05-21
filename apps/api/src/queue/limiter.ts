import Bottleneck from 'bottleneck';
import { config } from '../config/env';

/**
 * Rate-limiter de envío (Bottleneck) — Bloque B.
 *
 * INERTE hasta que el worker (T6/T7) lo use: construir el limiter no envía nada.
 *
 * Estrategia:
 * - `reservoir = SEND_RATE_PER_SEC` (default 40), repuesto a tope cada 1000ms.
 *   Esto da un techo de N envíos por segundo, por debajo del tier de Twilio.
 * - `maxConcurrent = SEND_MAX_CONCURRENT` (default 20): cuántas requests Twilio
 *   simultáneas tolera el proceso sin saturar el event loop / sockets.
 *
 * Todo el envío real pasa por `limiter.schedule(() => sendTextMessage(...))`.
 */
export const limiter = new Bottleneck({
  reservoir: config.SEND_RATE_PER_SEC,
  reservoirRefreshAmount: config.SEND_RATE_PER_SEC,
  reservoirRefreshInterval: 1000,
  maxConcurrent: config.SEND_MAX_CONCURRENT,
});
