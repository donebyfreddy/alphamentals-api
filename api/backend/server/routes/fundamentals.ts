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
import { getCalendarPayload, getFundamentalsPayload, getNewsPayload } from '../services/marketIntelligence/marketIntelligenceHub.service.js';
import { getMyfxbookCalendar, refreshMyfxbookCalendar } from '../services/myfxbookCalendar.service.js';

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
    const [overview, fundamentals, news, calendar] = await Promise.all([
      Promise.resolve(getFundamentalsOverview()),
      getFundamentalsPayload(),
      getNewsPayload(),
      getCalendarPayload(),
    ]);
    res.json({
      ...fundamentals,
      ok: true,
      pairs: overview.pairs,
      latestNews: news.articles,
      upcomingEvents: calendar.events,
      highImpactNext4Hours: calendar.events.filter((event) => event.impact === 'high').slice(0, 10),
      sourceStatus: fundamentals.sources,
      lastUpdated: fundamentals.generatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals overview';
    res.json({
      analysis: [],
      globalMacro: {
        usdBias: 'neutral',
        riskSentiment: 'mixed',
        goldBias: 'neutral',
      },
      sources: [],
      generatedAt: new Date().toISOString(),
      error: message,
      detail: 'The fundamentals engine could not build the default overview.',
    });
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
    res.json(await getNewsPayload());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals news';
    res.json({ articles: [], sources: [], generatedAt: new Date().toISOString(), error: message });
  }
});

fundamentalsRouter.get('/events', async (_req, res) => {
  try {
    res.json(await getCalendarPayload());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals events';
    res.json({ events: [], sources: [], generatedAt: new Date().toISOString(), error: message });
  }
});

// MyFXBook Playwright calendar endpoints. They never hard-fail if cache exists.
fundamentalsRouter.get('/calendar/today', async (_req, res) => {
  try {
    res.json(await getMyfxbookCalendar('today'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load today calendar';
    res.json({
      ok: false,
      period: 'today',
      events: [],
      summary: {
        period: 'today',
        high_impact_events: [],
        medium_impact_events: [],
        currencies_affected: [],
        risk_summary: 'MyFXBook calendar is unavailable and no cache was found.',
        trading_warning: 'Calendar data unavailable. Use caution around scheduled macro releases.',
        last_updated: new Date().toISOString(),
      },
      last_updated: null,
      source: 'cache_fallback',
      error: message,
    });
  }
});

fundamentalsRouter.get('/calendar/week', async (_req, res) => {
  try {
    res.json(await getMyfxbookCalendar('week'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load week calendar';
    res.json({
      ok: false,
      period: 'week',
      events: [],
      summary: {
        period: 'week',
        high_impact_events: [],
        medium_impact_events: [],
        currencies_affected: [],
        risk_summary: 'MyFXBook weekly calendar is unavailable and no cache was found.',
        trading_warning: 'Calendar data unavailable. Use caution around scheduled macro releases.',
        last_updated: new Date().toISOString(),
      },
      last_updated: null,
      source: 'cache_fallback',
      error: message,
    });
  }
});

fundamentalsRouter.get('/calendar/refresh', async (_req, res) => {
  try {
    const bundle = await refreshMyfxbookCalendar();
    res.json({
      ok: bundle.ok,
      source: bundle.source,
      generated_at: bundle.generated_at,
      today: await getMyfxbookCalendar('today'),
      week: await getMyfxbookCalendar('week'),
      error: bundle.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh MyFXBook calendar';
    res.json({
      ok: false,
      error: message,
      detail: 'Live scraping failed and no usable cache was found.',
    });
  }
});

fundamentalsRouter.get('/sources/status', async (_req, res) => {
  try {
    const payload = await getFundamentalsPayload();
    res.json({ sources: payload.sources, items: getFundamentalSourceStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load fundamentals source status';
    res.json({ sources: [], error: message });
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
