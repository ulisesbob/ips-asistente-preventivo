import crypto from 'crypto';
import { config } from '../config/env';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * Send a text message via Twilio WhatsApp.
 * @param toE164WithPlus — phone in E.164 with + (e.g. +5493764125878)
 */
export async function sendTwilioTextMessage(
  toE164WithPlus: string,
  text: string
): Promise<boolean> {
  const sid = config.TWILIO_ACCOUNT_SID;
  const token = config.TWILIO_AUTH_TOKEN;
  const from = config.TWILIO_WHATSAPP_FROM;

  if (!sid || !token || !from) {
    console.error('[Twilio] Faltan TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_WHATSAPP_FROM');
    return false;
  }

  const url = `${TWILIO_API_BASE}/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:${toE164WithPlus}`,
    Body: text,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `[Twilio] Error enviando mensaje a ${toE164WithPlus}: ${response.status} — ${errorBody}`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Twilio] Error de red enviando mensaje:', error);
    return false;
  }
}

/**
 * Verify Twilio inbound webhook signature.
 * Spec: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * Signature = HMAC-SHA1(authToken, url + sortedParamsConcatenated) base64.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  const authToken = config.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    if (config.NODE_ENV === 'production') {
      console.error('[SECURITY] TWILIO_AUTH_TOKEN no configurado en producción — rechazando');
      return false;
    }
    console.warn('[SECURITY] TWILIO_AUTH_TOKEN no configurado — verificación deshabilitada (dev)');
    return true;
  }

  if (!signature) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = crypto.createHmac('sha1', authToken).update(data).digest('base64');

  // Decode both signatures from base64 BEFORE comparing — string-level Buffer.from()
  // uses utf-8 by default which compares characters instead of the actual HMAC bytes.
  let sigBuf: Buffer;
  let expBuf: Buffer;
  try {
    sigBuf = Buffer.from(signature, 'base64');
    expBuf = Buffer.from(expected, 'base64');
  } catch {
    return false;
  }

  if (sigBuf.length !== expBuf.length) return false;
  try {
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
