import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as playbook from '../services/playbook.service.js';

const router = Router();

const SetupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  category: z.string().max(60).optional(),
  rules: z.array(z.string()).optional(),
  confirmations: z.array(z.string()).optional(),
  invalidations: z.array(z.string()).optional(),
  timeframes: z.array(z.string()).optional(),
  sessions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/playbook/setups
router.get('/setups', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const includeInactive = req.query.all === 'true';
    res.json(await playbook.listSetups(userId, includeInactive));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/playbook/setups
router.post('/setups', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const parsed = SetupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const setup = await playbook.createSetup(userId, parsed.data);
    res.status(201).json(setup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/playbook/setups/seed
router.post('/setups/seed', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    res.json(await playbook.seedDefaultSetups(userId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/playbook/setups/:id
router.patch('/setups/:id', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const parsed = SetupSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const setup = await playbook.updateSetup(userId, req.params.id, parsed.data);
    res.json(setup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/playbook/setups/:id
router.delete('/setups/:id', async (req: Request, res: Response) => {
  try {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    await playbook.deleteSetup(userId, req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
