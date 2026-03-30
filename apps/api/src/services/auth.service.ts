import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma, Role } from '@ips/db';
import { config } from '../config/env';
import { UnauthorizedError, NotFoundError } from '../utils/errors';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
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
  const doctor = await prisma.doctor.findUnique({
    where: { email },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      passwordHash: true,
    },
  });

  // Avoid timing attacks: always run bcrypt even if doctor not found
  const hash = doctor?.passwordHash ?? DUMMY_HASH;
  const isValid = await bcrypt.compare(password, hash);

  if (!doctor || !isValid) {
    throw new UnauthorizedError('Credenciales inválidas');
  }

  const payload: TokenPayload = {
    sub: doctor.id,
    email: doctor.email,
    role: doctor.role,
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
    select: { id: true, email: true, role: true },
  });

  if (!doctor) {
    throw new UnauthorizedError('Usuario no encontrado');
  }

  const newPayload: TokenPayload = {
    sub: doctor.id,
    email: doctor.email,
    role: doctor.role,
  };

  return generateAccessToken(newPayload);
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
