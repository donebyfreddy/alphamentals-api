"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScheduledFundamentalsSymbols = getScheduledFundamentalsSymbols;
exports.getFundamentalsRefreshIntervalMinutes = getFundamentalsRefreshIntervalMinutes;
exports.refreshSavedFundamentalsForConfiguredSymbols = refreshSavedFundamentalsForConfiguredSymbols;
exports.startFundamentalsRefreshScheduler = startFundamentalsRefreshScheduler;
const aiAnalysisRuns_service_js_1 = require("./aiAnalysisRuns.service.js");
const symbolNormalizer_js_1 = require("../../../src/services/pairs/symbolNormalizer.js");
const DEFAULT_REFRESH_SYMBOLS = ['XAUUSD', 'GBPUSD', 'EURUSD', 'DXY', 'USOIL'];
const REFRESH_INTERVAL_MINUTES = Number(process.env.AI_ANALYSIS_REFRESH_INTERVAL_MINUTES ?? '3');
function parseRefreshSymbols() {
    const raw = process.env.AI_ANALYSIS_REFRESH_SYMBOLS?.trim();
    const values = raw
        ? raw.split(',').map((symbol) => (0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol)).filter(Boolean)
        : [...DEFAULT_REFRESH_SYMBOLS];
    return [...new Set(values)];
}
function getScheduledFundamentalsSymbols() {
    return parseRefreshSymbols();
}
function getFundamentalsRefreshIntervalMinutes() {
    return REFRESH_INTERVAL_MINUTES > 0 ? REFRESH_INTERVAL_MINUTES : 3;
}
async function refreshSavedFundamentalsForConfiguredSymbols(source = 'cron') {
    const symbols = getScheduledFundamentalsSymbols();
    const startedAt = new Date().toISOString();
    console.log('[fundamentals-refresh] Sync started', {
        source,
        startedAt,
        symbols,
        intervalMinutes: getFundamentalsRefreshIntervalMinutes(),
    });
    const result = await (0, aiAnalysisRuns_service_js_1.runAiAnalysis)({
        trigger: source === 'startup' ? 'startup' : 'cron',
        bypassCooldown: true,
        symbols,
    });
    console.log('[fundamentals-refresh] Sync finished', {
        source,
        startedAt,
        finishedAt: result.finishedAt,
        ok: result.ok,
        symbolsChecked: symbols.length,
        savedSymbols: result.analysis ? Object.keys(result.analysis.symbols).length : 0,
        error: result.error ?? null,
    });
    return {
        ok: result.ok,
        startedAt,
        finishedAt: result.finishedAt,
        checkedSymbols: symbols.length,
        refreshedSymbols: result.analysis ? Object.keys(result.analysis.symbols).length : 0,
        symbols,
        error: result.error ?? null,
    };
}
function startFundamentalsRefreshScheduler() {
    const intervalMinutes = getFundamentalsRefreshIntervalMinutes();
    const intervalMs = Math.max(1, intervalMinutes) * 60_000;
    const symbols = getScheduledFundamentalsSymbols();
    console.log('[fundamentals-refresh] Automatic saved AI fundamentals scheduler enabled', {
        intervalMinutes,
        symbols,
    });
    setImmediate(() => {
        void refreshSavedFundamentalsForConfiguredSymbols('startup').catch((error) => {
            console.error('[fundamentals-refresh] Startup refresh failed:', error instanceof Error ? error.message : String(error));
        });
    });
    setInterval(() => {
        void refreshSavedFundamentalsForConfiguredSymbols('cron').catch((error) => {
            console.error('[fundamentals-refresh] Scheduled refresh failed:', error instanceof Error ? error.message : String(error));
        });
    }, intervalMs);
}
