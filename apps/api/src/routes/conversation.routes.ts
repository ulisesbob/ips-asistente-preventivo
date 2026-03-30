import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import { Role, ConversationStatus } from '@ips/db';
import * as conversationPanelService from '../services/conversation-panel.service';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  search: z.string().max(100).optional(),
  status: z.nativeEnum(ConversationStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const idParamsSchema = z.object({
  id: z.string().uuid('id debe ser un UUID válido'),
});

const messagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ─── GET /api/conversations ──────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;

    const result = await conversationPanelService.listConversations(
      req.doctor!.id,
      req.doctor!.role as Role,
      {
        search: query.search,
        status: query.status,
        page: query.page,
        limit: query.limit,
      },
    );

    res.status(200).json({
      status: 'ok',
      data: result,
    });
  }),
);

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────

router.get(
  '/:id/messages',
  requireAuth,
  validate(idParamsSchema, 'params'),
  validate(messagesQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>;
    const { page, limit } = req.query as unknown as z.infer<typeof messagesQuerySchema>;

    const result = await conversationPanelService.getConversationMessages(
      id,
      req.doctor!.id,
      req.doctor!.role as Role,
      page,
      limit,
    );

    res.status(200).json({
      status: 'ok',
      data: result,
    });
  }),
);

export { router as conversationRouter };
