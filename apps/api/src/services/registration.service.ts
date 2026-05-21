import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { prisma, Role, Prisma } from '@ips/db';
import { config } from '../config/env';
import { ValidationError, ServiceUnavailableError } from '../utils/errors';
import { normalizeEmail } from '../utils/email';
import { sendVerificationEmail } from './email.service';

// ─── Auto-registro de médicos ────────────────────────────────────────────────
//
// El médico se da de alta solo. Controles de seguridad (sistema de salud, ley
// 25.326): (1) el email DEBE ser de un dominio institucional habilitado; (2) se
// verifica que el email sea realmente suyo vía link; (3) hasta verificar NO puede
// loguear (ver auth.service.login); (4) el rol siempre es DOCTOR (nunca ADMIN).

const SALT_ROUNDS = 10;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const TOKEN_BYTES = 32; // ~43 chars base64url

// Respuesta SIEMPRE genérica: no revela si el email ya existía (anti-enumeración).
const GENERIC_OK = {
  message:
    'Si el email pertenece a IPS y no estaba registrado, te enviamos un link de verificación. Revisá tu casilla.',
} as const;

// Formato de email ASCII, un solo @, sin whitespace (\s cubre \n/\r/tab → bloquea
// CRLF injection). El check ASCII aparte bloquea homoglyphs unicode.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASCII_PRINTABLE_RE = /^[\x21-\x7e]+$/;

export interface RegisterDoctorInput {
  fullName: string;
  licenseNumber: string;
  email: string;
  password: string;
}

export interface RegisterResult {
  message: string;
}

// ─── Helpers puros (testeables sin DB ni env) ────────────────────────────────

export function parseAllowedDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * ¿El email pertenece a uno de los dominios habilitados? Match EXACTO del dominio
 * (sin wildcard ni `endsWith`), tras validar formato. Fail-closed: si la lista
 * está vacía, rechaza todo.
 */
export function isInstitutionalEmail(rawEmail: string, allowedDomains: string[]): boolean {
  if (typeof rawEmail !== 'string') return false;
  if (allowedDomains.length === 0) return false; // fail-closed
  const email = rawEmail.trim();
  if (!ASCII_PRINTABLE_RE.test(email)) return false; // anti homoglyph / control chars
  if (!EMAIL_RE.test(email)) return false; // un solo @, sin whitespace
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return allowedDomains.map((d) => d.toLowerCase()).includes(domain);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── registerDoctor ──────────────────────────────────────────────────────────

export async function registerDoctor(input: RegisterDoctorInput): Promise<RegisterResult> {
  const allowed = parseAllowedDomains(config.ALLOWED_DOCTOR_EMAIL_DOMAINS);
  if (!isInstitutionalEmail(input.email, allowed)) {
    throw new ValidationError(
      'El email debe pertenecer a un dominio institucional de IPS habilitado.'
    );
  }
  if (typeof input.password !== 'string' || input.password.length < 8) {
    throw new ValidationError('La contraseña debe tener al menos 8 caracteres');
  }
  const fullName = (input.fullName ?? '').trim();
  if (fullName.length < 2) {
    throw new ValidationError('El nombre completo es requerido');
  }
  const licenseNumber = (input.licenseNumber ?? '').trim();
  if (licenseNumber.length < 2) {
    throw new ValidationError('La matrícula profesional es requerida');
  }

  const email = normalizeEmail(input.email);
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  // Token plano → al mail. Hash → a la DB. Nunca guardamos el plano.
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const verificationCodeHash = hashToken(token);
  const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  const existing = await prisma.doctor.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true },
  });

  // Ya hay una cuenta verificada: respuesta genérica, no tocamos nada ni revelamos.
  if (existing?.emailVerifiedAt) {
    return GENERIC_OK;
  }

  let doctorId: string;
  let createdNow = false;

  if (existing) {
    // Existe pero sin verificar: regeneramos el token (invalida el anterior),
    // refrescamos los datos y reenviamos el mail.
    await prisma.doctor.update({
      where: { id: existing.id },
      data: { fullName, licenseNumber, passwordHash, verificationCodeHash, verificationExpiresAt },
    });
    doctorId = existing.id;
  } else {
    try {
      const created = await prisma.doctor.create({
        data: {
          fullName,
          email,
          passwordHash,
          licenseNumber,
          role: Role.DOCTOR, // FORZADO: el alta pública jamás crea administradores.
          emailVerifiedAt: null,
          verificationCodeHash,
          verificationExpiresAt,
        },
        select: { id: true },
      });
      doctorId = created.id;
      createdNow = true;
    } catch (err) {
      // Race de doble submit simultáneo (unique de email): tratar como genérico.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return GENERIC_OK;
      }
      throw err;
    }
  }

  // Mail FUERA de transacción. Si falla y recién creamos el alta, la compensamos
  // borrando el doctor para no dejar una cuenta imposible de verificar.
  try {
    const verifyUrl = `${config.FRONTEND_URL}/verificar-email?token=${token}`;
    await sendVerificationEmail({ to: email, fullName, verifyUrl });
  } catch {
    if (createdNow) {
      await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => {
        /* best-effort: si el borrado falla, el alta queda pendiente y re-registrable */
      });
    }
    throw new ServiceUnavailableError(
      'No pudimos enviar el mail de verificación. Probá de nuevo en unos minutos.'
    );
  }

  return GENERIC_OK;
}

// ─── verifyEmail ─────────────────────────────────────────────────────────────

export async function verifyEmail(token: string): Promise<void> {
  // Error genérico único: no distingue inválido / vencido / ya usado (anti-fuga).
  const invalid = new ValidationError('El link de verificación es inválido o expiró.');

  if (typeof token !== 'string' || token.length < 20 || token.length > 512) {
    throw invalid;
  }

  const hash = hashToken(token);
  const doctor = await prisma.doctor.findFirst({
    where: { verificationCodeHash: hash },
    select: { id: true, verificationExpiresAt: true },
  });

  if (!doctor || !doctor.verificationExpiresAt || doctor.verificationExpiresAt.getTime() < Date.now()) {
    throw invalid;
  }

  // Marca verificado y limpia el código → un solo uso (un 2º intento no matchea).
  await prisma.doctor.update({
    where: { id: doctor.id },
    data: { emailVerifiedAt: new Date(), verificationCodeHash: null, verificationExpiresAt: null },
  });
}
