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
exports.macroDataRouter = void 0;
const express_1 = require("express");
const macroSync_js_1 = require("../lib/macroSync.js");
const cache = __importStar(require("../lib/cache.js"));
exports.macroDataRouter = (0, express_1.Router)();
const SNAPSHOT_CACHE_KEY = 'macro:snapshot';
const SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1 hour
/**
 * GET /api/macro
 * Returns the latest macro snapshot from Supabase.
 * Served from memory cache (1h TTL) to avoid hammering DB.
 */
exports.macroDataRouter.get('/', async (_req, res) => {
    try {
        const cached = cache.get(SNAPSHOT_CACHE_KEY);
        if (cached)
            return res.json(cached);
        const snapshot = await (0, macroSync_js_1.getMacroSnapshot)();
        cache.set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
        res.json(snapshot);
    }
    catch (err) {
        console.error('[macro/GET]', err);
        res.status(500).json({ error: 'Failed to load macro snapshot' });
    }
});
/**
 * GET /api/macro/:currency
 * Returns single-currency snapshot.
 */
exports.macroDataRouter.get('/:currency', async (req, res) => {
    try {
        const currency = req.params.currency.toUpperCase();
        const cached = cache.get(SNAPSHOT_CACHE_KEY);
        const snapshot = cached ?? (await (0, macroSync_js_1.getMacroSnapshot)());
        if (!cached)
            cache.set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
        const data = snapshot[currency];
        if (!data)
            return res.status(404).json({ error: `Currency ${currency} not found` });
        res.json({ [currency]: data });
    }
    catch (err) {
        console.error('[macro/GET/:currency]', err);
        res.status(500).json({ error: 'Failed to load macro snapshot' });
    }
});
/**
 * POST /api/macro/sync
 * Triggers a full FRED sync and refreshes the cache.
 * Should be called by the scheduler or a protected admin endpoint.
 */
exports.macroDataRouter.post('/sync', async (_req, res) => {
    try {
        console.log('[macro/sync] Manual sync triggered via API');
        const snapshot = await (0, macroSync_js_1.syncMacroIndicators)();
        cache.set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
        res.json({ ok: true, syncedAt: new Date().toISOString(), currencies: Object.keys(snapshot) });
    }
    catch (err) {
        console.error('[macro/sync]', err);
        res.status(500).json({ error: 'Sync failed', detail: err.message });
    }
});
