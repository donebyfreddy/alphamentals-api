import { Router } from 'express';
import { z } from 'zod';
import { connectSaxo, syncSaxo, disconnectSaxo } from '../services/saxo.service.js';

export const saxoRouter = Router();

const credentialsSchema = z.object({
  accessToken: z.string().trim().min(1),
  accountKey: z.string().trim().optional(),
  environment: z.enum(['sim', 'live']).default('sim'),
});

saxoRouter.post('/connect', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid Saxo credentials.', details: parsed.error.flatten() },
    });
    return;
  }
  try {
    const result = await connectSaxo(parsed.data);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'CONNECTION_FAILED', message: error instanceof Error ? error.message : 'Unexpected error.' },
    });
  }
});

saxoRouter.post('/sync', async (req, res) => {
  const parsed = z.object({ connectionKey: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Connection key required.' } });
    return;
  }
  try {
    const result = await syncSaxo(parsed.data.connectionKey);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'SYNC_FAILED', message: error instanceof Error ? error.message : 'Unexpected error.' },
    });
  }
});

saxoRouter.post('/disconnect', (req, res) => {
  const parsed = z.object({ connectionKey: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Connection key required.' } });
    return;
  }
  disconnectSaxo(parsed.data.connectionKey);
  res.json({ success: true });
});
