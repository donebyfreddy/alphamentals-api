import { Router } from 'express';
import { getTradingViewCandlesForReplay } from '../lib/market/tradingViewCandles.js';
import { mapToTradingViewTimeframe } from '../lib/market/symbolMapping.js';
import { getBridgeConfigDiagnostics, getPreferredMarketPrices } from '../../../src/server/mt5BridgeQuotes.js';
import { normalizeApiSymbol, normalizeDisplaySymbol } from '../../../src/services/pairs/symbolNormalizer.js';

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

// Timeframe normalization: frontend short-form → MT5/internal form
const TIMEFRAME_MAP: Record<string, string> = {
  '1m':    'M1',
  '5m':    'M5',
  '15m':   'M15',
  '30m':   'M30',
  '1h':    'H1',
  '4h':    'H4',
  '1d':    'D1',
  '1w':    'W1',
  // Pass-through values already in internal form
  M1: 'M1', M5: 'M5', M15: 'M15', M30: 'M30',
  H1: 'H1', H4: 'H4', D1: 'D1', W1: 'W1',
};

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

    // MT5 bridge candle feed is not yet connected — return empty candles with clear status.
    return res.json({
      ok: true,
      symbol,
      displaySymbol: normalizeDisplaySymbol(symbol),
      timeframe,
      limit,
      candles: [] as unknown[],
      provider: 'mt5-bridge',
      status: 'MT5_BRIDGE_CANDLES_NOT_CONNECTED',
      message: `Candle feed not connected for ${symbol} ${timeframe}. Configure MT5_BRIDGE_URL and ensure the EA is streaming candles.`,
    });
  } catch (err) {
    console.error('[market-data] candles_error', err instanceof Error ? err.message : err);
    res.status(502).json(providerFailureBody(err, (req.query.symbol as string) ?? null));
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
