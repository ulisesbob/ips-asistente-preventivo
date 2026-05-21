import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import { config } from '../config/env';
import * as authService from '../services/auth.service';
import * as registrationService from '../services/registration.service';
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

// Limiter del auto-registro / verificación. A diferencia del de login, NO saltea
// los exitosos: cada registro "exitoso" dispara un mail, así que hay que contarlos
// para frenar spam de correos (reputación SMTP) y fuerza bruta de tokens.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { status: 'error', message: 'Demasiados intentos, probá de nuevo más tarde' },
  standardHeaders: true,
  legacyHeaders: false,
  // En tests no aplicamos rate-limit (las requests de la suite comparten IP y no
  // son un ataque). Queda activo en development y production.
  skip: () => config.NODE_ENV === 'test',
});

// ─── Schemas ────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});

const registerSchema = z.object({
  fullName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(200),
  licenseNumber: z.string().min(2, 'La matrícula es requerida').max(50),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(128),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token requerido').max(512),
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

// ─── POST /api/auth/register — auto-registro de médicos ──────────────────────

router.post(
  '/register',
  registerLimiter,
  validate(registerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof registerSchema>;

    // La respuesta es SIEMPRE genérica (no revela si el email ya existía).
    const result = await registrationService.registerDoctor(body);

    res.status(201).json({
      status: 'ok',
      data: result,
    });
  })
);

// ─── POST /api/auth/verify-email — confirma el email del registro ────────────

router.post(
  '/verify-email',
  registerLimiter,
  validate(verifyEmailSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.body as z.infer<typeof verifyEmailSchema>;

    await registrationService.verifyEmail(token);

    res.status(200).json({
      status: 'ok',
      message: 'Email verificado. Ya podés iniciar sesión.',
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
  asyncHandler(async (req: Request, res: Response) => {
    // Revoca TODAS las sesiones del médico (bump de tokenVersion) usando el
    // refresh token de la cookie — así un token robado deja de servir (audit #4).
    const token = (req.cookies as Record<string, string | undefined>)['refreshToken'];
    await authService.logout(token);

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
  })
);

export { router as authRouter };
