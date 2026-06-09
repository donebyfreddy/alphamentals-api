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
const express_1 = require("express");
const checklistService = __importStar(require("../services/checklist.service.js"));
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const ChecklistSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(3),
    htfBiasAligned: zod_1.z.boolean(),
    liquiditySweepConfirmed: zod_1.z.boolean(),
    bosChochConfirmed: zod_1.z.boolean(),
    sessionValid: zod_1.z.boolean(),
    rrMeetsMinimum: zod_1.z.boolean(),
    newsRiskChecked: zod_1.z.boolean(),
    emotionalStateOk: zod_1.z.boolean(),
    notRevengeTrade: zod_1.z.boolean(),
    notFomo: zod_1.z.boolean(),
    riskSizedCorrectly: zod_1.z.boolean(),
    entryTimeframeAligned: zod_1.z.boolean(),
    keyLevelPresent: zod_1.z.boolean(),
    notes: zod_1.z.string().optional(),
});
router.post('/', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID;
        const parsed = ChecklistSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
            return;
        }
        const checklist = await checklistService.createChecklist(userId, parsed.data);
        res.status(201).json(checklist);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/', async (req, res) => {
    const userId = process.env.DEFAULT_USER_ID;
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    res.json(await checklistService.getChecklists(userId, limit));
});
router.get('/:id', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID;
        res.json(await checklistService.getChecklistById(userId, req.params.id));
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
exports.default = router;
