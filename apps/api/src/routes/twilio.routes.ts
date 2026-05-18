import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyTwilioSignature } from '../services/twilio.service';
import { handleIncomingMessage } from '../services/conversation.service';

const twilioRouter = Router();

// Deduplicate Twilio inbound messages by MessageSid (Twilio retries on 5xx).
const processedSids = new Set<string>();
const MAX_CACHE_SIZE = 5000;

setInterval(() => {
  if (processedSids.size > MAX_CACHE_SIZE) {
    const entries = [...processedSids];
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE / 2);
    for (const id of toRemove) processedSids.delete(id);
    console.log(`[Twilio] Dedup cache cleaned: ${toRemove.length} entries removed`);
  }
}, 10 * 60 * 1000);

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => 'twilio-webhook',
});

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Twilio inbound WhatsApp webhook.
 * Receives form-urlencoded POST. Body fields: From, To, Body, MessageSid, ProfileName, WaId.
 * Spec: https://www.twilio.com/docs/messaging/guides/webhook-request
 */
twilioRouter.post('/webhooks/twilio', webhookLimiter, (req, res) => {
  // Reconstruct the URL Twilio actually called (Render is behind a proxy).
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol;
  const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host;
  const fullUrl = `${proto}://${host}${req.originalUrl}`;

  const signature = (req.headers['x-twilio-signature'] as string) ?? '';
  const params = (req.body ?? {}) as Record<string, string>;

  if (!verifyTwilioSignature(fullUrl, params, signature)) {
    console.warn('[Twilio] Firma inválida en webhook');
    res.status(401).type('text/xml').send('<Response/>');
    return;
  }

  // TwiML empty response — we reply asynchronously via the REST API.
  res.status(200).type('text/xml').send('<Response/>');

  const messageSid = params.MessageSid ?? '';
  const from = params.From ?? '';
  const body = (params.Body ?? '').slice(0, MAX_MESSAGE_LENGTH);
  const profileName = (params.ProfileName ?? '').slice(0, 100).replace(/[<>"']/g, '');

  if (!messageSid || !from || !body) {
    return;
  }

  // Strip "whatsapp:" prefix and leading + — handleIncomingMessage expects raw E.164 digits.
  const phone = from.replace(/^whatsapp:/, '').replace(/^\+/, '');

  (async () => {
    try {
      if (processedSids.has(messageSid)) {
        console.log(`[Twilio] Duplicate message ${messageSid} — skipping`);
        return;
      }
      processedSids.add(messageSid);

      await handleIncomingMessage(phone, body, profileName);
    } catch (error) {
      console.error(`[Twilio] Error procesando mensaje de ${phone}:`, error);
    }
  })().catch((error) => {
    console.error('[Twilio] Error inesperado procesando mensaje:', error);
  });
});

export { twilioRouter };
