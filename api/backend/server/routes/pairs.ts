import { Router } from 'express';
import { buildPairAnalysis } from '../services/pairAnalysis.service.js';
import { buildBatchPairIntelligenceAI } from '../services/pairIntelligenceAI.service.js';
import type { PairIntelligenceContext } from '../services/pairIntelligenceAI.service.js';
import { buildPairIntelligence } from '../services/pairIntelligence.service.js';
import { buildPriceSnapshot } from '../services/mt5PriceSnapshot.service.js';
import { buildPairFundamentalAnalysis } from '../services/pairFundamentalsAi.service.js';
import { buildMarketStructure } from '../services/marketStructure.service.js';
import { buildSmartMoneyAnalysis } from '../services/smcAnalysis.service.js';
import {
  getMt5Candles,
  getMt5CandleBundle,
  ALL_TIMEFRAMES,
  type Mt5Timeframe,
} from '../services/mt5Candles.service.js';
import { refreshFundamentalsData } from '../services/fundamentals.service.js';

export const pairsRouter = Router();

const VALID_TIMEFRAMES: Mt5Timeframe[] = ['W1', 'D1', 'H4', 'H1', 'M15', 'M5'];

function parseTimeframe(raw: unknown): Mt5Timeframe | null {
  const tf = String(raw ?? '').toUpperCase() as Mt5Timeframe;
  return VALID_TIMEFRAMES.includes(tf) ? tf : null;
}

// ── GET /:symbol/candles?timeframe=H1&count=300 ───────────────────────────────
pairsRouter.get('/:symbol/candles', async (req, res) => {
  const symbol = req.params.symbol;
  const timeframe = parseTimeframe(req.query.timeframe ?? 'H1');
  const count = Math.min(Math.max(Number(req.query.count) || 300, 1), 5000);

  if (!timeframe) {
    return res.status(400).json({ ok: false, error: 'INVALID_TIMEFRAME', message: `timeframe must be one of ${VALID_TIMEFRAMES.join(', ')}` });
  }

  try {
    const result = await getMt5Candles(symbol, timeframe, { count, forceRefresh: req.query.refresh === 'true' });
    if (result.status === 'error') {
      return res.status(502).json({
        ok: false, error: result.error ?? 'MT5_CANDLES_FAILED', symbol, timeframe,
        message: result.message, source: 'mt5-python-bridge',
      });
    }
    if (result.status === 'insufficient_data') {
      return res.status(200).json({
        ok: false, error: 'INSUFFICIENT_CANDLE_DATA', symbol, timeframe,
        message: result.message,
        details: { symbol, timeframe, available: result.available, required: result.required, source: 'mt5-python-bridge' },
        candles: result.candles,
      });
    }
    return res.json({ ok: true, symbol, timeframe, source: 'mt5-python-bridge', count: result.available, candles: result.candles });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'PAIR_CANDLES_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /:symbol/price ────────────────────────────────────────────────────────
pairsRouter.get('/:symbol/price', async (req, res) => {
  try {
    const snapshot = await buildPriceSnapshot(req.params.symbol, { forceRefresh: req.query.refresh === 'true' });
    if (!snapshot.ok) {
      return res.status(snapshot.error === 'PRICE_UNAVAILABLE' ? 502 : 200).json({ ok: false, ...snapshot });
    }
    res.json({ ok: true, symbol: snapshot.symbol, data: snapshot, updatedAt: snapshot.lastTickAt ?? new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'PAIR_PRICE_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /:symbol/structure ────────────────────────────────────────────────────
pairsRouter.get('/:symbol/structure', async (req, res) => {
  try {
    const bundle = await getMt5CandleBundle(req.params.symbol, { forceRefresh: req.query.refresh === 'true' });
    const structure = buildMarketStructure(req.params.symbol, ALL_TIMEFRAMES.map((tf) => bundle.timeframes[tf]));
    res.json({
      ok: true,
      symbol: structure.symbol,
      data: structure,
      mt5: { bridgeReachable: bundle.bridgeReachable, terminalConnected: bundle.terminalConnected },
      warnings: bundle.warnings,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'PAIR_STRUCTURE_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /:symbol/smc ──────────────────────────────────────────────────────────
pairsRouter.get('/:symbol/smc', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const [bundle, price] = await Promise.all([
      getMt5CandleBundle(req.params.symbol, { timeframes: ['H1', 'M15'], forceRefresh }),
      buildPriceSnapshot(req.params.symbol, { forceRefresh }),
    ]);
    const smcTf = bundle.timeframes.H1.status === 'ok' ? bundle.timeframes.H1 : bundle.timeframes.M15;
    const smc = buildSmartMoneyAnalysis(smcTf, price.price);
    res.json({ ok: true, symbol: req.params.symbol.toUpperCase(), data: smc, updatedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'PAIR_SMC_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /:symbol/fundamentals ─────────────────────────────────────────────────
pairsRouter.get('/:symbol/fundamentals', async (req, res) => {
  try {
    const fundamentals = await buildPairFundamentalAnalysis(req.params.symbol);
    res.json({ ok: true, symbol: fundamentals.symbol, data: fundamentals, updatedAt: fundamentals.generatedAt });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'PAIR_FUNDAMENTALS_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /:symbol/intelligence ─────────────────────────────────────────────────
pairsRouter.get('/:symbol/intelligence', async (req, res) => {
  try {
    const intelligence = await buildPairIntelligence(req.params.symbol, { forceRefresh: req.query.refresh === 'true' });
    res.json({ ok: true, symbol: intelligence.symbol, data: intelligence, updatedAt: intelligence.generatedAt });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'PAIR_INTELLIGENCE_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── POST /:symbol/regenerate-ai ───────────────────────────────────────────────
// Refresh sources → MT5 candles → AI fundamentals → structure → SMC → persist.
pairsRouter.post('/:symbol/regenerate-ai', async (req, res) => {
  const symbol = req.params.symbol;
  const warnings: string[] = [];
  try {
    console.log(`[pair-intelligence] regenerate-ai started for ${symbol}`);
    try {
      await refreshFundamentalsData({ triggeredBy: 'manual' });
    } catch (err) {
      warnings.push(`Source refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const intelligence = await buildPairIntelligence(symbol, { forceRefresh: true });
    console.log(`[pair-intelligence] regenerate-ai completed for ${symbol}: ${intelligence.setupDecision.status}`);
    res.json({ ok: true, symbol: intelligence.symbol, data: intelligence, warnings, updatedAt: intelligence.generatedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate pair intelligence';
    console.error(`[pair-intelligence] regenerate-ai failed for ${symbol}:`, message);
    res.status(500).json({ ok: false, error: 'REGENERATE_FAILED', message, warnings });
  }
});

// ── Legacy: GET /:symbol/analysis ─────────────────────────────────────────────
pairsRouter.get('/:symbol/analysis', async (req, res) => {
  try {
    const result = await buildPairAnalysis(req.params.symbol);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build pair analysis';
    res.status(500).json({ error: message });
  }
});

// ── Legacy: POST /:symbol/analysis ────────────────────────────────────────────
pairsRouter.post('/:symbol/analysis', async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await buildPairAnalysis(req.params.symbol, {
      forceRefresh: Boolean(req.body?.forceRefresh ?? true),
      allowLiveAI: true,
      preferSavedAi: false,
    });
    res.json({ success: true, message: 'Analysis updated', result });
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Failed to generate pair analysis');
    const durationMs = Date.now() - startedAt;
    const timedOut = /timeout/i.test(err.name) || /timeout/i.test(err.message);
    console.error('[pair-ai] analysis failed', { symbol: req.params.symbol, durationMs, errorName: err.name, errorMessage: err.message });
    res.status(timedOut ? 504 : 500).json({
      error: timedOut ? 'AI analysis timed out' : err.message,
      details: timedOut ? 'OpenAI request exceeded 60 seconds' : err.message,
      diagnostics: {
        openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY),
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        symbol: req.params.symbol,
        pairContextLoaded: true,
        fundamentalsLoaded: true,
      },
      durationMs,
    });
  }
});

/**
 * POST /api/pairs/batch-intelligence
 * Analyzes multiple symbols in ONE AI call instead of N separate calls.
 */
pairsRouter.post('/batch-intelligence', async (req, res) => {
  try {
    const { contexts, deep, forceRefresh } = req.body as {
      contexts: PairIntelligenceContext[];
      deep?: boolean;
      forceRefresh?: boolean;
    };
    if (!Array.isArray(contexts) || contexts.length === 0) {
      return res.status(400).json({ error: 'contexts array required' });
    }
    if (contexts.length > 8) {
      return res.status(400).json({ error: 'max 8 contexts per batch' });
    }
    const results = await buildBatchPairIntelligenceAI(contexts, { deep, forceRefresh });
    res.json({ success: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Batch intelligence failed';
    res.status(500).json({ error: message });
  }
});
