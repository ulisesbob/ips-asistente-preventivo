import crypto from 'crypto';
import { config } from '../config/env';

// ─── Meta Cloud API Constants ─────────────────────────────────────────────────

const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IncomingMessage {
  from: string;          // Sender phone number (E.164 without +)
  text: string;          // Message body
  messageId: string;     // Meta message ID
  displayName: string;   // WhatsApp profile name
  timestamp: string;
}

interface WebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile: { name: string };
        wa_id: string;
      }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        type: string;
        text?: { body: string };
      }>;
      statuses?: Array<unknown>;
    };
    field: string;
  }>;
}

interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

// ─── Parse Webhook Payload ────────────────────────────────────────────────────

export function parseWebhookPayload(body: WebhookPayload): IncomingMessage[] {
  const messages: IncomingMessage[] = [];

  if (body.object !== 'whatsapp_business_account') return messages;

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      if (!value.messages) continue;

      const contacts = value.contacts ?? [];

      for (const msg of value.messages) {
        // Only process text messages for now
        if (msg.type !== 'text' || !msg.text?.body) continue;

        const contact = contacts.find((c) => c.wa_id === msg.from);

        messages.push({
          from: msg.from,
          text: msg.text.body.slice(0, 2000), // Cap message length
          messageId: msg.id,
          displayName: (contact?.profile?.name ?? '').slice(0, 100).replace(/[<>"']/g, ''),
          timestamp: msg.timestamp,
        });
      }
    }
  }

  return messages;
}

// ─── Send Text Message ────────────────────────────────────────────────────────

export async function sendTextMessage(to: string, text: string): Promise<boolean> {
  const token = config.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error('[WhatsApp] WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurado');
    return false;
  }

  const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[WhatsApp] Error enviando mensaje a ${to}: ${response.status} — ${errorBody}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[WhatsApp] Error de red enviando mensaje:', error);
    return false;
  }
}

// ─── Verify Webhook Signature (HMAC-SHA256) ──────────────────────────────────

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
  const appSecret = config.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    if (config.NODE_ENV === 'production') {
      console.error('[SECURITY] WHATSAPP_APP_SECRET no configurado en producción — rechazando');
      return false;
    }
    console.warn('[SECURITY] WHATSAPP_APP_SECRET no configurado — verificación deshabilitada (dev)');
    return true;
  }

  if (!signatureHeader) return false;

  // Header format: sha256=<hex>
  const parts = signatureHeader.split('=');
  if (parts[0] !== 'sha256' || !parts[1]) return false;
  const signature = parts[1];

  // Validate hex format — HMAC-SHA256 always produces exactly 64 hex chars (32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;

  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  // Both buffers are guaranteed to be 32 bytes due to the regex check above
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}
