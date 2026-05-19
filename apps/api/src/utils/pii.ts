/**
 * PII masking helpers for production logs.
 *
 * Render persists logs and anyone with dashboard access can read them. For a
 * health system handling patient data, mask identifiers so logs remain useful
 * for correlation without leaking PII.
 */

export function maskId(id: string | null | undefined): string {
  if (!id) return '(no id)';
  // Threshold inclusive so IDs de exactamente 8 chars también se enmascaran
  // (UUIDs de 8 chars usados como prefijos son identificables, ver code-review).
  return id.length >= 8 ? `${id.slice(0, 8)}…` : id;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '(no phone)';
  // Si el phone es menor o igual a 7 chars, los últimos 4 son casi todo el número
  // → fallback a "***" total. Solo enmascaramos parcial cuando hay >= 8 dígitos.
  if (phone.length < 8) return '***';
  return `***${phone.slice(-4)}`;
}

export function firstName(fullName: string | null | undefined): string {
  if (!fullName) return '(no name)';
  // Split por cualquier whitespace (tab, NBSP, newline) y trim previo,
  // si no, " Juan Pérez" devuelve "" → "(no name)" en mensajes al paciente.
  const trimmed = fullName.trim();
  if (!trimmed) return '(no name)';
  return trimmed.split(/\s+/)[0] || '(no name)';
}
