import { Router } from 'express';
import { z } from 'zod';
import { executeAccountableTrade } from '../services/tradeExecution.service.js';
import type { TradeExecutionPlan } from '../../../src/lib/tradeExecutionRules.js';

export const tradeExecutionRouter = Router();

const symbolSchema = z.enum(['XAUUSD', 'EURUSD', 'GBPUSD']);
const setupGradeSchema = z.enum(['A+', 'A', 'B', 'C']);

const executionPlanSchema = z.object({
  userId: z.string().min(1),
  idempotencyKey: z.string().min(8),
  account: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    broker: z.string().optional().nullable(),
    balance: z.number(),
    equity: z.number().optional().nullable(),
    currency: z.string().default('USD'),
    metaApiAccountId: z.string().optional().nullable(),
    status: z.enum(['connected', 'disconnected', 'syncing', 'failed', 'pending', 'demo', 'unavailable', 'invalid_credentials']),
  }).nullable(),
  symbol: symbolSchema,
  direction: z.enum(['LONG', 'SHORT']),
  orderType: z.enum(['market', 'buy_limit', 'sell_limit', 'buy_stop', 'sell_stop']),
  entryPrice: z.number(),
  stopLoss: z.number().nullable(),
  takeProfit: z.number().nullable(),
  riskPercent: z.number(),
  session: z.union([z.enum(['London', 'New York', 'Asia', 'Overlap']), z.literal('')]),
  marketType: z.union([z.enum(['Trend', 'Range', 'Consolidation', 'Reversal']), z.literal('')]),
  higherTimeframeBias: z.union([z.enum(['Bullish', 'Bearish', 'Mixed']), z.literal('')]),
  liquidityContext: z.union([z.enum(['Sweep', 'No sweep', 'Liquidity resting', 'Unknown']), z.literal('')]),
  poiType: z.union([z.enum(['Demand', 'Supply', 'Order block', 'FVG', 'Support/Resistance', 'Other']), z.literal('')]),
  setupGrade: z.union([setupGradeSchema, z.literal('')]),
  setupName: z.string().optional(),
  playbookChecks: z.object({
    htfBiasAligned: z.boolean(),
    clearPoi: z.boolean(),
    liquiditySweep: z.boolean(),
    confirmationPresent: z.boolean(),
    cleanInvalidation: z.boolean(),
    minimumRrMet: z.boolean(),
    newsClear: z.boolean(),
  }),
  psychology: z.object({
    emotionallyCalm: z.boolean(),
    acceptsLoss: z.boolean(),
    noRevengeTrade: z.boolean(),
    maxRiskAccepted: z.boolean(),
    knowsInvalidation: z.boolean(),
    checkedNews: z.boolean(),
    markedPoi: z.boolean(),
    markedSupply: z.boolean(),
    markedDemand: z.boolean(),
    willJournal: z.boolean(),
    willLeaveCharts: z.boolean(),
    followsTradingPlan: z.boolean(),
  }),
  marketGate: z.object({
    isMarketOpen: z.boolean(),
    isSymbolTradable: z.boolean(),
    isMetaApiConnected: z.boolean(),
    isBrokerHealthy: z.boolean(),
    spread: z.number().optional().nullable(),
    maxSpread: z.number().optional().nullable(),
    checkedAt: z.string().optional().nullable(),
  }),
  newsEvents: z.array(z.object({
    id: z.string(),
    currency: z.string(),
    eventName: z.string(),
    impact: z.enum(['low', 'medium', 'high']),
    datetimeUtc: z.string(),
  })),
  dailyRisk: z.object({
    riskTakenPercentToday: z.number().optional(),
    tradeCountToday: z.number().optional(),
    consecutiveLosses: z.number().optional(),
    dailyLossLimitHit: z.boolean().optional(),
  }),
  settings: z.object({
    liveExecutionEnabled: z.boolean(),
    paperMode: z.boolean(),
    maximumRiskPerTrade: z.number(),
    maximumDailyRisk: z.number(),
    maximumTradesPerDay: z.number(),
    minimumRR: z.number(),
    psychologyMinimumReadiness: z.number(),
    blockHighImpactNewsWindowMinutes: z.number(),
    warnHighImpactNewsWindowMinutes: z.number(),
    overridesEnabled: z.boolean(),
    strictRR: z.boolean(),
    stopAfterConsecutiveLosses: z.number(),
    allowedSymbols: z.array(symbolSchema),
    defaultRiskByGrade: z.object({
      'A+': z.number(),
      A: z.number(),
      B: z.number(),
      C: z.number(),
    }),
  }),
  brokerSettings: z.object({
    minLot: z.number().optional(),
    lotStep: z.number().optional(),
    maxLot: z.number().nullable().optional(),
    accountCurrency: z.string().optional(),
  }).optional(),
  override: z.object({
    requested: z.boolean(),
    reason: z.string().optional(),
  }).optional(),
  confirmation: z.object({
    acceptedLiveRisk: z.boolean(),
    typedConfirm: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
});

tradeExecutionRouter.post('/execute', async (req, res) => {
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
    const result = await executeAccountableTrade(parsed.data as TradeExecutionPlan);
    res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      allowed: false,
      status: 'BLOCKED',
      blockingReasons: [error instanceof Error ? error.message : 'Unexpected trade execution failure.'],
    });
  }
});
