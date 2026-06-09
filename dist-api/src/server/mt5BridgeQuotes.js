"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBridgeConfigDiagnostics = getBridgeConfigDiagnostics;
exports.getPreferredMarketPrices = getPreferredMarketPrices;
exports.debugMt5BridgeQuotes = debugMt5BridgeQuotes;
const mt5BridgeEnv_js_1 = require("../lib/mt5BridgeEnv.js");
const DISPLAY_NAMES = {
    XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD',
    USDJPY: 'USD/JPY', USDCAD: 'USD/CAD', AUDUSD: 'AUD/USD',
    NZDUSD: 'NZD/USD', GBPJPY: 'GBP/JPY', EURJPY: 'EUR/JPY',
    EURGBP: 'EUR/GBP', DXY: 'DX/Y', USOIL: 'WTI/USD',
    NAS100: 'NAS100', US30: 'US30', US500: 'US500',
};
const EMPTY_SYMBOL_MAP = Object.create(null);
function getBridgeConfigDiagnostics() {
    const baseUrl = (0, mt5BridgeEnv_js_1.resolveMt5BridgeBaseUrl)();
    const apiKey = (0, mt5BridgeEnv_js_1.resolveMt5BridgeApiKey)();
    return {
        mt5BridgeUrlConfigured: Boolean(baseUrl),
        mt5BridgeApiKeyConfigured: Boolean(apiKey),
        mt5BridgeUrl: baseUrl ?? null,
        enableTwelveDataQuotes: false,
        bridgeSymbolMap: EMPTY_SYMBOL_MAP,
    };
}
function toMid(bid, ask) {
    if (bid == null || ask == null)
        return null;
    return Number(((bid + ask) / 2).toFixed(8));
}
function emptyEntry(sym, timestamp) {
    return { symbol: sym, displaySymbol: DISPLAY_NAMES[sym] ?? sym, price: null, bid: null, ask: null, timestamp, provider: 'mt5-bridge' };
}
function parseRawQuote(sym, raw, timestamp) {
    const bid = typeof raw.bid === 'number' ? raw.bid : null;
    const ask = typeof raw.ask === 'number' ? raw.ask : null;
    const last = typeof raw.last === 'number' ? raw.last : null;
    return {
        symbol: sym,
        displaySymbol: DISPLAY_NAMES[sym] ?? sym,
        price: toMid(bid, ask) ?? last,
        bid,
        ask,
        timestamp: typeof raw.updatedAt === 'string' ? raw.updatedAt : timestamp,
        provider: 'mt5-bridge',
    };
}
async function fetchFromBridge(baseUrl, apiKey, symbols) {
    const timestamp = new Date().toISOString();
    const url = `${baseUrl}/quotes?symbols=${symbols.join(',')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let resp;
    try {
        resp = await fetch(url, { signal: controller.signal, headers: { 'x-api-key': apiKey } });
    }
    finally {
        clearTimeout(timer);
    }
    if (!resp.ok) {
        const errMsg = `MT5 bridge returned HTTP ${resp.status}`;
        return {
            ok: true,
            data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
            errors: Object.fromEntries(symbols.map((s) => [s, errMsg])),
            timestamp,
        };
    }
    const body = await resp.json();
    const data = {};
    const errors = body.errors ? { ...body.errors } : {};
    for (const sym of symbols) {
        const raw = body.data?.[sym];
        if (raw) {
            data[sym] = parseRawQuote(sym, raw, timestamp);
        }
        else {
            data[sym] = emptyEntry(sym, timestamp);
            if (!errors[sym])
                errors[sym] = 'Quote not available from MT5 bridge';
        }
    }
    return { ok: true, data, errors, timestamp };
}
async function getPreferredMarketPrices(symbols) {
    const timestamp = new Date().toISOString();
    const baseUrl = (0, mt5BridgeEnv_js_1.resolveMt5BridgeBaseUrl)();
    const apiKey = (0, mt5BridgeEnv_js_1.resolveMt5BridgeApiKey)();
    if (!baseUrl || !apiKey) {
        return {
            ok: true,
            data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
            errors: Object.fromEntries(symbols.map((s) => [s, 'MT5 bridge not configured'])),
            timestamp,
        };
    }
    try {
        return await fetchFromBridge(baseUrl, apiKey, symbols);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'MT5 bridge request failed';
        return {
            ok: false,
            data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
            errors: Object.fromEntries(symbols.map((s) => [s, message])),
            timestamp,
        };
    }
}
async function debugMt5BridgeQuotes(symbols) {
    const diag = getBridgeConfigDiagnostics();
    if (!symbols?.length)
        return { ok: true, diagnostics: diag };
    const quotes = await getPreferredMarketPrices(symbols);
    return { ok: quotes.ok, diagnostics: diag, quotes };
}
