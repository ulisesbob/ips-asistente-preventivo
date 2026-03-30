/**
 * Structured JSON logger — zero external dependencies.
 * Outputs one JSON line per log for Railway log aggregation.
 *
 * Design decisions:
 * - No Winston/Pino/Bunyan — console methods are sufficient for Railway's log drain
 * - Every line is a parseable JSON object for future log queries
 * - Typed event categories (http, cron, whatsapp, ai) for filtering in Railway logs
 * - Debug logs suppressed in production to reduce noise and cost
 * - Child loggers carry context (requestId, patientId) without repeated arguments
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  event?: string;
  [key: string]: unknown;
}

const SERVICE = 'ips-api';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    ...context,
    timestamp: new Date().toISOString(),
    level,
    message,
    service: SERVICE,
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'debug':
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),

  /**
   * Log an HTTP request after response is sent.
   * Called by the request logging middleware.
   */
  http(meta: {
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    contentLength?: number;
  }) {
    const level: LogLevel = meta.statusCode >= 500 ? 'error'
      : meta.statusCode >= 400 ? 'warn'
      : 'info';

    log(level, `${meta.method} ${meta.path} ${meta.statusCode} ${meta.durationMs}ms`, {
      event: 'http_request',
      ...meta,
    });
  },

  /**
   * Log a cron job run result. Includes sent/failed counts and duration
   * for tracking reminder delivery reliability over time.
   */
  cron(action: string, meta?: Record<string, unknown>) {
    log('info', `cron:${action}`, {
      event: 'cron',
      action,
      ...meta,
    });
  },

  /**
   * Log a cron run completion with standard metrics.
   * Separated for easy querying: filter by event=cron_result in Railway.
   */
  cronResult(sent: number, failed: number, durationMs: number) {
    const level: LogLevel = failed > 0 ? 'warn' : 'info';
    log(level, `Cron completed: ${sent} sent, ${failed} failed in ${durationMs}ms`, {
      event: 'cron_result',
      sent,
      failed,
      total: sent + failed,
      durationMs,
      successRate: sent + failed > 0 ? Number(((sent / (sent + failed)) * 100).toFixed(1)) : 100,
      runDate: new Date().toISOString().slice(0, 10),
    });
  },

  /**
   * Log WhatsApp events: incoming messages, outbound sends, webhook verification.
   */
  whatsapp(action: string, meta?: Record<string, unknown>) {
    log('info', `whatsapp:${action}`, {
      event: 'whatsapp',
      action,
      ...meta,
    });
  },

  /**
   * Log AI (Claude Haiku) interactions with token usage and latency.
   */
  ai(action: string, meta?: Record<string, unknown>) {
    log('info', `ai:${action}`, {
      event: 'ai',
      action,
      ...meta,
    });
  },

  /**
   * Create a child logger that carries preset fields in every log entry.
   * Useful for request-scoped logging (requestId) or patient context.
   *
   * Usage:
   *   const reqLog = logger.child({ requestId: 'abc-123' });
   *   reqLog.info('Processing webhook');
   *   // => {"requestId":"abc-123","message":"Processing webhook",...}
   */
  child(defaults: Record<string, unknown>) {
    return {
      debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, { ...defaults, ...ctx }),
      info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, { ...defaults, ...ctx }),
      warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, { ...defaults, ...ctx }),
      error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, { ...defaults, ...ctx }),
    };
  },
};
