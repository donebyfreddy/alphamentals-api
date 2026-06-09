"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const journalService = __importStar(require("../services/tradeJournal.service.js"));
const aiCoach_service_js_1 = require("../services/aiCoach.service.js");
const riskValidator_service_js_1 = require("../services/riskValidator.service.js");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
function param(value) {
    return Array.isArray(value) ? value[0] : value;
}
const CreateTradeSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(3).max(10),
    direction: zod_1.z.enum(['LONG', 'SHORT']),
    entryPrice: zod_1.z.number().positive(),
    stopLoss: zod_1.z.number().positive(),
    takeProfit: zod_1.z.number().positive(),
    positionSize: zod_1.z.number().positive(),
    riskPercent: zod_1.z.number().min(0.01).max(10),
    session: zod_1.z.enum(['LONDON', 'NEW_YORK', 'ASIA', 'LONDON_NY_OVERLAP', 'CUSTOM']),
    timeframe: zod_1.z.string(),
    setupType: zod_1.z.string().min(1),
    confluences: zod_1.z.array(zod_1.z.string()).optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    preTradeEmotion: zod_1.z.enum(['CALM', 'CONFIDENT', 'ANXIOUS', 'FEARFUL', 'GREEDY', 'REVENGE', 'FOMO', 'NEUTRAL', 'EXCITED', 'FRUSTRATED']).optional(),
    confidenceLevel: zod_1.z.number().min(1).max(10).optional(),
    tradePlan: zod_1.z.string().optional(),
    reasonForEntry: zod_1.z.string().optional(),
    entryTime: zod_1.z.string(),
    checklistId: zod_1.z.string().optional(),
    isRevengeTrade: zod_1.z.boolean().optional(),
    isFomo: zod_1.z.boolean().optional(),
});
const EMOTIONS = ['CALM', 'CONFIDENT', 'ANXIOUS', 'FEARFUL', 'GREEDY', 'REVENGE', 'FOMO', 'NEUTRAL', 'EXCITED', 'FRUSTRATED', 'FOCUSED', 'ANGRY', 'IMPATIENT', 'TIRED', 'OVERCONFIDENT', 'HESITANT', 'STRESSED', 'DETACHED', 'EMOTIONAL', 'SATISFIED', 'DISAPPOINTED', 'MOTIVATED', 'REGRETFUL'];
const CloseTradeSchema = zod_1.z.object({
    closePrice: zod_1.z.number().positive(),
    exitTime: zod_1.z.string(),
    postTradeEmotion: zod_1.z.enum(EMOTIONS).optional(),
    reasonForExit: zod_1.z.string().optional(),
    lessonsLearned: zod_1.z.string().optional(),
    mistakeTags: zod_1.z.array(zod_1.z.string()).optional(),
    followedPlan: zod_1.z.boolean().optional(),
    screenshotUrls: zod_1.z.array(zod_1.z.string()).optional(),
});
const ReviewSchema = zod_1.z.object({
    setupId: zod_1.z.string().optional(),
    setupName: zod_1.z.string().optional(),
    setupQualityGrade: zod_1.z.enum(['A_PLUS', 'A', 'B', 'C', 'FORCED', 'NO_SETUP']).optional(),
    blueprintRulesFollowed: zod_1.z.array(zod_1.z.string()).optional(),
    blueprintRulesBroken: zod_1.z.array(zod_1.z.string()).optional(),
    reasonForEntry: zod_1.z.string().optional(),
    reasonForExit: zod_1.z.string().optional(),
    tradePlan: zod_1.z.string().optional(),
    postTradeNotes: zod_1.z.string().optional(),
    lessonsLearned: zod_1.z.string().optional(),
    whatToImprove: zod_1.z.string().optional(),
    preTradeEmotion: zod_1.z.enum(EMOTIONS).optional(),
    duringTradeEmotion: zod_1.z.enum(EMOTIONS).optional(),
    postTradeEmotion: zod_1.z.enum(EMOTIONS).optional(),
    confidenceLevel: zod_1.z.number().min(1).max(10).optional(),
    followedPlan: zod_1.z.boolean().optional(),
    isFomo: zod_1.z.boolean().optional(),
    isRevengeTrade: zod_1.z.boolean().optional(),
    hesitation: zod_1.z.boolean().optional(),
    movedStopLoss: zod_1.z.boolean().optional(),
    closedEarly: zod_1.z.boolean().optional(),
    mistakeTags: zod_1.z.array(zod_1.z.string()).optional(),
    lossClassification: zod_1.z.enum(['VALID_LOSS', 'EXECUTION', 'PSYCHOLOGY', 'RISK', 'STRATEGY', 'RULE_VIOLATION']).optional(),
    screenshotUrls: zod_1.z.array(zod_1.z.string()).optional(),
});
const TRADES_FALLBACK = {
    ok: true,
    data: [],
    pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
};
// GET /api/journal/trades
router.get('/trades', async (req, res) => {
    const pageNum = req.query.page ? Number(req.query.page) : 1;
    const limitNum = req.query.limit ? Number(req.query.limit) : 20;
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const { symbol, direction, status, session, setupType, from, to, reviewStatus, setupId, setupQualityGrade } = req.query;
        const result = await journalService.getTrades(userId, {
            page: pageNum,
            limit: limitNum,
            symbol: symbol,
            direction: direction,
            status: status,
            session: session,
            setupType: setupType,
            reviewStatus: reviewStatus,
            setupId: setupId,
            setupQualityGrade: setupQualityGrade,
            from: from,
            to: to,
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
    }
    catch (err) {
        console.error('[journal/trades]', err.message);
        res.json({ ...TRADES_FALLBACK, pagination: { ...TRADES_FALLBACK.pagination, page: pageNum, limit: limitNum } });
    }
});
// POST /api/journal/trades
router.post('/trades', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const parsed = CreateTradeSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
            return;
        }
        const validation = (0, riskValidator_service_js_1.validateTradeRisk)({
            entryPrice: parsed.data.entryPrice,
            stopLoss: parsed.data.stopLoss,
            takeProfit: parsed.data.takeProfit,
            lotSize: undefined,
        });
        if (!validation.isValid) {
            res.status(400).json({ error: 'Trade blocked by risk rules', blockers: validation.blockers });
            return;
        }
        const trade = await journalService.createTrade(userId, parsed.data);
        if (validation.warnings.length > 0) {
            res.status(201).json({ trade, warnings: validation.warnings });
            return;
        }
        res.status(201).json(trade);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/journal/trades/:id
router.get('/trades/:id', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const trade = await journalService.getTradeById(userId, param(req.params.id));
        res.json(trade);
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
// PATCH /api/journal/trades/:id/close
router.patch('/trades/:id/close', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const parsed = CloseTradeSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
            return;
        }
        const trade = await journalService.closeTrade(userId, param(req.params.id), parsed.data);
        res.json(trade);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/journal/trades/:id
router.delete('/trades/:id', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        await journalService.deleteTrade(userId, param(req.params.id));
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/journal/trades/:id/review — save post-trade review + recompute scores
router.patch('/trades/:id/review', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const parsed = ReviewSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
            return;
        }
        const result = await journalService.updateTradeReview(userId, param(req.params.id), parsed.data);
        // When the review is complete, generate the AI coach comment in the background
        // so the response (with deterministic scores) returns immediately.
        if (result.trade?.reviewStatus === 'COMPLETE') {
            (0, aiCoach_service_js_1.reviewTrade)(userId, param(req.params.id)).catch(() => { });
        }
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/journal/trades/:id/ai-review
router.post('/trades/:id/ai-review', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const review = await (0, aiCoach_service_js_1.reviewTrade)(userId, param(req.params.id));
        res.json({ review });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
const STATS_FALLBACK = { totalTrades: 0, winRate: 0, profitFactor: 0, netPnl: 0, needsReview: 0 };
// GET /api/journal/stats
router.get('/stats', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const { from, to } = req.query;
        const stats = await journalService.getPerformanceStats(userId, from, to);
        res.json({ ok: true, data: stats });
    }
    catch (err) {
        console.error('[journal/stats]', err.message);
        res.json({ ok: true, data: STATS_FALLBACK });
    }
});
exports.default = router;
