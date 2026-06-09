"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mt5BridgeRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const mt5Bridge_service_js_1 = require("../services/mt5Bridge.service.js");
exports.mt5BridgeRouter = (0, express_1.Router)();
const connectSchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid().optional(),
    login: zod_1.z.string().trim().min(1),
    password: zod_1.z.string().optional(),
    server: zod_1.z.string().trim().min(1),
    terminalPath: zod_1.z.string().trim().min(1).optional(),
    accountType: zod_1.z.enum(['demo', 'live']).optional(),
});
const disconnectSchema = zod_1.z.object({
    accountId: zod_1.z.string().trim().min(1),
});
exports.mt5BridgeRouter.get('/health', async (_req, res) => {
    if (!mt5Bridge_service_js_1.mt5BridgeService.isConfigured()) {
        res.status(503).json({
            ok: false,
            configured: false,
            message: 'MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY on Render.',
        });
        return;
    }
    try {
        const health = await mt5Bridge_service_js_1.mt5BridgeService.health();
        res.json({
            ok: true,
            configured: true,
            bridge: health,
            config: mt5Bridge_service_js_1.mt5BridgeService.getConfigSummary(),
        });
    }
    catch (error) {
        res.status(502).json({
            ok: false,
            configured: true,
            message: error instanceof Error ? error.message : 'MT5 bridge health check failed.',
        });
    }
});
exports.mt5BridgeRouter.post('/accounts/connect', async (req, res) => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Invalid connect payload.', details: parsed.error.flatten() });
        return;
    }
    try {
        const response = await mt5Bridge_service_js_1.mt5BridgeService.connectAccount(parsed.data);
        res.json({ ok: true, ...response });
    }
    catch (error) {
        res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge connect failed.' });
    }
});
exports.mt5BridgeRouter.post('/accounts/disconnect', async (req, res) => {
    const parsed = disconnectSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Invalid disconnect payload.', details: parsed.error.flatten() });
        return;
    }
    try {
        const response = await mt5Bridge_service_js_1.mt5BridgeService.disconnectAccount(parsed.data.accountId);
        res.json({ ok: true, ...response });
    }
    catch (error) {
        res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge disconnect failed.' });
    }
});
exports.mt5BridgeRouter.get('/accounts/:accountId/status', async (req, res) => {
    try {
        const status = await mt5Bridge_service_js_1.mt5BridgeService.getAccountStatus(req.params.accountId);
        res.json(status);
    }
    catch (error) {
        res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge status lookup failed.' });
    }
});
exports.mt5BridgeRouter.get('/accounts/:accountId/info', async (req, res) => {
    try {
        const info = await mt5Bridge_service_js_1.mt5BridgeService.getAccountInfo(req.params.accountId);
        res.json(info);
    }
    catch (error) {
        res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge account info lookup failed.' });
    }
});
exports.mt5BridgeRouter.get('/accounts/:accountId/positions', async (req, res) => {
    try {
        const positions = await mt5Bridge_service_js_1.mt5BridgeService.getPositions(req.params.accountId);
        res.json(positions);
    }
    catch (error) {
        res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge positions lookup failed.' });
    }
});
exports.mt5BridgeRouter.post('/accounts/:accountId/sync', async (req, res) => {
    const parsed = zod_1.z.object({
        userId: zod_1.z.string().trim().min(1).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Invalid sync payload.', details: parsed.error.flatten() });
        return;
    }
    try {
        const sync = await mt5Bridge_service_js_1.mt5BridgeService.syncAccountSnapshot(req.params.accountId, parsed.data.userId);
        res.json(sync);
    }
    catch (error) {
        res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge account sync failed.' });
    }
});
