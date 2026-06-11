import { Router } from 'express';
import {
  connectAccount,
  getAccount,
  getAccountStatus,
  reconnectAccount,
  disconnectAccount,
  deleteAccount,
  verifyAccountTrading,
  syncAccount,
  getAccountPositions,
  getAccountOrders,
  getAccountDeals,
  getJournalStatus,
  listAccounts,
  rowToResponse,
} from '../services/accounts/accounts.service.js';

export const accountsConnectRouter = Router();

// ── POST /api/accounts/connect ────────────────────────────────────────────────
accountsConnectRouter.post('/connect', async (req, res) => {
  try {
    const result = await connectAccount(req.body);
    if (!result.ok) {
      res.status(400).json({
        ok: false,
        code: result.code ?? 'UNKNOWN_ERROR',
        message: result.message ?? 'Connection failed',
        diagnostics: result.diagnostics ?? {},
      });
      return;
    }
    res.json({
      ok: true,
      account: result.data!.account,
      diagnostics: result.data!.diagnostics,
    });
  } catch (err) {
    console.error('[Accounts] connect unhandled error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── GET /api/accounts ─────────────────────────────────────────────────────────
accountsConnectRouter.get('/', async (req, res) => {
  const userId = req.query.userId as string | undefined;
  try {
    const rows = await listAccounts(userId);
    res.json(rows.map(rowToResponse));
  } catch (err) {
    console.error('[Accounts] list error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── GET /api/accounts/:accountId ──────────────────────────────────────────────
accountsConnectRouter.get('/:accountId', async (req, res) => {
  // Skip sub-path routes that would be handled below — Express matches in order
  // but we guard here to avoid catching /connect accidentally.
  const { accountId } = req.params;
  if (!accountId || accountId === 'connect') {
    res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid accountId' });
    return;
  }
  try {
    const result = await getAccount(accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, account: result.data!.account });
  } catch (err) {
    console.error('[Accounts] get error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── GET /api/accounts/:accountId/status ───────────────────────────────────────
accountsConnectRouter.get('/:accountId/status', async (req, res) => {
  try {
    const result = await getAccountStatus(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json(result.data);
  } catch (err) {
    console.error('[Accounts] status error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── POST /api/accounts/:accountId/reconnect ───────────────────────────────────
accountsConnectRouter.post('/:accountId/reconnect', async (req, res) => {
  try {
    const result = await reconnectAccount(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json({
        ok: false,
        code: result.code,
        message: result.message,
        diagnostics: result.diagnostics ?? {},
      });
      return;
    }
    res.json({
      ok: true,
      account: result.data!.account,
      diagnostics: result.data!.diagnostics,
    });
  } catch (err) {
    console.error('[Accounts] reconnect error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── POST /api/accounts/:accountId/disconnect ──────────────────────────────────
accountsConnectRouter.post('/:accountId/disconnect', async (req, res) => {
  try {
    const result = await disconnectAccount(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, accountId: result.data!.accountId });
  } catch (err) {
    console.error('[Accounts] disconnect error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── DELETE /api/accounts/:accountId ──────────────────────────────────────────
accountsConnectRouter.delete('/:accountId', async (req, res) => {
  try {
    const result = await deleteAccount(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, success: true, accountId: result.data!.accountId });
  } catch (err) {
    console.error('[Accounts] delete error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── POST /api/accounts/:accountId/verify-trading ─────────────────────────────
accountsConnectRouter.post('/:accountId/verify-trading', async (req, res) => {
  try {
    const result = await verifyAccountTrading(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json({
        ok: false,
        code: result.code,
        message: result.message,
      });
      return;
    }
    res.json({ ok: true, tradingAllowed: result.data!.tradingAllowed });
  } catch (err) {
    console.error('[Accounts] verify-trading error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── POST /api/accounts/:accountId/sync ───────────────────────────────────────
accountsConnectRouter.post('/:accountId/sync', async (req, res) => {
  try {
    const result = await syncAccount(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, synced: result.data!.synced });
  } catch (err) {
    console.error('[Accounts] sync error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── GET /api/accounts/:accountId/positions ────────────────────────────────────
accountsConnectRouter.get('/:accountId/positions', async (req, res) => {
  try {
    const result = await getAccountPositions(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, positions: result.data });
  } catch (err) {
    console.error('[Accounts] positions error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── GET /api/accounts/:accountId/orders ──────────────────────────────────────
accountsConnectRouter.get('/:accountId/orders', async (req, res) => {
  try {
    const result = await getAccountOrders(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, orders: result.data });
  } catch (err) {
    console.error('[Accounts] orders error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── GET /api/accounts/:accountId/deals ───────────────────────────────────────
accountsConnectRouter.get('/:accountId/deals', async (req, res) => {
  try {
    const result = await getAccountDeals(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, deals: result.data });
  } catch (err) {
    console.error('[Accounts] deals error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});

// ── GET /api/accounts/:accountId/journal-status ───────────────────────────────
accountsConnectRouter.get('/:accountId/journal-status', async (req, res) => {
  try {
    const result = await getJournalStatus(req.params.accountId);
    if (!result.ok) {
      res.status(result.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, ...result.data });
  } catch (err) {
    console.error('[Accounts] journal-status error:', (err as Error).message);
    res.status(500).json({ ok: false, code: 'UNKNOWN_ERROR', message: 'Internal server error' });
  }
});
