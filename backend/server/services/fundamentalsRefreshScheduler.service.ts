import { runAiAnalysis } from './aiAnalysisRuns.service.js';
import { normalizeApiSymbol } from '../../../src/services/pairs/symbolNormalizer.js';

const DEFAULT_REFRESH_SYMBOLS = ['XAUUSD', 'GBPUSD', 'EURUSD', 'DXY', 'USOIL'] as const;
const REFRESH_INTERVAL_MINUTES = Number(process.env.AI_ANALYSIS_REFRESH_INTERVAL_MINUTES ?? '3');

function parseRefreshSymbols() {
  const raw = process.env.AI_ANALYSIS_REFRESH_SYMBOLS?.trim();
  const values = raw
    ? raw.split(',').map((symbol) => normalizeApiSymbol(symbol)).filter(Boolean)
    : [...DEFAULT_REFRESH_SYMBOLS];
  return [...new Set(values)];
}

export function getScheduledFundamentalsSymbols() {
  return parseRefreshSymbols();
}

export function getFundamentalsRefreshIntervalMinutes() {
  return REFRESH_INTERVAL_MINUTES > 0 ? REFRESH_INTERVAL_MINUTES : 3;
}

export async function refreshSavedFundamentalsForConfiguredSymbols(source: 'cron' | 'startup' = 'cron') {
  const symbols = getScheduledFundamentalsSymbols();
  const startedAt = new Date().toISOString();
  console.log('[fundamentals-refresh] Sync started', {
    source,
    startedAt,
    symbols,
    intervalMinutes: getFundamentalsRefreshIntervalMinutes(),
  });

  const result = await runAiAnalysis({
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

export function startFundamentalsRefreshScheduler() {
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
