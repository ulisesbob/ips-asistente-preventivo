import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import * as medService from '../services/medication-reminder.service';
import { Role } from '@ips/db';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const patientIdSchema = z.object({
  patientId: z.string().uuid(),
});

const idSchema = z.object({
  id: z.string().uuid(),
});

const createSchema = z.object({
  medicationName: z.string().min(1, 'Nombre de medicamento requerido').max(200),
  dosage: z.string().min(1, 'Dosis requerida').max(200),
  reminderHour: z.number().int().min(0).max(23),
  reminderMinute: z.number().int().min(0).max(59).optional().default(0),
});

const updateSchema = z.object({
  medicationName: z.string().min(1).max(200).optional(),
  dosage: z.string().min(1).max(200).optional(),
  reminderHour: z.number().int().min(0).max(23).optional(),
  reminderMinute: z.number().int().min(0).max(59).optional(),
  active: z.boolean().optional(),
});

// ─── GET /api/patients/:patientId/medications ────────────────────────────────

router.get(
  '/patients/:patientId/medications',
  requireAuth,
  validate(patientIdSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { patientId } = req.params as z.infer<typeof patientIdSchema>;
    const reminders = await medService.listMedReminders(
      patientId, req.doctor!.id, req.doctor!.role as Role
    );
    res.status(200).json({ status: 'ok', data: { reminders } });
  })
);

// ─── POST /api/patients/:patientId/medications ───────────────────────────────

router.post(
  '/patients/:patientId/medications',
  requireAuth,
  validate(patientIdSchema, 'params'),
  validate(createSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { patientId } = req.params as z.infer<typeof patientIdSchema>;
    const body = req.body as z.infer<typeof createSchema>;
    const reminder = await medService.createMedReminder(
      patientId, req.doctor!.id, req.doctor!.role as Role, body
    );
    res.status(201).json({ status: 'ok', data: { reminder } });
  })
);

// ─── PATCH /api/medication-reminders/:id ─────────────────────────────────────

router.patch(
  '/medication-reminders/:id',
  requireAuth,
  validate(idSchema, 'params'),
  validate(updateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const body = req.body as z.infer<typeof updateSchema>;
    const reminder = await medService.updateMedReminder(id, body);
    res.status(200).json({ status: 'ok', data: { reminder } });
  })
);

// ─── DELETE /api/medication-reminders/:id ────────────────────────────────────

router.delete(
  '/medication-reminders/:id',
  requireAuth,
  validate(idSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    await medService.deleteMedReminder(id);
    res.status(204).send();
  })
);

export { router as medicationReminderRouter };
