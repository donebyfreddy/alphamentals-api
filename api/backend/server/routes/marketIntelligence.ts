import { Router } from 'express';
import { bootstrapFundamentals, getFundamentalsEvents, getFundamentalsNews, getFundamentalsOverview, refreshFundamentalsData } from '../services/fundamentals.service.js';
import { getLatestAiAnalysisResponse, getLatestAiAnalysisForSymbolResponse, runAiAnalysis, getRunJobStatus } from '../services/aiAnalysisRuns.service.js';
import { normalizeApiSymbol, normalizeDisplaySymbol } from '../../../src/services/pairs/symbolNormalizer.js';
import { getTelegramRuntimeState } from '../services/telegramBridge.service.js';
import { getConfiguredOpenAIApiKey, getOpenAIModel } from '../lib/openaiConfig.js';
import { getPersistenceStatus } from '../services/marketIntelligencePersistence.service.js';
import { getActiveProviders } from '../lib/calendarProviders/index.js';
import { buildPairFundamentalAnalysis, type PairFundamentalAnalysis } from '../services/pairFundamentalsAi.service.js';
import { buildPairIntelligence } from '../services/pairIntelligence.service.js';
import { loadPairIntelligence } from '../services/pairIntelligencePersistence.service.js';
import { getMt5BridgeStatus } from '../services/mt5Candles.service.js';

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

    // Detailed structured pair fundamentals — prefer persisted (fast),
    // fall back to a fresh build if nothing is saved yet.
    let pairFundamental: PairFundamentalAnalysis | null = null;
    const persisted = await loadPairIntelligence<{ fundamentals: PairFundamentalAnalysis }>(symbol);
    if (persisted?.fundamentals) {
      pairFundamental = persisted.fundamentals;
    } else {
      pairFundamental = await buildPairFundamentalAnalysis(symbol).catch((e) => {
        console.warn('[market-intelligence] pair fundamental build failed:', e instanceof Error ? e.message : e);
        return null;
      });
    }

    res.json({
      ok: true,
      symbol,
      displaySymbol: normalizeDisplaySymbol(symbol),
      analysisRunId: latestAi.analysis?.analysisRunId ?? null,
      analysis: latestAi.analysis
        ? mapPreviewItem(symbol, latestAi.analysis)
        : null,
      // New: detailed structured fundamental analysis (bias, drivers, conflict, evidence).
      pairFundamental,
      latestBias: latestAi.analysis
        ? mapPreviewItem(symbol, latestAi.analysis)
        : null,
      biasHistory: latestAi.analysis
        ? [mapPreviewItem(symbol, latestAi.analysis)]
        : [],
      relatedArticles: filterNewsForSymbol(symbol),
      relatedEvents: filterEventsForSymbol(symbol),
      generatedAt: pairFundamental?.generatedAt ?? latestAi.generatedAt,
      generatedTimezone: latestAi.generatedTimezone,
      triggerSource: latestAi.triggerSource,
      nextScheduledRun: latestAi.nextScheduledRun,
      status: latestAi.status,
      isStale: pairFundamental?.dataFreshness.isStale ?? latestAi.isStale,
      timezone: 'Europe/Madrid',
      updatedAt: pairFundamental?.generatedAt ?? latestAi.generatedAt ?? new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'PAIR_ERROR', message: error instanceof Error ? error.message : 'Failed to load pair fundamentals' });
  }
});

// ── POST /fundamentals/:symbol/regenerate ─────────────────────────────────────
// Refresh sources → build full pair intelligence (AI + MT5 structure/SMC) → persist.
marketIntelligenceRouter.post('/fundamentals/:symbol/regenerate', async (req, res) => {
  const symbol = normalizeApiSymbol(req.params.symbol);
  const warnings: string[] = [];
  try {
    console.log(`[market-intelligence] fundamentals regenerate started for ${symbol}`);
    try {
      await refreshFundamentalsData({ triggeredBy: 'manual' });
    } catch (err) {
      warnings.push(`Source refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const intelligence = await buildPairIntelligence(symbol, { forceRefresh: true });
    res.json({
      ok: true,
      symbol: intelligence.symbol,
      pairFundamental: intelligence.fundamentals,
      data: intelligence,
      warnings,
      updatedAt: intelligence.generatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate pair fundamentals';
    console.error(`[market-intelligence] fundamentals regenerate failed for ${symbol}:`, message);
    res.status(500).json({ ok: false, error: 'REGENERATE_FAILED', message, warnings });
  }
});

// ── GET /diagnostics ──────────────────────────────────────────────────────────

marketIntelligenceRouter.get('/diagnostics', async (_req, res) => {
  try {
    const overview = getFundamentalsOverview();
    const jobStatus = getRunJobStatus();
    const telegram = getTelegramRuntimeState();
    const openaiKey = getConfiguredOpenAIApiKey();
    const persistence = await getPersistenceStatus();
    const calendarProviders = getActiveProviders();
    const mt5Bridge = await getMt5BridgeStatus();

    const activeSources = overview.sourceStatus.filter((s) => s.status === 'ok').length;
    const failedSources = overview.sourceStatus.filter((s) => s.status === 'failed').length;

    const myfxbookEmail = process.env.MYFXBOOK_EMAIL?.trim();
    const myfxbookPassword = process.env.MYFXBOOK_PASSWORD?.trim();
    const myfxbookConfigured = Boolean(myfxbookEmail && myfxbookPassword);
    const myfxbookProvider = calendarProviders.find((p) => p.name === 'myfxbook');

    const openaiConfigured = Boolean(openaiKey);

    res.json({
      ok: true,
      backend: {
        port: Number(process.env.PORT ?? 3001),
        env: process.env.NODE_ENV ?? 'development',
        timezone: 'Europe/Madrid',
        time: new Date().toISOString(),
      },
      mt5: {
        bridgeUrl: mt5Bridge.bridgeUrl,
        bridgeReachable: mt5Bridge.bridgeReachable,
        terminalConnected: mt5Bridge.terminalConnected,
        accountLogin: mt5Bridge.accountLogin,
        server: mt5Bridge.server,
        lastCheckAt: mt5Bridge.lastCheckAt,
        error: mt5Bridge.error,
      },
      openai: {
        configured: openaiConfigured,
        valid: openaiConfigured,
        model: getOpenAIModel(),
        lastError: openaiConfigured ? null : 'OPENAI_API_KEY is missing or empty',
      },
      myfxbook: {
        configured: myfxbookConfigured,
        authenticated: myfxbookProvider?.available ?? false,
        lastError: myfxbookConfigured ? null : 'MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD are missing',
      },
      telegram: {
        available: telegram.connected,
        configured: telegram.configured,
        phase: telegram.currentPhase ?? telegram.errorPhase ?? 'TELEGRAM_UNAVAILABLE',
        account: telegram.accountUsername ?? null,
        targetChat: telegram.targetChat,
        resolvedChat: telegram.targetChatTitle,
        lastError: telegram.error,
        code: telegram.code,
        hints: telegram.hints,
      },
      sources: {
        active: activeSources,
        failed: failedSources,
        total: overview.sourceStatus.length,
        lastRefreshAt: overview.lastUpdated,
        calendarProviders,
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
        timezone: 'Europe/Madrid',
      },
      persistence: {
        hasAnalysis: persistence.hasAnalysis,
        hasCalendar: persistence.hasCalendar,
        hasNews: persistence.hasNews,
        lastAnalysisAt: persistence.lastAnalysisAt,
        dataDir: persistence.dataDir,
      },
      frontend: {
        expectedBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL
          ?? process.env.VPS_API_BASE_URL
          ?? `http://localhost:${process.env.PORT ?? 3001}`,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'DIAGNOSTICS_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /telegram ─────────────────────────────────────────────────────────────

marketIntelligenceRouter.get('/telegram', (_req, res) => {
  try {
    const telegram = getTelegramRuntimeState();
    res.json({
      ok: true,
      configured: telegram.configured,
      available: telegram.connected,
      loggedIn: telegram.loggedIn,
      targetChatAccessible: telegram.targetChatAccessible,
      targetChatResolved: telegram.targetChatResolved,
      canReadMessages: telegram.canReadMessages,
      messagesFetched: telegram.messagesFetched,
      phase: telegram.currentPhase,
      errorPhase: telegram.errorPhase,
      account: telegram.account,
      accountUsername: telegram.accountUsername,
      targetChat: telegram.targetChat,
      targetChatTitle: telegram.targetChatTitle,
      targetChatType: telegram.targetChatType,
      lastSyncAt: telegram.lastSyncAt,
      lastMessageDate: telegram.lastMessageDate,
      error: telegram.error,
      code: telegram.code,
      hints: telegram.hints,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'TELEGRAM_STATUS_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
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
