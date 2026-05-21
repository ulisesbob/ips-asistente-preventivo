import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma, Role, DoctorStatus } from '@ips/db';
import { config } from '../config/env';
import { UnauthorizedError, NotFoundError, ForbiddenError } from '../utils/errors';
import { normalizeEmail } from '../utils/email';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
  // Versión de sesión: si no coincide con doctor.tokenVersion, el token fue
  // revocado (logout / cambio de password). Ver requireAuth y logout (audit #4).
  tv: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface DoctorProfile {
  id: string;
  fullName: string;
  email: string;
  role: Role;
}

export interface LoginResult extends AuthTokens {
  doctor: DoctorProfile;
}

// ─── Constants ────────────────────────────────────────────────────────────

// Pre-generated valid bcrypt hash for timing-attack mitigation
const DUMMY_HASH = bcrypt.hashSync('dummy-password-never-matches', 10);

// ─── Token helpers ─────────────────────────────────────────────────────────

function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign({ ...payload, type: 'access' }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign({ ...payload, type: 'refresh' }, config.JWT_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

// ─── Service methods ────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<LoginResult> {
  // Normalizamos igual que en el alta para que el `@unique` case-sensitive matchee.
  const doctor = await prisma.doctor.findUnique({
    where: { email: normalizeEmail(email) },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      passwordHash: true,
      tokenVersion: true,
      emailVerifiedAt: true,
      status: true,
    },
  });

  // Avoid timing attacks: always run bcrypt even if doctor not found
  const hash = doctor?.passwordHash ?? DUMMY_HASH;
  const isValid = await bcrypt.compare(password, hash);

  if (!doctor || !isValid) {
    throw new UnauthorizedError('Credenciales inválidas');
  }

  // Gate de auto-registro: sin verificar el email no se puede entrar. Se chequea
  // DESPUÉS de validar la contraseña, así sólo se revela a quien ya tiene la
  // credencial correcta (no sirve para enumerar emails).
  if (!doctor.emailVerifiedAt) {
    throw new ForbiddenError(
      'Verificá tu email antes de iniciar sesión. Te enviamos un link cuando te registraste.'
    );
  }

  // Gate de aprobación: aunque el email esté verificado, un admin tiene que
  // habilitar la cuenta (así garantizamos que sea realmente un médico).
  if (doctor.status !== DoctorStatus.APPROVED) {
    throw new ForbiddenError(
      'Tu cuenta todavía no fue habilitada por un administrador. Te avisaremos cuando esté aprobada.'
    );
  }

  const payload: TokenPayload = {
    sub: doctor.id,
    email: doctor.email,
    role: doctor.role,
    tv: doctor.tokenVersion ?? 0,
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  return {
    accessToken,
    refreshToken,
    doctor: {
      id: doctor.id,
      fullName: doctor.fullName,
      email: doctor.email,
      role: doctor.role,
    },
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  let payload: TokenPayload;

  try {
    const decoded = jwt.verify(refreshToken, config.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as TokenPayload & { type?: string };

    if (decoded.type !== 'refresh') {
      throw new Error('Not a refresh token');
    }

    payload = decoded;
  } catch {
    throw new UnauthorizedError('Refresh token inválido o expirado');
  }

  // Verify doctor still exists
  const doctor = await prisma.doctor.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, tokenVersion: true, status: true, emailVerifiedAt: true },
  });

  if (!doctor) {
    throw new UnauthorizedError('Usuario no encontrado');
  }

  // Revocación: si la versión del refresh token no coincide con la del doctor,
  // fue invalidado por un logout (o cambio de password). Audit #4.
  if ((payload.tv ?? 0) !== (doctor.tokenVersion ?? 0)) {
    throw new UnauthorizedError('Sesión expirada, iniciá sesión de nuevo');
  }

  // Defensa en profundidad: no renovar el acceso si la cuenta dejó de estar
  // habilitada (email sin verificar o no aprobada / rechazada).
  if (!doctor.emailVerifiedAt || doctor.status !== DoctorStatus.APPROVED) {
    throw new UnauthorizedError('Sesión no válida, iniciá sesión de nuevo');
  }

  const newPayload: TokenPayload = {
    sub: doctor.id,
    email: doctor.email,
    role: doctor.role,
    tv: doctor.tokenVersion ?? 0,
  };

  return generateAccessToken(newPayload);
}

/**
 * Cierra TODAS las sesiones del médico incrementando su tokenVersion: invalida de
 * inmediato cualquier access/refresh token emitido antes (audit #4). Recibe el
 * refresh token de la cookie; si falta o es inválido, es un no-op silencioso
 * (el logout siempre debe "funcionar" desde la perspectiva del cliente).
 */
export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;

  let sub: string;
  try {
    const decoded = jwt.verify(refreshToken, config.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as TokenPayload & { type?: string };
    if (decoded.type !== 'refresh') return;
    sub = decoded.sub;
  } catch {
    return; // token inválido/expirado: no hay sesión que revocar
  }

  await prisma.doctor
    .update({ where: { id: sub }, data: { tokenVersion: { increment: 1 } } })
    .catch(() => {
      /* doctor borrado entre medio: no-op */
    });
}

export async function getMe(doctorId: string): Promise<DoctorProfile> {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
    },
  });

  if (!doctor) {
    throw new NotFoundError('Usuario no encontrado');
  }

  return {
    id: doctor.id,
    fullName: doctor.fullName,
    email: doctor.email,
    role: doctor.role,
  };
}
