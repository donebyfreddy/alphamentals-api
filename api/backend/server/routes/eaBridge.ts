import { Router } from 'express';
import {
  storeHeartbeat,
  storeTick,
  getLatestHeartbeat,
  isEaConnected,
  getAllTicks,
  getTickCount,
  getTickSymbols,
} from '../../../src/server/eaStore.js';

export const eaBridgeRouter = Router();

// Coerce a value to number; returns null if not numeric.
function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Prefer mid-price; fall back to last (MT5 sets last=0 for some forex pairs).
function computePrice(bid: number | null, ask: number | null, last: number | null): number | null {
  if (bid != null && ask != null) return (bid + ask) / 2;
  if (last == null || last === 0) return null;
  return last;
}

function buildAccount(raw: Record<string, unknown>) {
  return {
    login:   typeof raw.login   === 'string' ? raw.login   : '',
    server:  typeof raw.server  === 'string' ? raw.server  : '',
    broker:  typeof raw.broker  === 'string' ? raw.broker  : '',
    name:    typeof raw.name    === 'string' ? raw.name    : '',
    balance: toNum(raw.balance) ?? 0,
    equity:  toNum(raw.equity)  ?? 0,
  };
}

function storeBundledQuotes(quotes: unknown[]): number {
  let count = 0;
  for (const q of quotes) {
    if (!q || typeof q !== 'object') continue;
    const qr = q as Record<string, unknown>;
    if (typeof qr.symbol !== 'string') continue;
    const bid  = toNum(qr.bid);
    const ask  = toNum(qr.ask);
    const last = toNum(qr.last);
    storeTick({
      symbol:    qr.symbol,
      bid,
      ask,
      price:     computePrice(bid, ask, last),
      timestamp: typeof qr.updatedAt === 'string' ? qr.updatedAt : new Date().toISOString(),
    });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// POST /ea/heartbeat
// Accepts account snapshot from the MT5 EA.
// Only accountId is required; all account fields are optional so the backend
// never rejects a heartbeat just because some broker fields are missing.
// ---------------------------------------------------------------------------
eaBridgeRouter.post('/heartbeat', (req, res) => {
  const body = req.body as Record<string, unknown> | undefined ?? {};
  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';

  if (!accountId) {
    console.warn('[ea-bridge] heartbeat rejected — missing accountId');
    res.status(400).json({ ok: false, error: 'accountId required' });
    return;
  }

  const rawAccount = (typeof body.account === 'object' && body.account !== null)
    ? body.account as Record<string, unknown>
    : {};

  storeHeartbeat({ accountId, account: buildAccount(rawAccount) });

  const ticksFromHeartbeat = Array.isArray(body.quotes) ? storeBundledQuotes(body.quotes) : 0;

  console.log(`[ea-bridge] heartbeat account=${accountId} bundled-ticks=${ticksFromHeartbeat}`);
  res.json({ ok: true, received: true });
});

// ---------------------------------------------------------------------------
// POST /ea/tick
// Accepts a single symbol price update from the EA.
// ---------------------------------------------------------------------------
eaBridgeRouter.post('/tick', (req, res) => {
  const body = req.body as Record<string, unknown> | undefined ?? {};
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';

  if (!symbol) {
    res.status(400).json({ ok: false, error: 'symbol required' });
    return;
  }

  const bid   = toNum(body.bid);
  const ask   = toNum(body.ask);
  const rawPrice = toNum(body.price);
  const price = rawPrice ?? computePrice(bid, ask, null);
  const timestamp = typeof body.timestamp === 'string' ? body.timestamp : new Date().toISOString();

  storeTick({ symbol, bid, ask, price, timestamp });

  console.log(`[ea-bridge] tick ${symbol} bid=${bid} ask=${ask} price=${price}`);
  res.json({ ok: true, received: true, symbol });
});

// ---------------------------------------------------------------------------
// GET /ea/status
// EA connection state based on last heartbeat age.
// ---------------------------------------------------------------------------
eaBridgeRouter.get('/status', (_req, res) => {
  const hb = getLatestHeartbeat();
  const connected = isEaConnected(30_000);
  const tickCount = getTickCount();
  const symbols = getTickSymbols();

  if (!hb) {
    res.json({
      ok: true,
      connected: false,
      source: 'mt5-ea',
      tickCount,
      symbols,
      message: 'No heartbeat received yet',
    });
    return;
  }

  res.json({
    ok: true,
    connected,
    source: 'mt5-ea',
    account: hb.account,
    accountId: hb.accountId,
    lastHeartbeatAt: hb.receivedAt,
    tickCount,
    symbols,
    message: connected ? 'EA connected' : 'EA heartbeat stale (>30s)',
  });
});

// ---------------------------------------------------------------------------
// GET /ea/ticks
// Debug endpoint — returns all latest ticks stored in memory.
// Use to verify the EA is sending real prices.
// ---------------------------------------------------------------------------
eaBridgeRouter.get('/ticks', (_req, res) => {
  const ticks = getAllTicks();
  res.json({
    ok: true,
    tickCount: Object.keys(ticks).length,
    ticks,
  });
});
