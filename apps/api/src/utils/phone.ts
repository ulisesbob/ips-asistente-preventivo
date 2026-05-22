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

// ─── Normalización canónica para ALMACENAMIENTO (anti-duplicados) ─────────────
//
// El @unique de la DB sólo dedupa strings IDÉNTICOS. Para que el MISMO documento
// o número no se pueda guardar dos veces "bajo ninguna circunstancia" (bot, panel,
// CSV), toda vía de escritura debe normalizar a una ÚNICA forma canónica antes de
// buscar/guardar. Estas funciones son esa forma canónica.

/** DNI canónico: solo dígitos (saca puntos, espacios, cualquier separador). */
export function canonicalDni(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Teléfono canónico para guardar: E.164 con "+" y, para móviles AR, SIEMPRE con el
 * "9" (`+549...`). Así un número cargado como `+543764...` (panel) y el mismo
 * número que llega del bot como `+5493764...` colapsan al mismo string y el @unique
 * impide el duplicado. Limpia separadores comunes (espacios, guiones, paréntesis).
 */
export function canonicalPhone(raw: string): string {
  const cleaned = (raw ?? '').replace(/[^\d+]/g, '');
  return toE164WithPlus(cleaned);
}
