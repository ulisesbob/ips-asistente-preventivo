import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import { config } from '../config/env';
import * as authService from '../services/auth.service';
import { UnauthorizedError } from '../utils/errors';

const router = Router();

// ─── Rate Limiting ──────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 intentos por ventana
  message: { status: 'error', message: 'Demasiados intentos, intente de nuevo en 15 minutos' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// ─── Schemas ────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});

// ─── Constants ───────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const result = await authService.login(email, password);

    // Set refresh token as httpOnly cookie (not exposed in response body)
    const isProduction = config.NODE_ENV === 'production';
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: SEVEN_DAYS_MS,
      path: '/',
    });

    res.status(200).json({
      status: 'ok',
      data: {
        accessToken: result.accessToken,
        doctor: result.doctor,
      },
    });
  })
);

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────

router.post(
  '/refresh',
  validate(refreshSchema),
  asyncHandler(async (req: Request, res: Response) => {
    // Prefer cookie, fall back to body
    const token =
      (req.cookies as Record<string, string | undefined>)['refreshToken'] ??
      (req.body as z.infer<typeof refreshSchema>).refreshToken;

    if (!token) {
      throw new UnauthorizedError('Refresh token requerido');
    }

    const accessToken = await authService.refreshAccessToken(token);

    res.status(200).json({
      status: 'ok',
      data: { accessToken },
    });
  })
);

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    // req.doctor is guaranteed by requireAuth
    const doctor = await authService.getMe(req.doctor!.id);

    res.status(200).json({
      status: 'ok',
      data: { doctor },
    });
  })
);

// ─── POST /api/auth/logout ──────────────────────────────────────────────────

router.post(
  '/logout',
  (_req: Request, res: Response) => {
    const isProduction = config.NODE_ENV === 'production';
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.status(200).json({
      status: 'ok',
      message: 'Sesión cerrada',
    });
  }
);

export { router as authRouter };
