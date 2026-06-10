import { Router } from 'express';
import { z } from 'zod';
import { getRecentTrades, syncMt5AccountNow } from '../services/mt5Sync.service.js';
import { getLatestHeartbeat, isEaConnected } from '../../../src/server/eaStore.js';

export const mt5Router = Router();
export const tradesRouter = Router();

function formatMt5RouteError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unexpected MT5 route error.';
  if (message.includes("Can't reach database server")) {
    return 'Trade journal database is unavailable. Check your Supabase/DB connection.';
  }
  return message;
}

const recentTradesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

mt5Router.post('/sync', async (_req, res) => {
  try {
    const result = await syncMt5AccountNow();
    res.status(result.success ? 200 : 503).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: formatMt5RouteError(error),
    });
  }
});

mt5Router.get('/status', (_req, res) => {
  const hb = getLatestHeartbeat();
  const connected = isEaConnected(30_000);

  if (!hb) {
    res.json({
      ok: true,
      data: {
        connected: false,
        status: 'no_heartbeat',
        source: 'mt5-ea',
        message: 'No EA heartbeat received. Ensure MetaTrader 5 is open and the EA is running.',
      },
    });
    return;
  }

  res.json({
    ok: true,
    data: {
      connected,
      status: connected ? 'connected' : 'stale',
      source: 'mt5-ea',
      account: hb.account,
      accountId: hb.accountId,
      lastHeartbeat: hb.receivedAt,
      message: connected ? 'EA connected' : 'EA heartbeat stale (>30s)',
    },
  });
});

tradesRouter.get('/recent', async (req, res) => {
  const parsed = recentTradesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid recent trades query.', details: parsed.error.flatten() });
    return;
  }

  try {
    const trades = await getRecentTrades(parsed.data.limit ?? 5);
    res.json({ ok: true, data: trades });
  } catch (error) {
    console.error('[trades/recent]', formatMt5RouteError(error));
    res.json({ ok: true, data: [] });
  }
});
