import { Router } from 'express';
import { z } from 'zod';
import { connectCTrader, syncCTrader, disconnectCTrader, type CTraderCredentials } from '../services/ctrader.service.js';

export const ctraderRouter = Router();

const credentialsSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
});

ctraderRouter.post('/connect', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid cTrader credentials.', details: parsed.error.flatten() },
    });
    return;
  }
  try {
    const result = await connectCTrader(parsed.data as CTraderCredentials);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'CONNECTION_FAILED', message: error instanceof Error ? error.message : 'Unexpected error.' },
    });
  }
});

ctraderRouter.post('/sync', async (req, res) => {
  const parsed = z.object({ connectionKey: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Connection key required.' } });
    return;
  }
  try {
    const result = await syncCTrader(parsed.data.connectionKey);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'SYNC_FAILED', message: error instanceof Error ? error.message : 'Unexpected error.' },
    });
  }
});

ctraderRouter.post('/disconnect', (req, res) => {
  const parsed = z.object({ connectionKey: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Connection key required.' } });
    return;
  }
  disconnectCTrader(parsed.data.connectionKey);
  res.json({ success: true });
});
