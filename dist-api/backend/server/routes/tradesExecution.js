"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradeExecutionRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const tradeExecution_service_js_1 = require("../services/tradeExecution.service.js");
exports.tradeExecutionRouter = (0, express_1.Router)();
const symbolSchema = zod_1.z.enum(['XAUUSD', 'EURUSD', 'GBPUSD']);
const setupGradeSchema = zod_1.z.enum(['A+', 'A', 'B', 'C']);
const executionPlanSchema = zod_1.z.object({
    userId: zod_1.z.string().min(1),
    idempotencyKey: zod_1.z.string().min(8),
    account: zod_1.z.object({
        id: zod_1.z.string().min(1),
        name: zod_1.z.string().min(1),
        broker: zod_1.z.string().optional().nullable(),
        balance: zod_1.z.number(),
        equity: zod_1.z.number().optional().nullable(),
        currency: zod_1.z.string().default('USD'),
        metaApiAccountId: zod_1.z.string().optional().nullable(),
        status: zod_1.z.enum(['connected', 'disconnected', 'syncing', 'failed', 'pending', 'demo', 'unavailable', 'invalid_credentials']),
    }).nullable(),
    symbol: symbolSchema,
    direction: zod_1.z.enum(['LONG', 'SHORT']),
    orderType: zod_1.z.enum(['market', 'buy_limit', 'sell_limit', 'buy_stop', 'sell_stop']),
    entryPrice: zod_1.z.number(),
    stopLoss: zod_1.z.number().nullable(),
    takeProfit: zod_1.z.number().nullable(),
    riskPercent: zod_1.z.number(),
    session: zod_1.z.union([zod_1.z.enum(['London', 'New York', 'Asia', 'Overlap']), zod_1.z.literal('')]),
    marketType: zod_1.z.union([zod_1.z.enum(['Trend', 'Range', 'Consolidation', 'Reversal']), zod_1.z.literal('')]),
    higherTimeframeBias: zod_1.z.union([zod_1.z.enum(['Bullish', 'Bearish', 'Mixed']), zod_1.z.literal('')]),
    liquidityContext: zod_1.z.union([zod_1.z.enum(['Sweep', 'No sweep', 'Liquidity resting', 'Unknown']), zod_1.z.literal('')]),
    poiType: zod_1.z.union([zod_1.z.enum(['Demand', 'Supply', 'Order block', 'FVG', 'Support/Resistance', 'Other']), zod_1.z.literal('')]),
    setupGrade: zod_1.z.union([setupGradeSchema, zod_1.z.literal('')]),
    setupName: zod_1.z.string().optional(),
    playbookChecks: zod_1.z.object({
        htfBiasAligned: zod_1.z.boolean(),
        clearPoi: zod_1.z.boolean(),
        liquiditySweep: zod_1.z.boolean(),
        confirmationPresent: zod_1.z.boolean(),
        cleanInvalidation: zod_1.z.boolean(),
        minimumRrMet: zod_1.z.boolean(),
        newsClear: zod_1.z.boolean(),
    }),
    psychology: zod_1.z.object({
        emotionallyCalm: zod_1.z.boolean(),
        acceptsLoss: zod_1.z.boolean(),
        noRevengeTrade: zod_1.z.boolean(),
        maxRiskAccepted: zod_1.z.boolean(),
        knowsInvalidation: zod_1.z.boolean(),
        checkedNews: zod_1.z.boolean(),
        markedPoi: zod_1.z.boolean(),
        markedSupply: zod_1.z.boolean(),
        markedDemand: zod_1.z.boolean(),
        willJournal: zod_1.z.boolean(),
        willLeaveCharts: zod_1.z.boolean(),
        followsTradingPlan: zod_1.z.boolean(),
    }),
    marketGate: zod_1.z.object({
        isMarketOpen: zod_1.z.boolean(),
        isSymbolTradable: zod_1.z.boolean(),
        isMetaApiConnected: zod_1.z.boolean(),
        isBrokerHealthy: zod_1.z.boolean(),
        spread: zod_1.z.number().optional().nullable(),
        maxSpread: zod_1.z.number().optional().nullable(),
        checkedAt: zod_1.z.string().optional().nullable(),
    }),
    newsEvents: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        currency: zod_1.z.string(),
        eventName: zod_1.z.string(),
        impact: zod_1.z.enum(['low', 'medium', 'high']),
        datetimeUtc: zod_1.z.string(),
    })),
    dailyRisk: zod_1.z.object({
        riskTakenPercentToday: zod_1.z.number().optional(),
        tradeCountToday: zod_1.z.number().optional(),
        consecutiveLosses: zod_1.z.number().optional(),
        dailyLossLimitHit: zod_1.z.boolean().optional(),
    }),
    settings: zod_1.z.object({
        liveExecutionEnabled: zod_1.z.boolean(),
        paperMode: zod_1.z.boolean(),
        maximumRiskPerTrade: zod_1.z.number(),
        maximumDailyRisk: zod_1.z.number(),
        maximumTradesPerDay: zod_1.z.number(),
        minimumRR: zod_1.z.number(),
        psychologyMinimumReadiness: zod_1.z.number(),
        blockHighImpactNewsWindowMinutes: zod_1.z.number(),
        warnHighImpactNewsWindowMinutes: zod_1.z.number(),
        overridesEnabled: zod_1.z.boolean(),
        strictRR: zod_1.z.boolean(),
        stopAfterConsecutiveLosses: zod_1.z.number(),
        allowedSymbols: zod_1.z.array(symbolSchema),
        defaultRiskByGrade: zod_1.z.object({
            'A+': zod_1.z.number(),
            A: zod_1.z.number(),
            B: zod_1.z.number(),
            C: zod_1.z.number(),
        }),
    }),
    brokerSettings: zod_1.z.object({
        minLot: zod_1.z.number().optional(),
        lotStep: zod_1.z.number().optional(),
        maxLot: zod_1.z.number().nullable().optional(),
        accountCurrency: zod_1.z.string().optional(),
    }).optional(),
    override: zod_1.z.object({
        requested: zod_1.z.boolean(),
        reason: zod_1.z.string().optional(),
    }).optional(),
    confirmation: zod_1.z.object({
        acceptedLiveRisk: zod_1.z.boolean(),
        typedConfirm: zod_1.z.string().optional(),
    }).optional(),
    notes: zod_1.z.string().optional(),
});
exports.tradeExecutionRouter.post('/execute', async (req, res) => {
    const parsed = executionPlanSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            allowed: false,
            status: 'BLOCKED',
            blockingReasons: ['Invalid execution payload.'],
            details: parsed.error.flatten(),
        });
        return;
    }
    try {
        const result = await (0, tradeExecution_service_js_1.executeAccountableTrade)(parsed.data);
        res.status(result.success ? 200 : 422).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            allowed: false,
            status: 'BLOCKED',
            blockingReasons: [error instanceof Error ? error.message : 'Unexpected trade execution failure.'],
        });
    }
});
