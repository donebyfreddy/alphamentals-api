"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ctraderRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const ctrader_service_js_1 = require("../services/ctrader.service.js");
exports.ctraderRouter = (0, express_1.Router)();
const credentialsSchema = zod_1.z.object({
    clientId: zod_1.z.string().trim().min(1),
    clientSecret: zod_1.z.string().trim().min(1),
    accessToken: zod_1.z.string().trim().min(1),
    accountId: zod_1.z.string().trim().min(1),
});
exports.ctraderRouter.post('/connect', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            error: { code: 'INVALID_PAYLOAD', message: 'Invalid cTrader credentials.', details: parsed.error.flatten() },
        });
        return;
    }
    try {
        const result = await (0, ctrader_service_js_1.connectCTrader)(parsed.data);
        res.status(result.success ? 200 : 400).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: { code: 'CONNECTION_FAILED', message: error instanceof Error ? error.message : 'Unexpected error.' },
        });
    }
});
exports.ctraderRouter.post('/sync', async (req, res) => {
    const parsed = zod_1.z.object({ connectionKey: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Connection key required.' } });
        return;
    }
    try {
        const result = await (0, ctrader_service_js_1.syncCTrader)(parsed.data.connectionKey);
        res.status(result.success ? 200 : 400).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: { code: 'SYNC_FAILED', message: error instanceof Error ? error.message : 'Unexpected error.' },
        });
    }
});
exports.ctraderRouter.post('/disconnect', (req, res) => {
    const parsed = zod_1.z.object({ connectionKey: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Connection key required.' } });
        return;
    }
    (0, ctrader_service_js_1.disconnectCTrader)(parsed.data.connectionKey);
    res.json({ success: true });
});
