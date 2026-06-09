"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchQuote = fetchQuote;
exports.fetchIntradayQuote = fetchIntradayQuote;
exports.fetchCandles = fetchCandles;
const cache = __importStar(require("./cache.js"));
const YAHOO_BASE = 'https://query1.finance.yahoo.com';
const SYMBOL_MAP = {
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
    US30: 'YM=F',
    US500: 'ES=F',
    BTCUSD: 'BTC-USD',
    ETHUSD: 'ETH-USD',
};
const SYMBOL_FALLBACKS = {
    XAUUSD: ['XAUUSD=X', 'GC=F'],
    XAGUSD: ['XAGUSD=X', 'SI=F'],
};
function toYahoo(symbol, fallbackIndex = 0) {
    const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()];
    if (fallbacks?.[fallbackIndex])
        return fallbacks[fallbackIndex];
    return SYMBOL_MAP[symbol.toUpperCase()] ?? `${symbol}=X`;
}
async function yahooFetch(path, ttlMs) {
    const cached = cache.get(path);
    if (cached)
        return cached;
    const res = await fetch(`${YAHOO_BASE}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok)
        throw new Error(`Yahoo Finance error: ${res.status}`);
    const data = (await res.json());
    cache.set(path, data, ttlMs);
    return data;
}
async function fetchQuoteForYahooSymbol(symbol, ySymbol) {
    const path = `/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=1d`;
    const data = await yahooFetch(path, 15_000);
    const result = data.chart.result?.[0];
    if (!result)
        throw new Error(`No data for ${symbol}`);
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
async function fetchQuote(symbol) {
    const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()] ?? [toYahoo(symbol)];
    let lastErr;
    for (const ySymbol of fallbacks) {
        try {
            return await fetchQuoteForYahooSymbol(symbol, ySymbol);
        }
        catch (err) {
            lastErr = err;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`No data for ${symbol}`);
}
async function fetchCandlesForYahooSymbol(ySymbol, timeframe = '1h') {
    const rangeMap = { '1m': '1d', '5m': '5d', '15m': '5d', '1h': '60d', '4h': '60d', '1d': '1y' };
    const range = rangeMap[timeframe] ?? '60d';
    const path = `/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=${timeframe}&range=${range}`;
    const data = await yahooFetch(path, 60_000);
    const result = data.chart.result?.[0];
    if (!result?.timestamp)
        return [];
    const q = result.indicators?.quote?.[0];
    if (!q)
        return [];
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
async function fetchIntradayQuote(symbol) {
    const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()] ?? [toYahoo(symbol)];
    let candles = [];
    let lastErr;
    for (const ySymbol of fallbacks) {
        try {
            candles = await fetchCandlesForYahooSymbol(ySymbol, '1m');
            if (candles.length)
                break;
        }
        catch (err) {
            lastErr = err;
        }
    }
    const latest = candles.at(-1);
    const previous = candles.at(-2) ?? latest;
    if (!latest || !previous) {
        if (lastErr)
            console.warn(`[yahoo] ${symbol} 1m fallback failed:`, lastErr instanceof Error ? lastErr.message : lastErr);
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
async function fetchCandles(symbol, timeframe = '1h') {
    const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()] ?? [toYahoo(symbol)];
    let lastErr;
    for (const ySymbol of fallbacks) {
        try {
            const candles = await fetchCandlesForYahooSymbol(ySymbol, timeframe);
            if (candles.length)
                return candles;
        }
        catch (err) {
            lastErr = err;
        }
    }
    if (lastErr)
        throw lastErr instanceof Error ? lastErr : new Error(`No candles for ${symbol}`);
    return [];
}
