import { Router } from 'express';
import { aggregateCosts, queryLedger } from '../lib/cost/ledger.js';
import { getMonthlyFixedCost } from '../lib/cost/pricing.js';
import { getTwelveDataCounters, getResendCounters } from '../lib/cost/counters.js';

export const costRouter = Router();

type Range = 'today' | '7d' | '30d' | 'month';
function parseRange(raw: unknown): Range {
  if (raw === 'today' || raw === '7d' || raw === '30d' || raw === 'month') return raw;
  return 'month';
}

/**
 * GET /api/cost/summary?range=today|7d|30d|month
 */
costRouter.get('/summary', async (req, res) => {
  try {
    const range = parseRange(req.query.range);

    const [openaiAgg, anthropicAgg] = await Promise.all([
      aggregateCosts('openai',    range),
      aggregateCosts('anthropic', range),
    ]);

    // Merge openai + anthropic into a combined ai section
    const ai = {
      totalRequests:    openaiAgg.totalRequests    + anthropicAgg.totalRequests,
      totalTokens:      openaiAgg.totalTokens      + anthropicAgg.totalTokens,
      promptTokens:     openaiAgg.promptTokens     + anthropicAgg.promptTokens,
      completionTokens: openaiAgg.completionTokens + anthropicAgg.completionTokens,
      costUsd:          openaiAgg.costUsd          + anthropicAgg.costUsd,
      byModel:   [...openaiAgg.byModel,   ...anthropicAgg.byModel].sort((a, b) => b.costUsd - a.costUsd),
      byFeature: mergeByKey([...openaiAgg.byFeature, ...anthropicAgg.byFeature], 'feature'),
    };

    const tdMonthly       = getMonthlyFixedCost('TWELVE_DATA_MONTHLY_COST_USD');
    const resendMonthly   = getMonthlyFixedCost('RESEND_MONTHLY_COST_USD');

    const tdCounters     = getTwelveDataCounters();
    const resendCounters = getResendCounters();

    const tdCost        = tdMonthly      ?? 0;
    const resendCost    = resendMonthly  ?? 0;

    res.json({
      ok: true,
      range,
      totals: {
        aiCostUsd:         ai.costUsd,
        metaApiCostUsd:    0,
        marketDataCostUsd: tdCost,
        emailCostUsd:      resendCost,
        totalCostUsd:      ai.costUsd + tdCost + resendCost,
      },
      ai,
      metaApi: {
        planName:       null,
        monthlyCostUsd: 0,
        dailyEstimateUsd:  0,
        weeklyEstimateUsd: 0,
        syncCount:      0,
        failedSyncCount: 0,
        lastSyncAt:     null,
        configured:     false,
        enabled:        false,
        message:        'MetaApi is disabled. This deployment uses Windows VPS MetaTrader 5 only.',
      },
      marketData: {
        provider:       'twelvedata',
        planName:       process.env.TWELVE_DATA_PLAN_NAME ?? null,
        monthlyCostUsd: tdMonthly,
        requestCount:   tdCounters.requestCount,
        symbolCounts:   tdCounters.symbolCounts,
        lastActivityAt: tdCounters.lastActivityAt,
        configured:     tdMonthly != null,
      },
      email: {
        provider:       'resend',
        planName:       process.env.RESEND_PLAN_NAME ?? null,
        emailsSent:     resendCounters.requestCount,
        failedEmails:   resendCounters.failedCount,
        lastEmailAt:    resendCounters.lastActivityAt,
        monthlyCostUsd: resendMonthly,
        configured:     resendMonthly != null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cost/summary]', message);
    res.status(500).json({ ok: false, error: message });
  }
});

/**
 * GET /api/cost/ledger?range=month&provider=all&feature=all&limit=50&offset=0
 */
costRouter.get('/ledger', async (req, res) => {
  try {
    const range    = parseRange(req.query.range);
    const provider = typeof req.query.provider === 'string' ? req.query.provider : 'all';
    const feature  = typeof req.query.feature  === 'string' ? req.query.feature  : 'all';
    const limit    = Math.min(Number(req.query.limit  ?? 50),  200);
    const offset   = Math.max(Number(req.query.offset ?? 0),   0);

    const { rows, total } = await queryLedger({ range, provider, feature, limit, offset });
    res.json({ ok: true, range, total, limit, offset, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cost/ledger]', message);
    res.status(500).json({ ok: false, error: message });
  }
});

/**
 * POST /api/cost/recalculate — dev/admin endpoint to recalculate costs from stored tokens.
 */
costRouter.post('/recalculate', async (_req, res) => {
  res.json({ ok: true, message: 'Recalculation not yet implemented. Costs are calculated at write time.' });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function mergeByKey<T extends { costUsd: number; requests: number; tokens: number }>(
  items: Array<T & { feature: string }>,
  _key: 'feature',
): Array<{ feature: string; costUsd: number; requests: number; tokens: number }> {
  const map = new Map<string, { costUsd: number; requests: number; tokens: number }>();
  for (const item of items) {
    const existing = map.get(item.feature) ?? { costUsd: 0, requests: 0, tokens: 0 };
    existing.costUsd   += item.costUsd;
    existing.requests  += item.requests;
    existing.tokens    += item.tokens;
    map.set(item.feature, existing);
  }
  return Array.from(map.entries())
    .map(([feature, v]) => ({ feature, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd);
}
