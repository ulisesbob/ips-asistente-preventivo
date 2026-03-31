import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';
import * as dashboardService from '../services/dashboard.service';
import * as surveyService from '../services/survey.service';

const router = Router();

// ─── GET /api/dashboard ─────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id, role } = req.doctor!;

    const stats = await dashboardService.getStats(id, role);

    res.status(200).json({
      status: 'ok',
      data: stats,
    });
  })
);

// ─── GET /api/dashboard/alerts ──────────────────────────────────────────────

router.get(
  '/alerts',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id, role } = req.doctor!;

    const alerts = await dashboardService.getAlerts(id, role);

    res.status(200).json({
      status: 'ok',
      data: alerts,
    });
  })
);

// ─── GET /api/dashboard/surveys ──────────────────────────────────────────────

router.get(
  '/surveys',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id, role } = req.doctor!;

    const stats = await surveyService.getSurveyStats(id, role);

    res.status(200).json({
      status: 'ok',
      data: stats,
    });
  })
);

export { router as dashboardRouter };
