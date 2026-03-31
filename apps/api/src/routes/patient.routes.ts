import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import * as patientService from '../services/patient.service';
import { Role, PatientProgramStatus, Gender } from '@ips/db';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  search: z.string().max(100, 'search no puede superar 100 caracteres').optional(),
  programId: z.string().uuid('programId debe ser un UUID válido').optional(),
  status: z.nativeEnum(PatientProgramStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamsSchema = z.object({
  id: z.string().uuid('id debe ser un UUID válido'),
});

const createBodySchema = z.object({
  fullName: z.string().min(2, 'fullName debe tener al menos 2 caracteres').max(200, 'fullName no puede superar 200 caracteres')
    .refine((v) => !/^[=+\-@\t\r]/.test(v), 'El nombre no puede comenzar con caracteres especiales (=, +, -, @)'),
  dni: z
    .string()
    .regex(/^\d{7,8}$/, 'DNI debe tener 7 u 8 dígitos numéricos'),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Teléfono debe estar en formato E.164')
    .optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate debe estar en formato YYYY-MM-DD')
    .refine((v) => {
      const d = new Date(v);
      if (isNaN(d.getTime())) return false;
      const year = d.getFullYear();
      return year >= 1900 && d <= new Date();
    }, 'birthDate debe ser una fecha válida en el pasado')
    .optional(),
  gender: z.nativeEnum(Gender).optional(),
  consent: z.boolean().default(true),
});

const updateBodySchema = z.object({
  fullName: z.string().min(2, 'fullName debe tener al menos 2 caracteres').max(200, 'fullName no puede superar 200 caracteres').optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Teléfono debe estar en formato E.164')
    .optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate debe estar en formato YYYY-MM-DD')
    .refine((v) => {
      const d = new Date(v);
      if (isNaN(d.getTime())) return false;
      const year = d.getFullYear();
      return year >= 1900 && d <= new Date();
    }, 'birthDate debe ser una fecha válida en el pasado')
    .optional(),
  gender: z.nativeEnum(Gender).optional(),
  consent: z.boolean().optional(),
});

const importBodySchema = z.object({
  csvContent: z.string().min(1, 'csvContent es requerido').max(500_000, 'csvContent no puede superar 500 KB'),
});

// ─── GET /api/patients ────────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;

    const result = await patientService.listPatients(
      req.doctor!.id,
      req.doctor!.role as Role,
      {
        search: query.search,
        programId: query.programId,
        status: query.status,
        page: query.page,
        limit: query.limit,
      }
    );

    res.status(200).json({
      status: 'ok',
      data: result,
    });
  })
);

// ─── POST /api/patients/import ────────────────────────────────────────────────
// Registered BEFORE /:id to avoid "import" being matched as a UUID param

router.post(
  '/import',
  requireAuth,
  requireAdmin,
  validate(importBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { csvContent } = req.body as z.infer<typeof importBodySchema>;

    const result = await patientService.importPatientsFromCsv(csvContent);

    res.status(200).json({
      status: 'ok',
      data: result,
    });
  })
);

// ─── GET /api/patients/export — Export CSV ────────────────────────────────────
// Registered BEFORE /:id to avoid "export" being matched as a UUID param

const exportQuerySchema = z.object({
  programId: z.string().uuid('programId debe ser un UUID válido').optional(),
  status: z.nativeEnum(PatientProgramStatus).optional(),
});

router.get(
  '/export',
  requireAuth,
  validate(exportQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof exportQuerySchema>;

    const csv = await patientService.exportPatientsCsv(
      req.doctor!.id,
      req.doctor!.role as Role,
      {
        programId: query.programId,
        status: query.status,
      }
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pacientes.csv"');
    // BOM for Excel UTF-8 support (LESSONS #22 — this time we ADD it for export)
    res.status(200).send('\uFEFF' + csv);
  })
);

// ─── GET /api/patients/:id ────────────────────────────────────────────────────

router.get(
  '/:id',
  requireAuth,
  validate(idParamsSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;

    const patient = await patientService.getPatientById(
      id,
      req.doctor!.id,
      req.doctor!.role as Role
    );

    res.status(200).json({
      status: 'ok',
      data: { patient },
    });
  })
);

// ─── POST /api/patients ───────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  validate(createBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof createBodySchema>;

    const { patient, created } = await patientService.upsertPatientByDni(body);

    res.status(created ? 201 : 200).json({
      status: 'ok',
      data: { patient },
    });
  })
);

// ─── PATCH /api/patients/:id ──────────────────────────────────────────────────

router.patch(
  '/:id',
  requireAuth,
  validate(idParamsSchema, 'params'),
  validate(updateBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;
    const body = req.body as z.infer<typeof updateBodySchema>;

    const patient = await patientService.updatePatient(
      id,
      req.doctor!.id,
      req.doctor!.role as Role,
      body
    );

    res.status(200).json({
      status: 'ok',
      data: { patient },
    });
  })
);

export { router as patientRouter };
