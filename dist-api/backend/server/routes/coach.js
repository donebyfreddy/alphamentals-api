"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiCoach_service_js_1 = require("../services/aiCoach.service.js");
const journalInsights_service_js_1 = require("../services/journalInsights.service.js");
const supabase_js_1 = require("../lib/supabase.js");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// GET /api/coach/insights — AI performance summary from journal analytics
router.get('/insights', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        res.json(await (0, journalInsights_service_js_1.generateJournalInsights)(userId));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/coach/sessions — list coaching sessions
router.get('/sessions', async (req, res) => {
    if (!(0, supabase_js_1.isDatabaseConfigured)()) {
        return res.json([]);
    }
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const { data, error } = await supabase_js_1.supabase
            .from('coaching_sessions')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })
            .limit(20);
        if (error)
            throw error;
        res.json(data ?? []);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load coaching sessions' });
    }
});
// POST /api/coach/weekly — generate weekly coaching
router.post('/weekly', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const content = await (0, aiCoach_service_js_1.generateWeeklyCoaching)(userId, req.body.week);
        res.json({ content });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/coach/daily — end-of-day debrief
router.post('/daily', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const content = await (0, aiCoach_service_js_1.generateDailyDebrief)(userId, req.body.date);
        res.json({ content });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/coach/ask — open-ended coaching question
router.post('/ask', async (req, res) => {
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const { question } = zod_1.z.object({ question: zod_1.z.string().min(1).max(1000) }).parse(req.body);
        const answer = await (0, aiCoach_service_js_1.askCoach)(userId, question);
        res.json({ answer });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/coach/sessions/:id/acknowledge
router.patch('/sessions/:id/acknowledge', async (req, res) => {
    if (!(0, supabase_js_1.isDatabaseConfigured)()) {
        return res.json({ ok: true });
    }
    try {
        const userId = process.env.DEFAULT_USER_ID ?? '';
        const { error } = await supabase_js_1.supabase
            .from('coaching_sessions')
            .update({ acknowledged: true })
            .eq('id', req.params.id)
            .eq('userId', userId);
        if (error)
            throw error;
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to acknowledge coaching session' });
    }
});
exports.default = router;
