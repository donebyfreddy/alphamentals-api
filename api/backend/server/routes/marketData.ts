import { Router } from 'express';
import { getTradingViewCandlesForReplay } from '../lib/market/tradingViewCandles.js';
import { mapToTradingViewTimeframe } from '../lib/market/symbolMapping.js';
import { getBridgeConfigDiagnostics, getPreferredMarketPrices } from '../../../src/server/mt5BridgeQuotes.js';
import { normalizeApiSymbol, normalizeDisplaySymbol } from '../../../src/services/pairs/symbolNormalizer.js';
import {
  getMt5Candles,
  getMt5CandleBundle,
  getMt5BridgeStatus,
  REQUIRED_CANDLES,
  ALL_TIMEFRAMES,
  type Mt5Timeframe,
} from '../services/mt5Candles.service.js';

const MT5_TF_SET: Mt5Timeframe[] = ['W1', 'D1', 'H4', 'H1', 'M15'];

/** Map any incoming timeframe form to a supported MT5 timeframe (or null). */
function toMt5Timeframe(tf: string): Mt5Timeframe | null {
  const norm = normalizeTimeframe(tf).toUpperCase();
  return MT5_TF_SET.includes(norm as Mt5Timeframe) ? (norm as Mt5Timeframe) : null;
}

export const marketDataRouter = Router();

// Aliases that may arrive from the frontend (e.g. TVC:DXY, USDX, TVC:USOIL, OIL, XAU/USD)
const SYMBOL_ALIASES: Record<string, string> = {
  USDX: 'DXY',
  TVCDXY: 'DXY',
  TVCUSOIL: 'USOIL',
  WTI: 'USOIL',
  WTIUSD: 'USOIL',
  OIL: 'USOIL',
  OILUSD: 'USOIL',
};

// Timeframe normalization: frontend short-form / display form → MT5/internal form.
// Handles: 1h / 1H / H1, 4h / 4H / H4, 15m / 15M / M15, 1d / D1, 1w / W1,
//          Weekly, Daily, and already-canonical MT5 forms.
const TIMEFRAME_MAP: Record<string, string> = {
  // Lowercase short-forms (TradingView-style)
  '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
  '1h': 'H1', '4h': 'H4', '1d': 'D1', '1w': 'W1',
  // Mixed-case display forms (e.g. frontend sends "1H", "4H", "15M", "Weekly")
  '1H': 'H1', '4H': 'H4', '15M': 'M15', '30M': 'M30',
  '1D': 'D1', '1W': 'W1',
  'Weekly': 'W1', 'WEEKLY': 'W1',
  'Daily': 'D1', 'DAILY': 'D1',
  // Pass-through canonical MT5 forms
  M1: 'M1', M5: 'M5', M15: 'M15', M30: 'M30',
  H1: 'H1', H4: 'H4', D1: 'D1', W1: 'W1', MN1: 'MN1',
};

/**
 * Canonical timeframe normalizer.
 * Maps any known input form to the MT5 canonical string (H4, H1, M15, D1, W1).
 * Unknown inputs fall back to the uppercase form.
 */
export function normalizeTimeframe(tf: string): string {
  return TIMEFRAME_MAP[tf] ?? TIMEFRAME_MAP[tf.toUpperCase()] ?? tf.toUpperCase();
}

function normalizeSymbol(input: string): string {
  const stripped = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalizeApiSymbol(SYMBOL_ALIASES[stripped] ?? stripped);
}

/** Controlled JSON error body so the frontend never receives raw HTML. */
function providerFailureBody(err: unknown, symbol: string | null) {
  const detail = err instanceof Error ? err.message : 'Unknown provider error';
  const isHtml = /non-json|<!doctype|<html/i.test(detail);
  return {
    success: false,
    error: isHtml ? 'NON_JSON_RESPONSE' : 'PROVIDER_ERROR',
    message: isHtml
      ? 'Trading data provider returned HTML instead of JSON'
      : 'Trading data provider request failed',
    pair: symbol,
    status: 502,
    detail,
  };
}

// Explicit allowlist for short symbols that don't match the standard 6-char forex pattern
const SHORT_SYMBOL_ALLOWLIST = new Set(['DXY', 'USOIL', 'WTI', 'OIL', 'NAS100', 'US30', 'US500']);

function isSupportedSymbol(symbol: string): boolean {
  if (SHORT_SYMBOL_ALLOWLIST.has(symbol)) return true;
  return /^[A-Z0-9]{6,12}$/.test(symbol);
}

/**
 * GET /api/market-data/quotes?symbols=EURUSD,GBPUSD,XAUUSD
 *
 * Accepts slash-formatted symbols (XAU/USD, EUR/USD) and normalizes them.
 * Primary source: MT5 bridge live quotes.
 */
marketDataRouter.get('/quotes', async (req, res) => {
  const symbolsParam = req.query.symbols as string;

  if (!symbolsParam) {
    return res.status(400).json({ ok: false, error: 'symbols param required' });
  }

  const requestedRaw = symbolsParam.split(',').map((s) => s.trim());
  const requestedMap: Record<string, string> = {};
  for (const raw of requestedRaw) {
    const normalized = normalizeSymbol(raw);
    requestedMap[normalized] = raw;
  }

  const symbols = Object.keys(requestedMap).filter((s) => isSupportedSymbol(s));

  console.log('[market-data] quote_request', { raw: symbolsParam, normalized: symbols });

  if (!symbols.length) {
    return res.status(400).json({ ok: false, error: 'No supported symbols requested' });
  }

  try {
    const quotes = await getPreferredMarketPrices(symbols);

    // Enrich each entry with displaySymbol and requestedSymbol
    const enriched: Record<string, unknown> = {};
    for (const [sym, entry] of Object.entries(quotes.data)) {
      enriched[sym] = {
        ...entry,
        displaySymbol: normalizeDisplaySymbol(sym),
        requestedSymbol: requestedMap[sym] ?? sym,
      };
    }

    console.log('[market-data] quote_response', { symbols, ok: quotes.ok });

    res.status(quotes.ok ? 200 : 502).json({
      ...quotes,
      data: enriched,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch MT5 bridge quotes';
    console.error('[market-data] quote_error', { symbols, message });
    res.status(502).json({
      ok: false,
      data: {},
      errors: Object.fromEntries(symbols.map((s) => [s, message])),
      cached: false,
      timestamp: new Date().toISOString(),
      message,
    });
  }
});

/**
 * GET /api/market-data/candles?symbol=XAUUSD&timeframe=M15&limit=200
 *
 * Accepts both short-form (15m, 1h) and internal (M15, H1) timeframes.
 * Returns a JSON response — never HTML. Currently returns empty candles when
 * the MT5 bridge candle feed is not connected.
 */
marketDataRouter.get('/candles', async (req, res) => {
  try {
    const rawSymbol = (req.query.symbol as string)?.toUpperCase();
    const rawTimeframe = (req.query.timeframe as string) ?? 'M15';
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 1000) : 200;

    if (!rawSymbol) return res.status(400).json({ ok: false, error: 'symbol param required' });

    const symbol = normalizeSymbol(rawSymbol);
    const timeframe = normalizeTimeframe(rawTimeframe);

    if (!isSupportedSymbol(symbol)) {
      return res.status(404).json({ ok: false, error: 'symbol not enabled', symbol });
    }

    console.log('[market-data] candles_request', { symbol, timeframe, limit });

    const mt5Tf = toMt5Timeframe(rawTimeframe);
    if (!mt5Tf) {
      return res.status(400).json({
        ok: false, error: 'INVALID_TIMEFRAME', symbol, timeframe,
        message: `Timeframe '${rawTimeframe}' is not supported. Supported: ${MT5_TF_SET.join(', ')}. Also accepted: W1, D1, H4, H1, M15, 1w, 1d, 4h, 1h, 15m and their equivalents.`,
      });
    }

    const count = req.query.count ? Math.min(Number(req.query.count), 5000) : limit;
    const result = await getMt5Candles(symbol, mt5Tf, { count, forceRefresh: req.query.refresh === 'true' });

    if (result.status === 'error') {
      return res.status(502).json({
        ok: false, error: result.error ?? 'MT5_CANDLES_FAILED', symbol,
        displaySymbol: normalizeDisplaySymbol(symbol), timeframe: mt5Tf,
        source: 'mt5-python-bridge', message: result.message, candles: [],
      });
    }
    if (result.status === 'insufficient_data') {
      return res.json({
        ok: false, error: 'INSUFFICIENT_CANDLE_DATA', symbol,
        displaySymbol: normalizeDisplaySymbol(symbol), timeframe: mt5Tf,
        source: 'mt5-python-bridge', message: result.message,
        details: { symbol, timeframe: mt5Tf, available: result.available, required: result.required, source: 'mt5-python-bridge' },
        candles: result.candles,
      });
    }
    return res.json({
      ok: true, symbol, displaySymbol: normalizeDisplaySymbol(symbol),
      timeframe: mt5Tf, source: 'mt5-python-bridge', count: result.available, candles: result.candles,
    });
  } catch (err) {
    console.error('[market-data] candles_error', err instanceof Error ? err.message : err);
    res.status(502).json(providerFailureBody(err, (req.query.symbol as string) ?? null));
  }
});

// ── GET /candles/bulk?symbols=...&timeframes=W1,D1,...&count=300 ───────────────
marketDataRouter.get('/candles/bulk', async (req, res) => {
  try {
    const symbols = String(req.query.symbols ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const tfRaw = String(req.query.timeframes ?? 'W1,D1,H4,H1,M15').split(',').map((s) => s.trim()).filter(Boolean);
    const count = req.query.count ? Math.min(Number(req.query.count), 5000) : 300;

    if (!symbols.length) return res.status(400).json({ ok: false, error: 'symbols param required' });

    const timeframes = tfRaw.map(toMt5Timeframe).filter((t): t is Mt5Timeframe => t !== null);
    if (!timeframes.length) return res.status(400).json({ ok: false, error: 'INVALID_TIMEFRAME', message: `Supported timeframes: ${MT5_TF_SET.join(', ')}` });

    const data: Record<string, unknown> = {};
    for (const sym of symbols) {
      const normalized = normalizeSymbol(sym);
      const bundle = await getMt5CandleBundle(normalized, { timeframes, count, forceRefresh: req.query.refresh === 'true' });
      data[normalized] = bundle.timeframes;
    }
    return res.json({ ok: true, source: 'mt5-python-bridge', count, data, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[market-data] candles_bulk_error', err instanceof Error ? err.message : err);
    res.status(502).json({ ok: false, error: 'CANDLES_BULK_ERROR', message: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── GET /candles/diagnostics ──────────────────────────────────────────────────
marketDataRouter.get('/candles/diagnostics', async (req, res) => {
  try {
    const symbols = String(req.query.symbols ?? 'XAUUSD,EURUSD,GBPUSD,DXY,USOIL')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const bridge = await getMt5BridgeStatus();

    const candles: Record<string, Record<string, { available: number; required: number; ok: boolean }>> = {};
    for (const sym of symbols) {
      const normalized = normalizeSymbol(sym);
      const bundle = await getMt5CandleBundle(normalized);
      const perTf: Record<string, { available: number; required: number; ok: boolean }> = {};
      for (const tf of ALL_TIMEFRAMES) {
        const r = bundle.timeframes[tf];
        perTf[tf] = { available: r?.available ?? 0, required: REQUIRED_CANDLES[tf], ok: (r?.status ?? 'error') === 'ok' };
      }
      candles[normalized] = perTf;
    }

    res.json({
      ok: true,
      mt5: {
        bridgeUrl: bridge.bridgeUrl,
        bridgeReachable: bridge.bridgeReachable,
        terminalConnected: bridge.terminalConnected,
        accountLogin: bridge.accountLogin,
        server: bridge.server,
        lastCheckAt: bridge.lastCheckAt,
        error: bridge.error,
      },
      candles,
      hint: 'If candle counts are low, open the symbol charts in MT5 on the VPS so the terminal downloads history.',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'CANDLES_DIAGNOSTICS_ERROR', message: err instanceof Error ? err.message : 'Unknown error' });
  }
});

const HOUR_MS = 60 * 60 * 1000;

function pickTimeframe(entryTime: string, exitTime?: string): string {
  const entryMs = new Date(entryTime).getTime();
  const exitMs = exitTime ? new Date(exitTime).getTime() : entryMs;
  const durationMs = exitMs - entryMs;
  if (durationMs < 4 * HOUR_MS) return 'M15';
  if (durationMs < 24 * HOUR_MS) return 'H1';
  return 'H4';
}

/**
 * GET /api/market-data/candles-for-trade
 *   ?symbol=EURUSD&entryTime=ISO&exitTime=ISO&timeframe=H1&before=150&after=150
 *
 * Source: TradingView historical candles only.
 */
marketDataRouter.get('/candles-for-trade', async (req, res) => {
  const symbol = (req.query.symbol as string)?.toUpperCase();
  const entryTime = req.query.entryTime as string;
  const exitTime = req.query.exitTime as string | undefined;
  const beforeCandles = req.query.before ? Number(req.query.before) : 150;
  const afterCandles = req.query.after ? Number(req.query.after) : 150;

  if (!symbol) {
    res.status(400).json({ error: 'symbol param required' });
    return;
  }
  if (!entryTime) {
    res.status(400).json({ error: 'entryTime param required — cannot load historical candles without trade timestamp' });
    return;
  }
  if (Number.isNaN(new Date(entryTime).getTime())) {
    res.status(400).json({ error: `Invalid entryTime: "${entryTime}"` });
    return;
  }

  const timeframe = (req.query.timeframe as string | undefined) ?? pickTimeframe(entryTime, exitTime);
  const tvTimeframe = mapToTradingViewTimeframe(timeframe);

  try {
    const result = await getTradingViewCandlesForReplay({
      symbol,
      timeframe,
      entryTime,
      beforeCandles,
      afterCandles,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[market-data] candles-for-trade TradingView failed — symbol=${symbol} tf=${tvTimeframe} entry=${entryTime}: ${message}`);
    res.status(502).json({
      error: 'Could not load TradingView historical candles for this trade.',
      reason: message,
      symbol,
      timeframe,
      tvTimeframe,
      entryTime,
    });
  }
});

marketDataRouter.get('/technicals', async (req, res) => {
  try {
    const rawSymbol = (req.query.symbol as string)?.toUpperCase();
    const timeframe = (req.query.interval as string) ?? '1d';
    if (!rawSymbol) return res.status(400).json({ error: 'symbol param required' });
    const symbol = normalizeSymbol(rawSymbol);
    if (!isSupportedSymbol(symbol)) return res.status(404).json({ error: 'symbol not enabled' });
    res.json({
      symbol,
      timeframe,
      available: false,
      source: 'mt5-bridge',
      error: `Technical candle context unavailable for ${symbol}. No MT5 candle feed is configured for this route.`,
    });
  } catch (err) {
    console.error('[market-data] technicals_error', err);
    res.status(502).json(providerFailureBody(err, (req.query.symbol as string) ?? null));
  }
});

marketDataRouter.get('/debug/market-provider', (_req, res) => {
  const diagnostics = getBridgeConfigDiagnostics();
  res.json({
    provider: 'mt5-bridge',
    liveQuotes: {
      provider: 'mt5-bridge',
      fallbackEnabled: false,
      twelvedataEnabled: diagnostics.enableTwelveDataQuotes,
      twelvedataUsedForLiveQuotes: false,
    },
    candles: {
      provider: 'unavailable',
      message: 'Candle routes require MT5 bridge candle feed to be connected.',
    },
    bridge: {
      configured: diagnostics.mt5BridgeUrlConfigured && diagnostics.mt5BridgeApiKeyConfigured,
      bridgeUrl: diagnostics.mt5BridgeUrl,
      symbolMap: diagnostics.bridgeSymbolMap,
    },
    timestamp: new Date().toISOString(),
  });
});
