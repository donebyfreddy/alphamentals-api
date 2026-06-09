import { Router } from 'express';
import { getTradingViewCandlesForReplay } from '../lib/market/tradingViewCandles.js';
import { mapToTradingViewTimeframe } from '../lib/market/symbolMapping.js';
import { getBridgeConfigDiagnostics, getPreferredMarketPrices } from '../../../src/server/mt5BridgeQuotes.js';
import { normalizeApiSymbol } from '../../../src/services/pairs/symbolNormalizer.js';

export const marketDataRouter = Router();

// Aliases that may arrive from the frontend (e.g. TVC:DXY, USDX, TVC:USOIL, OIL)
const SYMBOL_ALIASES: Record<string, string> = {
  USDX: 'DXY',
  TVCDXY: 'DXY',
  TVCUSOIL: 'USOIL',
  WTI: 'USOIL',
  WTIUSD: 'USOIL',
  OIL: 'USOIL',
  OILUSD: 'USOIL',
};

function normalizeSymbol(input: string): string {
  return normalizeApiSymbol(SYMBOL_ALIASES[input.toUpperCase().replace(/[^A-Z0-9]/g, '')] ?? input);
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
 * Primary: MT5 bridge live quotes only.
 * TwelveData live quote fallback is disabled by default.
 */
marketDataRouter.get('/quotes', async (req, res) => {
  const symbolsParam = req.query.symbols as string;
  const symbols = symbolsParam
    ? symbolsParam
      .split(',')
      .map((s) => normalizeSymbol(s.trim()))
      .filter((symbol) => isSupportedSymbol(symbol))
    : [];

  try {
    if (!symbolsParam) return res.status(400).json({ error: 'symbols param required' });
    if (!symbols.length) return res.status(400).json({ error: 'No supported symbols requested' });

    const quotes = await getPreferredMarketPrices(symbols);
    res.status(quotes.ok ? 200 : 502).json(quotes);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch MT5 bridge quotes';
    console.error('[Market Data] quotes route failed:', message);
    res.status(502).json({
      ok: false,
      data: {},
      errors: Object.fromEntries(symbols.map((symbol) => [symbol, message])),
      cached: false,
      timestamp: new Date().toISOString(),
      message,
    });
  }
});

marketDataRouter.get('/candles', async (req, res) => {
  try {
    const rawSymbol = (req.query.symbol as string)?.toUpperCase();
    const timeframe = (req.query.timeframe as string) ?? '1h';
    if (!rawSymbol) return res.status(400).json({ error: 'symbol param required' });
    const symbol = normalizeSymbol(rawSymbol);
    if (!isSupportedSymbol(symbol)) return res.status(404).json({ error: 'symbol not enabled' });
    const message = `MT5 bridge candles unavailable for ${symbol} ${timeframe}. Live chart candles are no longer served from TwelveData or Yahoo.`;
    return res.status(501).json({
      success: false,
      provider: 'mt5-bridge',
      symbol,
      timeframe,
      error: 'MT5_BRIDGE_CANDLES_UNAVAILABLE',
      message,
    });
  } catch (err) {
    console.error('[Market Data] candles fetch failed:', err instanceof Error ? err.message : err);
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
 * Returns exact historical OHLCV data centred around the trade entry timestamp.
 * Never falls back to latest candles — returns 502 if TradingView data is unavailable.
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
    console.error(`[Market Data] candles-for-trade TradingView failed — symbol=${symbol} tf=${tvTimeframe} entry=${entryTime}: ${message}`);
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
    console.error('[market-data/technicals]', err);
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
      message: 'Candle routes no longer fall back to TwelveData or Yahoo.',
    },
    bridge: {
      configured: diagnostics.mt5BridgeUrlConfigured && diagnostics.mt5BridgeApiKeyConfigured,
      bridgeUrl: diagnostics.mt5BridgeUrl,
      symbolMap: diagnostics.bridgeSymbolMap,
    },
    timestamp: new Date().toISOString(),
  });
});
