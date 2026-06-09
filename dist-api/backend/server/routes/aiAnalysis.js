"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiAnalysisRouter = void 0;
const express_1 = require("express");
const aiAnalysisRuns_service_js_1 = require("../services/aiAnalysisRuns.service.js");
exports.aiAnalysisRouter = (0, express_1.Router)();
function isAuthorizedCron(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret)
        return false;
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const headerSecret = req.headers['x-cron-secret'];
    return bearer === secret || headerSecret === secret;
}
// Fast read — never calls AI, returns last saved result instantly
exports.aiAnalysisRouter.get('/latest', async (_req, res) => {
    try {
        const latest = await (0, aiAnalysisRuns_service_js_1.getLatestAiAnalysisResponse)();
        res.json(latest);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load latest AI analysis';
        res.status(500).json({ error: message });
    }
});
// Fast read — returns in-flight job status + latest saved analysis
exports.aiAnalysisRouter.get('/status', (_req, res) => {
    res.json((0, aiAnalysisRuns_service_js_1.getRunJobStatus)());
});
// Fire-and-forget — starts analysis in background, returns immediately with latest saved data.
// This prevents the 12 s proxy timeout from marking the backend unhealthy.
exports.aiAnalysisRouter.post('/run', async (_req, res) => {
    try {
        const startedAt = new Date().toISOString();
        const { status, latestAvailable, generatedAt } = (0, aiAnalysisRuns_service_js_1.getRunJobStatus)();
        if (status === 'running') {
            res.json({ ok: true, status: 'running', startedAt, latestAvailable, generatedAt, message: 'Analysis already running.' });
            return;
        }
        // Kick off analysis without awaiting — responds in <100 ms
        (0, aiAnalysisRuns_service_js_1.runAiAnalysis)({ trigger: 'manual' }).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[ai-analysis] background run failed:', msg);
        });
        res.json({ ok: true, status: 'queued', startedAt, latestAvailable, generatedAt, message: 'Analysis started. Poll /api/ai-analysis/latest for results.' });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start AI analysis';
        res.status(500).json({ error: message });
    }
});
exports.aiAnalysisRouter.post('/cron', async (req, res) => {
    if (!isAuthorizedCron(req)) {
        return res.status(401).json({ error: 'Unauthorized cron request' });
    }
    const scheduleStatus = (0, aiAnalysisRuns_service_js_1.canRunScheduledAiAnalysis)();
    if (!scheduleStatus.allowed) {
        return res.json({
            skipped: true,
            reason: scheduleStatus.reason,
            timezone: 'Europe/Madrid',
            currentMadridIso: scheduleStatus.currentMadridIso,
        });
    }
    try {
        const result = await (0, aiAnalysisRuns_service_js_1.runAiAnalysis)({ trigger: 'cron', bypassCooldown: true });
        res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run scheduled AI analysis';
        res.status(500).json({ error: message });
    }
});
