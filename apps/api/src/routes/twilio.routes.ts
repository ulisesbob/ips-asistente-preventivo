import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { setAuditActor } from '@ips/db';
import { verifyTwilioSignature } from '../services/twilio.service';
import { handleIncomingMessage } from '../services/conversation.service';
import { maskPhone } from '../utils/pii';

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
 * Clasifica un POST del webhook de Twilio. Pura y exportada para testear.
 * - 'status'      → callback de estado (delivered/read/failed). NUNCA es un
 *                   mensaje entrante, aunque traiga NumMedia (callback de un
 *                   mensaje saliente con media). No se responde.
 * - 'ignore'      → sin MessageSid o sin From: no es un mensaje de usuario.
 * - 'text'        → mensaje entrante con texto.
 * - 'unsupported' → mensaje entrante SIN texto = audio/imagen/video/documento/
 *                   sticker/ubicación/vCard. Por descarte (no enumerando tipos),
 *                   para no quedar mudos ante un tipo nuevo.
 */
export type TwilioWebhookKind = 'status' | 'ignore' | 'text' | 'unsupported';

// Estados de ENTREGA de un mensaje SALIENTE (status callbacks). CLAVE: Twilio
// manda SmsStatus="received" en TODO mensaje ENTRANTE, así que NO se puede tratar
// la sola presencia de SmsStatus/MessageStatus como callback — hay que mirar el
// VALOR. "received" (o vacío) = mensaje entrante real.
const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered'];

export function classifyTwilioWebhook(
  params: Record<string, string | undefined>
): TwilioWebhookKind {
  const status = (params.MessageStatus ?? params.SmsStatus ?? '').toLowerCase();
  if (DELIVERY_STATUSES.includes(status)) return 'status';
  if (!params.MessageSid || !params.From) return 'ignore';
  if ((params.Body ?? '').trim()) return 'text';
  return 'unsupported';
}

/**
 * Twilio inbound WhatsApp webhook.
 * Receives form-urlencoded POST. Body fields: From, To, Body, MessageSid, ProfileName, WaId.
 * Spec: https://www.twilio.com/docs/messaging/guides/webhook-request
 */
twilioRouter.post('/webhooks/twilio', webhookLimiter, (req, res) => {
  // Reconstruct the URL Twilio called. With `app.set('trust proxy', 1)` in app.ts,
  // req.protocol and req.get('host') honor X-Forwarded-* from Render's proxy only
  // (not arbitrary client-supplied headers).
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const signature = (req.headers['x-twilio-signature'] as string) ?? '';
  const params = (req.body ?? {}) as Record<string, string>;

  if (!verifyTwilioSignature(fullUrl, params, signature)) {
    console.warn('[Twilio] Firma inválida en webhook');
    res.status(401).type('text/xml').send('<Response/>');
    return;
  }

  const messageSid = params.MessageSid ?? '';
  const from = params.From ?? '';
  const body = (params.Body ?? '').slice(0, MAX_MESSAGE_LENGTH);
  const profileName = (params.ProfileName ?? '').slice(0, 100).replace(/[<>"']/g, '');

  // Clasificar: status callback / ignorar / texto / contenido no soportado.
  const kind = classifyTwilioWebhook(params);
  const isUnsupported = kind === 'unsupported';

  // Dedup BEFORE responding (perf review CRITICAL): Twilio retries fast on 5xx.
  // If the check ran inside the async IIFE, two webhooks racing in <50ms both
  // passed and the message got processed twice. Solo dedupeamos mensajes reales.
  const isDuplicate = !!messageSid && processedSids.has(messageSid);
  if (messageSid && !isDuplicate && kind !== 'status') processedSids.add(messageSid);

  // TwiML empty response — we reply asynchronously via the REST API.
  res.status(200).type('text/xml').send('<Response/>');

  if (isDuplicate) {
    console.log(`[Twilio] Duplicate message ${messageSid} — skipping`);
    return;
  }

  // Solo procesamos mensajes ENTRANTES de usuario (texto o contenido no soportado).
  // Los status callbacks (delivery/read) — incluso de un mensaje saliente CON
  // media — y los eventos sin SID/remitente se ignoran. Antes un callback con
  // NumMedia disparaba por error la guía "solo texto" (review).
  if (kind === 'status' || kind === 'ignore') {
    return;
  }

  // Strip "whatsapp:" prefix and leading + — handleIncomingMessage expects raw E.164 digits.
  const phone = from.replace(/^whatsapp:/, '').replace(/^\+/, '');

  (async () => {
    try {
      // Atribuimos las escrituras de este mensaje al BOT (no SYSTEM): registro,
      // recordatorios, autoinscripción a programa, etc. quedan trazados como
      // originados por el webhook de WhatsApp en el audit log (ley 25.326 art. 9).
      setAuditActor({ actorType: 'BOT', actorId: null });
      await handleIncomingMessage(phone, body, profileName, isUnsupported);
    } catch (error) {
      // Mask phone — production logs in Render are accessible to whoever has the dashboard.
      console.error(`[Twilio] Error procesando mensaje de ${maskPhone(phone)}:`, error);
    }
  })().catch((error) => {
    console.error('[Twilio] Error inesperado procesando mensaje:', error);
  });
});

export { twilioRouter };
