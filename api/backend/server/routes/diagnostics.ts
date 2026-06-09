import { Router } from 'express';
import { getDiagnostics, clearCooldown } from '../lib/aiDiagnostics.js';
import { stats as cacheStats } from '../lib/cache.js';

export const diagnosticsRouter = Router();

/**
 * GET /api/diagnostics
 * Returns AI performance metrics, cache stats, and rate-limit status.
 */
diagnosticsRouter.get('/', (_req, res) => {
  const ai = getDiagnostics();
  const cache = cacheStats();

  res.json({
    timestamp: Date.now(),
    ai,
    cache: {
      entries: cache.size,
      keys: cache.keys.filter((k) => k.startsWith('pair-intel-ai:')),
    },
    marketData: {
      provider: 'mt5-bridge',
      quoteTtlSeconds: 15,
      candleTtlSeconds: { intraday: 0, daily: 0 },
    },
  });
});

/**
 * POST /api/diagnostics/clear-cooldown
 * Manually clears an active AI rate-limit cooldown (use after confirming quota reset).
 */
diagnosticsRouter.post('/clear-cooldown', (_req, res) => {
  clearCooldown();
  res.json({ success: true, message: 'AI cooldown cleared' });
});
