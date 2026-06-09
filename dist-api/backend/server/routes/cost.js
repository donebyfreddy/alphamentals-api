"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.costRouter = void 0;
const express_1 = require("express");
const ledger_js_1 = require("../lib/cost/ledger.js");
const pricing_js_1 = require("../lib/cost/pricing.js");
const counters_js_1 = require("../lib/cost/counters.js");
exports.costRouter = (0, express_1.Router)();
function parseRange(raw) {
    if (raw === 'today' || raw === '7d' || raw === '30d' || raw === 'month')
        return raw;
    return 'month';
}
function daysInCurrentMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}
/**
 * GET /api/cost/summary?range=today|7d|30d|month
 */
exports.costRouter.get('/summary', async (req, res) => {
    try {
        const range = parseRange(req.query.range);
        const [openaiAgg, anthropicAgg] = await Promise.all([
            (0, ledger_js_1.aggregateCosts)('openai', range),
            (0, ledger_js_1.aggregateCosts)('anthropic', range),
        ]);
        // Merge openai + anthropic into a combined ai section
        const ai = {
            totalRequests: openaiAgg.totalRequests + anthropicAgg.totalRequests,
            totalTokens: openaiAgg.totalTokens + anthropicAgg.totalTokens,
            promptTokens: openaiAgg.promptTokens + anthropicAgg.promptTokens,
            completionTokens: openaiAgg.completionTokens + anthropicAgg.completionTokens,
            costUsd: openaiAgg.costUsd + anthropicAgg.costUsd,
            byModel: [...openaiAgg.byModel, ...anthropicAgg.byModel].sort((a, b) => b.costUsd - a.costUsd),
            byFeature: mergeByKey([...openaiAgg.byFeature, ...anthropicAgg.byFeature], 'feature'),
        };
        const metaApiMonthly = (0, pricing_js_1.getMonthlyFixedCost)('METAAPI_MONTHLY_COST_USD');
        const tdMonthly = (0, pricing_js_1.getMonthlyFixedCost)('TWELVE_DATA_MONTHLY_COST_USD');
        const resendMonthly = (0, pricing_js_1.getMonthlyFixedCost)('RESEND_MONTHLY_COST_USD');
        const days = daysInCurrentMonth();
        const tdCounters = (0, counters_js_1.getTwelveDataCounters)();
        const resendCounters = (0, counters_js_1.getResendCounters)();
        const metaApiCounters = (0, counters_js_1.getMetaApiCounters)();
        const metaApiCost = metaApiMonthly ?? 0;
        const tdCost = tdMonthly ?? 0;
        const resendCost = resendMonthly ?? 0;
        res.json({
            ok: true,
            range,
            totals: {
                aiCostUsd: ai.costUsd,
                metaApiCostUsd: metaApiCost,
                marketDataCostUsd: tdCost,
                emailCostUsd: resendCost,
                totalCostUsd: ai.costUsd + metaApiCost + tdCost + resendCost,
            },
            ai,
            metaApi: {
                planName: process.env.METAAPI_PLAN_NAME ?? null,
                monthlyCostUsd: metaApiMonthly,
                dailyEstimateUsd: metaApiMonthly != null ? parseFloat((metaApiMonthly / days).toFixed(4)) : null,
                weeklyEstimateUsd: metaApiMonthly != null ? parseFloat((metaApiMonthly / 4.345).toFixed(4)) : null,
                syncCount: metaApiCounters.requestCount,
                failedSyncCount: metaApiCounters.failedCount,
                lastSyncAt: metaApiCounters.lastActivityAt,
                configured: metaApiMonthly != null,
            },
            marketData: {
                provider: 'twelvedata',
                planName: process.env.TWELVE_DATA_PLAN_NAME ?? null,
                monthlyCostUsd: tdMonthly,
                requestCount: tdCounters.requestCount,
                symbolCounts: tdCounters.symbolCounts,
                lastActivityAt: tdCounters.lastActivityAt,
                configured: tdMonthly != null,
            },
            email: {
                provider: 'resend',
                planName: process.env.RESEND_PLAN_NAME ?? null,
                emailsSent: resendCounters.requestCount,
                failedEmails: resendCounters.failedCount,
                lastEmailAt: resendCounters.lastActivityAt,
                monthlyCostUsd: resendMonthly,
                configured: resendMonthly != null,
            },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[cost/summary]', message);
        res.status(500).json({ ok: false, error: message });
    }
});
/**
 * GET /api/cost/ledger?range=month&provider=all&feature=all&limit=50&offset=0
 */
exports.costRouter.get('/ledger', async (req, res) => {
    try {
        const range = parseRange(req.query.range);
        const provider = typeof req.query.provider === 'string' ? req.query.provider : 'all';
        const feature = typeof req.query.feature === 'string' ? req.query.feature : 'all';
        const limit = Math.min(Number(req.query.limit ?? 50), 200);
        const offset = Math.max(Number(req.query.offset ?? 0), 0);
        const { rows, total } = await (0, ledger_js_1.queryLedger)({ range, provider, feature, limit, offset });
        res.json({ ok: true, range, total, limit, offset, rows });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[cost/ledger]', message);
        res.status(500).json({ ok: false, error: message });
    }
});
/**
 * POST /api/cost/recalculate — dev/admin endpoint to recalculate costs from stored tokens.
 */
exports.costRouter.post('/recalculate', async (_req, res) => {
    res.json({ ok: true, message: 'Recalculation not yet implemented. Costs are calculated at write time.' });
});
// ── helpers ───────────────────────────────────────────────────────────────────
function mergeByKey(items, _key) {
    const map = new Map();
    for (const item of items) {
        const existing = map.get(item.feature) ?? { costUsd: 0, requests: 0, tokens: 0 };
        existing.costUsd += item.costUsd;
        existing.requests += item.requests;
        existing.tokens += item.tokens;
        map.set(item.feature, existing);
    }
    return Array.from(map.entries())
        .map(([feature, v]) => ({ feature, ...v }))
        .sort((a, b) => b.costUsd - a.costUsd);
}
