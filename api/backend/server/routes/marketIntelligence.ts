import { Router } from 'express';
import { bootstrapFundamentals, getFundamentalsEvents, getFundamentalsNews, getFundamentalsOverview, refreshFundamentalsData } from '../services/fundamentals.service.js';
import { getLatestAiAnalysisResponse, getLatestAiAnalysisForSymbolResponse, runAiAnalysis } from '../services/aiAnalysisRuns.service.js';
import { normalizeApiSymbol, normalizeDisplaySymbol } from '../../../src/services/pairs/symbolNormalizer.js';

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

marketIntelligenceRouter.get('/news', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({
      items: getFundamentalsNews(),
      lastUpdated: getFundamentalsOverview().lastUpdated,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load market intelligence news' });
  }
});

marketIntelligenceRouter.get('/events', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    const overview = getFundamentalsOverview();
    res.json({
      items: getFundamentalsEvents(),
      upcoming: overview.upcomingEvents,
      next4Hours: overview.highImpactNext4Hours,
      lastUpdated: overview.lastUpdated,
      timezone: 'Europe/Madrid',
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load market intelligence events' });
  }
});

marketIntelligenceRouter.get('/fundamentals', async (_req, res) => {
  try {
    await bootstrapFundamentals();
    const overview = getFundamentalsOverview();
    const latestAi = await getLatestAiAnalysisResponse();
    const pairs = latestAi.analysis
      ? Object.entries(latestAi.analysis.symbols).map(([symbol, analysis]) => mapPreviewItem(symbol, analysis))
      : [];

    res.json({
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
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load market intelligence fundamentals',
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

marketIntelligenceRouter.get('/fundamentals/:symbol', async (req, res) => {
  try {
    await bootstrapFundamentals();
    const symbol = normalizeApiSymbol(req.params.symbol);
    const latestAi = await getLatestAiAnalysisForSymbolResponse(symbol);
    res.json({
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
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load pair fundamentals' });
  }
});

marketIntelligenceRouter.post('/refresh', async (req, res) => {
  try {
    console.log('[fundamentals] manual refresh started');
    const overview = await refreshFundamentalsData({
      enablePlaywrightFallback: Boolean(req.body?.enablePlaywrightFallback),
      triggeredBy: 'manual',
    });
    console.log('[fundamentals] raw sources refreshed');
    console.log('[fundamentals] AI analysis regeneration started');
    const aiResult = await runAiAnalysis({ trigger: 'manual', bypassCooldown: true, skipSourceRefresh: true });
    if (!aiResult.ok) {
      throw new Error(aiResult.error ?? 'AI analysis regeneration failed.');
    }
    console.log('[fundamentals] AI analysis regeneration completed', { symbols: aiResult.symbols });
    res.json({
      ok: true,
      lastUpdated: overview.lastUpdated,
      generatedAt: aiResult.analysis?.generatedAt ?? null,
      timezone: 'Europe/Madrid',
      newsCount: overview.latestNews.length,
      eventCount: overview.upcomingEvents.length,
      next4HoursCount: overview.highImpactNext4Hours.length,
      symbols: aiResult.symbols,
      message: 'Fundamentals sources refreshed and AI analysis regenerated successfully.',
      overview,
      analysis: aiResult.latestAvailable,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh market intelligence';
    console.error('[fundamentals] manual refresh failed', { error: message });
    res.status(500).json({ error: message });
  }
});

marketIntelligenceRouter.post('/refresh-sources', async (req, res) => {
  try {
    console.log('[fundamentals] manual refresh started');
    const overview = await refreshFundamentalsData({
      enablePlaywrightFallback: Boolean(req.body?.enablePlaywrightFallback),
      triggeredBy: 'manual',
    });
    console.log('[fundamentals] raw sources refreshed');
    res.json({
      success: true,
      message: 'Sources refreshed successfully.',
      lastUpdated: overview.lastUpdated,
      timezone: 'Europe/Madrid',
      newsCount: overview.latestNews.length,
      eventCount: overview.upcomingEvents.length,
      next4HoursCount: overview.highImpactNext4Hours.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh source data';
    console.error('[fundamentals] manual refresh failed', { error: message });
    res.status(500).json({ error: message });
  }
});

marketIntelligenceRouter.post('/regenerate-ai', async (_req, res) => {
  try {
    console.log('[fundamentals] AI analysis regeneration started');
    const aiResult = await runAiAnalysis({ trigger: 'manual', bypassCooldown: true, skipSourceRefresh: true });
    if (!aiResult.ok) {
      throw new Error(aiResult.error ?? 'AI analysis regeneration failed.');
    }
    console.log('[fundamentals] AI analysis regeneration completed', { symbols: aiResult.symbols });
    res.json({
      success: true,
      message: 'AI analysis regenerated successfully.',
      generatedAt: aiResult.analysis?.generatedAt ?? null,
      symbols: aiResult.symbols,
      analysis: aiResult.latestAvailable,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate AI analysis';
    console.error('[fundamentals] manual refresh failed', { error: message });
    res.status(500).json({ error: message });
  }
});
