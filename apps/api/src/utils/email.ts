/**
 * Normaliza un email para ALMACENAMIENTO y COMPARACIÓN: trim + lowercase.
 * Centralizado para que registro, login y alta por admin coincidan (el `@unique`
 * de Postgres es case-sensitive: sin esto, "Juan@IPS.com" y "juan@ips.com" serían
 * cuentas distintas y el login fallaría por mismatch de mayúsculas).
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
