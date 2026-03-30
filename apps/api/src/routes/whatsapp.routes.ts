import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/env';
import { asyncHandler } from '../middleware/error-handler';
import {
  parseWebhookPayload,
  verifyWebhookSignature,
} from '../services/whatsapp.service';
import { handleIncomingMessage } from '../services/conversation.service';

const whatsappRouter = Router();

// ─── Rate limiter for webhook ────────────────────────────────────────────────

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => 'whatsapp-webhook', // single bucket for all Meta IPs
});

// ─── Timing-safe token comparison ────────────────────────────────────────────

function safeTokenCompare(a: string, b: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false; // length mismatch
  }
}

// ─── GET /api/webhooks/whatsapp — Meta Webhook Verification ──────────────────

whatsappRouter.get(
  '/webhooks/whatsapp',
  asyncHandler(async (req, res) => {
    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    const verifyToken = config.WHATSAPP_VERIFY_TOKEN ?? '';

    if (mode === 'subscribe' && token && safeTokenCompare(token, verifyToken)) {
      console.log('[WhatsApp] Webhook verificado exitosamente');
      res.status(200).send(challenge);
      return;
    }

    console.warn('[WhatsApp] Verificación fallida — token inválido');
    res.status(403).json({ status: 'error', message: 'Token de verificación inválido' });
  })
);

// ─── POST /api/webhooks/whatsapp — Receive Messages ──────────────────────────
// Meta requires 200 response within 5 seconds. Process messages asynchronously.

const MAX_MESSAGES_PER_WEBHOOK = 10;

whatsappRouter.post(
  '/webhooks/whatsapp',
  webhookLimiter,
  (req, res) => {
    // Raw body is required for HMAC verification
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody) {
      res.status(400).json({ status: 'error', message: 'Cuerpo de solicitud inválido' });
      return;
    }

    // Verify HMAC-SHA256 signature
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!verifyWebhookSignature(rawBody, signature ?? '')) {
      console.warn('[WhatsApp] Firma inválida en webhook');
      res.status(401).json({ status: 'error', message: 'Firma inválida' });
      return;
    }

    // Respond 200 immediately — Meta requirement (must be < 5 seconds)
    res.status(200).json({ status: 'ok' });

    // Process messages asynchronously — fire and forget (errors logged, not thrown)
    const messages = parseWebhookPayload(req.body).slice(0, MAX_MESSAGES_PER_WEBHOOK);

    if (messages.length > 0) {
      // Process sequentially per message to preserve order for stateful flows (registration)
      (async () => {
        for (const msg of messages) {
          try {
            await handleIncomingMessage(msg.from, msg.text, msg.displayName);
          } catch (error) {
            console.error(`[WhatsApp] Error procesando mensaje de ${msg.from}:`, error);
          }
        }
      })().catch((error) => {
        console.error('[WhatsApp] Error inesperado procesando mensajes:', error);
      });
    }
  }
);

export { whatsappRouter };
