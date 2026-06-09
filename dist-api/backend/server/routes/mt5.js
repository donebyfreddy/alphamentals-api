"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradesRouter = exports.mt5Router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const mt5Sync_service_js_1 = require("../services/mt5Sync.service.js");
exports.mt5Router = (0, express_1.Router)();
exports.tradesRouter = (0, express_1.Router)();
function formatMt5RouteError(error) {
    const message = error instanceof Error ? error.message : 'Unexpected MT5 route error.';
    if (message.includes("Can't reach database server")) {
        return 'Trade journal database is unavailable. Check your Supabase/DB connection.';
    }
    return message;
}
const recentTradesQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().min(1).max(50).optional(),
});
exports.mt5Router.post('/sync', async (_req, res) => {
    try {
        const result = await (0, mt5Sync_service_js_1.syncMt5AccountNow)();
        res.status(result.success ? 200 : 503).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: formatMt5RouteError(error),
        });
    }
});
const MT5_STATUS_FALLBACK = { ok: true, data: { connected: false, status: 'unavailable', message: 'MT5 bridge unavailable' } };
exports.mt5Router.get('/status', async (_req, res) => {
    try {
        const raw = await (0, mt5Sync_service_js_1.getMt5Status)();
        let bridgeStatus;
        if (!raw.apiReachable)
            bridgeStatus = 'unreachable';
        else if (raw.linkedAccountExists)
            bridgeStatus = 'connected';
        else
            bridgeStatus = 'no_account';
        res.json({
            ok: true,
            data: {
                connected: raw.apiReachable && raw.linkedAccountExists,
                status: bridgeStatus,
                message: raw.lastError ?? (raw.apiReachable ? 'MT5 bridge reachable' : 'MT5 bridge unreachable'),
                accountLogin: raw.accountLogin,
                serverName: raw.serverName,
                lastSyncTime: raw.lastSyncTime,
                openTrades: raw.openTrades,
            },
        });
    }
    catch (error) {
        console.error('[mt5/status]', formatMt5RouteError(error));
        res.json(MT5_STATUS_FALLBACK);
    }
});
exports.tradesRouter.get('/recent', async (req, res) => {
    const parsed = recentTradesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Invalid recent trades query.', details: parsed.error.flatten() });
        return;
    }
    try {
        const trades = await (0, mt5Sync_service_js_1.getRecentTrades)(parsed.data.limit ?? 5);
        res.json({ ok: true, data: trades });
    }
    catch (error) {
        console.error('[trades/recent]', formatMt5RouteError(error));
        res.json({ ok: true, data: [] });
    }
});
