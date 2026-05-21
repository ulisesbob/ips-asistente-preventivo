import { config } from '../config/env';
import { sendTextMessage as sendMetaTextMessage } from './whatsapp.service';
import { sendTwilioTextMessage } from './twilio.service';
import { toE164WithPlus } from '../utils/phone';

/**
 * Provider-agnostic text sender. Routes to Meta Cloud API or Twilio
 * based on MESSAGING_PROVIDER env var (default: 'meta').
 *
 * Existing call sites pass phones in Meta-normalized form (no +, no leading 9
 * for Argentina mobile). El wrapper re-normaliza a E.164 con "+" para Twilio.
 */
export async function sendTextMessage(phone: string, text: string): Promise<boolean> {
  // Test de carga (Bloque B): cortocircuito ANTES de rutear a cualquier provider.
  // Devuelve true sin mandar nada — el harness de 40k ejercita cola + limiter +
  // idempotencia sin envíos reales ni costo Twilio. Inerte en prod (default false).
  if (config.MOCK_TWILIO) {
    return true;
  }
  if (config.MESSAGING_PROVIDER === 'twilio') {
    return sendTwilioTextMessage(toE164WithPlus(phone), text);
  }
  return sendMetaTextMessage(phone, text);
}
