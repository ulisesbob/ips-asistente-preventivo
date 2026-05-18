import { config } from '../config/env';
import { sendTextMessage as sendMetaTextMessage } from './whatsapp.service';
import { sendTwilioTextMessage } from './twilio.service';

/**
 * Provider-agnostic text sender. Routes to Meta Cloud API or Twilio
 * based on MESSAGING_PROVIDER env var (default: 'meta').
 *
 * Existing call sites pass phones in Meta-normalized form (no +, no leading 9
 * for Argentina mobile). This wrapper re-normalizes to E.164 with + for Twilio.
 */
export async function sendTextMessage(phone: string, text: string): Promise<boolean> {
  if (config.MESSAGING_PROVIDER === 'twilio') {
    return sendTwilioTextMessage(toE164WithPlus(phone), text);
  }
  return sendMetaTextMessage(phone, text);
}

/**
 * Normalize any Argentine phone format to E.164 with + (and the mobile "9").
 *   "5413764125878"  → "+5493764125878"  (Meta-stripped form restored)
 *   "5493764125878"  → "+5493764125878"
 *   "+5493764125878" → "+5493764125878"
 */
function toE164WithPlus(phone: string): string {
  let p = phone.startsWith('+') ? phone.slice(1) : phone;
  // Argentina mobile: Meta strips the leading 9 (so 54 + 10 digits = 12 total).
  // Twilio uses the full WhatsApp ID with the 9, so re-add it.
  if (p.startsWith('54') && !p.startsWith('549') && p.length === 12) {
    p = '549' + p.slice(2);
  }
  return '+' + p;
}
