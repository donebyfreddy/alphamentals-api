import * as cache from './cache.js';

const YAHOO_BASE = 'https://query1.finance.yahoo.com';

const SYMBOL_MAP: Record<string, string> = {
  EURUSD: 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  USDJPY: 'USDJPY=X',
  USDCHF: 'USDCHF=X',
  AUDUSD: 'AUDUSD=X',
  USDCAD: 'USDCAD=X',
  NZDUSD: 'NZDUSD=X',
  GBPJPY: 'GBPJPY=X',
  EURJPY: 'EURJPY=X',
  XAUUSD: 'XAUUSD=X',
  XAGUSD: 'SI=F',
  NAS100: 'NQ=F',
  US30:   'YM=F',
  US500:  'ES=F',
  BTCUSD: 'BTC-USD',
  ETHUSD: 'ETH-USD',
};

const SYMBOL_FALLBACKS: Record<string, string[]> = {
  XAUUSD: ['XAUUSD=X', 'GC=F'],
  XAGUSD: ['XAGUSD=X', 'SI=F'],
};

function toYahoo(symbol: string, fallbackIndex = 0): string {
  const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()];
  if (fallbacks?.[fallbackIndex]) return fallbacks[fallbackIndex];
  return SYMBOL_MAP[symbol.toUpperCase()] ?? `${symbol}=X`;
}

async function yahooFetch<T>(path: string, ttlMs: number): Promise<T> {
  const cached = cache.get<T>(path);
  if (cached) return cached;

  const res = await fetch(`${YAHOO_BASE}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);
  const data = (await res.json()) as T;
  cache.set(path, data, ttlMs);
  return data;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  timestamp: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface YahooChartMeta {
  regularMarketPrice: number;
  previousClose: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketTime: number;
}

interface YahooChartResult {
  meta: YahooChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }>;
  };
}

interface YahooChartResponse {
  chart: { result: YahooChartResult[] | null; error: unknown };
}

async function fetchQuoteForYahooSymbol(symbol: string, ySymbol: string): Promise<Quote> {
  const path = `/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=1d`;
  const data = await yahooFetch<YahooChartResponse>(path, 15_000);
  const result = data.chart.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);
  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prev = meta.previousClose || price;
  const change = price - prev;
  const spread = price * 0.0002;
  return {
    symbol,
    bid: price - spread / 2,
    ask: price + spread / 2,
    mid: price,
    spread,
    change,
    changePct: (change / prev) * 100,
    high: meta.regularMarketDayHigh || price,
    low: meta.regularMarketDayLow || price,
    timestamp: meta.regularMarketTime * 1000,
  };
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()] ?? [toYahoo(symbol)];
  let lastErr: unknown;
  for (const ySymbol of fallbacks) {
    try {
      return await fetchQuoteForYahooSymbol(symbol, ySymbol);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`No data for ${symbol}`);
}

async function fetchCandlesForYahooSymbol(ySymbol: string, timeframe = '1h'): Promise<Candle[]> {
  const rangeMap: Record<string, string> = { '1m': '1d', '5m': '5d', '15m': '5d', '1h': '60d', '4h': '60d', '1d': '1y' };
  const range = rangeMap[timeframe] ?? '60d';
  const path = `/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=${timeframe}&range=${range}`;
  const data = await yahooFetch<YahooChartResponse>(path, 60_000);
  const result = data.chart.result?.[0];
  if (!result?.timestamp) return [];
  const q = result.indicators?.quote?.[0];
  if (!q) return [];
  return result.timestamp
    .map((t, i) => ({
      time: t,
      open: q.open[i] ?? 0,
      high: q.high[i] ?? 0,
      low: q.low[i] ?? 0,
      close: q.close[i] ?? 0,
      volume: q.volume[i] ?? 0,
    }))
    .filter((c) => c.close > 0);
}

export async function fetchIntradayQuote(symbol: string): Promise<Quote> {
  const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()] ?? [toYahoo(symbol)];
  let candles: Candle[] = [];
  let lastErr: unknown;
  for (const ySymbol of fallbacks) {
    try {
      candles = await fetchCandlesForYahooSymbol(ySymbol, '1m');
      if (candles.length) break;
    } catch (err) {
      lastErr = err;
    }
  }

  const latest = candles.at(-1);
  const previous = candles.at(-2) ?? latest;
  if (!latest || !previous) {
    if (lastErr) console.warn(`[yahoo] ${symbol} 1m fallback failed:`, lastErr instanceof Error ? lastErr.message : lastErr);
    return fetchQuote(symbol);
  }

  const dayHigh = candles.reduce((max, candle) => Math.max(max, candle.high), latest.high);
  const dayLow = candles.reduce((min, candle) => Math.min(min, candle.low), latest.low);
  const change = latest.close - previous.close;
  const spread = latest.close * 0.0002;

  return {
    symbol,
    bid: latest.close - spread / 2,
    ask: latest.close + spread / 2,
    mid: latest.close,
    spread,
    change,
    changePct: previous.close ? (change / previous.close) * 100 : 0,
    high: dayHigh,
    low: dayLow,
    timestamp: latest.time * 1000,
  };
}

export async function fetchCandles(symbol: string, timeframe = '1h'): Promise<Candle[]> {
  const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()] ?? [toYahoo(symbol)];
  let lastErr: unknown;
  for (const ySymbol of fallbacks) {
    try {
      const candles = await fetchCandlesForYahooSymbol(ySymbol, timeframe);
      if (candles.length) return candles;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(`No candles for ${symbol}`);
  return [];
}
