import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import * as doctorService from '../services/doctor.service';
import { Role } from '@ips/db';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const idParamsSchema = z.object({
  id: z.string().uuid('id debe ser un UUID válido'),
});

const createBodySchema = z.object({
  fullName: z.string().min(2, 'fullName debe tener al menos 2 caracteres').max(200),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(128),
  role: z.nativeEnum(Role).optional(),
});

const updateBodySchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  email: z.string().email('Email inválido').optional(),
  role: z.nativeEnum(Role).optional(),
});

const assignProgramBodySchema = z.object({
  programId: z.string().uuid('programId debe ser un UUID válido'),
});

const doctorProgramParamsSchema = z.object({
  id: z.string().uuid('id debe ser un UUID válido'),
  programId: z.string().uuid('programId debe ser un UUID válido'),
});

// ─── GET /api/doctors ────────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const doctors = await doctorService.listDoctors();

    res.status(200).json({
      status: 'ok',
      data: { doctors },
    });
  })
);

// ─── POST /api/doctors ───────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  requireAdmin,
  validate(createBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof createBodySchema>;

    const doctor = await doctorService.createDoctor(body);

    res.status(201).json({
      status: 'ok',
      data: { doctor },
    });
  })
);

// ─── PATCH /api/doctors/:id ──────────────────────────────────────────────────

router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validate(idParamsSchema, 'params'),
  validate(updateBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;
    const body = req.body as z.infer<typeof updateBodySchema>;

    const doctor = await doctorService.updateDoctor(id, body, req.doctor!.id);

    res.status(200).json({
      status: 'ok',
      data: { doctor },
    });
  })
);

// ─── POST /api/doctors/:id/programs — Asignar a programa ────────────────────

router.post(
  '/:id/programs',
  requireAuth,
  requireAdmin,
  validate(idParamsSchema, 'params'),
  validate(assignProgramBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;
    const { programId } = req.body as z.infer<typeof assignProgramBodySchema>;

    const assignment = await doctorService.assignDoctorToProgram(id, programId);

    res.status(201).json({
      status: 'ok',
      data: { assignment },
    });
  })
);

// ─── DELETE /api/doctors/:id/programs/:programId — Desasignar ────────────────

router.delete(
  '/:id/programs/:programId',
  requireAuth,
  requireAdmin,
  validate(doctorProgramParamsSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, programId } = req.params as z.infer<typeof doctorProgramParamsSchema>;

    await doctorService.unassignDoctorFromProgram(id, programId);

    res.status(204).send();
  })
);

export { router as doctorRouter };
