import { Router } from 'express';
import { storeHeartbeat, storeTick, getLatestHeartbeat, isEaConnected } from '../../../src/server/eaStore.js';

export const eaBridgeRouter = Router();

eaBridgeRouter.post('/heartbeat', (req, res) => {
  const { accountId, account } = req.body ?? {};
  if (!accountId || !account || typeof account !== 'object') {
    res.status(400).json({ ok: false, error: 'accountId and account required' });
    return;
  }
  storeHeartbeat({ accountId, account });
  console.log(`[ea-bridge] heartbeat — account=${accountId}`);
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
