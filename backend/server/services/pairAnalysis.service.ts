import * as memCache from '../lib/cache.js';
import { getLatestMarketPrice } from '../../../src/server/marketDataService.js';
import {
  bootstrapFundamentals,
  getFundamentalSourceStatus,
  getFundamentalsEvents,
  getFundamentalsForSymbol,
  getFundamentalsNews,
  refreshFundamentalsData,
} from './fundamentals.service.js';
import {
  buildFundamentalSummary,
  buildTechnicalSummary,
  getCentralBankDriversForSymbol,
  getLatestNewsForSymbol,
  getPoliticalDriversForSymbol,
  inferBullishBearishDrivers,
} from '../../../src/services/pairs/pairMacroDriverService.js';
import {
  getAssetClass,
  getBaseCurrency,
  getDisplayName,
  getQuoteCurrency,
  normalizeApiSymbol,
  normalizeDisplaySymbol,
} from '../../../src/services/pairs/symbolNormalizer.js';
import {
  isEnabledPair,
  getMacroFocusForSymbol,
  getFundamentalDriversForSymbol,
} from '../../../src/services/intelligence/pairFundamentalDrivers.js';
import {
  scoreNewsRelevanceForPair,
  summarizeNewsImpact,
  type ScoredArticle,
} from '../../../src/services/intelligence/newsRelevanceScorer.js';
import {
  filterEventsForPair,
  findNextHighImpact,
  type ScoredEvent,
} from '../../../src/services/intelligence/eventRelevanceFilter.js';
import {
  calculateTradeStatus,
  type TradeStatus,
} from '../../../src/services/intelligence/tradeStatusCalculator.js';
import {
  buildPairIntelligenceAI,
  fallbackIntelligence,
  type PairIntelligenceAI,
  type PairIntelligenceContext,
} from './pairIntelligenceAI.service.js';
import { getLatestSavedAiAnalysisForSymbol, type SavedAiSymbolAnalysis } from './aiAnalysisStore.service.js';
import {
  buildCorrelationContext,
  getCorrelatedSymbols,
  type MacroCorrelationContext,
} from '../../../src/services/intelligence/intermarketCorrelation.js';
import { getOpenAIModel, getPairAiTimeoutMs, isOpenAIConfigured, logOpenAIConfiguration } from '../lib/openaiConfig.js';

// ── Multi-timeframe bias ───────────────────────────────────────────────────

export type TimeframeBiasLabel = 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';

export interface TimeframeBias {
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
  bias: TimeframeBiasLabel;
  confidence: number;
  latestClose: number | null;
  lastCandleTime: string | null;
  reason: string;
}

const TIMEFRAMES: TimeframeBias['timeframe'][] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const TIMEFRAME_WEIGHTS: Record<TimeframeBias['timeframe'], number> = {
  '1m': 1, '5m': 1, '15m': 2, '30m': 2, '1h': 3, '4h': 4, '1d': 5,
};

function computeEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function computeRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + gains / period / avgLoss);
}

function scoreEMA(ema20: number | null, ema50: number | null, parts: string[]): number {
  if (ema20 == null || ema50 == null) return 0;
  if (ema20 > ema50) { parts.push('EMA20>EMA50'); return 1; }
  if (ema20 < ema50) { parts.push('EMA20<EMA50'); return -1; }
  return 0;
}

function scoreRSI(rsi: number | null, parts: string[]): number {
  if (rsi == null) return 0;
  if (rsi > 55) { parts.push(`RSI ${rsi.toFixed(0)}`); return 1; }
  if (rsi < 45) { parts.push(`RSI ${rsi.toFixed(0)}`); return -1; }
  parts.push(`RSI neutral ${rsi.toFixed(0)}`);
  return 0;
}

function scoreMomentum(momentum: number | null, parts: string[]): number {
  if (momentum == null) return 0;
  if (momentum > 0) { parts.push('momentum up'); return 1; }
  if (momentum < 0) { parts.push('momentum down'); return -1; }
  return 0;
}

function classifyBias(closes: number[]): { bias: TimeframeBiasLabel; confidence: number; reason: string } {
  if (closes.length < 5) return { bias: 'unknown', confidence: 0, reason: 'Insufficient candles' };
  const last = closes.at(-1) ?? 0;
  const parts: string[] = [];
  const scores = [
    scoreEMA(computeEMA(closes, 20), computeEMA(closes, 50), parts),
    scoreRSI(computeRSI(closes, 14), parts),
    scoreMomentum(closes.length >= 6 ? last - (closes.at(-6) ?? last) : null, parts),
  ];
  const active = scores.filter((s) => s !== 0);
  const norm = active.length > 0 ? active.reduce((a, b) => a + b, 0) / scores.length : 0;
  let bias: TimeframeBiasLabel = 'neutral';
  if (norm > 0.2) bias = 'bullish';
  else if (norm < -0.2) bias = 'bearish';
  return { bias, confidence: Math.min(100, Math.round(Math.abs(norm) * 100)), reason: parts.join(' · ') || 'Neutral signals' };
}

async function computeSingleTimeframeBias(symbol: string, tf: TimeframeBias['timeframe']): Promise<TimeframeBias> {
  return {
    timeframe: tf,
    bias: 'unknown',
    confidence: 0,
    latestClose: null,
    lastCandleTime: null,
    reason: 'MT5 bridge candle feed unavailable for this timeframe.',
  };
}

const TF_BIAS_CACHE_TTL_MS = 3 * 60 * 1000;

async function computeAllTimeframeBiases(symbol: string): Promise<TimeframeBias[]> {
  const cacheKey = `tf-bias:${normalizeApiSymbol(symbol)}`;
  const cached = memCache.get<TimeframeBias[]>(cacheKey);
  if (cached) return cached;
  const result = await Promise.all(TIMEFRAMES.map((tf) => computeSingleTimeframeBias(symbol, tf)));
  memCache.set(cacheKey, result, TF_BIAS_CACHE_TTL_MS);
  return result;
}

export function deriveWeightedBias(biases: TimeframeBias[]): { bias: TimeframeBiasLabel; confidence: number } {
  let weightedScore = 0;
  let totalWeight = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  for (const b of biases) {
    if (b.bias === 'unknown') continue;
    const w = TIMEFRAME_WEIGHTS[b.timeframe];
    let score = 0;
    if (b.bias === 'bullish') score = 1;
    else if (b.bias === 'bearish') score = -1;
    weightedScore += score * w;
    totalWeight += w;
    confidenceSum += b.confidence * w;
    confidenceCount += w;
  }
  if (totalWeight === 0) return { bias: 'unknown', confidence: 0 };
  const norm = weightedScore / totalWeight;
  const intradayBiases = biases.filter((b) => ['1m', '5m', '15m', '30m', '1h'].includes(b.timeframe));
  const higherBiases = biases.filter((b) => ['4h', '1d'].includes(b.timeframe));
  const intradayScore = directionalAverage(intradayBiases);
  const higherScore = directionalAverage(higherBiases);
  const conflict = intradayScore !== 0 && higherScore !== 0 && Math.sign(intradayScore) !== Math.sign(higherScore);

  let bias: TimeframeBiasLabel = 'neutral';
  if (norm > 0.15) bias = 'bullish';
  else if (norm < -0.15) bias = 'bearish';
  if (conflict || (Math.abs(norm) <= 0.15 && hasDirectionalConflict(biases))) bias = 'mixed';
  const confidence = confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : 0;
  return { bias, confidence };
}

function directionalAverage(biases: TimeframeBias[]): number {
  const directional = biases.filter((b) => b.bias === 'bullish' || b.bias === 'bearish');
  if (!directional.length) return 0;
  return directional.reduce((sum, b) => sum + (b.bias === 'bullish' ? 1 : -1), 0) / directional.length;
}

function hasDirectionalConflict(biases: TimeframeBias[]): boolean {
  return biases.some((b) => b.bias === 'bullish') && biases.some((b) => b.bias === 'bearish');
}

// ── Response types ──────────────────────────────────────────────────────────

export interface ScoredNewsItem {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  contentSnippet: string | null;
  impact: 'low' | 'medium' | 'high' | 'unknown';
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
  affectedCurrencies: string[];
  affectedSymbols: string[];
  aiSummary: string | null;
  publishedAt: string;
  relevanceScore: number;
  biasImpact: 'bullish' | 'bearish' | 'neutral';
  whyItMatters: string;
}

export interface ScoredEventItem {
  id: string;
  eventName: string;
  currency: string | null;
  impact: 'low' | 'medium' | 'high';
  eventTime: string;
  previous: string | null;
  forecast: string | null;
  actual: string | null;
  tradeWarning: 'none' | 'wait' | 'avoid';
  relevance: 'high' | 'medium' | 'low';
  minutesUntil: number;
  isFuture: boolean;
}

export interface PairAnalysisResponse {
  symbol: string;
  displaySymbol: string;
  displayName: string;
  assetClass: string;
  enabled: boolean;
  price: {
    current: number | null;
    bid: number | null;
    ask: number | null;
    change: number | null;
    changePercent: number | null;
    previousClose: number | null;
    dayHigh: number | null;
    dayLow: number | null;
    marketStatus: 'open' | 'closed' | 'unknown';
    source: string;
    updatedAt: string | null;
    staleMinutes: number | null;
    unavailableReason?: string;
  };
  fundamentals: {
    bias: 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
    confidence: number;
    impact: 'low' | 'medium' | 'high' | 'unknown';
    tradeStatus: 'safe' | 'wait' | 'avoid' | 'unknown';
    summary: string;
    reason: string;
    keyDrivers: string[];
    bullishDrivers: string[];
    bearishDrivers: string[];
    risks: string[];
    lastUpdated: string | null;
    mode: 'rules-based' | 'ai-enhanced';
  };
  technical: {
    trend: 'bullish' | 'bearish' | 'neutral' | 'unknown';
    timeframe: '1D';
    summary: string;
  };
  intelligence: PairIntelligenceAI;
  newsImpactSummary: {
    direction: 'bullish' | 'bearish' | 'neutral' | 'mixed';
    percentage: number;
    summary: string;
  };
  topRelevantNews: ScoredNewsItem[];
  relevantEvents: ScoredEventItem[];
  nextHighImpactEvent: ScoredEventItem | null;
  tradeStatus: {
    status: TradeStatus;
    label: string;
    reason: string;
  };
  macroFocus: string[];
  fundamentalDriversList: string[];
  latestNews: ReturnType<typeof getLatestNewsForSymbol>;
  centralBankDrivers: ReturnType<typeof getCentralBankDriversForSymbol>;
  politicalDrivers: ReturnType<typeof getPoliticalDriversForSymbol>;
  sourceStatus: ReturnType<typeof getFundamentalSourceStatus>;
  timeframeBiases: TimeframeBias[];
  overallBias: TimeframeBiasLabel;
  overallConfidence: number;
  macroCorrelation: MacroCorrelationContext;
}

export type PairAiStage =
  | 'preparing_pair_snapshot'
  | 'loading_fundamentals'
  | 'running_ai_analysis'
  | 'finalizing_verdict';

export interface PairAnalysisDiagnostics {
  openaiKeyConfigured: boolean;
  model: string;
  symbol: string;
  pairContextLoaded: boolean;
  fundamentalsLoaded: boolean;
  promptSizeEstimate: number | null;
  pairAiTimeoutMs: number;
}

interface PreparedPairAnalysisContext {
  apiSymbol: string;
  displaySymbol: string;
  enabled: boolean;
  price: PairAnalysisResponse['price'];
  fundamentals: PairAnalysisResponse['fundamentals'];
  technical: PairAnalysisResponse['technical'];
  newsImpact: PairAnalysisResponse['newsImpactSummary'];
  topRelevantNews: ScoredNewsItem[];
  relevantEvents: ScoredEventItem[];
  nextHighImpactEvent: ScoredEventItem | null;
  macroFocus: string[];
  fundamentalDriversList: string[];
  latestNews: ReturnType<typeof getLatestNewsForSymbol>;
  centralBankDrivers: ReturnType<typeof getCentralBankDriversForSymbol>;
  politicalDrivers: ReturnType<typeof getPoliticalDriversForSymbol>;
  sourceStatus: ReturnType<typeof getFundamentalSourceStatus>;
  timeframeBiases: TimeframeBias[];
  overallBias: TimeframeBiasLabel;
  overallConfidence: number;
  macroCorrelation: MacroCorrelationContext;
  intelligenceContext: PairIntelligenceContext;
  promptSizeEstimate: number;
}

// ── Price helpers ────────────────────────────────────────────────────────────

function inferMarketStatus(timestamp: number | null): 'open' | 'closed' | 'unknown' {
  if (!timestamp) return 'unknown';
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return 'closed';
  return 'open';
}

function computeStaleMinutes(updatedAt: string | null): number | null {
  if (!updatedAt) return null;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

type PriceQuote = {
  mid: number;
  bid: number | null;
  ask: number | null;
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  timestamp: number;
};

export function buildPricePayload(args: {
  quote: PriceQuote | null;
  source?: string;
  unavailableReason?: string;
}): PairAnalysisResponse['price'] {
  const quote = args.quote;
  const current = quote?.mid ?? null;
  const previousClose = quote && quote.change != null ? quote.mid - quote.change : null;
  const change = quote?.change ?? (current != null && previousClose != null ? current - previousClose : null);
  const changePercent = quote?.changePct ?? (change != null && previousClose ? (change / previousClose) * 100 : null);
  const source = current != null ? (args.source ?? 'mt5-bridge') : 'Unavailable';
  let updatedAt: string | null = null;
  if (quote?.timestamp) updatedAt = new Date(quote.timestamp).toISOString();

  return {
    current,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    change,
    changePercent,
    previousClose,
    dayHigh: quote?.high ?? null,
    dayLow: quote?.low ?? null,
    marketStatus: inferMarketStatus(quote?.timestamp ?? null),
    source,
    updatedAt,
    staleMinutes: computeStaleMinutes(updatedAt),
    unavailableReason: current == null ? (args.unavailableReason ?? 'Price unavailable — check MT5 bridge quote feed.') : args.unavailableReason,
  };
}

async function fetchPriceContext(symbol: string): Promise<PairAnalysisResponse['price']> {
  const apiSymbol = normalizeApiSymbol(symbol);
  let quote: PriceQuote | null = null;
  let source = 'market-data';
  let unavailableReason: string | undefined;

  try {
    const latest = await getLatestMarketPrice(apiSymbol);
    if (latest.price != null) {
      quote = {
        mid: latest.price,
        bid: latest.bid,
        ask: latest.ask,
        change: latest.change,
        changePct: latest.changePercent,
        high: latest.high,
        low: latest.low,
        timestamp: latest.timestampMs,
      };
      source = latest.provider;
    } else {
      unavailableReason = latest.error ?? latest.warning ?? `MT5 bridge quote unavailable for ${apiSymbol}.`;
    }
  } catch (err) {
    console.warn(`[pairAnalysis] unified market quote failed for ${apiSymbol}:`, err instanceof Error ? err.message : err);
    unavailableReason = err instanceof Error ? err.message : `MT5 bridge quote unavailable for ${apiSymbol}.`;
  }

  return buildPricePayload({ quote, source, unavailableReason });
}

// ── Map scored news/events into response shapes ──────────────────────────────

function mapScoredArticle(scored: ScoredArticle<NonNullable<ReturnType<typeof getLatestNewsForSymbol>>[number]>): ScoredNewsItem {
  const a = scored.article;
  return {
    id: a.id,
    source: a.source,
    title: a.title,
    summary: a.summary ?? null,
    contentSnippet: a.contentSnippet ?? null,
    impact: a.impact,
    sentiment: a.sentiment,
    affectedCurrencies: a.affectedCurrencies,
    affectedSymbols: a.affectedSymbols,
    aiSummary: a.aiSummary ?? null,
    publishedAt: a.publishedAt,
    relevanceScore: scored.relevanceScore,
    biasImpact: scored.biasImpact,
    whyItMatters: scored.whyItMatters,
  };
}

function mapScoredEvent(scored: ScoredEvent): ScoredEventItem {
  const e = scored.event;
  return {
    id: e.id,
    eventName: e.eventName,
    currency: e.currency,
    impact: e.impact,
    eventTime: e.eventTime,
    previous: e.previous ?? null,
    forecast: e.forecast ?? null,
    actual: e.actual ?? null,
    tradeWarning: e.tradeWarning ?? 'none',
    relevance: scored.relevance,
    minutesUntil: scored.minutesUntil,
    isFuture: scored.isFuture,
  };
}

function mapStoredAnalysisToIntelligence(
  apiSymbol: string,
  saved: SavedAiSymbolAnalysis,
  technicalSummary: string,
  fundamentalSummary: string,
  hasNearHighImpactEvent: boolean,
): PairIntelligenceAI {
  return {
    symbol: apiSymbol,
    overallBias: saved.bias,
    biasPercentage: Math.max(0, Math.min(100, saved.confidence)),
    technicalBias: {
      direction: saved.bias,
      percentage: Math.max(0, Math.min(100, saved.confidence)),
      summary: saved.technicalSummary || technicalSummary,
    },
    fundamentalBias: {
      direction: saved.macroFundamentals.bias,
      percentage: Math.max(0, Math.min(100, saved.confidence)),
      summary: saved.fundamentalSummary || saved.macroFundamentals.reasoning || fundamentalSummary,
    },
    newsImpact: {
      direction: saved.bias,
      percentage: saved.economicCalendarImpact.riskLevel === 'high' ? 80 : saved.economicCalendarImpact.riskLevel === 'medium' ? 60 : 40,
      summary: saved.decisionSummary || saved.economicCalendarImpact.expectedEffect,
    },
    tradeStatus: hasNearHighImpactEvent || saved.calendarRisk === 'high' || saved.tradeMode === 'avoid' ? 'high_risk' : 'wait',
    summary: saved.decisionSummary || saved.summary,
    bullishDrivers: saved.bias === 'bullish' ? saved.macroDrivers : [],
    bearishDrivers: saved.bias === 'bearish' ? saved.macroDrivers : [],
    risks: saved.riskFactors,
    invalidation: saved.decisionSummary || 'Watch the latest macro event slate and invalidate on fresh opposing data.',
    tradePlan: {
      preferredDirection: saved.tradeMode === 'favor_buys' ? 'long' : saved.tradeMode === 'favor_sells' ? 'short' : 'stand aside',
      entryConditions: ['Wait for price action confirmation around your planned level.'],
      avoidConditions: saved.riskFactors.length ? saved.riskFactors.slice(0, 3) : ['Avoid trading into unresolved high-impact events.'],
      riskNotes: saved.decisionSummary || saved.summary,
    },
  };
}

// ── Build analysis ───────────────────────────────────────────────────────────

async function preparePairAnalysisContext(
  symbol: string,
  options?: { forceRefresh?: boolean },
): Promise<PreparedPairAnalysisContext> {
  const apiSymbol = normalizeApiSymbol(symbol);
  const displaySymbol = normalizeDisplaySymbol(apiSymbol);
  const enabled = isEnabledPair(apiSymbol);

  await bootstrapFundamentals();
  if (options?.forceRefresh) {
    await refreshFundamentalsData();
  }

  const pairData = getFundamentalsForSymbol(displaySymbol);
  const hasData = pairData.relatedArticles.length > 0 || pairData.relatedEvents.length > 0;
  if (!hasData) {
    await refreshFundamentalsData();
  }

  const refreshedPairData = getFundamentalsForSymbol(displaySymbol);
  const allNews = getFundamentalsNews();
  const allEvents = getFundamentalsEvents();
  const sourceStatus = getFundamentalSourceStatus();
  const price = await fetchPriceContext(apiSymbol);
  const latestNews = getLatestNewsForSymbol(displaySymbol, allNews);
  const centralBankDrivers = getCentralBankDriversForSymbol(displaySymbol, allNews);
  const politicalDrivers = getPoliticalDriversForSymbol(displaySymbol, allNews);

  const scoredArticles = scoreNewsRelevanceForPair(allNews, apiSymbol);
  const topRelevantNews = scoredArticles.slice(0, 8).map(mapScoredArticle);
  const newsImpact = summarizeNewsImpact(scoredArticles.slice(0, 8));

  const scoredEvents = filterEventsForPair(allEvents, apiSymbol);
  const relevantEvents = scoredEvents.slice(0, 8).map(mapScoredEvent);
  const nextHighImpactScored = findNextHighImpact(scoredEvents);
  const nextHighImpactEvent = nextHighImpactScored ? mapScoredEvent(nextHighImpactScored) : null;

  const latestBias = refreshedPairData.latestBias;
  const technical = buildTechnicalSummary({
    symbol: displaySymbol,
    currentPrice: price.current,
    previousClose: price.previousClose,
    dayHigh: price.dayHigh,
    dayLow: price.dayLow,
    fundamentalBias: latestBias?.bias ?? 'unknown',
  });
  const { bullishDrivers, bearishDrivers } = inferBullishBearishDrivers(displaySymbol, latestNews);

  const fundamentals = {
    bias: latestBias?.bias ?? 'unknown',
    confidence: latestBias?.confidence ?? 0,
    impact: latestBias?.impact ?? 'unknown',
    tradeStatus: latestBias?.tradeStatus ?? 'unknown',
    summary: buildFundamentalSummary({
      symbol: displaySymbol,
      bias: latestBias?.bias ?? 'unknown',
      reason: latestBias?.reason ?? 'No saved analysis yet. Click Generate Analysis to fetch current price, latest macro headlines, and create a pair-specific fundamental view.',
      currentPrice: price.current,
      dailyChangePercent: price.changePercent,
      technicalTrend: technical.trend,
    }),
    reason: latestBias?.reason ?? 'No saved analysis yet. Click Generate Analysis to fetch current price, latest macro headlines, and create a pair-specific fundamental view.',
    keyDrivers: latestBias?.keyDrivers ?? [],
    bullishDrivers,
    bearishDrivers,
    risks: [
      'Headline volatility can reverse short-term bias quickly.',
      'High-impact data and central bank commentary can invalidate the current read.',
      technical.trend === 'unknown' ? 'Technical confirmation is limited because price context is incomplete.' : 'Fundamental and technical context should be checked together before acting.',
    ],
    lastUpdated: latestBias?.updatedAt ?? null,
    mode: isOpenAIConfigured() ? 'ai-enhanced' as const : 'rules-based' as const,
  };

  const timeframeBiases = await computeAllTimeframeBiases(symbol);
  const overall = deriveWeightedBias(timeframeBiases);

  const correlatedSymbols = getCorrelatedSymbols(apiSymbol);
  const correlatedBiasEntries = await Promise.all(
    correlatedSymbols.map(async (sym) => {
      const biases = await computeAllTimeframeBiases(sym);
      const derived = deriveWeightedBias(biases);
      return { symbol: sym, bias: derived.bias, confidence: derived.confidence };
    }),
  );
  const correlationCtx = buildCorrelationContext(apiSymbol, overall.bias, correlatedBiasEntries);

  const macroFocus = getMacroFocusForSymbol(apiSymbol);
  const fundamentalDriversList = getFundamentalDriversForSymbol(apiSymbol);
  const intelligenceContext: PairIntelligenceContext = {
    symbol: apiSymbol,
    displaySymbol,
    currentPrice: price.current,
    marketStatus: price.marketStatus,
    priceStaleMinutes: price.staleMinutes,
    overallBias: overall.bias,
    overallConfidence: overall.confidence,
    timeframeBiases: timeframeBiases.map((b) => ({
      timeframe: b.timeframe,
      bias: b.bias,
      confidence: b.confidence,
      reason: b.reason,
    })),
    technicalSummary: technical.summary,
    fundamentalSummary: fundamentals.summary,
    topRelevantNews: topRelevantNews.slice(0, 4).map((n) => ({
      title: n.title.slice(0, 140),
      summary: (n.summary ?? n.contentSnippet ?? n.whyItMatters).slice(0, 220),
      relevanceScore: n.relevanceScore,
      biasImpact: n.biasImpact,
      whyItMatters: n.whyItMatters.slice(0, 160),
    })),
    upcomingHighImpactEvents: scoredEvents
      .filter((s) => s.isFuture && s.event.impact === 'high' && s.relevance !== 'low')
      .slice(0, 4)
      .map((s) => ({
        eventName: s.event.eventName,
        currency: s.event.currency,
        impact: s.event.impact,
        eventTime: s.event.eventTime,
        minutesUntil: s.minutesUntil,
      })),
    macroDrivers: macroFocus.slice(0, 6),
    fundamentalDrivers: fundamentalDriversList.slice(0, 6),
    correlationSignals: correlationCtx.signals.map((s) => ({
      relatedSymbol: s.relatedSymbol,
      relationship: s.relationship,
      status: s.status,
      confidenceDelta: s.confidenceDelta,
      explanation: s.explanation.slice(0, 180),
    })),
    correlationConfidenceDelta: correlationCtx.totalConfidenceDelta,
    correlationMacroSummary: correlationCtx.macroSummary.slice(0, 220),
  };

  return {
    apiSymbol,
    displaySymbol,
    enabled,
    price,
    fundamentals,
    technical,
    newsImpact: {
      direction: newsImpact.direction === 'mixed' ? 'mixed' : newsImpact.direction,
      percentage: newsImpact.percentage,
      summary: newsImpact.summary,
    },
    topRelevantNews,
    relevantEvents,
    nextHighImpactEvent,
    macroFocus,
    fundamentalDriversList,
    latestNews,
    centralBankDrivers,
    politicalDrivers,
    sourceStatus,
    timeframeBiases,
    overallBias: overall.bias,
    overallConfidence: overall.confidence,
    macroCorrelation: correlationCtx,
    intelligenceContext,
    promptSizeEstimate: JSON.stringify(intelligenceContext).length,
  };
}

export async function getPairAiDebugSnapshot(symbol: string, options?: { forceRefresh?: boolean }) {
  logOpenAIConfiguration();
  const prepared = await preparePairAnalysisContext(symbol, options);
  return {
    openaiKeyConfigured: isOpenAIConfigured(),
    model: getOpenAIModel(),
    symbol: prepared.apiSymbol,
    pairContextLoaded: true,
    fundamentalsLoaded: true,
    promptSizeEstimate: prepared.promptSizeEstimate,
    timeoutConfigured: getPairAiTimeoutMs(),
  };
}

export async function buildPairAnalysis(
  symbol: string,
  options?: {
    forceRefresh?: boolean;
    preferSavedAi?: boolean;
    allowLiveAI?: boolean;
    onStageChange?: (stage: PairAiStage) => void;
  },
): Promise<PairAnalysisResponse> {
  const startedAt = Date.now();
  const apiSymbol = normalizeApiSymbol(symbol);
  const model = getOpenAIModel();
  logOpenAIConfiguration();
  console.log('[pair-ai] analysis requested', { symbol: apiSymbol });

  options?.onStageChange?.('preparing_pair_snapshot');
  console.log('[pair-ai] loading pair technical context', { symbol: apiSymbol });
  options?.onStageChange?.('loading_fundamentals');
  console.log('[pair-ai] loading fundamentals context', { symbol: apiSymbol });

  const prepared = await preparePairAnalysisContext(symbol, { forceRefresh: options?.forceRefresh });
  let intelligence: PairIntelligenceAI;

  const savedAnalysis = options?.preferSavedAi === false
    ? null
    : await getLatestSavedAiAnalysisForSymbol(prepared.apiSymbol);

  if (savedAnalysis) {
    intelligence = mapStoredAnalysisToIntelligence(
      prepared.apiSymbol,
      savedAnalysis,
      prepared.technical.summary,
      prepared.fundamentals.summary,
      prepared.relevantEvents.some((s) => s.isFuture && s.impact === 'high' && s.minutesUntil <= 60),
    );
  } else if (options?.allowLiveAI) {
    options?.onStageChange?.('running_ai_analysis');
    console.log('[pair-ai] calling OpenAI', { model });
    intelligence = await buildPairIntelligenceAI(prepared.intelligenceContext);
    console.log('[pair-ai] OpenAI analysis completed', { symbol: prepared.apiSymbol, durationMs: Date.now() - startedAt });
  } else {
    intelligence = fallbackIntelligence(prepared.intelligenceContext);
  }

  options?.onStageChange?.('finalizing_verdict');
  const tradeStatus = calculateTradeStatus({
    overallBias: prepared.overallBias === 'unknown' ? 'unknown' : prepared.overallBias,
    technicalBias: intelligence.technicalBias.direction,
    fundamentalBias: intelligence.fundamentalBias.direction,
    marketStatus: prepared.price.marketStatus,
    priceStaleMinutes: prepared.price.staleMinutes,
    highImpactWithinMinutes: prepared.nextHighImpactEvent?.minutesUntil ?? null,
    overallConfidence: prepared.overallConfidence,
  });

  return {
    symbol: prepared.apiSymbol,
    displaySymbol: prepared.displaySymbol,
    displayName: getDisplayName(prepared.apiSymbol),
    assetClass: getAssetClass(prepared.apiSymbol),
    enabled: prepared.enabled,
    price: prepared.price,
    fundamentals: prepared.fundamentals,
    technical: prepared.technical,
    intelligence,
    newsImpactSummary: prepared.newsImpact,
    topRelevantNews: prepared.topRelevantNews,
    relevantEvents: prepared.relevantEvents,
    nextHighImpactEvent: prepared.nextHighImpactEvent,
    tradeStatus,
    macroFocus: prepared.macroFocus,
    fundamentalDriversList: prepared.fundamentalDriversList,
    latestNews: prepared.latestNews,
    centralBankDrivers: prepared.centralBankDrivers,
    politicalDrivers: prepared.politicalDrivers,
    sourceStatus: prepared.sourceStatus,
    timeframeBiases: prepared.timeframeBiases,
    overallBias: prepared.overallBias,
    overallConfidence: prepared.overallConfidence,
    macroCorrelation: prepared.macroCorrelation,
  };
}

export function buildPairHeaderMeta(symbol: string) {
  return {
    baseCurrency: getBaseCurrency(symbol),
    quoteCurrency: getQuoteCurrency(symbol),
  };
}
