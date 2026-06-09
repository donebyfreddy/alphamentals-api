import { Router, Request, Response } from 'express';
import * as journalService from '../services/tradeJournal.service.js';
import type { Direction, TradeStatus, Session, CreateTradeInput, CloseTradeInput, ReviewInput } from '../services/tradeJournal.service.js';
import { reviewTrade } from '../services/aiCoach.service.js';
import { validateTradeRisk } from '../services/riskValidator.service.js';
import { z } from 'zod';

const router = Router();

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

const CreateTradeSchema = z.object({
  symbol: z.string().min(3).max(10),
  direction: z.enum(['LONG', 'SHORT']),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  positionSize: z.number().positive(),
  riskPercent: z.number().min(0.01).max(10),
  session: z.enum(['LONDON', 'NEW_YORK', 'ASIA', 'LONDON_NY_OVERLAP', 'CUSTOM']),
  timeframe: z.string(),
  setupType: z.string().min(1),
  confluences: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  preTradeEmotion: z.enum(['CALM','CONFIDENT','ANXIOUS','FEARFUL','GREEDY','REVENGE','FOMO','NEUTRAL','EXCITED','FRUSTRATED']).optional(),
  confidenceLevel: z.number().min(1).max(10).optional(),
  tradePlan: z.string().optional(),
  reasonForEntry: z.string().optional(),
  entryTime: z.string(),
  checklistId: z.string().optional(),
  isRevengeTrade: z.boolean().optional(),
  isFomo: z.boolean().optional(),
});

const EMOTIONS = ['CALM','CONFIDENT','ANXIOUS','FEARFUL','GREEDY','REVENGE','FOMO','NEUTRAL','EXCITED','FRUSTRATED','FOCUSED','ANGRY','IMPATIENT','TIRED','OVERCONFIDENT','HESITANT','STRESSED','DETACHED','EMOTIONAL','SATISFIED','DISAPPOINTED','MOTIVATED','REGRETFUL'] as const;

const CloseTradeSchema = z.object({
  closePrice: z.number().positive(),
  exitTime: z.string(),
  postTradeEmotion: z.enum(EMOTIONS).optional(),
  reasonForExit: z.string().optional(),
  lessonsLearned: z.string().optional(),
  mistakeTags: z.array(z.string()).optional(),
  followedPlan: z.boolean().optional(),
  screenshotUrls: z.array(z.string()).optional(),
});

const ReviewSchema = z.object({
  setupId: z.string().optional(),
  setupName: z.string().optional(),
  setupQualityGrade: z.enum(['A_PLUS','A','B','C','FORCED','NO_SETUP']).optional(),
  blueprintRulesFollowed: z.array(z.string()).optional(),
  blueprintRulesBroken: z.array(z.string()).optional(),
  reasonForEntry: z.string().optional(),
  reasonForExit: z.string().optional(),
  tradePlan: z.string().optional(),
  postTradeNotes: z.string().optional(),
  lessonsLearned: z.string().optional(),
  whatToImprove: z.string().optional(),
  preTradeEmotion: z.enum(EMOTIONS).optional(),
  duringTradeEmotion: z.enum(EMOTIONS).optional(),
  postTradeEmotion: z.enum(EMOTIONS).optional(),
  confidenceLevel: z.number().min(1).max(10).optional(),
  followedPlan: z.boolean().optional(),
  isFomo: z.boolean().optional(),
  isRevengeTrade: z.boolean().optional(),
  hesitation: z.boolean().optional(),
  movedStopLoss: z.boolean().optional(),
  closedEarly: z.boolean().optional(),
  mistakeTags: z.array(z.string()).optional(),
  lossClassification: z.enum(['VALID_LOSS','EXECUTION','PSYCHOLOGY','RISK','STRATEGY','RULE_VIOLATION']).optional(),
  screenshotUrls: z.array(z.string()).optional(),
});

const TRADES_FALLBACK = {
  ok: true as const,
  data: [] as unknown[],
  pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
};

// GET /api/journal/trades
router.get('/trades', async (req: Request, res: Response) => {
  const pageNum = req.query.page ? Number(req.query.page) : 1;
  const limitNum = req.query.limit ? Number(req.query.limit) : 20;
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const { symbol, direction, status, session, setupType, from, to, reviewStatus, setupId, setupQualityGrade } = req.query;
    const result = await journalService.getTrades(userId, {
      page: pageNum,
      limit: limitNum,
      symbol: symbol as string,
      direction: direction as Direction,
      status: status as TradeStatus,
      session: session as Session,
      setupType: setupType as string,
      reviewStatus: reviewStatus as string,
      setupId: setupId as string,
      setupQualityGrade: setupQualityGrade as string,
      from: from as string,
      to: to as string,
    });
    res.json({
      ok: true,
      data: result.trades ?? [],
      pagination: {
        page: result.page ?? pageNum,
        limit: result.limit ?? limitNum,
        total: result.total ?? 0,
        totalPages: result.pages ?? 0,
      },
    });
  } catch (err: any) {
    console.error('[journal/trades]', err.message);
    res.json({ ...TRADES_FALLBACK, pagination: { ...TRADES_FALLBACK.pagination, page: pageNum, limit: limitNum } });
  }
});

// POST /api/journal/trades
router.post('/trades', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const parsed = CreateTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const validation = validateTradeRisk({
      entryPrice: parsed.data.entryPrice,
      stopLoss: parsed.data.stopLoss,
      takeProfit: parsed.data.takeProfit,
      lotSize: undefined,
    });
    if (!validation.isValid) {
      res.status(400).json({ error: 'Trade blocked by risk rules', blockers: validation.blockers });
      return;
    }
    const trade = await journalService.createTrade(userId, parsed.data as CreateTradeInput);
    if (validation.warnings.length > 0) {
      res.status(201).json({ trade, warnings: validation.warnings });
      return;
    }
    res.status(201).json(trade);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/trades/:id
router.get('/trades/:id', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const trade = await journalService.getTradeById(userId, param(req.params.id));
    res.json(trade);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// PATCH /api/journal/trades/:id/close
router.patch('/trades/:id/close', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const parsed = CloseTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const trade = await journalService.closeTrade(userId, param(req.params.id), parsed.data as CloseTradeInput);
    res.json(trade);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/journal/trades/:id
router.delete('/trades/:id', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    await journalService.deleteTrade(userId, param(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/journal/trades/:id/review — save post-trade review + recompute scores
router.patch('/trades/:id/review', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const result = await journalService.updateTradeReview(userId, param(req.params.id), parsed.data as ReviewInput);
    // When the review is complete, generate the AI coach comment in the background
    // so the response (with deterministic scores) returns immediately.
    if (result.trade?.reviewStatus === 'COMPLETE') {
      reviewTrade(userId, param(req.params.id)).catch(() => { /* non-fatal */ });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/journal/trades/:id/ai-review
router.post('/trades/:id/ai-review', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const review = await reviewTrade(userId, param(req.params.id));
    res.json({ review });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const STATS_FALLBACK = { totalTrades: 0, winRate: 0, profitFactor: 0, netPnl: 0, needsReview: 0 };

// GET /api/journal/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const { from, to } = req.query;
    const stats = await journalService.getPerformanceStats(userId, from as string, to as string);
    res.json({ ok: true, data: stats });
  } catch (err: any) {
    console.error('[journal/stats]', err.message);
    res.json({ ok: true, data: STATS_FALLBACK });
  }
});

export default router;
