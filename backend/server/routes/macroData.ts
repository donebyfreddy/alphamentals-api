import { Router } from 'express';
import { syncMacroIndicators, getMacroSnapshot } from '../lib/macroSync.js';
import * as cache from '../lib/cache.js';

export const macroDataRouter = Router();

const SNAPSHOT_CACHE_KEY = 'macro:snapshot';
const SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * GET /api/macro
 * Returns the latest macro snapshot from Supabase.
 * Served from memory cache (1h TTL) to avoid hammering DB.
 */
macroDataRouter.get('/', async (_req, res) => {
  try {
    const cached = cache.get(SNAPSHOT_CACHE_KEY);
    if (cached) return res.json(cached);

    const snapshot = await getMacroSnapshot();
    cache.set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
    res.json(snapshot);
  } catch (err) {
    console.error('[macro/GET]', err);
    res.status(500).json({ error: 'Failed to load macro snapshot' });
  }
});

/**
 * GET /api/macro/:currency
 * Returns single-currency snapshot.
 */
macroDataRouter.get('/:currency', async (req, res) => {
  try {
    const currency = req.params.currency.toUpperCase();
    const cached = cache.get<Record<string, unknown>>(SNAPSHOT_CACHE_KEY);
    const snapshot = cached ?? (await getMacroSnapshot());
    if (!cached) cache.set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);

    const data = (snapshot as Record<string, unknown>)[currency];
    if (!data) return res.status(404).json({ error: `Currency ${currency} not found` });
    res.json({ [currency]: data });
  } catch (err) {
    console.error('[macro/GET/:currency]', err);
    res.status(500).json({ error: 'Failed to load macro snapshot' });
  }
});

/**
 * POST /api/macro/sync
 * Triggers a full FRED sync and refreshes the cache.
 * Should be called by the scheduler or a protected admin endpoint.
 */
macroDataRouter.post('/sync', async (_req, res) => {
  try {
    console.log('[macro/sync] Manual sync triggered via API');
    const snapshot = await syncMacroIndicators();
    cache.set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
    res.json({ ok: true, syncedAt: new Date().toISOString(), currencies: Object.keys(snapshot) });
  } catch (err) {
    console.error('[macro/sync]', err);
    res.status(500).json({ error: 'Sync failed', detail: (err as Error).message });
  }
});
