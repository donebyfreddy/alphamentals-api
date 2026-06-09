import { Router } from 'express';
import { z } from 'zod';
import { mt5BridgeService, type Mt5BridgeConnectPayload } from '../services/mt5Bridge.service.js';

export const mt5BridgeRouter = Router();

const connectSchema = z.object({
  accountId: z.string().uuid().optional(),
  login: z.string().trim().min(1),
  password: z.string().optional(),
  server: z.string().trim().min(1),
  terminalPath: z.string().trim().min(1).optional(),
  accountType: z.enum(['demo', 'live']).optional(),
});

const disconnectSchema = z.object({
  accountId: z.string().trim().min(1),
});

mt5BridgeRouter.get('/health', async (_req, res) => {
  if (!mt5BridgeService.isConfigured()) {
    res.status(503).json({
      ok: false,
      configured: false,
      message: 'MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY on Render.',
    });
    return;
  }

  try {
    const health = await mt5BridgeService.health();
    res.json({
      ok: true,
      configured: true,
      bridge: health,
      config: mt5BridgeService.getConfigSummary(),
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : 'MT5 bridge health check failed.',
    });
  }
});

mt5BridgeRouter.post('/accounts/connect', async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid connect payload.', details: parsed.error.flatten() });
    return;
  }

  try {
    const response = await mt5BridgeService.connectAccount(parsed.data as Mt5BridgeConnectPayload);
    res.json({ ok: true, ...response });
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge connect failed.' });
  }
});

mt5BridgeRouter.post('/accounts/disconnect', async (req, res) => {
  const parsed = disconnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid disconnect payload.', details: parsed.error.flatten() });
    return;
  }

  try {
    const response = await mt5BridgeService.disconnectAccount(parsed.data.accountId);
    res.json({ ok: true, ...response });
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge disconnect failed.' });
  }
});

mt5BridgeRouter.get('/accounts/:accountId/status', async (req, res) => {
  try {
    const status = await mt5BridgeService.getAccountStatus(req.params.accountId);
    res.json(status);
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge status lookup failed.' });
  }
});

mt5BridgeRouter.get('/accounts/:accountId/info', async (req, res) => {
  try {
    const info = await mt5BridgeService.getAccountInfo(req.params.accountId);
    res.json(info);
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge account info lookup failed.' });
  }
});

mt5BridgeRouter.get('/accounts/:accountId/positions', async (req, res) => {
  try {
    const positions = await mt5BridgeService.getPositions(req.params.accountId);
    res.json(positions);
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge positions lookup failed.' });
  }
});

mt5BridgeRouter.post('/accounts/:accountId/sync', async (req, res) => {
  const parsed = z.object({
    userId: z.string().trim().min(1).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid sync payload.', details: parsed.error.flatten() });
    return;
  }

  try {
    const sync = await mt5BridgeService.syncAccountSnapshot(req.params.accountId, parsed.data.userId);
    res.json(sync);
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Bridge account sync failed.' });
  }
});
