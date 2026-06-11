/**
 * MT5 candle service — the ONLY candle source for technical analysis.
 *
 * Candles come exclusively from the Windows VPS MetaTrader 5 terminal via the
 * local Python MT5 bridge (http://127.0.0.1:8001). No external candle
 * providers (TradingView/Yahoo/TwelveData/...) are used here.
 *
 * Caching is tiered to avoid hammering the terminal:
 *   M5/M15  → 30 s
 *   H1/H4   → 120 s
 *   D1/W1   → 10 min
 * Regenerate/debug paths can pass { forceRefresh: true }.
 */

import * as cache from '../lib/cache.js';

export type Mt5Timeframe = 'W1' | 'D1' | 'H4' | 'H1' | 'M15';

export interface Mt5Candle {
  time: string; // ISO-8601 UTC
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number | null;
  realVolume: number;
}

export interface TimeframeCandleResult {
  timeframe: Mt5Timeframe;
  status: 'ok' | 'insufficient_data' | 'error';
  candles: Mt5Candle[];
  available: number;
  required: number;
  resolvedSymbol: string | null;
  source: 'mt5-python-bridge';
  error: string | null;
  message: string | null;
  fetchedAt: string;
}

export interface SymbolCandleBundle {
  symbol: string;
  ok: boolean;
  bridgeReachable: boolean;
  terminalConnected: boolean;
  timeframes: Record<Mt5Timeframe, TimeframeCandleResult>;
  warnings: string[];
}

export const REQUIRED_CANDLES: Record<Mt5Timeframe, number> = {
  W1: 80,
  D1: 120,
  H4: 200,
  H1: 300,
  M15: 300,
};

export const ALL_TIMEFRAMES: Mt5Timeframe[] = ['W1', 'D1', 'H4', 'H1', 'M15'];

const CACHE_TTL_MS: Record<Mt5Timeframe, number> = {
  M15: 30_000,
  H1: 120_000,
  H4: 120_000,
  D1: 10 * 60_000,
  W1: 10 * 60_000,
};

function bridgeBaseUrl(): string {
  return (process.env.MT5_BRIDGE_URL ?? 'http://127.0.0.1:8001').replace(/\/+$/, '');
}

function bridgeTimeoutMs(): number {
  const raw = Number(process.env.MT5_BRIDGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
}

function bridgeHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = process.env.MT5_BRIDGE_API_KEY ?? process.env.MT5_API_KEY;
  if (key?.trim()) headers['x-api-key'] = key.trim();
  return headers;
}

async function bridgeGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bridgeTimeoutMs());
  try {
    const res = await fetch(`${bridgeBaseUrl()}${path}`, {
      headers: bridgeHeaders(),
      signal: controller.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`MT5 bridge returned non-JSON (HTTP ${res.status}): ${text.slice(0, 160)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

interface BridgeCandlesResponse {
  ok: boolean;
  error?: string;
  message?: string;
  symbol?: string;
  resolvedSymbol?: string;
  timeframe?: string;
  count?: number;
  candles?: Mt5Candle[];
  status?: string;
}

interface BridgeBulkResponse {
  ok: boolean;
  error?: string;
  message?: string;
  data?: Record<string, Record<string, BridgeCandlesResponse>>;
}

function emptyResult(timeframe: Mt5Timeframe, error: string, message: string): TimeframeCandleResult {
  return {
    timeframe,
    status: 'error',
    candles: [],
    available: 0,
    required: REQUIRED_CANDLES[timeframe],
    resolvedSymbol: null,
    source: 'mt5-python-bridge',
    error,
    message,
    fetchedAt: new Date().toISOString(),
  };
}

function toResult(timeframe: Mt5Timeframe, payload: BridgeCandlesResponse): TimeframeCandleResult {
  const required = REQUIRED_CANDLES[timeframe];
  const candles = payload.candles ?? [];

  if (!payload.ok) {
    return {
      ...emptyResult(timeframe, payload.error ?? 'MT5_CANDLES_FAILED', payload.message ?? 'MT5 bridge returned an error.'),
      resolvedSymbol: payload.resolvedSymbol ?? null,
    };
  }

  const status: TimeframeCandleResult['status'] = candles.length >= required ? 'ok' : 'insufficient_data';
  return {
    timeframe,
    status,
    candles,
    available: candles.length,
    required,
    resolvedSymbol: payload.resolvedSymbol ?? null,
    source: 'mt5-python-bridge',
    error: status === 'insufficient_data' ? 'INSUFFICIENT_CANDLE_DATA' : null,
    message: status === 'insufficient_data'
      ? `Only ${candles.length} ${timeframe} candles available; need at least ${required}. Open the ${timeframe} chart in MT5 to download more history.`
      : null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Compact symbol for the bridge (XAU/USD → XAUUSD). */
function compactSymbol(symbol: string): string {
  return symbol.replace(/[/\s]/g, '').toUpperCase();
}

// ── Single timeframe ──────────────────────────────────────────────────────────

export async function getMt5Candles(
  symbol: string,
  timeframe: Mt5Timeframe,
  options?: { count?: number; forceRefresh?: boolean },
): Promise<TimeframeCandleResult> {
  const compact = compactSymbol(symbol);
  const count = options?.count ?? Math.max(REQUIRED_CANDLES[timeframe], 300);
  const cacheKey = `mt5:candles:${compact}:${timeframe}:${count}`;

  if (!options?.forceRefresh) {
    const cached = cache.get<TimeframeCandleResult>(cacheKey);
    if (cached) return cached;
  }

  const candlesPath = `/candles?symbol=${encodeURIComponent(compact)}&timeframe=${timeframe}&count=${count}`;
  console.log(`[mt5-candles] symbol=${compact} tf=${timeframe} count=${count} url=${bridgeBaseUrl()}${candlesPath}`);

  let result: TimeframeCandleResult;
  try {
    const payload = await bridgeGet<BridgeCandlesResponse>(candlesPath);
    result = toResult(timeframe, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    result = emptyResult(
      timeframe,
      isAbort ? 'MT5_BRIDGE_TIMEOUT' : 'MT5_BRIDGE_UNREACHABLE',
      isAbort
        ? `MT5 bridge did not respond within ${bridgeTimeoutMs()}ms.`
        : `MT5 bridge unreachable at ${bridgeBaseUrl()}: ${message}. Start it with PM2 (mt5-bridge) on the VPS.`,
    );
  }

  // Cache only successful/insufficient results; failed bridge calls get a short negative cache
  const ttl = result.status === 'error' ? 10_000 : CACHE_TTL_MS[timeframe];
  cache.set(cacheKey, result, ttl);
  console.log(`[mt5-candles] done symbol=${compact} tf=${timeframe} status=${result.status} available=${result.available}/${result.required} resolvedSymbol=${result.resolvedSymbol ?? 'n/a'}`);
  return result;
}

// ── Full bundle (all timeframes via /candles/bulk) ───────────────────────────

export async function getMt5CandleBundle(
  symbol: string,
  options?: { timeframes?: Mt5Timeframe[]; count?: number; forceRefresh?: boolean },
): Promise<SymbolCandleBundle> {
  const compact = compactSymbol(symbol);
  const timeframes = options?.timeframes ?? ALL_TIMEFRAMES;
  const count = options?.count ?? 300;
  const cacheKey = `mt5:bundle:${compact}:${timeframes.join('-')}:${count}`;

  if (!options?.forceRefresh) {
    const cached = cache.get<SymbolCandleBundle>(cacheKey);
    if (cached) return cached;
  }

  const warnings: string[] = [];
  const tfResults = {} as Record<Mt5Timeframe, TimeframeCandleResult>;
  let bridgeReachable = false;
  let terminalConnected = false;

  try {
    const payload = await bridgeGet<BridgeBulkResponse>(
      `/candles/bulk?symbols=${encodeURIComponent(compact)}&timeframes=${timeframes.join(',')}&count=${count}`,
    );
    bridgeReachable = true;

    if (!payload.ok) {
      const message = payload.message ?? 'MT5 bulk candle fetch failed.';
      warnings.push(message);
      for (const tf of timeframes) {
        tfResults[tf] = emptyResult(tf, payload.error ?? 'MT5_NOT_CONNECTED', message);
      }
    } else {
      terminalConnected = true;
      const symbolData = payload.data?.[compact] ?? {};
      for (const tf of timeframes) {
        const tfPayload = symbolData[tf];
        tfResults[tf] = tfPayload
          ? toResult(tf, tfPayload)
          : emptyResult(tf, 'MT5_TIMEFRAME_MISSING', `Bridge returned no data block for ${tf}.`);
        if (tfResults[tf].status !== 'ok' && tfResults[tf].message) {
          warnings.push(`${tf}: ${tfResults[tf].message}`);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`MT5 bridge unreachable: ${message}`);
    for (const tf of timeframes) {
      tfResults[tf] = emptyResult(
        tf,
        'MT5_BRIDGE_UNREACHABLE',
        `MT5 bridge unreachable at ${bridgeBaseUrl()}. Start it on the VPS: pm2 start mt5-bridge.`,
      );
    }
  }

  const bundle: SymbolCandleBundle = {
    symbol: compact,
    ok: timeframes.some((tf) => tfResults[tf].status === 'ok'),
    bridgeReachable,
    terminalConnected,
    timeframes: tfResults,
    warnings,
  };

  // Short TTL — the bundle mixes tiers, so use the smallest (30 s) when healthy.
  cache.set(cacheKey, bundle, bundle.ok ? 30_000 : 10_000);
  console.log(`[mt5-candles] bundle ${compact}: ok=${bundle.ok} bridge=${bridgeReachable} terminal=${terminalConnected}`);
  return bundle;
}

// ── Bridge health ─────────────────────────────────────────────────────────────

export interface Mt5BridgeStatus {
  bridgeUrl: string;
  bridgeReachable: boolean;
  terminalConnected: boolean;
  accountLogin: string | null;
  server: string | null;
  error: string | null;
  lastCheckAt: string;
}

export async function getMt5BridgeStatus(): Promise<Mt5BridgeStatus> {
  const cacheKey = 'mt5:bridge-status';
  const cached = cache.get<Mt5BridgeStatus>(cacheKey);
  if (cached) return cached;

  const base: Mt5BridgeStatus = {
    bridgeUrl: bridgeBaseUrl(),
    bridgeReachable: false,
    terminalConnected: false,
    accountLogin: null,
    server: null,
    error: null,
    lastCheckAt: new Date().toISOString(),
  };

  try {
    const status = await bridgeGet<{
      ok: boolean;
      mt5Initialized?: boolean;
      error?: string;
      account?: { login?: string; server?: string } | null;
    }>('/status');
    base.bridgeReachable = true;
    base.terminalConnected = Boolean(status.ok && status.mt5Initialized);
    base.accountLogin = status.account?.login ?? null;
    base.server = status.account?.server ?? null;
    base.error = status.ok ? null : status.error ?? 'MT5 terminal not connected';
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
  }

  cache.set(cacheKey, base, 30_000);
  return base;
}
