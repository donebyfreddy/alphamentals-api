import { Router, Request, Response } from 'express';
import { generateWeeklyCoaching, generateDailyDebrief, askCoach } from '../services/aiCoach.service.js';
import { generateJournalInsights } from '../services/journalInsights.service.js';
import { isDatabaseConfigured, supabase } from '../lib/supabase.js';
import { z } from 'zod';

const router = Router();

// GET /api/coach/insights — AI performance summary from journal analytics
router.get('/insights', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await generateJournalInsights(userId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/coach/sessions — list coaching sessions
router.get('/sessions', async (req: Request, res: Response) => {
  if (!isDatabaseConfigured()) {
    return res.json([]);
  }

  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const { data, error } = await supabase
      .from('coaching_sessions')
      .select('*')
      .eq('userId', userId)
      .order('createdAt', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load coaching sessions' });
  }
});

// POST /api/coach/weekly — generate weekly coaching
router.post('/weekly', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const content = await generateWeeklyCoaching(userId, req.body.week);
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coach/daily — end-of-day debrief
router.post('/daily', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const content = await generateDailyDebrief(userId, req.body.date);
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coach/ask — open-ended coaching question
router.post('/ask', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const { question } = z.object({ question: z.string().min(1).max(1000) }).parse(req.body);
    const answer = await askCoach(userId, question);
    res.json({ answer });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/coach/sessions/:id/acknowledge
router.patch('/sessions/:id/acknowledge', async (req: Request, res: Response) => {
  if (!isDatabaseConfigured()) {
    return res.json({ ok: true });
  }

  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const { error } = await supabase
      .from('coaching_sessions')
      .update({ acknowledged: true })
      .eq('id', req.params.id)
      .eq('userId', userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to acknowledge coaching session' });
  }
});

export default router;
