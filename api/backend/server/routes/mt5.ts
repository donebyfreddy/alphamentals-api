import { Router } from 'express';
import { z } from 'zod';
import { getRecentTrades, syncMt5AccountNow } from '../services/mt5Sync.service.js';
import { getLatestHeartbeat, isEaConnected } from '../../../src/server/eaStore.js';
import { getMt5BridgeStatus } from '../services/mt5Candles.service.js';

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

mt5Router.get('/status', async (_req, res) => {
  const hb = getLatestHeartbeat();
  const eaConnected = isEaConnected(30_000);

  // Python bridge status (candle source) — independent of the EA tick feed.
  const bridge = await getMt5BridgeStatus().catch(() => null);

  res.json({
    ok: true,
    mt5: {
      bridgeUrl: bridge?.bridgeUrl ?? process.env.MT5_BRIDGE_URL ?? 'http://127.0.0.1:8001',
      bridgeReachable: bridge?.bridgeReachable ?? false,
      terminalConnected: bridge?.terminalConnected ?? false,
      accountLogin: bridge?.accountLogin ?? (hb?.account ? String(hb.accountId) : null),
      server: bridge?.server ?? null,
      lastCheckAt: bridge?.lastCheckAt ?? new Date().toISOString(),
      error: bridge?.error ?? null,
    },
    ea: {
      connected: eaConnected,
      status: hb ? (eaConnected ? 'connected' : 'stale') : 'no_heartbeat',
      source: 'mt5-ea',
      account: hb?.account ?? null,
      accountId: hb?.accountId ?? null,
      lastHeartbeat: hb?.receivedAt ?? null,
      message: hb
        ? (eaConnected ? 'EA connected' : 'EA heartbeat stale (>30s)')
        : 'No EA heartbeat received. Ensure MetaTrader 5 is open and the EA is running.',
    },
    // Legacy shape kept for existing consumers.
    data: {
      connected: eaConnected,
      status: hb ? (eaConnected ? 'connected' : 'stale') : 'no_heartbeat',
      source: 'mt5-ea',
      account: hb?.account ?? null,
      accountId: hb?.accountId ?? null,
      lastHeartbeat: hb?.receivedAt ?? null,
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
