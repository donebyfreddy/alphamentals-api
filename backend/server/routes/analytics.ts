import { Router, Request, Response } from 'express';
import * as analyticsService from '../services/analytics.service.js';
import { isDatabaseConfigured } from '../lib/supabase.js';

const router = Router();

const dbAvailable = () => {
  return isDatabaseConfigured();
};

router.get('/equity-curve', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const { from, to } = req.query;
    res.json(await analyticsService.getEquityCurve(userId, from as string, to as string));
  } catch { res.json([]); }
});

router.get('/session-heatmap', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getSessionHeatmap(userId));
  } catch { res.json([]); }
});

router.get('/day-heatmap', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getDayOfWeekHeatmap(userId));
  } catch { res.json([]); }
});

router.get('/mistakes', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getMistakeBreakdown(userId));
  } catch { res.json([]); }
});

router.get('/setups', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getSetupPerformance(userId));
  } catch { res.json([]); }
});

router.get('/psychology', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getPsychologyCorrelations(userId));
  } catch { res.json([]); }
});

router.get('/patterns', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json({ ok: true, data: [] });
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const patterns = await analyticsService.detectMistakePatterns(userId);
    res.json({ ok: true, data: patterns });
  } catch { res.json({ ok: true, data: [] }); }
});

router.get('/setup-quality', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getSetupQualityPerformance(userId));
  } catch { res.json([]); }
});

router.get('/mistake-cost', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getMistakeCost(userId));
  } catch { res.json([]); }
});

router.get('/discipline', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json(null);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getDisciplineStats(userId));
  } catch { res.json(null); }
});

router.get('/risk-flags', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json(null);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getRiskFlagStats(userId));
  } catch { res.json(null); }
});

router.get('/time-of-day', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getTimeOfDayPerformance(userId));
  } catch { res.json([]); }
});

router.get('/psychology-phase', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const phaseParam = req.query.phase;
    const phase = phaseParam === 'during' || phaseParam === 'post' ? phaseParam : 'pre';
    res.json(await analyticsService.getPsychologyByPhase(userId, phase));
  } catch { res.json([]); }
});

router.get('/by-symbol', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getPerformanceBySymbol(userId));
  } catch { res.json([]); }
});

router.get('/good-vs-bad-loss', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json(null);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getGoodVsBadLossStats(userId));
  } catch { res.json(null); }
});

router.get('/psychology-cost', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getPsychologyFlagCost(userId));
  } catch { res.json([]); }
});

router.get('/review-coverage', async (req: Request, res: Response) => {
  if (!dbAvailable()) return res.json(null);
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await analyticsService.getReviewCoverage(userId));
  } catch { res.json(null); }
});

export default router;
