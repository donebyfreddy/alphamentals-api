"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const riskManager_service_js_1 = require("../services/riskManager.service.js");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const RiskSchema = zod_1.z.object({
    accountSize: zod_1.z.number().positive(),
    riskPercent: zod_1.z.number().min(0.01).max(10),
    entryPrice: zod_1.z.number().positive(),
    stopLoss: zod_1.z.number().positive(),
    takeProfit: zod_1.z.number().positive(),
    instrument: zod_1.z.enum(['forex', 'gold', 'indices']).default('forex'),
});
router.post('/calculate', (req, res) => {
    const parsed = RiskSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
    }
    res.json((0, riskManager_service_js_1.calculateRisk)(parsed.data));
});
exports.default = router;
