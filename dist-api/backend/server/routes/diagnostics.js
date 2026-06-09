"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnosticsRouter = void 0;
const express_1 = require("express");
const aiDiagnostics_js_1 = require("../lib/aiDiagnostics.js");
const cache_js_1 = require("../lib/cache.js");
exports.diagnosticsRouter = (0, express_1.Router)();
/**
 * GET /api/diagnostics
 * Returns AI performance metrics, cache stats, and rate-limit status.
 */
exports.diagnosticsRouter.get('/', (_req, res) => {
    const ai = (0, aiDiagnostics_js_1.getDiagnostics)();
    const cache = (0, cache_js_1.stats)();
    res.json({
        timestamp: Date.now(),
        ai,
        cache: {
            entries: cache.size,
            keys: cache.keys.filter((k) => k.startsWith('pair-intel-ai:')),
        },
        marketData: {
            provider: 'mt5-bridge',
            quoteTtlSeconds: 15,
            candleTtlSeconds: { intraday: 0, daily: 0 },
        },
    });
});
/**
 * POST /api/diagnostics/clear-cooldown
 * Manually clears an active AI rate-limit cooldown (use after confirming quota reset).
 */
exports.diagnosticsRouter.post('/clear-cooldown', (_req, res) => {
    (0, aiDiagnostics_js_1.clearCooldown)();
    res.json({ success: true, message: 'AI cooldown cleared' });
});
