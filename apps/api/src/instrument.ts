/**
 * Inicialización de Sentry. DEBE importarse ANTES que express/app para que la
 * auto-instrumentación enganche (por eso es el primer import de index.ts).
 *
 * Si no hay SENTRY_DSN, Sentry queda desactivado (dev/test no envían nada).
 */
import * as Sentry from '@sentry/node';
import { config } from './config/env';

/**
 * Scrub defensivo de PII antes de mandar nada a Sentry. CRÍTICO por ley 25.326
 * (datos de salud): body, cookies, headers y query pueden traer DNI, teléfono,
 * texto del paciente o tokens. Nada de eso debe salir hacia Sentry.
 *
 * Pura y exportada a propósito para poder testearla (ver instrument.test.ts).
 */
export function scrubPii<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    const headers = event.request.headers;
    if (headers) {
      delete headers['authorization'];
      delete headers['cookie'];
      delete headers['x-twilio-signature'];
    }
    if (event.request.query_string) {
      event.request.query_string = '[scrubbed]';
    }
  }
  delete event.user;
  return event;
}

if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    release: process.env.RENDER_GIT_COMMIT,
    // Performance sampling: 10% en prod, nada en dev.
    tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 0,
    // CRÍTICO (datos de salud, ley 25.326): nunca enviar PII por defecto.
    sendDefaultPii: false,
    beforeSend: scrubPii,
  });
}

export { Sentry };
