"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairAiRouter = void 0;
const express_1 = require("express");
const pairAiJob_service_js_1 = require("../services/pairAiJob.service.js");
exports.pairAiRouter = (0, express_1.Router)();
exports.pairAiRouter.post('/analyze', async (req, res) => {
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '';
    const forceRefresh = Boolean(req.body?.forceRefresh ?? true);
    if (!symbol.trim()) {
        return res.status(400).json({ error: 'symbol is required' });
    }
    const job = await (0, pairAiJob_service_js_1.createPairAiJob)(symbol, forceRefresh);
    return res.json({
        jobId: job.jobId,
        status: job.status,
        stage: job.stage,
    });
});
exports.pairAiRouter.get('/analyze/status', (req, res) => {
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : '';
    if (!jobId.trim()) {
        return res.status(400).json({ error: 'jobId is required' });
    }
    const job = (0, pairAiJob_service_js_1.getPairAiJob)(jobId);
    if (!job) {
        return res.status(404).json({ error: 'job not found' });
    }
    if (job.status === 'failed') {
        return res.json({
            status: job.status,
            error: job.error,
            details: job.details,
            diagnostics: job.diagnostics,
        });
    }
    return res.json({
        jobId: job.jobId,
        status: job.status,
        stage: job.stage,
        analysis: job.analysis,
        diagnostics: job.diagnostics,
    });
});
