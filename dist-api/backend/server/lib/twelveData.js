"use strict";
/**
 * Twelve Data client — optimized for live quote usage on the dashboard.
 *
 * Free tier: 800 credits/day, 8 requests/minute.
 *
 * Strategy:
 *  - Cache checked BEFORE rate-limiter — cache hits cost 0 credits and bypass the queue.
 *  - Quotes are batched so one dashboard refresh can cover multiple symbols in a single API request.
 *  - All real API calls go through a rate-limiter that spaces them ≥8.5 s apart (~7/min).
 *  - Candles remain cached for chart/indicator use; live prices come from quote/price endpoints only.
 */
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
exports.SYMBOL_LABELS = void 0;
exports.fetchTwelveCandles = fetchTwelveCandles;
exports.fetchTwelveQuotes = fetchTwelveQuotes;
exports.fetchTwelveQuote = fetchTwelveQuote;
const cache = __importStar(require("./cache.js"));
const counters_js_1 = require("./cost/counters.js");
const BASE = 'https://api.twelvedata.com';
// ── Rate limiter ─────────────────────────────────────────────────────────────
class RateLimiter {
    lastCall = 0;
    interval;
    queue = [];
    processing = false;
    constructor(intervalMs) {
        this.interval = intervalMs;
    }
    throttle() {
        return new Promise((resolve) => {
            this.queue.push(resolve);
            if (!this.processing)
                this.drain();
        });
    }
    async drain() {
        this.processing = true;
        while (this.queue.length > 0) {
            const wait = this.lastCall + this.interval - Date.now();
            if (wait > 0)
                await new Promise((r) => setTimeout(r, wait));
            this.lastCall = Date.now();
            const next = this.queue.shift();
            if (next)
                next();
        }
        this.processing = false;
    }
}
const limiter = new RateLimiter(8_500); // ~7 req/min, safely under 8
// Symbol normalisation: EURUSD → EUR/USD, XAUUSD → XAU/USD
// Maps internal symbols (already normalised — no slashes) → Twelve Data provider symbols
const SYMBOL_OVERRIDES = {
    NAS100: 'NAS100',
    US30: 'US30',
    US500: 'SPX500',
    // Index
    DXY: 'DXY',
    USDX: 'DXY',
    TVCDXY: 'DXY',
    // Crude oil — USOIL is the internal symbol; all aliases map to WTI/USD for Twelve Data
    USOIL: 'WTI/USD',
    WTI: 'WTI/USD',
    WTIUSD: 'WTI/USD',
    TVCUSOIL: 'WTI/USD',
    OIL: 'WTI/USD',
    OILUSD: 'WTI/USD',
};
// Human-readable labels for UI display
exports.SYMBOL_LABELS = {
    DXY: 'US Dollar Index',
    USOIL: 'WTI Crude Oil',
    WTI: 'WTI Crude Oil',
};
function toTwelveSymbol(symbol) {
    const upper = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (SYMBOL_OVERRIDES[upper])
        return SYMBOL_OVERRIDES[upper];
    if (upper.length === 6)
        return `${upper.slice(0, 3)}/${upper.slice(3)}`;
    return upper;
}
const INTERVAL_MAP = {
    '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '1h', '4h': '4h', '1d': '1day', '1w': '1week',
    'm1': '1min', 'm5': '5min', 'm15': '15min',
    'h1': '1h', 'h4': '4h', 'd1': '1day',
};
function tdInterval(timeframe) {
    return INTERVAL_MAP[timeframe] ?? '1h';
}
const INTRADAY_CANDLE_TTL_MS = 2 * 60 * 1000;
const CANDLE_TTL_MS = 5 * 60 * 1000;
const QUOTE_TTL_MS = 10 * 1000;
const MAX_QUOTE_AGE_MS = 30 * 1000;
async function twelveGet(path) {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey)
        throw new Error('TWELVE_DATA_API_KEY not configured');
    await limiter.throttle();
    const sep = path.includes('?') ? '&' : '?';
    const url = `${BASE}${path}${sep}apikey=${apiKey}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'AlphaMentals/1.0' } });
    if (!res.ok)
        throw new Error(`Twelve Data HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
        const preview = (await res.text()).slice(0, 200);
        throw new Error(`Twelve Data returned non-JSON (${contentType || 'unknown'}): ${preview}`);
    }
    const data = (await res.json());
    if (data.code && data.code !== 200)
        throw new Error(`Twelve Data error ${data.code}: ${data.message}`);
    return data;
}
function maybeParseNumber(value) {
    if (value == null)
        return null;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseResponseTimestamp(raw) {
    if (typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp))
        return raw.timestamp * 1000;
    if (raw.datetime) {
        const normalized = raw.datetime.includes('T') ? raw.datetime : raw.datetime.replace(' ', 'T');
        const millis = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`);
        if (Number.isFinite(millis))
            return millis;
    }
    return null;
}
function candleTtlForInterval(interval) {
    return interval === '1min' ? INTRADAY_CANDLE_TTL_MS : CANDLE_TTL_MS;
}
function parseTwelveDatetime(datetime) {
    const normalized = datetime.includes('T') ? datetime : datetime.replace(' ', 'T');
    const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
    return Math.floor(new Date(withTimezone).getTime() / 1000);
}
/** Fetch candles. Cache hit → 0 credits, bypasses rate limiter. */
async function fetchTwelveCandles(symbol, timeframe = '1h', outputsize = 60) {
    const tdSymbol = toTwelveSymbol(symbol);
    const interval = tdInterval(timeframe);
    const cacheKey = `td:candles:${tdSymbol}:${interval}:${outputsize}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    console.info('[TwelveData Candles]', { internalSymbol: symbol, provider: 'TwelveData', providerSymbol: tdSymbol, interval });
    (0, counters_js_1.incrementTwelveData)(symbol);
    const raw = await twelveGet(`/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${outputsize}&timezone=UTC`);
    if (!raw.values?.length)
        throw new Error(`Twelve Data: no candles for ${symbol}/${interval}`);
    const candles = raw.values
        .slice()
        .reverse()
        .map((v) => ({
        time: parseTwelveDatetime(v.datetime),
        open: Number.parseFloat(v.open),
        high: Number.parseFloat(v.high),
        low: Number.parseFloat(v.low),
        close: Number.parseFloat(v.close),
        volume: v.volume ? Number.parseFloat(v.volume) : 0,
    }))
        .filter((c) => c.close > 0);
    cache.set(cacheKey, candles, candleTtlForInterval(interval));
    return candles;
}
function normalizeQuote(symbol, tdSymbol, raw, cached) {
    const receivedAt = Date.now();
    const bid = maybeParseNumber(raw.bid);
    const ask = maybeParseNumber(raw.ask);
    const close = maybeParseNumber(raw.close);
    const prev = maybeParseNumber(raw.previous_close) ?? close;
    const change = maybeParseNumber(raw.change) ?? (close != null && prev != null ? close - prev : 0);
    const changePct = maybeParseNumber(raw.percent_change) ?? (change && prev ? (change / prev) * 100 : 0);
    let mid = null;
    let midpointSource = 'close';
    if (bid != null && ask != null) {
        mid = (bid + ask) / 2;
        midpointSource = 'bid-ask-midpoint';
    }
    else if (close != null) {
        mid = close;
    }
    if (mid == null)
        throw new Error(`Twelve Data: missing bid/ask/close for ${symbol}`);
    const fallbackSpread = Math.max(mid * 0.0002, 0);
    const normalizedBid = bid ?? mid - fallbackSpread / 2;
    const normalizedAsk = ask ?? mid + fallbackSpread / 2;
    const timestamp = parseResponseTimestamp(raw) ?? receivedAt;
    const ageMs = receivedAt - timestamp;
    const stale = ageMs > MAX_QUOTE_AGE_MS;
    const warning = stale
        ? `Live quote is stale (${Math.round(ageMs / 1000)}s old).`
        : undefined;
    const quote = {
        symbol,
        requestedSymbol: symbol,
        requestedTwelveSymbol: tdSymbol,
        bid: normalizedBid,
        ask: normalizedAsk,
        mid,
        spread: Math.max(normalizedAsk - normalizedBid, 0),
        change: change ?? 0,
        changePct: changePct ?? 0,
        high: maybeParseNumber(raw.high) ?? mid,
        low: maybeParseNumber(raw.low) ?? mid,
        timestamp,
        cached,
        stale,
        warning,
        midpointSource,
        marketStatus: raw.status,
    };
    if (stale) {
        console.warn(`[twelve-data] stale quote for ${symbol} (${Math.round((Date.now() - quote.timestamp) / 1000)}s old)`);
    }
    return quote;
}
async function fetchTwelvePrice(symbol, tdSymbol) {
    const receivedAt = Date.now();
    const raw = await twelveGet(`/price?symbol=${encodeURIComponent(tdSymbol)}&timezone=UTC`);
    const price = maybeParseNumber(raw.price);
    if (price == null)
        throw new Error(`Twelve Data: invalid /price response for ${symbol}`);
    const quote = {
        symbol,
        requestedSymbol: symbol,
        requestedTwelveSymbol: tdSymbol,
        bid: price,
        ask: price,
        mid: price,
        spread: 0,
        change: 0,
        changePct: 0,
        high: price,
        low: price,
        timestamp: receivedAt,
        cached: false,
        stale: false,
        midpointSource: 'price-endpoint',
        marketStatus: raw.status,
    };
    return quote;
}
let pendingBatchSymbols = null;
let pendingBatchSubscribers = [];
let pendingBatchForceRefresh = false;
let batchTimer = null;
const COALESCE_WINDOW_MS = 80;
function flushBatch() {
    batchTimer = null;
    const allSymbols = Array.from(pendingBatchSymbols ?? []);
    const subscribers = pendingBatchSubscribers.slice();
    const forceRefresh = pendingBatchForceRefresh;
    pendingBatchSymbols = null;
    pendingBatchSubscribers = [];
    pendingBatchForceRefresh = false;
    executeBatch(allSymbols, forceRefresh).then((all) => {
        for (const sub of subscribers) {
            sub.resolve(Object.fromEntries(sub.symbols.filter((s) => s in all).map((s) => [s, all[s]])));
        }
    }).catch((err) => {
        for (const sub of subscribers)
            sub.reject(err);
    });
}
function extractRawQuote(symbol, tdSymbol, rawPayload, isSingle) {
    const batch = rawPayload;
    return batch[tdSymbol] ?? batch[symbol] ?? (isSingle ? rawPayload : undefined);
}
async function resolveSymbolQuote(symbol, rawPayload, isSingle) {
    const tdSymbol = toTwelveSymbol(symbol);
    const raw = extractRawQuote(symbol, tdSymbol, rawPayload, isSingle);
    try {
        if (!raw?.close && raw?.code)
            throw new Error(raw.message ?? `Twelve Data: missing quote payload for ${symbol}`);
        if (!raw)
            throw new Error(`Twelve Data: missing quote payload for ${symbol}`);
        return normalizeQuote(symbol, tdSymbol, raw, false);
    }
    catch (err) {
        console.warn(`[twelve-data] quote failed for ${symbol} (${tdSymbol}), trying /price:`, err instanceof Error ? err.message : err);
        try {
            return await fetchTwelvePrice(symbol, tdSymbol);
        }
        catch (priceErr) {
            console.error(`[twelve-data] /price also failed for ${symbol}:`, priceErr instanceof Error ? priceErr.message : priceErr);
            return null;
        }
    }
}
async function executeBatch(symbols, forceRefresh) {
    const results = {};
    const missing = [];
    for (const symbol of symbols) {
        const cached = forceRefresh ? null : cache.get(`td:quote:${toTwelveSymbol(symbol)}`);
        if (cached) {
            results[symbol] = { ...cached, cached: true };
            continue;
        }
        missing.push(symbol);
    }
    if (!missing.length)
        return results;
    const tdSymbols = missing.map(toTwelveSymbol);
    for (let i = 0; i < missing.length; i++) {
        console.info('[TwelveData Sync]', { internalSymbol: missing[i], provider: 'TwelveData', providerSymbol: tdSymbols[i] });
        (0, counters_js_1.incrementTwelveData)(missing[i]);
    }
    const rawPayload = await twelveGet(`/quote?symbol=${tdSymbols.join(',')}&timezone=UTC`);
    for (const symbol of missing) {
        const quote = await resolveSymbolQuote(symbol, rawPayload, missing.length === 1);
        if (!quote)
            continue;
        cache.set(`td:quote:${toTwelveSymbol(symbol)}`, quote, QUOTE_TTL_MS);
        results[symbol] = quote;
    }
    return results;
}
async function fetchTwelveQuotes(symbols, options) {
    const forceRefresh = options?.forceRefresh ?? false;
    const normalizedSymbols = Array.from(new Set(symbols.map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean)));
    // Fast path: every symbol already in cache
    if (!forceRefresh) {
        const results = {};
        if (normalizedSymbols.every((s) => {
            const hit = cache.get(`td:quote:${toTwelveSymbol(s)}`);
            if (hit) {
                results[s] = { ...hit, cached: true };
                return true;
            }
            return false;
        }))
            return results;
    }
    // Coalesce into the shared pending batch
    return new Promise((resolve, reject) => {
        if (pendingBatchSymbols === null || pendingBatchForceRefresh !== forceRefresh) {
            pendingBatchSymbols = new Set(normalizedSymbols);
            pendingBatchForceRefresh = forceRefresh;
            pendingBatchSubscribers = [];
        }
        else {
            for (const s of normalizedSymbols)
                pendingBatchSymbols.add(s);
        }
        pendingBatchSubscribers.push({ symbols: normalizedSymbols, resolve, reject });
        batchTimer ??= setTimeout(flushBatch, COALESCE_WINDOW_MS);
    });
}
async function fetchTwelveQuote(symbol, options) {
    const quotes = await fetchTwelveQuotes([symbol], options);
    const quote = quotes[symbol.toUpperCase().replace('/', '')];
    if (!quote)
        throw new Error(`Twelve Data: missing quote for ${symbol}`);
    return quote;
}
