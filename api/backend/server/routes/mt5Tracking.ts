import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

export const mt5TrackingRouter = Router();

/* ─── GET /api/mt5-tracking/accounts ─────────────────────────── */
mt5TrackingRouter.get('/accounts', async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
  const { data, error } = await supabase
    .from('mt5_connected_accounts')
    .select('*')
    .eq('userId', userId)
    .order('createdAt', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

/* ─── GET /api/mt5-tracking/accounts/:accountId ──────────────── */
mt5TrackingRouter.get('/accounts/:accountId', async (req, res) => {
  const { data, error } = await supabase
    .from('mt5_connected_accounts')
    .select('*')
    .eq('id', req.params.accountId)
    .single();
  if (error || !data) { res.status(404).json({ error: 'Account not found' }); return; }
  res.json(data);
});

/* ─── GET /api/mt5-tracking/accounts/:accountId/positions ─────── */
mt5TrackingRouter.get('/accounts/:accountId/positions', async (req, res) => {
  const { data, error } = await supabase
    .from('mt5_open_positions')
    .select('*')
    .eq('accountId', req.params.accountId)
    .order('openTime', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

/* ─── GET /api/mt5-tracking/accounts/:accountId/trades ──────────*/
mt5TrackingRouter.get('/accounts/:accountId/trades', async (req, res) => {
  const { limit = '100', offset = '0', symbol } = req.query as Record<string, string>;
  const take = Math.min(Number(limit), 500);
  const skip = Number(offset);

  let query = supabase
    .from('mt5_trades')
    .select('*')
    .eq('accountId', req.params.accountId)
    .order('closeTime', { ascending: false })
    .range(skip, skip + take - 1);
  if (symbol) query = query.eq('symbol', symbol);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

/* ─── GET /api/mt5-tracking/accounts/:accountId/equity ──────────*/
mt5TrackingRouter.get('/accounts/:accountId/equity', async (req, res) => {
  const { limit = '200' } = req.query as Record<string, string>;
  const take = Math.min(Number(limit), 1000);

  const { data, error } = await supabase
    .from('mt5_equity_snapshots')
    .select('*')
    .eq('accountId', req.params.accountId)
    .order('recordedAt', { ascending: false })
    .limit(take);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data ?? []).reverse()); // chronological order for charts
});

/* ─── GET /api/mt5-tracking/accounts/:accountId/stats ───────────*/
mt5TrackingRouter.get('/accounts/:accountId/stats', async (req, res) => {
  const { accountId } = req.params;

  const [tradesResult, equityResult] = await Promise.all([
    supabase.from('mt5_trades').select('*').eq('accountId', accountId),
    supabase.from('mt5_equity_snapshots').select('*').eq('accountId', accountId).order('recordedAt', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const trades = tradesResult.data ?? [];
  const latestEquity = equityResult.data;

  const closed  = trades.filter(t => t.closePrice != null);
  const wins    = closed.filter(t => t.profit > 0);
  const losses  = closed.filter(t => t.profit < 0);
  const totalPnl = closed.reduce((s, t) => s + t.profit, 0);
  const grossWin = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const winRate   = closed.length ? wins.length / closed.length : 0;
  const avgWin    = wins.length   ? grossWin  / wins.length    : 0;
  const avgLoss   = losses.length ? grossLoss / losses.length  : 0;
  let profitFactor: number;
  if (grossLoss > 0) { profitFactor = grossWin / grossLoss; }
  else if (grossWin > 0) { profitFactor = Infinity; }
  else { profitFactor = 0; }

  res.json({
    totalTrades:   closed.length,
    wins:          wins.length,
    losses:        losses.length,
    winRate:       Math.round(winRate * 10000) / 100,
    totalPnl:      Math.round(totalPnl * 100) / 100,
    avgWin:        Math.round(avgWin  * 100) / 100,
    avgLoss:       Math.round(avgLoss * 100) / 100,
    profitFactor:  Math.round(profitFactor * 100) / 100,
    balance:       latestEquity?.balance  ?? null,
    equity:        latestEquity?.equity   ?? null,
    lastSyncedAt:  latestEquity?.recordedAt ?? null,
  });
});

/* ─── POST /api/mt5-tracking/accounts ───────────────────────────*/
const createAccountSchema = z.object({
  userId:       z.string().min(1),
  brokerName:   z.string().default(''),
  accountLogin: z.string().min(1),
  serverName:   z.string().min(1),
  accountType:  z.enum(['demo', 'live']).default('demo'),
});

mt5TrackingRouter.post('/accounts', async (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    // Upsert by unique constraint (userId, accountLogin, serverName)
    const { data, error } = await supabase
      .from('mt5_connected_accounts')
      .upsert(
        { ...parsed.data, status: 'disconnected' },
        { onConflict: 'userId,accountLogin,serverName' }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
