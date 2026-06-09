"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fundamentalsRouter = void 0;
const express_1 = require("express");
const fundamentals_service_js_1 = require("../services/fundamentals.service.js");
const aiAnalysisRuns_service_js_1 = require("../services/aiAnalysisRuns.service.js");
function isAuthorizedCron(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret)
        return false;
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const headerSecret = req.headers['x-cron-secret'] ?? '';
    return bearer === secret || headerSecret === secret;
}
exports.fundamentalsRouter = (0, express_1.Router)();
exports.fundamentalsRouter.get('/', async (_req, res) => {
    try {
        await (0, fundamentals_service_js_1.bootstrapFundamentals)();
        res.json((0, fundamentals_service_js_1.getFundamentalsOverview)());
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load fundamentals overview';
        res.status(500).json({ error: message, detail: 'The fundamentals engine could not build the default overview.' });
    }
});
exports.fundamentalsRouter.get('/overview', async (_req, res) => {
    try {
        await (0, fundamentals_service_js_1.bootstrapFundamentals)();
        let overview = (0, fundamentals_service_js_1.getFundamentalsOverview)();
        if (!overview.lastUpdated && !overview.latestNews.length && !overview.upcomingEvents.length) {
            overview = await (0, fundamentals_service_js_1.refreshFundamentalsData)();
        }
        res.json(overview);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load fundamentals overview';
        res.status(500).json({
            error: message,
            detail: 'Overview route failed. Check backend logs, source config, and DB connectivity.',
        });
    }
});
exports.fundamentalsRouter.post('/refresh', async (req, res) => {
    try {
        const enablePlaywrightFallback = Boolean(req.body?.enablePlaywrightFallback);
        const overview = await (0, fundamentals_service_js_1.refreshFundamentalsData)({ enablePlaywrightFallback, triggeredBy: 'manual' });
        res.json({
            success: true,
            message: 'Source data refreshed. AI analysis updates on the next scheduled run.',
            overview,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh fundamentals';
        res.status(500).json({
            error: message,
            detail: 'Manual refresh failed before a valid overview could be built.',
        });
    }
});
exports.fundamentalsRouter.get('/news', async (_req, res) => {
    try {
        await (0, fundamentals_service_js_1.bootstrapFundamentals)();
        res.json({ items: (0, fundamentals_service_js_1.getFundamentalsNews)() });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load fundamentals news';
        res.status(500).json({ error: message });
    }
});
exports.fundamentalsRouter.get('/events', async (_req, res) => {
    try {
        await (0, fundamentals_service_js_1.bootstrapFundamentals)();
        res.json({ items: (0, fundamentals_service_js_1.getFundamentalsEvents)() });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load fundamentals events';
        res.status(500).json({ error: message });
    }
});
exports.fundamentalsRouter.get('/sources/status', async (_req, res) => {
    try {
        await (0, fundamentals_service_js_1.bootstrapFundamentals)();
        res.json({ items: (0, fundamentals_service_js_1.getFundamentalSourceStatus)() });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load fundamentals source status';
        res.status(500).json({ error: message });
    }
});
// POST /api/fundamentals/cron
// Backwards-compatible alias for the canonical cron endpoint.
// Requires Authorization: Bearer <CRON_SECRET> or X-Cron-Secret header.
exports.fundamentalsRouter.post('/cron', async (req, res) => {
    if (!isAuthorizedCron(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const scheduleStatus = (0, aiAnalysisRuns_service_js_1.canRunScheduledAiAnalysis)();
    if (!scheduleStatus.allowed) {
        res.json({
            skipped: true,
            reason: scheduleStatus.reason,
            timezone: 'Europe/Madrid',
            currentMadridIso: scheduleStatus.currentMadridIso,
            scheduleMetadata: (0, fundamentals_service_js_1.getScheduleMetadata)(),
        });
        return;
    }
    try {
        console.log('[fundamentals/cron] Scheduled AI fundamentals generation triggered', scheduleStatus);
        const result = await (0, aiAnalysisRuns_service_js_1.runAiAnalysis)({ trigger: 'cron', bypassCooldown: true });
        res.json({
            ...result,
            scheduleMetadata: (0, fundamentals_service_js_1.getScheduleMetadata)(),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Cron job failed';
        console.error('[fundamentals/cron] Daily generation failed:', message);
        res.status(500).json({ error: message, scheduleMetadata: (0, fundamentals_service_js_1.getScheduleMetadata)() });
    }
});
exports.fundamentalsRouter.get('/:symbol/latest', async (req, res) => {
    try {
        const payload = await (0, aiAnalysisRuns_service_js_1.getLatestAiAnalysisForSymbolResponse)(req.params.symbol);
        console.log('[fundamentals/latest] Loaded saved AI fundamentals', {
            requestedSymbol: req.params.symbol,
            symbol: payload.symbol,
            status: payload.status,
            hasAnalysis: Boolean(payload.analysis),
            generatedAt: payload.generatedAt,
        });
        res.json(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load saved AI fundamentals';
        console.error('[fundamentals/latest] Failed:', message);
        res.status(500).json({ error: message });
    }
});
exports.fundamentalsRouter.post('/:symbol/run', async (req, res) => {
    try {
        const startedAt = new Date().toISOString();
        const symbol = req.params.symbol;
        const latestAvailable = await (0, aiAnalysisRuns_service_js_1.getLatestAiAnalysisForSymbolResponse)(symbol);
        console.log('[fundamentals/run] Queuing saved AI fundamentals run', {
            requestedSymbol: symbol,
            symbol: latestAvailable.symbol,
            previousGeneratedAt: latestAvailable.generatedAt,
        });
        (0, aiAnalysisRuns_service_js_1.runAiAnalysis)({ trigger: 'manual', symbols: [symbol] }).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[fundamentals/run] background run failed:', msg);
        });
        res.json({
            ok: true,
            status: latestAvailable.status === 'running' ? 'running' : 'queued',
            startedAt,
            symbol: latestAvailable.symbol,
            latestAvailable,
            generatedAt: latestAvailable.generatedAt,
            message: 'Saved AI fundamentals refresh started. Poll /api/fundamentals/:symbol/latest for results.',
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start AI fundamentals run';
        console.error('[fundamentals/run] Failed:', message);
        res.status(500).json({ error: message });
    }
});
exports.fundamentalsRouter.get('/:symbol', async (req, res) => {
    try {
        await (0, fundamentals_service_js_1.bootstrapFundamentals)();
        const payload = (0, fundamentals_service_js_1.getFundamentalsForSymbol)(req.params.symbol);
        res.json(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load pair fundamentals';
        res.status(500).json({ error: message });
    }
});
