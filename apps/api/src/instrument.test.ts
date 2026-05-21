import { describe, it, expect } from 'vitest';
import { scrubPii } from './instrument';

// Estos tests blindan el filtro de PII que va a Sentry. Datos de salud (ley
// 25.326): si esto se rompe, podríamos filtrar DNI / teléfono / texto del
// paciente a un tercero. Por eso son asserts explícitos sobre cada campo.
describe('scrubPii — filtro de PII antes de Sentry (ley 25.326)', () => {
  it('borra body, cookies y headers sensibles del request', () => {
    const out = scrubPii({
      request: {
        data: { dni: '20123456', mensaje: 'me duele el pecho' },
        cookies: { session: 'abc' },
        headers: {
          authorization: 'Bearer secreto',
          cookie: 'session=abc',
          'x-twilio-signature': 'firma-twilio',
          'content-type': 'application/json',
        },
        query_string: 'dni=20123456&telefono=3764000000',
      },
    } as Parameters<typeof scrubPii>[0]);

    const req = out.request!;
    expect(req.data).toBeUndefined();
    expect(req.cookies).toBeUndefined();
    expect((req.headers as Record<string, string>).authorization).toBeUndefined();
    expect((req.headers as Record<string, string>).cookie).toBeUndefined();
    expect((req.headers as Record<string, string>)['x-twilio-signature']).toBeUndefined();
    // Headers no sensibles se conservan (sirven para debug, no son PII).
    expect((req.headers as Record<string, string>)['content-type']).toBe('application/json');
    // La query puede traer DNI/teléfono: se ofusca entera.
    expect(req.query_string).toBe('[scrubbed]');
  });

  it('elimina el objeto user (IP, id, username)', () => {
    const out = scrubPii({
      user: { id: '42', ip_address: '1.2.3.4', username: 'paciente' },
    } as Parameters<typeof scrubPii>[0]);
    expect(out.user).toBeUndefined();
  });

  it('no rompe con un evento sin request ni user', () => {
    expect(() => scrubPii({ message: 'algo' } as Parameters<typeof scrubPii>[0])).not.toThrow();
    const out = scrubPii({ message: 'sin pii' } as Parameters<typeof scrubPii>[0]);
    expect(out.message).toBe('sin pii');
  });
});
