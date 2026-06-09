"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metaTraderRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const metaTrader_service_js_1 = require("../services/metaTrader.service.js");
exports.metaTraderRouter = (0, express_1.Router)();
const credentialsSchema = zod_1.z.object({
    version: zod_1.z.enum(['mt4', 'mt5']),
    server: zod_1.z.string().trim().min(1),
    login: zod_1.z.string().trim().min(1),
    password: zod_1.z.string().min(1),
    accountType: zod_1.z.enum(['live', 'demo']),
    passwordType: zod_1.z.enum(['master', 'investor']),
});
exports.metaTraderRouter.post('/connect', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            status: 'failed',
            error: {
                code: 'INVALID_PAYLOAD',
                message: 'Invalid MetaTrader connection details.',
                details: parsed.error.flatten(),
            },
        });
        return;
    }
    try {
        const result = await (0, metaTrader_service_js_1.connectMetaTrader)(parsed.data);
        res.status(result.success ? 200 : 400).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            status: 'failed',
            error: {
                code: 'FAILED_TO_CONNECT',
                message: 'Unexpected MetaTrader connection failure.',
                details: error instanceof Error ? error.message : String(error),
            },
        });
    }
});
exports.metaTraderRouter.post('/sync', async (req, res) => {
    const parsed = zod_1.z.object({ connectionKey: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            status: 'failed',
            error: {
                code: 'INVALID_PAYLOAD',
                message: 'A MetaTrader connection key is required.',
                details: parsed.error.flatten(),
            },
        });
        return;
    }
    try {
        const result = await (0, metaTrader_service_js_1.syncMetaTrader)(parsed.data.connectionKey);
        res.status(result.success ? 200 : 400).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            status: 'failed',
            error: {
                code: 'FAILED_TO_CONNECT',
                message: 'Unexpected MetaTrader sync failure.',
                details: error instanceof Error ? error.message : String(error),
            },
        });
    }
});
exports.metaTraderRouter.post('/disconnect', (req, res) => {
    const parsed = zod_1.z.object({ connectionKey: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            status: 'failed',
            error: {
                code: 'INVALID_PAYLOAD',
                message: 'A MetaTrader connection key is required.',
                details: parsed.error.flatten(),
            },
        });
        return;
    }
    (0, metaTrader_service_js_1.disconnectMetaTrader)(parsed.data.connectionKey);
    res.json({ success: true, status: 'disconnected' });
});
exports.metaTraderRouter.get('/bridge-status', async (_req, res) => {
    const status = (0, metaTrader_service_js_1.getBridgeStatus)();
    res.status(status.ready ? 200 : 503).json(status);
});
exports.metaTraderRouter.get('/health', async (_req, res) => {
    const status = (0, metaTrader_service_js_1.getBridgeStatus)();
    res.status(status.ready ? 200 : 503).json({
        healthy: status.ready,
        message: status.message,
        provider: status.provider,
    });
});
exports.metaTraderRouter.post('/test-connection', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            status: 'failed',
            error: {
                code: 'INVALID_PAYLOAD',
                message: 'Invalid MetaTrader connection details.',
                details: parsed.error.flatten(),
            },
        });
        return;
    }
    try {
        const result = await (0, metaTrader_service_js_1.connectMetaTrader)(parsed.data);
        res.status(result.success ? 200 : 400).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            status: 'failed',
            error: {
                code: 'FAILED_TO_CONNECT',
                message: 'Unexpected MetaTrader connection failure.',
                details: error instanceof Error ? error.message : String(error),
            },
        });
    }
});
exports.metaTraderRouter.get('/symbols', async (_req, res) => {
    try {
        const symbols = await (0, metaTrader_service_js_1.mt5GetSymbols)();
        res.json({ success: true, symbols });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
});
exports.metaTraderRouter.get('/tick/:symbol', async (req, res) => {
    try {
        const tick = await (0, metaTrader_service_js_1.mt5GetTick)(req.params.symbol);
        res.json({ success: true, tick });
    }
    catch (err) {
        res.status(404).json({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
});
const historicalSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(1),
    timeframe: zod_1.z.string().min(1),
    startDate: zod_1.z.string().min(1),
    endDate: zod_1.z.string().min(1),
});
exports.metaTraderRouter.post('/historical-data', async (req, res) => {
    const parsed = historicalSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid payload', details: parsed.error.flatten() });
        return;
    }
    try {
        const { symbol, timeframe, startDate, endDate } = parsed.data;
        const bars = await (0, metaTrader_service_js_1.mt5GetHistoricalData)(symbol, timeframe, startDate, endDate);
        res.json({ success: true, bars });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
});
const placeOrderSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(1),
    order_type: zod_1.z.enum(['buy', 'sell', 'buy_limit', 'sell_limit', 'buy_stop', 'sell_stop']),
    volume: zod_1.z.number().positive(),
    price: zod_1.z.number().optional(),
    sl: zod_1.z.number().optional(),
    tp: zod_1.z.number().optional(),
    comment: zod_1.z.string().optional(),
    magic: zod_1.z.number().optional(),
});
// Trade execution is intentionally disabled — this dashboard is read-only.
// Trades are placed manually from the MT5 phone app.
exports.metaTraderRouter.post('/order/place', (_req, res) => {
    res.status(403).json({ success: false, message: 'Trade execution is disabled. This dashboard is read-only. Place trades from your MT5 app.' });
});
exports.metaTraderRouter.post('/position/close/:positionId', (_req, res) => {
    res.status(403).json({ success: false, message: 'Trade execution is disabled. This dashboard is read-only. Close positions from your MT5 app.' });
});
