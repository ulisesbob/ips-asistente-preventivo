import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import * as noteService from '../services/note.service';
import { Role } from '@ips/db';

const router = Router();

// Rate limit: max 10 note creations per minute per doctor
const noteCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.doctor?.id ?? req.ip ?? 'unknown',
  message: { status: 'error', message: 'Demasiadas notas creadas. Esperá un momento.' },
});

// ─── Schemas ─────────────────────────────────────────────────────────────────

const patientIdSchema = z.object({
  id: z.string().uuid('id debe ser un UUID válido'),
});

const createNoteSchema = z.object({
  content: z
    .string()
    .min(1, 'El contenido es requerido')
    .max(500, 'La nota no puede superar 500 caracteres')
    .refine(
      (v) => !/^[=+\-@\t\r]/.test(v),
      'La nota no puede comenzar con caracteres especiales (=, +, -, @)'
    ),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─── GET /api/patients/:id/notes ─────────────────────────────────────────────

router.get(
  '/:id/notes',
  requireAuth,
  validate(patientIdSchema, 'params'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as z.infer<typeof patientIdSchema>;
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;

    const result = await noteService.listNotes(
      id,
      req.doctor!.id,
      req.doctor!.role as Role,
      query.page,
      query.limit
    );

    res.status(200).json({
      status: 'ok',
      data: result,
    });
  })
);

// ─── POST /api/patients/:id/notes ────────────────────────────────────────────

router.post(
  '/:id/notes',
  requireAuth,
  noteCreateLimiter,
  validate(patientIdSchema, 'params'),
  validate(createNoteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as z.infer<typeof patientIdSchema>;
    const body = req.body as z.infer<typeof createNoteSchema>;

    const note = await noteService.createNote(
      id,
      req.doctor!.id,
      req.doctor!.role as Role,
      body
    );

    res.status(201).json({
      status: 'ok',
      data: { note },
    });
  })
);

export { router as noteRouter };
