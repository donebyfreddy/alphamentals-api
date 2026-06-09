"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bridgeRouter = void 0;
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const zod_1 = require("zod");
const config_js_1 = require("./config.js");
const state_js_1 = require("./state.js");
exports.bridgeRouter = (0, express_1.Router)();
const candleTimeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const connectSchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid().optional(),
    login: zod_1.z.string().trim().min(1),
    password: zod_1.z.string().optional(),
    server: zod_1.z.string().trim().min(1),
    terminalPath: zod_1.z.string().trim().min(1).nullable().optional(),
    accountType: zod_1.z.enum(['demo', 'live']).optional(),
});
const disconnectSchema = zod_1.z.object({
    accountId: zod_1.z.string().trim().min(1),
});
const accountInfoSchema = zod_1.z.object({
    login: zod_1.z.string().trim().min(1),
    server: zod_1.z.string().trim().min(1),
    broker: zod_1.z.string().default(''),
    name: zod_1.z.string().default(''),
    balance: zod_1.z.number(),
    equity: zod_1.z.number(),
    margin: zod_1.z.number(),
    freeMargin: zod_1.z.number(),
    profit: zod_1.z.number(),
    currency: zod_1.z.string().default('USD'),
    leverage: zod_1.z.number(),
    tradeAllowed: zod_1.z.boolean(),
    company: zod_1.z.string().nullable().optional(),
    terminalName: zod_1.z.string().nullable().optional(),
    updatedAt: zod_1.z.string().optional(),
});
const positionSchema = zod_1.z.object({
    ticket: zod_1.z.string().trim().min(1),
    symbol: zod_1.z.string().trim().min(1),
    type: zod_1.z.enum(['buy', 'sell']),
    volume: zod_1.z.number(),
    profit: zod_1.z.number(),
    openPrice: zod_1.z.number(),
    currentPrice: zod_1.z.number().nullable(),
    stopLoss: zod_1.z.number().nullable(),
    takeProfit: zod_1.z.number().nullable(),
    openedAt: zod_1.z.string().nullable(),
    swap: zod_1.z.number().nullable().optional(),
    commission: zod_1.z.number().nullable().optional(),
    magic: zod_1.z.number().nullable().optional(),
    comment: zod_1.z.string().nullable().optional(),
});
const quoteSchema = zod_1.z.object({
    symbol: zod_1.z.string().trim().min(1),
    bid: zod_1.z.number().nullable(),
    ask: zod_1.z.number().nullable(),
    last: zod_1.z.number().nullable(),
    high: zod_1.z.number().nullable(),
    low: zod_1.z.number().nullable(),
    previousClose: zod_1.z.number().nullable(),
    updatedAt: zod_1.z.string().trim().min(1),
    source: zod_1.z.literal('mt5-bridge'),
});
const heartbeatSchema = zod_1.z.object({
    accountId: zod_1.z.string().trim().min(1),
    account: accountInfoSchema,
    positions: zod_1.z.array(positionSchema).default([]),
    quotes: zod_1.z.array(quoteSchema).default([]),
    error: zod_1.z.string().nullable().optional(),
});
const priceQuerySchema = zod_1.z.object({
    symbol: zod_1.z.string().trim().min(1),
});
const quotesQuerySchema = zod_1.z.object({
    symbols: zod_1.z.string().trim().min(1),
});
const candlesQuerySchema = zod_1.z.object({
    symbol: zod_1.z.string().trim().min(1),
    timeframe: zod_1.z.enum(candleTimeframes).default('M5'),
    limit: zod_1.z.coerce.number().int().min(1).max(1000).default(100),
});
function logMarketDataRequest(endpoint, details) {
    console.log('[mt5-bridge] market data request', {
        endpoint,
        ...details,
    });
}
function logMarketDataResponse(endpoint, status, details) {
    console.log('[mt5-bridge] market data response', {
        endpoint,
        status,
        ...details,
    });
}
function respondPriceSourceNotReady(res, endpoint, details) {
    const payload = {
        ok: false,
        error: 'MT5_PRICE_SOURCE_NOT_READY',
        message: 'MT5 price source is not connected yet',
    };
    logMarketDataResponse(endpoint, 503, details);
    res.status(503).json(payload);
}
function toMidPrice(bid, ask) {
    if (bid == null || ask == null)
        return null;
    return Number(((bid + ask) / 2).toFixed(8));
}
exports.bridgeRouter.post('/accounts/connect', (req, res) => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            error: 'INVALID_PAYLOAD',
            details: parsed.error.flatten(),
        });
        return;
    }
    const now = new Date().toISOString();
    const accountId = parsed.data.accountId ?? (0, node_crypto_1.randomUUID)();
    const state = (0, state_js_1.saveAccountState)({
        accountId,
        login: parsed.data.login,
        server: parsed.data.server,
        terminalPath: parsed.data.terminalPath ?? null,
        accountType: parsed.data.accountType ?? 'demo',
        status: 'connected',
        connected: true,
        createdAt: now,
        updatedAt: now,
        lastHeartbeatAt: now,
        lastError: null,
        accountInfo: null,
        positions: [],
    });
    res.json({
        ok: true,
        accountId: state.accountId,
        status: state.status,
        connected: state.connected,
        message: 'Bridge account registered. MT5 handshake stub is ready for Phase 2.',
    });
});
exports.bridgeRouter.post('/accounts/disconnect', (req, res) => {
    const parsed = disconnectSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            error: 'INVALID_PAYLOAD',
            details: parsed.error.flatten(),
        });
        return;
    }
    const state = (0, state_js_1.getAccountState)(parsed.data.accountId);
    if (!state) {
        res.status(404).json({
            ok: false,
            error: 'ACCOUNT_NOT_FOUND',
            message: 'Account is not registered in the bridge.',
        });
        return;
    }
    (0, state_js_1.saveAccountState)({
        ...state,
        connected: false,
        status: 'disconnected',
        updatedAt: new Date().toISOString(),
        lastHeartbeatAt: null,
    });
    res.json({
        ok: true,
        accountId: state.accountId,
        status: 'disconnected',
        message: 'Bridge account disconnected.',
    });
});
exports.bridgeRouter.get('/accounts/:accountId/status', (req, res) => {
    const state = (0, state_js_1.getAccountState)(req.params.accountId);
    if (!state) {
        res.status(404).json({
            ok: false,
            error: 'ACCOUNT_NOT_FOUND',
            message: 'Account is not registered in the bridge.',
        });
        return;
    }
    res.json({
        accountId: state.accountId,
        status: state.status,
        connected: state.connected,
        login: state.login,
        server: state.server,
        lastHeartbeatAt: state.lastHeartbeatAt,
        lastError: state.lastError,
    });
});
exports.bridgeRouter.get('/accounts/:accountId/info', (req, res) => {
    const state = (0, state_js_1.getAccountState)(req.params.accountId);
    if (!state?.accountInfo) {
        res.status(404).json({
            ok: false,
            error: 'ACCOUNT_INFO_NOT_AVAILABLE',
            message: 'No MT5 account snapshot has been received yet.',
        });
        return;
    }
    res.json(state.accountInfo);
});
exports.bridgeRouter.get('/accounts/:accountId/positions', (req, res) => {
    const state = (0, state_js_1.getAccountState)(req.params.accountId);
    if (!state) {
        res.status(404).json({
            ok: false,
            error: 'ACCOUNT_NOT_FOUND',
            message: 'Account is not registered in the bridge.',
        });
        return;
    }
    res.json(state.positions);
});
exports.bridgeRouter.get('/market-data/price', (req, res) => {
    const parsed = priceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            error: 'INVALID_QUERY',
            details: parsed.error.flatten(),
        });
        return;
    }
    const endpoint = '/market-data/price';
    const symbol = (0, state_js_1.normalizeQuoteSymbol)(parsed.data.symbol);
    logMarketDataRequest(endpoint, {
        bridgeUrl: `http://0.0.0.0:${config_js_1.bridgeConfig.port}`,
        symbol,
    });
    const quote = (0, state_js_1.getLatestQuotes)([symbol])[symbol];
    if (!quote) {
        respondPriceSourceNotReady(res, endpoint, { symbol });
        return;
    }
    const payload = {
        ok: true,
        symbol,
        bid: quote.bid,
        ask: quote.ask,
        mid: toMidPrice(quote.bid, quote.ask),
        timestamp: quote.updatedAt,
        source: 'mt5',
    };
    logMarketDataResponse(endpoint, 200, { symbol });
    res.json(payload);
});
exports.bridgeRouter.get('/market-data/quotes', (req, res) => {
    const parsed = quotesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            error: 'INVALID_QUERY',
            details: parsed.error.flatten(),
        });
        return;
    }
    const endpoint = '/market-data/quotes';
    const symbols = parsed.data.symbols
        .split(',')
        .map((symbol) => (0, state_js_1.normalizeQuoteSymbol)(symbol))
        .filter(Boolean);
    logMarketDataRequest(endpoint, {
        bridgeUrl: `http://0.0.0.0:${config_js_1.bridgeConfig.port}`,
        symbols,
    });
    const latestQuotes = (0, state_js_1.getLatestQuotes)(symbols);
    const quotes = symbols
        .map((symbol) => latestQuotes[symbol])
        .filter((quote) => Boolean(quote))
        .map((quote) => ({
        symbol: quote.symbol,
        bid: quote.bid,
        ask: quote.ask,
        mid: toMidPrice(quote.bid, quote.ask),
        timestamp: quote.updatedAt,
        source: 'mt5',
    }));
    if (!quotes.length) {
        respondPriceSourceNotReady(res, endpoint, { symbols });
        return;
    }
    logMarketDataResponse(endpoint, 200, {
        symbols,
        quoteCount: quotes.length,
    });
    res.json({
        ok: true,
        quotes,
    });
});
exports.bridgeRouter.get('/market-data/candles', (req, res) => {
    const parsed = candlesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            error: 'INVALID_QUERY',
            details: parsed.error.flatten(),
        });
        return;
    }
    const endpoint = '/market-data/candles';
    const symbol = (0, state_js_1.normalizeQuoteSymbol)(parsed.data.symbol);
    logMarketDataRequest(endpoint, {
        bridgeUrl: `http://0.0.0.0:${config_js_1.bridgeConfig.port}`,
        symbol,
        timeframe: parsed.data.timeframe,
        limit: parsed.data.limit,
    });
    respondPriceSourceNotReady(res, endpoint, {
        symbol,
        timeframe: parsed.data.timeframe,
        limit: parsed.data.limit,
    });
});
exports.bridgeRouter.get('/quotes', (req, res) => {
    const symbolsParam = typeof req.query.symbols === 'string' ? req.query.symbols : '';
    const requestedSymbols = symbolsParam
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean);
    const latestQuotes = (0, state_js_1.getLatestQuotes)(requestedSymbols);
    const data = requestedSymbols.length ? {} : latestQuotes;
    const errors = {};
    if (requestedSymbols.length) {
        for (const symbol of requestedSymbols) {
            const normalized = (0, state_js_1.normalizeQuoteSymbol)(symbol);
            const quote = latestQuotes[normalized];
            if (quote) {
                data[normalized] = quote;
                continue;
            }
            errors[normalized] = 'Quote not available from the latest MT5 heartbeat.';
        }
    }
    res.json({
        ok: true,
        data,
        errors,
        timestamp: new Date().toISOString(),
    });
});
exports.bridgeRouter.post('/ea/heartbeat', (req, res) => {
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            error: 'INVALID_HEARTBEAT',
            details: parsed.error.flatten(),
        });
        return;
    }
    const accountInfo = {
        ...parsed.data.account,
        updatedAt: parsed.data.account.updatedAt ?? new Date().toISOString(),
    };
    (0, state_js_1.updateLatestQuotes)(parsed.data.quotes);
    const state = (0, state_js_1.updateAccountSnapshot)({
        accountId: parsed.data.accountId,
        accountInfo,
        positions: parsed.data.positions,
        lastError: parsed.data.error ?? null,
    });
    res.json({
        ok: true,
        accountId: state.accountId,
        status: state.status,
        positions: state.positions.length,
        tradingEnabled: config_js_1.bridgeConfig.tradingEnabled,
        message: state.lastError ? 'Heartbeat stored with MT5 error.' : 'Heartbeat stored.',
    });
});
