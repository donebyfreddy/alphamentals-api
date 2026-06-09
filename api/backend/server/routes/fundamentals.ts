import type { Request } from 'express';
import { Router } from 'express';
import {
  bootstrapFundamentals,
  getFundamentalSourceStatus,
  getFundamentalsEvents,
  getFundamentalsForSymbol,
  getFundamentalsNews,
  getFundamentalsOverview,
  getScheduleMetadata,
  refreshFundamentalsData,
} from '../services/fundamentals.service.js';
import { canRunScheduledAiAnalysis, getLatestAiAnalysisForSymbolResponse, runAiAnalysis } from '../services/aiAnalysisRuns.service.js';

function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? '';
  return bearer === secret || headerSecret === secret;
}

export const fundamentalsRouter = Router();

fundamentalsRouter.get('/', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json(getFundamentalsOverview());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals overview';
    res.status(500).json({ error: message, detail: 'The fundamentals engine could not build the default overview.' });
  }
});

fundamentalsRouter.get('/overview', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    let overview = getFundamentalsOverview();
    if (!overview.lastUpdated && !overview.latestNews.length && !overview.upcomingEvents.length) {
      overview = await refreshFundamentalsData();
    }
    res.json(overview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals overview';
    res.status(500).json({
      error: message,
      detail: 'Overview route failed. Check backend logs, source config, and DB connectivity.',
    });
  }
});

fundamentalsRouter.post('/refresh', async (req, res) => {
  try {
    const enablePlaywrightFallback = Boolean(req.body?.enablePlaywrightFallback);
    const overview = await refreshFundamentalsData({ enablePlaywrightFallback, triggeredBy: 'manual' });
    res.json({
      success: true,
      message: 'Source data refreshed. AI analysis updates on the next scheduled run.',
      overview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh fundamentals';
    res.status(500).json({
      error: message,
      detail: 'Manual refresh failed before a valid overview could be built.',
    });
  }
});

fundamentalsRouter.get('/news', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({ items: getFundamentalsNews() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals news';
    res.status(500).json({ error: message });
  }
});

fundamentalsRouter.get('/events', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({ items: getFundamentalsEvents() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals events';
    res.status(500).json({ error: message });
  }
});

fundamentalsRouter.get('/sources/status', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({ items: getFundamentalSourceStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals source status';
    res.status(500).json({ error: message });
  }
});

// POST /api/fundamentals/cron
// Backwards-compatible alias for the canonical cron endpoint.
// Requires Authorization: Bearer <CRON_SECRET> or X-Cron-Secret header.
fundamentalsRouter.post('/cron', async (req, res) => {
  if (!isAuthorizedCron(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const scheduleStatus = canRunScheduledAiAnalysis();
  if (!scheduleStatus.allowed) {
    res.json({
      skipped: true,
      reason: scheduleStatus.reason,
      timezone: 'Europe/Madrid',
      currentMadridIso: scheduleStatus.currentMadridIso,
      scheduleMetadata: getScheduleMetadata(),
    });
    return;
  }

  try {
    console.log('[fundamentals/cron] Scheduled AI fundamentals generation triggered', scheduleStatus);
    const result = await runAiAnalysis({ trigger: 'cron', bypassCooldown: true });
    res.json({
      ...result,
      scheduleMetadata: getScheduleMetadata(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cron job failed';
    console.error('[fundamentals/cron] Daily generation failed:', message);
    res.status(500).json({ error: message, scheduleMetadata: getScheduleMetadata() });
  }
});

fundamentalsRouter.get('/:symbol/latest', async (req, res) => {
  try {
    const payload = await getLatestAiAnalysisForSymbolResponse(req.params.symbol);
    console.log('[fundamentals/latest] Loaded saved AI fundamentals', {
      requestedSymbol: req.params.symbol,
      symbol: payload.symbol,
      status: payload.status,
      hasAnalysis: Boolean(payload.analysis),
      generatedAt: payload.generatedAt,
    });
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load saved AI fundamentals';
    console.error('[fundamentals/latest] Failed:', message);
    res.status(500).json({ error: message });
  }
});

fundamentalsRouter.post('/:symbol/run', async (req, res) => {
  try {
    const startedAt = new Date().toISOString();
    const symbol = req.params.symbol;
    const latestAvailable = await getLatestAiAnalysisForSymbolResponse(symbol);

    console.log('[fundamentals/run] Queuing saved AI fundamentals run', {
      requestedSymbol: symbol,
      symbol: latestAvailable.symbol,
      previousGeneratedAt: latestAvailable.generatedAt,
    });

    runAiAnalysis({ trigger: 'manual', symbols: [symbol] }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[fundamentals/run] background run failed:', msg);
    });

    res.json({
      ok: true,
      status: latestAvailable.status === 'running' ? 'running' : 'queued',
      startedAt,
      symbol: latestAvailable.symbol,
      latestAvailable,
      generatedAt: latestAvailable.generatedAt,
      message: 'Saved AI fundamentals refresh started. Poll /api/fundamentals/:symbol/latest for results.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start AI fundamentals run';
    console.error('[fundamentals/run] Failed:', message);
    res.status(500).json({ error: message });
  }
});

fundamentalsRouter.get('/:symbol', async (req, res) => {
  try {
    await bootstrapFundamentals();
    const payload = getFundamentalsForSymbol(req.params.symbol);
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load pair fundamentals';
    res.status(500).json({ error: message });
  }
});
