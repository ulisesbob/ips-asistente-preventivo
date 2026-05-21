import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Harness 40k — MOCK_TWILIO ─────────────────────────────────────────────────
// Para el test de carga: con MOCK_TWILIO=true, sendTextMessage NO toca ningún
// provider (ni Twilio ni Meta) y devuelve true. Así el harness ejercita la cola +
// el limiter + la idempotencia a 40k sin mandar mensajes reales (ni costo Twilio).

const mockMetaSend = vi.fn();
const mockTwilioSend = vi.fn();
const mockConfig: { MESSAGING_PROVIDER: 'meta' | 'twilio'; MOCK_TWILIO: boolean } = {
  MESSAGING_PROVIDER: 'twilio',
  MOCK_TWILIO: false,
};

vi.mock('../config/env', () => ({ config: mockConfig }));
vi.mock('../services/whatsapp.service', () => ({ sendTextMessage: mockMetaSend }));
vi.mock('../services/twilio.service', () => ({ sendTwilioTextMessage: mockTwilioSend }));

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.MESSAGING_PROVIDER = 'twilio';
  mockConfig.MOCK_TWILIO = false;
  mockMetaSend.mockResolvedValue(true);
  mockTwilioSend.mockResolvedValue(true);
});

describe('sendTextMessage — MOCK_TWILIO', () => {
  it('MOCK_TWILIO=true: devuelve true SIN llamar a ningún provider', async () => {
    mockConfig.MOCK_TWILIO = true;
    const { sendTextMessage } = await import('../services/messaging.service');

    const ok = await sendTextMessage('5493764000001', 'hola');

    expect(ok).toBe(true);
    expect(mockTwilioSend).not.toHaveBeenCalled();
    expect(mockMetaSend).not.toHaveBeenCalled();
  });

  it('MOCK_TWILIO=true: tampoco manda por Meta aunque el provider sea meta', async () => {
    mockConfig.MESSAGING_PROVIDER = 'meta';
    mockConfig.MOCK_TWILIO = true;
    const { sendTextMessage } = await import('../services/messaging.service');

    const ok = await sendTextMessage('5493764000001', 'hola');

    expect(ok).toBe(true);
    expect(mockMetaSend).not.toHaveBeenCalled();
    expect(mockTwilioSend).not.toHaveBeenCalled();
  });

  it('MOCK_TWILIO=false (default): rutea normal por Twilio', async () => {
    const { sendTextMessage } = await import('../services/messaging.service');

    await sendTextMessage('5493764000001', 'hola');

    expect(mockTwilioSend).toHaveBeenCalledTimes(1);
    expect(mockMetaSend).not.toHaveBeenCalled();
  });

  it('MOCK_TWILIO=false + provider=meta: rutea por Meta', async () => {
    mockConfig.MESSAGING_PROVIDER = 'meta';
    const { sendTextMessage } = await import('../services/messaging.service');

    await sendTextMessage('5493764000001', 'hola');

    expect(mockMetaSend).toHaveBeenCalledTimes(1);
    expect(mockTwilioSend).not.toHaveBeenCalled();
  });
});
