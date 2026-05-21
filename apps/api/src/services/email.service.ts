import { config } from '../config/env';
import { ServiceUnavailableError } from '../utils/errors';

// ─── Email de verificación de auto-registro ──────────────────────────────────
//
// Envía por Resend (https://resend.com) vía su API REST — sin SDK ni dependencia
// nueva, sólo fetch. Estrategia por entorno:
//   - Con RESEND_API_KEY: manda el mail de verdad.
//   - Sin key en dev/test: loguea el link por consola (no manda nada) para poder
//     desarrollar/testear sin proveedor.
//   - Sin key en producción: ERROR — no se puede dar de alta sin poder verificar.

interface VerificationEmailParams {
  to: string;
  /** Nombre del médico, para personalizar el saludo. */
  fullName: string;
  /** URL absoluta de verificación (ya incluye el token plano). */
  verifyUrl: string;
}

function buildHtml({ fullName, verifyUrl }: VerificationEmailParams): string {
  return `
  <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
    <h2>Verificá tu email</h2>
    <p>Hola ${escapeHtml(fullName)}, recibimos tu solicitud de acceso al panel del
    Asistente Preventivo de IPS.</p>
    <p>Confirmá que este correo es tuyo para activar tu cuenta:</p>
    <p style="margin: 24px 0;">
      <a href="${escapeHtml(verifyUrl)}" style="background:#0d6efd;color:#fff;padding:12px 20px;
      border-radius:6px;text-decoration:none;display:inline-block;">Verificar mi email</a>
    </p>
    <p style="color:#666;font-size:13px;">El link vence en 24 horas. Si no fuiste vos,
    ignorá este mensaje.</p>
  </div>`;
}

// Escapa los datos provistos por el usuario antes de meterlos en el HTML del mail
// (anti-inyección de markup en el cuerpo).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendVerificationEmail(params: VerificationEmailParams): Promise<void> {
  // Defensa local: no confiar sólo en el caller. El destinatario debe ser UN único
  // email ASCII bien formado (evita inyección de múltiples destinatarios / headers).
  if (typeof params.to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.to)) {
    throw new ServiceUnavailableError('Destinatario de email inválido.');
  }

  if (!config.RESEND_API_KEY) {
    if (config.NODE_ENV === 'production') {
      // Fail-closed: en prod no podemos verificar emails sin proveedor configurado.
      throw new ServiceUnavailableError(
        'El envío de mails no está configurado (falta RESEND_API_KEY).'
      );
    }
    // Dev/test: dejamos el link a mano para poder verificar manualmente.
    // eslint-disable-next-line no-console
    console.log(`[email:dev] Verificación para ${params.to} → ${params.verifyUrl}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.EMAIL_FROM,
      to: params.to,
      subject: 'Verificá tu email — IPS Asistente Preventivo',
      html: buildHtml(params),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // El detalle del proveedor puede traer info sensible de la cuenta/credenciales:
    // se loguea SÓLO server-side. Al cliente, mensaje fijo y genérico.
    // eslint-disable-next-line no-console
    console.error(`[email] Resend falló (${res.status}): ${detail}`);
    throw new ServiceUnavailableError(
      'No pudimos enviar el mail de verificación. Probá de nuevo en unos minutos.'
    );
  }
}
