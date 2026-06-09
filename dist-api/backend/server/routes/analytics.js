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
const analyticsService = __importStar(require("../services/analytics.service.js"));
const supabase_js_1 = require("../lib/supabase.js");
const router = (0, express_1.Router)();
const dbAvailable = () => {
    return (0, supabase_js_1.isDatabaseConfigured)();
};
router.get('/equity-curve', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const { from, to } = req.query;
        res.json(await analyticsService.getEquityCurve(userId, from, to));
    }
    catch {
        res.json([]);
    }
});
router.get('/session-heatmap', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getSessionHeatmap(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/day-heatmap', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getDayOfWeekHeatmap(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/mistakes', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getMistakeBreakdown(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/setups', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getSetupPerformance(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/psychology', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getPsychologyCorrelations(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/patterns', async (req, res) => {
    if (!dbAvailable())
        return res.json({ ok: true, data: [] });
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const patterns = await analyticsService.detectMistakePatterns(userId);
        res.json({ ok: true, data: patterns });
    }
    catch {
        res.json({ ok: true, data: [] });
    }
});
router.get('/setup-quality', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getSetupQualityPerformance(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/mistake-cost', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getMistakeCost(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/discipline', async (req, res) => {
    if (!dbAvailable())
        return res.json(null);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getDisciplineStats(userId));
    }
    catch {
        res.json(null);
    }
});
router.get('/risk-flags', async (req, res) => {
    if (!dbAvailable())
        return res.json(null);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getRiskFlagStats(userId));
    }
    catch {
        res.json(null);
    }
});
router.get('/time-of-day', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getTimeOfDayPerformance(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/psychology-phase', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const phaseParam = req.query.phase;
        const phase = phaseParam === 'during' || phaseParam === 'post' ? phaseParam : 'pre';
        res.json(await analyticsService.getPsychologyByPhase(userId, phase));
    }
    catch {
        res.json([]);
    }
});
router.get('/by-symbol', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getPerformanceBySymbol(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/good-vs-bad-loss', async (req, res) => {
    if (!dbAvailable())
        return res.json(null);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getGoodVsBadLossStats(userId));
    }
    catch {
        res.json(null);
    }
});
router.get('/psychology-cost', async (req, res) => {
    if (!dbAvailable())
        return res.json([]);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getPsychologyFlagCost(userId));
    }
    catch {
        res.json([]);
    }
});
router.get('/review-coverage', async (req, res) => {
    if (!dbAvailable())
        return res.json(null);
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await analyticsService.getReviewCoverage(userId));
    }
    catch {
        res.json(null);
    }
});
exports.default = router;
