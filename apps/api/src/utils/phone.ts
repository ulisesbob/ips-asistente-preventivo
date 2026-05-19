/**
 * Normalización centralizada de teléfonos argentinos para mensajería.
 *
 * Quirk de Argentina: WhatsApp envía móviles como 549XXXXXXXXXX (con 9),
 * pero Meta Cloud API requiere 54XXXXXXXXXX (sin 9) para enviar. Twilio
 * en cambio usa el formato completo con el 9 ("whatsapp:+5491XXX").
 *
 * LESSONS #40 — antes había 6 copias inline de esta lógica en diferentes
 * services. Cualquier cambio (ej. soporte a otro país) requería tocar 6
 * archivos. Ahora viven acá.
 */

/**
 * Formato Meta Cloud API: sin "+", sin el "9" para móviles AR.
 *   "+5493764125878"  → "543764125878"
 *   "5493764125878"   → "543764125878"
 *   "543764125878"    → "543764125878"  (ya stripeado)
 *   "+5491123456789"  → "5411123456789" (CABA mobile)
 */
export function toMetaSendablePhone(phone: string): string {
  let p = phone.startsWith('+') ? phone.slice(1) : phone;
  // Argentina mobile: 549 + 10 dígitos = 13 chars → 54 + 10 dígitos = 12 chars.
  if (p.startsWith('549') && p.length === 13) {
    p = '54' + p.slice(3);
  }
  return p;
}

/**
 * Formato E.164 con "+" (Twilio, display general).
 *   "5413764125878"   → "+5493764125878"  (Meta-stripped restaurado)
 *   "5493764125878"   → "+5493764125878"
 *   "+5493764125878"  → "+5493764125878"
 */
export function toE164WithPlus(phone: string): string {
  let p = phone.startsWith('+') ? phone.slice(1) : phone;
  // Si vino en formato Meta-stripped (54 + 10 dígitos = 12 chars), re-agregar el 9.
  if (p.startsWith('54') && !p.startsWith('549') && p.length === 12) {
    p = '549' + p.slice(2);
  }
  return '+' + p;
}
