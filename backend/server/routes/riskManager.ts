import { Router, Request, Response } from 'express';
import { calculateRisk, type RiskCalcInput } from '../services/riskManager.service.js';
import { z } from 'zod';

const router = Router();

const RiskSchema = z.object({
  accountSize: z.number().positive(),
  riskPercent: z.number().min(0.01).max(10),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  instrument: z.enum(['forex', 'gold', 'indices']).default('forex'),
});

router.post('/calculate', (req: Request, res: Response) => {
  const parsed = RiskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  res.json(calculateRisk(parsed.data as RiskCalcInput));
});

export default router;
