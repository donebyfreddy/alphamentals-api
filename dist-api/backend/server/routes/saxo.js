"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saxoRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const saxo_service_js_1 = require("../services/saxo.service.js");
exports.saxoRouter = (0, express_1.Router)();
const credentialsSchema = zod_1.z.object({
    accessToken: zod_1.z.string().trim().min(1),
    accountKey: zod_1.z.string().trim().optional(),
    environment: zod_1.z.enum(['sim', 'live']).default('sim'),
});
exports.saxoRouter.post('/connect', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            error: { code: 'INVALID_PAYLOAD', message: 'Invalid Saxo credentials.', details: parsed.error.flatten() },
        });
        return;
    }
    try {
        const result = await (0, saxo_service_js_1.connectSaxo)(parsed.data);
        res.status(result.success ? 200 : 400).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: { code: 'CONNECTION_FAILED', message: error instanceof Error ? error.message : 'Unexpected error.' },
        });
    }
});
exports.saxoRouter.post('/sync', async (req, res) => {
    const parsed = zod_1.z.object({ connectionKey: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Connection key required.' } });
        return;
    }
    try {
        const result = await (0, saxo_service_js_1.syncSaxo)(parsed.data.connectionKey);
        res.status(result.success ? 200 : 400).json(result);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: { code: 'SYNC_FAILED', message: error instanceof Error ? error.message : 'Unexpected error.' },
        });
    }
});
exports.saxoRouter.post('/disconnect', (req, res) => {
    const parsed = zod_1.z.object({ connectionKey: zod_1.z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Connection key required.' } });
        return;
    }
    (0, saxo_service_js_1.disconnectSaxo)(parsed.data.connectionKey);
    res.json({ success: true });
});
