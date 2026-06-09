import { Router, Request, Response } from 'express';
import * as checklistService from '../services/checklist.service.js';
import { z } from 'zod';

const router = Router();

const ChecklistSchema = z.object({
  symbol: z.string().min(3),
  htfBiasAligned: z.boolean(),
  liquiditySweepConfirmed: z.boolean(),
  bosChochConfirmed: z.boolean(),
  sessionValid: z.boolean(),
  rrMeetsMinimum: z.boolean(),
  newsRiskChecked: z.boolean(),
  emotionalStateOk: z.boolean(),
  notRevengeTrade: z.boolean(),
  notFomo: z.boolean(),
  riskSizedCorrectly: z.boolean(),
  entryTimeframeAligned: z.boolean(),
  keyLevelPresent: z.boolean(),
  notes: z.string().optional(),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID!;
    const parsed = ChecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const checklist = await checklistService.createChecklist(userId, parsed.data);
    res.status(201).json(checklist);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req: Request, res: Response) => {
  const userId = process.env.DEFAULT_USER_ID!;
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  res.json(await checklistService.getChecklists(userId, limit));
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID!;
    res.json(await checklistService.getChecklistById(userId, req.params.id));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
