import { Router } from 'express';
import { z } from 'zod';
import {
  connectMetaTrader,
  disconnectMetaTrader,
  syncMetaTrader,
  getBridgeStatus,
  mt5GetSymbols,
  mt5GetTick,
  mt5GetHistoricalData,
  type MetaTraderCredentials,
} from '../services/metaTrader.service.js';

export const metaTraderRouter = Router();

const credentialsSchema = z.object({
  version: z.enum(['mt4', 'mt5']),
  server: z.string().trim().min(1),
  login: z.string().trim().min(1),
  password: z.string().min(1),
  accountType: z.enum(['live', 'demo']),
  passwordType: z.enum(['master', 'investor']),
});

metaTraderRouter.post('/connect', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      status: 'failed',
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid MetaTrader connection details.',
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  try {
    const result = await connectMetaTrader(parsed.data as MetaTraderCredentials);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'failed',
      error: {
        code: 'FAILED_TO_CONNECT',
        message: 'Unexpected MetaTrader connection failure.',
        details: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

metaTraderRouter.post('/sync', async (req, res) => {
  const parsed = z.object({ connectionKey: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      status: 'failed',
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'A MetaTrader connection key is required.',
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  try {
    const result = await syncMetaTrader(parsed.data.connectionKey);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'failed',
      error: {
        code: 'FAILED_TO_CONNECT',
        message: 'Unexpected MetaTrader sync failure.',
        details: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

metaTraderRouter.post('/disconnect', (req, res) => {
  const parsed = z.object({ connectionKey: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      status: 'failed',
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'A MetaTrader connection key is required.',
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  disconnectMetaTrader(parsed.data.connectionKey);
  res.json({ success: true, status: 'disconnected' });
});

metaTraderRouter.get('/bridge-status', async (_req, res) => {
  const status = getBridgeStatus();
  res.status(status.ready ? 200 : 503).json(status);
});

metaTraderRouter.get('/health', async (_req, res) => {
  const status = getBridgeStatus();
  res.status(status.ready ? 200 : 503).json({
    healthy: status.ready,
    message: status.message,
    provider: status.provider,
  });
});

metaTraderRouter.post('/test-connection', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      status: 'failed',
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid MetaTrader connection details.',
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  try {
    const result = await connectMetaTrader(parsed.data as MetaTraderCredentials);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'failed',
      error: {
        code: 'FAILED_TO_CONNECT',
        message: 'Unexpected MetaTrader connection failure.',
        details: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

metaTraderRouter.get('/symbols', async (_req, res) => {
  try {
    const symbols = await mt5GetSymbols();
    res.json({ success: true, symbols });
  } catch (err) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
  }
});

metaTraderRouter.get('/tick/:symbol', async (req, res) => {
  try {
    const tick = await mt5GetTick(req.params.symbol);
    res.json({ success: true, tick });
  } catch (err) {
    res.status(404).json({ success: false, message: err instanceof Error ? err.message : String(err) });
  }
});

const historicalSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

metaTraderRouter.post('/historical-data', async (req, res) => {
  const parsed = historicalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  try {
    const { symbol, timeframe, startDate, endDate } = parsed.data;
    const bars = await mt5GetHistoricalData(symbol, timeframe, startDate, endDate);
    res.json({ success: true, bars });
  } catch (err) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
  }
});

const placeOrderSchema = z.object({
  symbol: z.string().min(1),
  order_type: z.enum(['buy', 'sell', 'buy_limit', 'sell_limit', 'buy_stop', 'sell_stop']),
  volume: z.number().positive(),
  price: z.number().optional(),
  sl: z.number().optional(),
  tp: z.number().optional(),
  comment: z.string().optional(),
  magic: z.number().optional(),
});

// Trade execution is intentionally disabled — this dashboard is read-only.
// Trades are placed manually from the MT5 phone app.
metaTraderRouter.post('/order/place', (_req, res) => {
  res.status(403).json({ success: false, message: 'Trade execution is disabled. This dashboard is read-only. Place trades from your MT5 app.' });
});

metaTraderRouter.post('/position/close/:positionId', (_req, res) => {
  res.status(403).json({ success: false, message: 'Trade execution is disabled. This dashboard is read-only. Close positions from your MT5 app.' });
});
