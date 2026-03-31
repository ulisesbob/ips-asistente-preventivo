import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import * as programService from '../services/program.service';
import { Role, PatientProgramStatus } from '@ips/db';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const idParamsSchema = z.object({
  id: z.string().uuid('id debe ser un UUID válido'),
});

const updateProgramBodySchema = z.object({
  description: z.string().min(1, 'description no puede estar vacío').max(2000).optional(),
  reminderFrequencyDays: z.number().int().min(1, 'Mínimo 1 día').max(365, 'Máximo 365 días').optional(),
  templateMessage: z.string().min(1, 'templateMessage no puede estar vacío').max(2000).optional(),
  centers: z
    .array(
      z.object({
        city: z.string().min(1),
        name: z.string().min(1),
        address: z.string().min(1),
      })
    )
    .optional(),
});

const enrollBodySchema = z.object({
  programId: z.string().uuid('programId debe ser un UUID válido'),
});

const patientIdParamsSchema = z.object({
  patientId: z.string().uuid('patientId debe ser un UUID válido'),
});

const patientProgramIdParamsSchema = z.object({
  id: z.string().uuid('id debe ser un UUID válido'),
});

const updateStatusBodySchema = z.object({
  status: z.nativeEnum(PatientProgramStatus),
});

const updateNextControlBodySchema = z.object({
  nextControlDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'nextControlDate debe estar en formato YYYY-MM-DD')
    .refine((v) => !isNaN(new Date(v).getTime()), 'Fecha inválida'),
});

// ─── GET /api/programs ───────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const programs = await programService.listPrograms(
      req.doctor!.id,
      req.doctor!.role as Role
    );

    res.status(200).json({
      status: 'ok',
      data: { programs },
    });
  })
);

// ─── GET /api/programs/:id ───────────────────────────────────────────────────

router.get(
  '/:id',
  requireAuth,
  validate(idParamsSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;

    const program = await programService.getProgramById(
      id,
      req.doctor!.id,
      req.doctor!.role as Role
    );

    res.status(200).json({
      status: 'ok',
      data: { program },
    });
  })
);

// ─── PATCH /api/programs/:id (admin only) ────────────────────────────────────

router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validate(idParamsSchema, 'params'),
  validate(updateProgramBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;
    const body = req.body as z.infer<typeof updateProgramBodySchema>;

    const program = await programService.updateProgram(id, body);

    res.status(200).json({
      status: 'ok',
      data: { program },
    });
  })
);

export { router as programRouter };

// ─── Patient-Program Router ──────────────────────────────────────────────────
// Separate router for /api/patients/:patientId/programs and /api/patient-programs/:id

const ppRouter = Router();

// ─── POST /api/patients/:patientId/programs — Inscribir paciente ─────────────

ppRouter.post(
  '/patients/:patientId/programs',
  requireAuth,
  validate(patientIdParamsSchema, 'params'),
  validate(enrollBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { patientId } = req.params as z.infer<typeof patientIdParamsSchema>;
    const { programId } = req.body as z.infer<typeof enrollBodySchema>;

    const enrollment = await programService.enrollPatient(
      patientId,
      programId,
      req.doctor!.id,
      req.doctor!.role as Role
    );

    res.status(201).json({
      status: 'ok',
      data: { enrollment },
    });
  })
);

// ─── POST /api/patient-programs/:id/control — Marcar control realizado ───────

ppRouter.post(
  '/patient-programs/:id/control',
  requireAuth,
  validate(patientProgramIdParamsSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof patientProgramIdParamsSchema>;

    const result = await programService.markControl(
      id,
      req.doctor!.id,
      req.doctor!.role as Role
    );

    res.status(200).json({
      status: 'ok',
      data: { patientProgram: result },
    });
  })
);

// ─── PATCH /api/patient-programs/:id/next-control — Cambiar fecha próximo control

ppRouter.patch(
  '/patient-programs/:id/next-control',
  requireAuth,
  validate(patientProgramIdParamsSchema, 'params'),
  validate(updateNextControlBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof patientProgramIdParamsSchema>;
    const { nextControlDate } = req.body as z.infer<typeof updateNextControlBodySchema>;

    const result = await programService.updateNextControl(
      id,
      nextControlDate,
      req.doctor!.id,
      req.doctor!.role as Role
    );

    res.status(200).json({
      status: 'ok',
      data: { patientProgram: result },
    });
  })
);

// ─── PATCH /api/patient-programs/:id — Cambiar status ────────────────────────

ppRouter.patch(
  '/patient-programs/:id',
  requireAuth,
  validate(patientProgramIdParamsSchema, 'params'),
  validate(updateStatusBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof patientProgramIdParamsSchema>;
    const { status } = req.body as z.infer<typeof updateStatusBodySchema>;

    const result = await programService.updatePatientProgramStatus(
      id,
      status,
      req.doctor!.id,
      req.doctor!.role as Role
    );

    res.status(200).json({
      status: 'ok',
      data: { patientProgram: result },
    });
  })
);

// ─── DELETE /api/patient-programs/:id — Dar de baja ──────────────────────────

ppRouter.delete(
  '/patient-programs/:id',
  requireAuth,
  validate(patientProgramIdParamsSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof patientProgramIdParamsSchema>;

    await programService.removePatientFromProgram(
      id,
      req.doctor!.id,
      req.doctor!.role as Role
    );

    res.status(204).send();
  })
);

export { ppRouter as patientProgramRouter };
