"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cronRouter = void 0;
const express_1 = require("express");
const aiAnalysisRuns_service_js_1 = require("../services/aiAnalysisRuns.service.js");
const telegramInfo_service_js_1 = require("../services/telegramInfo.service.js");
exports.cronRouter = (0, express_1.Router)();
function isAuthorizedCron(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret)
        return false;
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const headerSecret = req.headers['x-cron-secret'] ?? '';
    return bearer === secret || headerSecret === secret;
}
exports.cronRouter.post('/telegram-sync', async (req, res) => {
    if (!isAuthorizedCron(req)) {
        return res.status(401).json({ error: 'Unauthorized cron request' });
    }
    const limit = typeof req.body?.limit === 'number' ? Math.min(Math.max(req.body.limit, 1), 10) : 10;
    try {
        const result = await (0, telegramInfo_service_js_1.syncTelegramSignals)(limit, {
            source: 'cron',
            enforceRateLimit: false,
        });
        return res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Telegram cron sync failed';
        console.error('[Telegram cron] Failed:', message);
        return res.status(500).json({
            ok: false,
            checkedChannels: 0,
            newMessages: 0,
            newSignals: 0,
            emailsSent: 0,
            errors: [message],
        });
    }
});
exports.cronRouter.post('/fundamentals-ai', async (req, res) => {
    if (!isAuthorizedCron(req)) {
        return res.status(401).json({ error: 'Unauthorized cron request' });
    }
    try {
        const scheduleStatus = (0, aiAnalysisRuns_service_js_1.canRunScheduledAiAnalysis)();
        const force = req.body?.force === true;
        if (!force && !scheduleStatus.allowed) {
            return res.json({
                success: false,
                skipped: true,
                runType: 'scheduled',
                timezone: 'Europe/Madrid',
                reason: scheduleStatus.reason,
                currentMadridIso: scheduleStatus.currentMadridIso,
            });
        }
        const result = await (0, aiAnalysisRuns_service_js_1.runAiAnalysis)({ trigger: force ? 'manual' : 'cron', bypassCooldown: true });
        return res.json({
            success: result.ok,
            runType: force ? 'manual' : 'scheduled',
            timezone: result.timezone ?? 'Europe/Madrid',
            symbolsAnalysed: result.symbols,
            generatedAt: result.analysis?.generatedAt ?? null,
            nextRun: result.nextRun ?? null,
            result,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Fundamentals cron AI run failed';
        console.error('[fundamentals cron] Failed:', message);
        return res.status(500).json({
            success: false,
            runType: 'scheduled',
            timezone: 'Europe/Madrid',
            symbolsAnalysed: [],
            error: message,
        });
    }
});
