import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import * as knowledgeService from '../services/knowledge.service';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  category: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  activeOnly: z.enum(['true', 'false']).optional().transform((v) => v !== 'false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const idParamsSchema = z.object({
  id: z.string().uuid('id debe ser un UUID válido'),
});

const createBodySchema = z.object({
  category: z.string().min(1, 'Categoría requerida').max(100),
  question: z.string().min(1, 'Pregunta requerida').max(500),
  answer: z.string().min(1, 'Respuesta requerida').max(2000),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const updateBodySchema = z.object({
  category: z.string().min(1).max(100).optional(),
  question: z.string().min(1).max(500).optional(),
  answer: z.string().min(1).max(2000).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});

// ─── GET /api/knowledge ──────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;

    const result = await knowledgeService.listKnowledge({
      category: query.category,
      search: query.search,
      activeOnly: query.activeOnly,
      page: query.page,
      limit: query.limit,
    });

    res.status(200).json({ status: 'ok', data: result });
  })
);

// ─── GET /api/knowledge/categories ───────────────────────────────────────────

router.get(
  '/categories',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const categories = await knowledgeService.getCategories();
    res.status(200).json({ status: 'ok', data: { categories } });
  })
);

// ─── POST /api/knowledge (admin only) ────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  requireAdmin,
  validate(createBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof createBodySchema>;
    const entry = await knowledgeService.createKBEntry(body);
    res.status(201).json({ status: 'ok', data: { entry } });
  })
);

// ─── PATCH /api/knowledge/:id (admin only) ───────────────────────────────────

router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validate(idParamsSchema, 'params'),
  validate(updateBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;
    const body = req.body as z.infer<typeof updateBodySchema>;
    const entry = await knowledgeService.updateKBEntry(id, body);
    res.status(200).json({ status: 'ok', data: { entry } });
  })
);

// ─── DELETE /api/knowledge/:id (admin only) ──────────────────────────────────

router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validate(idParamsSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;
    await knowledgeService.deleteKBEntry(id);
    res.status(204).send();
  })
);

export { router as knowledgeRouter };
