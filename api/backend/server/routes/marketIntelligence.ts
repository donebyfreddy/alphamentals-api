import { Router } from 'express';
import { bootstrapFundamentals, getFundamentalsEvents, getFundamentalsNews, getFundamentalsOverview, refreshFundamentalsData } from '../services/fundamentals.service.js';
import { getLatestAiAnalysisResponse, getLatestAiAnalysisForSymbolResponse, runAiAnalysis, getRunJobStatus } from '../services/aiAnalysisRuns.service.js';
import { normalizeApiSymbol, normalizeDisplaySymbol } from '../../../src/services/pairs/symbolNormalizer.js';
import { getTelegramRuntimeState } from '../services/telegramBridge.service.js';
import { getConfiguredOpenAIApiKey, getOpenAIModel } from '../lib/openaiConfig.js';

export const marketIntelligenceRouter = Router();

function mapPreviewItem(symbol: string, analysis: NonNullable<Awaited<ReturnType<typeof getLatestAiAnalysisResponse>>['analysis']>['symbols'][string]) {
  return {
    id: analysis.id ?? `saved-${symbol}`,
    analysisRunId: analysis.analysisRunId ?? null,
    symbol,
    displaySymbol: normalizeDisplaySymbol(symbol),
    action: analysis.tradeMode === 'favor_buys' || analysis.tradeMode === 'favor_sells'
      ? 'trade_allowed'
      : analysis.tradeMode,
    tradeStatus: analysis.tradeMode === 'avoid'
      ? 'avoid'
      : analysis.tradeMode === 'wait'
        ? 'wait'
        : 'safe',
    bias: analysis.bias,
    confidence: analysis.confidence,
    impact: analysis.calendarRisk,
    reason: analysis.summary,
    summary: analysis.summary,
    keyDrivers: analysis.macroDrivers,
    tradeMode: analysis.tradeMode,
    calendarRisk: analysis.calendarRisk,
    decisionSummary: analysis.decisionSummary,
    fundamentalSummary: analysis.fundamentalSummary,
    macroDrivers: analysis.macroDrivers,
    watchEvents: analysis.watchEvents,
    keyRisks: analysis.keyRisks,
    relatedArticleIds: [],
    relatedEventIds: [],
    macroFundamentals: analysis.macroFundamentals,
    calendarImpact: analysis.economicCalendarImpact,
    topRisks: analysis.keyRisks,
    relatedEvents: analysis.watchEvents,
    relatedNews: analysis.macroDrivers,
    drivers: analysis.macroDrivers,
    generatedAt: analysis.generatedAt,
    sourceDataWindow: analysis.sourceDataTimestamp,
    model: analysis.model,
    aiCost: null,
    createdAt: analysis.generatedAt,
    updatedAt: analysis.generatedAt,
  };
}

function filterEventsForSymbol(symbol: string) {
  const display = normalizeDisplaySymbol(symbol);
  return getFundamentalsEvents().filter((event) => event.affectedSymbols.includes(display)).slice(0, 20);
}

function filterNewsForSymbol(symbol: string) {
  const display = normalizeDisplaySymbol(symbol);
  return getFundamentalsNews().filter((article) => article.affectedSymbols.includes(display)).slice(0, 20);
}

// ── Shared overview builder ───────────────────────────────────────────────────

async function buildFundamentalsOverviewResponse() {
  await bootstrapFundamentals();
  const overview = getFundamentalsOverview();
  const latestAi = await getLatestAiAnalysisResponse();
  const pairs = latestAi.analysis
    ? Object.entries(latestAi.analysis.symbols).map(([symbol, analysis]) => mapPreviewItem(symbol, analysis))
    : [];

  return {
    ok: true,
    pairs,
    items: pairs,
    latestNews: overview.latestNews ?? [],
    upcomingEvents: overview.upcomingEvents ?? [],
    highImpactNext4Hours: overview.highImpactNext4Hours ?? [],
    sourceStatus: overview.sourceStatus ?? [],
    sources: overview.sourceStatus ?? [],
    diagnostics: {
      ...overview.aiDiagnostics,
      ...overview.scheduleMetadata,
      analysisRunId: pairs[0]?.analysisRunId ?? null,
    },
    generatedAt: latestAi.generatedAt,
    generatedTimezone: latestAi.generatedTimezone,
    triggerSource: latestAi.triggerSource,
    nextScheduledRun: latestAi.nextScheduledRun,
    nextRun: latestAi.nextScheduledRun,
    status: latestAi.status,
    lastUpdated: overview.lastUpdated ?? null,
    timezone: 'Europe/Madrid',
    updatedAt: overview.lastUpdated ?? new Date().toISOString(),
  };
}

// ── GET / (overview alias) ────────────────────────────────────────────────────

marketIntelligenceRouter.get('/', async (_req, res) => {
  try {
    res.json(await buildFundamentalsOverviewResponse());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load market intelligence';
    console.error('[market-intelligence] GET / failed', { error: message });
    res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message });
  }
});

// ── GET /status ───────────────────────────────────────────────────────────────

marketIntelligenceRouter.get('/status', (_req, res) => {
  try {
    const overview = getFundamentalsOverview();
    const jobStatus = getRunJobStatus();
    res.json({
      ok: true,
      status: jobStatus.status,
      lastUpdated: overview.lastUpdated,
      activeSources: overview.sourceStatus.filter((s) => s.status === 'ok').length,
      failedSources: overview.sourceStatus.filter((s) => s.status === 'failed').length,
      totalSources: overview.sourceStatus.length,
      lastAiRefresh: overview.aiDiagnostics.lastAiRefresh,
      nextRun: overview.scheduleMetadata.nextScheduledRun,
      timezone: 'Europe/Madrid',
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'STATUS_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /latest (alias for fundamentals overview) ─────────────────────────────

marketIntelligenceRouter.get('/latest', async (_req, res) => {
  try {
    res.json(await buildFundamentalsOverviewResponse());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load latest market intelligence';
    console.error('[market-intelligence] GET /latest failed', { error: message });
    res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message });
  }
});

// ── GET /news ─────────────────────────────────────────────────────────────────

marketIntelligenceRouter.get('/news', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({
      ok: true,
      items: getFundamentalsNews(),
      lastUpdated: getFundamentalsOverview().lastUpdated,
      updatedAt: getFundamentalsOverview().lastUpdated ?? new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'NEWS_ERROR', message: error instanceof Error ? error.message : 'Failed to load news' });
  }
});

// ── GET /articles (alias for /news) ──────────────────────────────────────────

marketIntelligenceRouter.get('/articles', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({
      ok: true,
      items: getFundamentalsNews(),
      lastUpdated: getFundamentalsOverview().lastUpdated,
      updatedAt: getFundamentalsOverview().lastUpdated ?? new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'ARTICLES_ERROR', message: error instanceof Error ? error.message : 'Failed to load articles' });
  }
});

// ── GET /events ───────────────────────────────────────────────────────────────

marketIntelligenceRouter.get('/events', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    const overview = getFundamentalsOverview();
    res.json({
      ok: true,
      items: getFundamentalsEvents(),
      upcoming: overview.upcomingEvents,
      next4Hours: overview.highImpactNext4Hours,
      lastUpdated: overview.lastUpdated,
      timezone: 'Europe/Madrid',
      updatedAt: overview.lastUpdated ?? new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'EVENTS_ERROR', message: error instanceof Error ? error.message : 'Failed to load events' });
  }
});

// ── GET /calendar (alias for /events) ────────────────────────────────────────

marketIntelligenceRouter.get('/calendar', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    const overview = getFundamentalsOverview();
    res.json({
      ok: true,
      items: getFundamentalsEvents(),
      upcoming: overview.upcomingEvents,
      next4Hours: overview.highImpactNext4Hours,
      lastUpdated: overview.lastUpdated,
      timezone: 'Europe/Madrid',
      updatedAt: overview.lastUpdated ?? new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'CALENDAR_ERROR', message: error instanceof Error ? error.message : 'Failed to load calendar' });
  }
});

// ── GET /macro ────────────────────────────────────────────────────────────────

marketIntelligenceRouter.get('/macro', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    const overview = getFundamentalsOverview();
    const latestAi = await getLatestAiAnalysisResponse();

    const pairs = latestAi.analysis
      ? Object.entries(latestAi.analysis.symbols).map(([symbol, analysis]) => ({
          symbol,
          displaySymbol: normalizeDisplaySymbol(symbol),
          bias: analysis.bias,
          confidence: analysis.confidence,
          summary: analysis.summary,
          drivers: analysis.macroDrivers,
        }))
      : [];

    res.json({
      ok: true,
      pairs,
      keyDrivers: pairs.flatMap((p) => p.drivers ?? []).slice(0, 10),
      risks: pairs.flatMap((p) => {
        const full = latestAi.analysis?.symbols[p.symbol];
        return full?.keyRisks ?? [];
      }).slice(0, 10),
      upcomingCatalysts: overview.upcomingEvents
        .filter((e) => e.impact === 'high')
        .slice(0, 5)
        .map((e) => `${e.eventName} (${e.currency}, ${e.dateLabel})`),
      lastUpdated: overview.lastUpdated,
      generatedAt: latestAi.generatedAt,
      timezone: 'Europe/Madrid',
      updatedAt: overview.lastUpdated ?? new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load macro intelligence';
    res.status(500).json({ ok: false, error: 'MACRO_ERROR', message });
  }
});

// ── GET /fundamentals ─────────────────────────────────────────────────────────

marketIntelligenceRouter.get('/fundamentals', async (_req, res) => {
  try {
    res.json(await buildFundamentalsOverviewResponse());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load market intelligence fundamentals';
    console.error('[market-intelligence] GET /fundamentals failed', { error: message });
    res.status(500).json({
      ok: false,
      error: 'FUNDAMENTALS_ERROR',
      message,
      pairs: [],
      latestNews: [],
      upcomingEvents: [],
      highImpactNext4Hours: [],
      sourceStatus: [],
      sources: [],
      lastUpdated: null,
      nextRun: null,
      timezone: 'Europe/Madrid',
    });
  }
});

// ── GET /fundamentals/:symbol ─────────────────────────────────────────────────

marketIntelligenceRouter.get('/fundamentals/:symbol', async (req, res) => {
  try {
    await bootstrapFundamentals();
    const symbol = normalizeApiSymbol(req.params.symbol);
    const latestAi = await getLatestAiAnalysisForSymbolResponse(symbol);
    res.json({
      ok: true,
      symbol,
      displaySymbol: normalizeDisplaySymbol(symbol),
      analysisRunId: latestAi.analysis?.analysisRunId ?? null,
      analysis: latestAi.analysis
        ? mapPreviewItem(symbol, latestAi.analysis)
        : null,
      latestBias: latestAi.analysis
        ? mapPreviewItem(symbol, latestAi.analysis)
        : null,
      biasHistory: latestAi.analysis
        ? [mapPreviewItem(symbol, latestAi.analysis)]
        : [],
      relatedArticles: filterNewsForSymbol(symbol),
      relatedEvents: filterEventsForSymbol(symbol),
      generatedAt: latestAi.generatedAt,
      generatedTimezone: latestAi.generatedTimezone,
      triggerSource: latestAi.triggerSource,
      nextScheduledRun: latestAi.nextScheduledRun,
      status: latestAi.status,
      isStale: latestAi.isStale,
      timezone: 'Europe/Madrid',
      updatedAt: latestAi.generatedAt ?? new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'PAIR_ERROR', message: error instanceof Error ? error.message : 'Failed to load pair fundamentals' });
  }
});

// ── GET /diagnostics ──────────────────────────────────────────────────────────

marketIntelligenceRouter.get('/diagnostics', (_req, res) => {
  try {
    const overview = getFundamentalsOverview();
    const jobStatus = getRunJobStatus();
    const telegram = getTelegramRuntimeState();
    const openaiKey = getConfiguredOpenAIApiKey();

    const activeSources = overview.sourceStatus.filter((s) => s.status === 'ok').length;
    const failedSources = overview.sourceStatus.filter((s) => s.status === 'failed').length;

    res.json({
      ok: true,
      backend: {
        time: new Date().toISOString(),
        env: process.env.NODE_ENV ?? 'development',
        timezone: 'Europe/Madrid',
      },
      openai: {
        configured: Boolean(openaiKey),
        model: getOpenAIModel(),
      },
      sources: {
        active: activeSources,
        failed: failedSources,
        total: overview.sourceStatus.length,
        lastRefreshAt: overview.lastUpdated,
        items: overview.sourceStatus.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          status: s.status,
          articleCount: s.articleCount,
          lastFetchedAt: s.lastFetchedAt,
          lastError: s.lastError,
        })),
      },
      analysis: {
        lastRunAt: overview.aiDiagnostics.lastAiRefresh,
        nextRunAt: overview.scheduleMetadata.nextScheduledRun,
        analysisRunId: jobStatus.latestAvailable
          ? (jobStatus.latestAvailable as unknown as Record<string, unknown>)?.runId ?? null
          : null,
        status: jobStatus.status,
        triggerSource: overview.scheduleMetadata.triggeredBy,
      },
      telegram: {
        available: telegram.connected,
        configured: telegram.configured,
        phase: telegram.currentPhase ?? (telegram.errorPhase ?? 'TELEGRAM_UNAVAILABLE'),
        account: telegram.accountUsername ?? 'Unknown',
        targetChat: telegram.targetChat,
        resolvedChat: telegram.targetChatTitle,
        lastError: telegram.error,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'DIAGNOSTICS_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── POST /refresh ─────────────────────────────────────────────────────────────

marketIntelligenceRouter.post('/refresh', async (req, res) => {
  try {
    console.log('[market-intelligence] refresh started');
    const overview = await refreshFundamentalsData({
      enablePlaywrightFallback: Boolean(req.body?.enablePlaywrightFallback),
      triggeredBy: 'manual',
    });
    console.log('[market-intelligence] raw sources refreshed');
    const aiResult = await runAiAnalysis({ trigger: 'manual', bypassCooldown: true, skipSourceRefresh: true });
    if (!aiResult.ok) throw new Error(aiResult.error ?? 'AI analysis regeneration failed.');
    console.log('[market-intelligence] analysis regenerated', { symbols: aiResult.symbols });
    res.json({
      ok: true,
      refreshedAt: overview.lastUpdated,
      lastUpdated: overview.lastUpdated,
      generatedAt: aiResult.analysis?.generatedAt ?? null,
      timezone: 'Europe/Madrid',
      newsCount: overview.latestNews.length,
      eventCount: overview.upcomingEvents.length,
      next4HoursCount: overview.highImpactNext4Hours.length,
      symbols: aiResult.symbols,
      message: 'Sources refreshed and AI analysis regenerated successfully.',
      sources: {
        active: overview.sourceStatus.filter((s) => s.status === 'ok').length,
        failed: overview.sourceStatus.filter((s) => s.status === 'failed').length,
        items: overview.sourceStatus,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh market intelligence';
    console.error('[market-intelligence] refresh failed', { error: message });
    res.status(500).json({ ok: false, error: 'REFRESH_FAILED', message });
  }
});

// ── POST /refresh-sources ─────────────────────────────────────────────────────

marketIntelligenceRouter.post('/refresh-sources', async (req, res) => {
  try {
    console.log('[market-intelligence] refresh-sources started');
    const overview = await refreshFundamentalsData({
      enablePlaywrightFallback: Boolean(req.body?.enablePlaywrightFallback),
      triggeredBy: 'manual',
    });
    const activeSources = overview.sourceStatus.filter((s) => s.status === 'ok').length;
    const failedSources = overview.sourceStatus.filter((s) => s.status === 'failed').length;
    console.log('[market-intelligence] refresh-sources completed', { activeSources, failedSources });
    res.json({
      ok: true,
      refreshedAt: overview.lastUpdated,
      lastUpdated: overview.lastUpdated,
      timezone: 'Europe/Madrid',
      newsCount: overview.latestNews.length,
      eventCount: overview.upcomingEvents.length,
      calendarEventsCount: overview.upcomingEvents.length,
      next4HoursCount: overview.highImpactNext4Hours.length,
      fundamentalsCount: overview.pairs?.length ?? 0,
      telegramMessagesCount: 0,
      message: 'Sources refreshed successfully.',
      sources: {
        active: activeSources,
        failed: failedSources,
        items: overview.sourceStatus.map((s) => ({
          name: s.id,
          type: s.type,
          ok: s.status === 'ok',
          count: s.articleCount,
          lastError: s.lastError,
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh source data';
    console.error('[market-intelligence] refresh-sources failed', { error: message });
    res.status(500).json({
      ok: false,
      error: 'SOURCE_REFRESH_FAILED',
      message: 'Failed to refresh market intelligence sources',
      details: { reason: message },
    });
  }
});

// ── POST /regenerate-ai ───────────────────────────────────────────────────────

marketIntelligenceRouter.post('/regenerate-ai', async (_req, res) => {
  try {
    console.log('[market-intelligence] AI analysis started');
    const aiResult = await runAiAnalysis({ trigger: 'manual', bypassCooldown: true, skipSourceRefresh: true });
    if (!aiResult.ok) throw new Error(aiResult.error ?? 'AI analysis regeneration failed.');
    console.log('[market-intelligence] AI analysis completed', { symbols: aiResult.symbols });
    res.json({
      ok: true,
      success: true,
      message: 'AI analysis regenerated successfully.',
      generatedAt: aiResult.analysis?.generatedAt ?? null,
      symbols: aiResult.symbols,
      analysis: aiResult.latestAvailable,
      updatedAt: aiResult.analysis?.generatedAt ?? new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate AI analysis';
    console.error('[market-intelligence] AI analysis failed', { error: message });
    res.status(500).json({ ok: false, error: 'AI_ANALYSIS_FAILED', message });
  }
});

// ── POST /run-analysis (alias for /regenerate-ai) ─────────────────────────────

marketIntelligenceRouter.post('/run-analysis', async (_req, res) => {
  try {
    console.log('[market-intelligence] run-analysis started');
    const aiResult = await runAiAnalysis({ trigger: 'manual', bypassCooldown: true, skipSourceRefresh: true });
    if (!aiResult.ok) throw new Error(aiResult.error ?? 'AI analysis run failed.');
    console.log('[market-intelligence] run-analysis completed', { symbols: aiResult.symbols });
    res.json({
      ok: true,
      status: 'completed',
      message: 'AI analysis completed successfully.',
      generatedAt: aiResult.analysis?.generatedAt ?? null,
      symbols: aiResult.symbols,
      analysis: aiResult.latestAvailable,
      updatedAt: aiResult.analysis?.generatedAt ?? new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run AI analysis';
    console.error('[market-intelligence] run-analysis failed', { error: message });
    res.status(500).json({ ok: false, error: 'RUN_ANALYSIS_FAILED', message });
  }
});
