import { Router } from 'express';
import { storeHeartbeat, storeTick, getLatestHeartbeat, isEaConnected } from '../../../src/server/eaStore.js';

export const eaBridgeRouter = Router();

// Prefer mid-price; fall back to last (MT5 sets last=0 for some forex pairs).
function computePrice(bid: number | null, ask: number | null, last: number | null): number | null {
  if (bid != null && ask != null) return (bid + ask) / 2;
  if (last == null || last === 0) return null;
  return last;
}

// The EA bundles all watched-symbol quotes inside every heartbeat body.
// Extract them here so /api/market-data/quotes can serve live prices.
function storeHeartbeatQuotes(quotes: unknown[]): number {
  let count = 0;
  for (const q of quotes) {
    if (!q || typeof q !== 'object') continue;
    const raw = q as Record<string, unknown>;
    if (typeof raw.symbol !== 'string') continue;
    const bid = typeof raw.bid === 'number' ? raw.bid : null;
    const ask = typeof raw.ask === 'number' ? raw.ask : null;
    const last = typeof raw.last === 'number' ? raw.last : null;
    storeTick({
      symbol: raw.symbol,
      bid,
      ask,
      price: computePrice(bid, ask, last),
      timestamp: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    });
    count++;
  }
  return count;
}

eaBridgeRouter.post('/heartbeat', (req, res) => {
  const { accountId, account, quotes } = req.body ?? {};
  if (!accountId || !account || typeof account !== 'object') {
    res.status(400).json({ ok: false, error: 'accountId and account required' });
    return;
  }

  storeHeartbeat({ accountId, account });
  const ticksStored = Array.isArray(quotes) ? storeHeartbeatQuotes(quotes) : 0;

  console.log(`[ea-bridge] heartbeat — account=${accountId} ticks=${ticksStored}`);
  res.json({ ok: true });
});

eaBridgeRouter.post('/tick', (req, res) => {
  const { symbol, bid, ask, price, timestamp } = req.body ?? {};
  if (!symbol) {
    res.status(400).json({ ok: false, error: 'symbol required' });
    return;
  }
  storeTick({
    symbol,
    bid: bid ?? null,
    ask: ask ?? null,
    price: price ?? null,
    timestamp: timestamp ?? new Date().toISOString(),
  });
  res.json({ ok: true });
});

eaBridgeRouter.get('/status', (_req, res) => {
  const hb = getLatestHeartbeat();
  const connected = isEaConnected(30_000);
  if (!hb) {
    res.json({ ok: true, connected: false, source: 'mt5-ea', message: 'No heartbeat received yet' });
    return;
  }
  res.json({
    ok: true,
    connected,
    source: 'mt5-ea',
    account: hb.account,
    accountId: hb.accountId,
    lastHeartbeat: hb.receivedAt,
    message: connected ? 'EA connected' : 'EA heartbeat stale (>30s)',
  });
});
