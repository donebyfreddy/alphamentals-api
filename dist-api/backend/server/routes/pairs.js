"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairsRouter = void 0;
const express_1 = require("express");
const pairAnalysis_service_js_1 = require("../services/pairAnalysis.service.js");
const pairIntelligenceAI_service_js_1 = require("../services/pairIntelligenceAI.service.js");
exports.pairsRouter = (0, express_1.Router)();
exports.pairsRouter.get('/:symbol/analysis', async (req, res) => {
    try {
        const result = await (0, pairAnalysis_service_js_1.buildPairAnalysis)(req.params.symbol);
        res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to build pair analysis';
        res.status(500).json({ error: message });
    }
});
exports.pairsRouter.post('/:symbol/analysis', async (req, res) => {
    const startedAt = Date.now();
    try {
        const result = await (0, pairAnalysis_service_js_1.buildPairAnalysis)(req.params.symbol, {
            forceRefresh: Boolean(req.body?.forceRefresh ?? true),
            allowLiveAI: true,
            preferSavedAi: false,
        });
        res.json({
            success: true,
            message: 'Analysis updated',
            result,
        });
    }
    catch (error) {
        const err = error instanceof Error ? error : new Error('Failed to generate pair analysis');
        const durationMs = Date.now() - startedAt;
        const timedOut = /timeout/i.test(err.name) || /timeout/i.test(err.message);
        console.error('[pair-ai] analysis failed', {
            symbol: req.params.symbol,
            durationMs,
            errorName: err.name,
            errorMessage: err.message,
        });
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
 * Body: { contexts: PairIntelligenceContext[], deep?: boolean, forceRefresh?: boolean }
 *
 * Analyzes multiple symbols in ONE AI call instead of N separate calls.
 * Cache hits are served without hitting the AI at all.
 */
exports.pairsRouter.post('/batch-intelligence', async (req, res) => {
    try {
        const { contexts, deep, forceRefresh } = req.body;
        if (!Array.isArray(contexts) || contexts.length === 0) {
            return res.status(400).json({ error: 'contexts array required' });
        }
        if (contexts.length > 8) {
            return res.status(400).json({ error: 'max 8 contexts per batch' });
        }
        const results = await (0, pairIntelligenceAI_service_js_1.buildBatchPairIntelligenceAI)(contexts, { deep, forceRefresh });
        res.json({ success: true, results });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Batch intelligence failed';
        res.status(500).json({ error: message });
    }
});
