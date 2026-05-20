import { z } from 'zod';

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerida'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().url('FRONTEND_URL debe ser una URL válida'),

  // JWT expiration
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Cifrado en reposo de campos sensibles (prisma-field-encryption).
  // Formato @47ng/cloak: "k1.aesgcm256.<base64>". Generar con `npx cloak generate`.
  // CRÍTICO: si se pierde esta clave, los datos cifrados son irrecuperables.
  // La de producción DEBE ser distinta a la de dev/test y vivir solo en el secret store.
  PRISMA_FIELD_ENCRYPTION_KEY: z
    .string()
    .min(1, 'PRISMA_FIELD_ENCRYPTION_KEY es requerida (npx cloak generate)')
    .regex(/^k1\.aesgcm256\./, 'PRISMA_FIELD_ENCRYPTION_KEY debe tener formato k1.aesgcm256.<base64>'),

  // Optional — Messaging provider switch (default: meta)
  MESSAGING_PROVIDER: z.enum(['meta', 'twilio']).default('meta'),

  // Optional — WhatsApp (Meta Cloud API)
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  // Optional — WhatsApp via Twilio (alternative to Meta)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  // Optional — AI (Anthropic)
  ANTHROPIC_API_KEY: z.string().optional(),
  // Override del modelo (para pinear un snapshot con datestamp sin tocar código).
  ANTHROPIC_MODEL: z.string().optional(),
  ANTHROPIC_FALLBACK_MODEL: z.string().optional(),

  // Optional — Cron
  REMINDER_CRON: z.string().optional(),

  // Optional — Observabilidad (Sentry). Sin DSN, Sentry queda desactivado.
  SENTRY_DSN: z.string().optional(),

  // IPS contacto — default al 0800 oficial. Override por env para reutilizar
  // el código en otras provincias / otros clientes sin tocar texto hardcoded.
  IPS_SUPPORT_PHONE: z.string().default('0800-888-0109'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.format();
  console.error('Variables de entorno inválidas:');
  console.error(JSON.stringify(formatted, null, 2));
  process.exit(1);
}

export const config = parsed.data;

export type Config = typeof config;
