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
const zod_1 = require("zod");
const playbook = __importStar(require("../services/playbook.service.js"));
const router = (0, express_1.Router)();
const SetupSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(120),
    description: zod_1.z.string().max(2000).optional(),
    category: zod_1.z.string().max(60).optional(),
    rules: zod_1.z.array(zod_1.z.string()).optional(),
    confirmations: zod_1.z.array(zod_1.z.string()).optional(),
    invalidations: zod_1.z.array(zod_1.z.string()).optional(),
    timeframes: zod_1.z.array(zod_1.z.string()).optional(),
    sessions: zod_1.z.array(zod_1.z.string()).optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    notes: zod_1.z.string().max(2000).optional(),
    isActive: zod_1.z.boolean().optional(),
});
// GET /api/playbook/setups
router.get('/setups', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const includeInactive = req.query.all === 'true';
        res.json(await playbook.listSetups(userId, includeInactive));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/playbook/setups
router.post('/setups', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const parsed = SetupSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
            return;
        }
        const setup = await playbook.createSetup(userId, parsed.data);
        res.status(201).json(setup);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/playbook/setups/seed
router.post('/setups/seed', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await playbook.seedDefaultSetups(userId));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/playbook/setups/:id
router.patch('/setups/:id', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const parsed = SetupSchema.partial().safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
            return;
        }
        const setup = await playbook.updateSetup(userId, req.params.id, parsed.data);
        res.json(setup);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/playbook/setups/:id
router.delete('/setups/:id', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        await playbook.deleteSetup(userId, req.params.id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
