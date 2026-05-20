import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma, Role, setAuditActor } from '@ips/db';
import { config } from '../config/env';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  tv?: number; // versión de sesión (audit #4); ausente en tokens legacy → 0
  iat?: number;
  exp?: number;
}

function extractToken(req: Request): string | null {
  // 1. Authorization header — "Bearer <token>"
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // 2. httpOnly cookie named 'token'
  if (req.cookies && typeof req.cookies['token'] === 'string') {
    return req.cookies['token'] as string;
  }

  return null;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);

    if (!token) {
      throw new UnauthorizedError('Token de autenticación requerido');
    }

    let payload: JwtPayload;

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET, {
        algorithms: ['HS256'],
      }) as JwtPayload & { type?: string };

      if (decoded.type !== 'access') {
        throw new Error('Not an access token');
      }

      payload = decoded;
    } catch {
      throw new UnauthorizedError('Token inválido o expirado');
    }

    const doctor = await prisma.doctor.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        fullName: true,
        tokenVersion: true,
      },
    });

    if (!doctor) {
      throw new UnauthorizedError('Usuario no encontrado');
    }

    // Revocación de sesión: un token con versión distinta a la del doctor fue
    // invalidado por logout/cambio de password (audit #4). El `?? 0` mantiene
    // válidos los tokens legacy (sin tv) hasta el primer logout.
    if ((payload.tv ?? 0) !== (doctor.tokenVersion ?? 0)) {
      throw new UnauthorizedError('Sesión expirada, iniciá sesión de nuevo');
    }

    req.doctor = {
      id: doctor.id,
      email: doctor.email,
      role: doctor.role,
      fullName: doctor.fullName,
    };

    // Eleva el actor del audit log de SYSTEM al médico autenticado.
    setAuditActor({
      actorType: doctor.role === Role.ADMIN ? 'ADMIN' : 'DOCTOR',
      actorId: doctor.id,
    });

    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.doctor) {
    next(new UnauthorizedError('No autenticado'));
    return;
  }

  if (req.doctor.role !== Role.ADMIN) {
    next(new ForbiddenError('Se requieren permisos de administrador'));
    return;
  }

  next();
}
