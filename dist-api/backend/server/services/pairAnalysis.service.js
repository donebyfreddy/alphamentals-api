"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveWeightedBias = deriveWeightedBias;
exports.buildPricePayload = buildPricePayload;
exports.getPairAiDebugSnapshot = getPairAiDebugSnapshot;
exports.buildPairAnalysis = buildPairAnalysis;
exports.buildPairHeaderMeta = buildPairHeaderMeta;
const memCache = __importStar(require("../lib/cache.js"));
const marketDataService_js_1 = require("../../../src/server/marketDataService.js");
const fundamentals_service_js_1 = require("./fundamentals.service.js");
const pairMacroDriverService_js_1 = require("../../../src/services/pairs/pairMacroDriverService.js");
const symbolNormalizer_js_1 = require("../../../src/services/pairs/symbolNormalizer.js");
const pairFundamentalDrivers_js_1 = require("../../../src/services/intelligence/pairFundamentalDrivers.js");
const newsRelevanceScorer_js_1 = require("../../../src/services/intelligence/newsRelevanceScorer.js");
const eventRelevanceFilter_js_1 = require("../../../src/services/intelligence/eventRelevanceFilter.js");
const tradeStatusCalculator_js_1 = require("../../../src/services/intelligence/tradeStatusCalculator.js");
const pairIntelligenceAI_service_js_1 = require("./pairIntelligenceAI.service.js");
const aiAnalysisStore_service_js_1 = require("./aiAnalysisStore.service.js");
const intermarketCorrelation_js_1 = require("../../../src/services/intelligence/intermarketCorrelation.js");
const openaiConfig_js_1 = require("../lib/openaiConfig.js");
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const TIMEFRAME_WEIGHTS = {
    '1m': 1, '5m': 1, '15m': 2, '30m': 2, '1h': 3, '4h': 4, '1d': 5,
};
function computeEMA(closes, period) {
    if (closes.length < period)
        return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++)
        ema = closes[i] * k + ema * (1 - k);
    return ema;
}
function computeRSI(closes, period = 14) {
    if (closes.length < period + 1)
        return null;
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0)
            gains += diff;
        else
            losses -= diff;
    }
    const avgLoss = losses / period;
    if (avgLoss === 0)
        return 100;
    return 100 - 100 / (1 + gains / period / avgLoss);
}
function scoreEMA(ema20, ema50, parts) {
    if (ema20 == null || ema50 == null)
        return 0;
    if (ema20 > ema50) {
        parts.push('EMA20>EMA50');
        return 1;
    }
    if (ema20 < ema50) {
        parts.push('EMA20<EMA50');
        return -1;
    }
    return 0;
}
function scoreRSI(rsi, parts) {
    if (rsi == null)
        return 0;
    if (rsi > 55) {
        parts.push(`RSI ${rsi.toFixed(0)}`);
        return 1;
    }
    if (rsi < 45) {
        parts.push(`RSI ${rsi.toFixed(0)}`);
        return -1;
    }
    parts.push(`RSI neutral ${rsi.toFixed(0)}`);
    return 0;
}
function scoreMomentum(momentum, parts) {
    if (momentum == null)
        return 0;
    if (momentum > 0) {
        parts.push('momentum up');
        return 1;
    }
    if (momentum < 0) {
        parts.push('momentum down');
        return -1;
    }
    return 0;
}
function classifyBias(closes) {
    if (closes.length < 5)
        return { bias: 'unknown', confidence: 0, reason: 'Insufficient candles' };
    const last = closes.at(-1) ?? 0;
    const parts = [];
    const scores = [
        scoreEMA(computeEMA(closes, 20), computeEMA(closes, 50), parts),
        scoreRSI(computeRSI(closes, 14), parts),
        scoreMomentum(closes.length >= 6 ? last - (closes.at(-6) ?? last) : null, parts),
    ];
    const active = scores.filter((s) => s !== 0);
    const norm = active.length > 0 ? active.reduce((a, b) => a + b, 0) / scores.length : 0;
    let bias = 'neutral';
    if (norm > 0.2)
        bias = 'bullish';
    else if (norm < -0.2)
        bias = 'bearish';
    return { bias, confidence: Math.min(100, Math.round(Math.abs(norm) * 100)), reason: parts.join(' · ') || 'Neutral signals' };
}
async function computeSingleTimeframeBias(symbol, tf) {
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
async function computeAllTimeframeBiases(symbol) {
    const cacheKey = `tf-bias:${(0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol)}`;
    const cached = memCache.get(cacheKey);
    if (cached)
        return cached;
    const result = await Promise.all(TIMEFRAMES.map((tf) => computeSingleTimeframeBias(symbol, tf)));
    memCache.set(cacheKey, result, TF_BIAS_CACHE_TTL_MS);
    return result;
}
function deriveWeightedBias(biases) {
    let weightedScore = 0;
    let totalWeight = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;
    for (const b of biases) {
        if (b.bias === 'unknown')
            continue;
        const w = TIMEFRAME_WEIGHTS[b.timeframe];
        let score = 0;
        if (b.bias === 'bullish')
            score = 1;
        else if (b.bias === 'bearish')
            score = -1;
        weightedScore += score * w;
        totalWeight += w;
        confidenceSum += b.confidence * w;
        confidenceCount += w;
    }
    if (totalWeight === 0)
        return { bias: 'unknown', confidence: 0 };
    const norm = weightedScore / totalWeight;
    const intradayBiases = biases.filter((b) => ['1m', '5m', '15m', '30m', '1h'].includes(b.timeframe));
    const higherBiases = biases.filter((b) => ['4h', '1d'].includes(b.timeframe));
    const intradayScore = directionalAverage(intradayBiases);
    const higherScore = directionalAverage(higherBiases);
    const conflict = intradayScore !== 0 && higherScore !== 0 && Math.sign(intradayScore) !== Math.sign(higherScore);
    let bias = 'neutral';
    if (norm > 0.15)
        bias = 'bullish';
    else if (norm < -0.15)
        bias = 'bearish';
    if (conflict || (Math.abs(norm) <= 0.15 && hasDirectionalConflict(biases)))
        bias = 'mixed';
    const confidence = confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : 0;
    return { bias, confidence };
}
function directionalAverage(biases) {
    const directional = biases.filter((b) => b.bias === 'bullish' || b.bias === 'bearish');
    if (!directional.length)
        return 0;
    return directional.reduce((sum, b) => sum + (b.bias === 'bullish' ? 1 : -1), 0) / directional.length;
}
function hasDirectionalConflict(biases) {
    return biases.some((b) => b.bias === 'bullish') && biases.some((b) => b.bias === 'bearish');
}
// ── Price helpers ────────────────────────────────────────────────────────────
function inferMarketStatus(timestamp) {
    if (!timestamp)
        return 'unknown';
    const date = new Date(timestamp);
    const day = date.getUTCDay();
    if (day === 0 || day === 6)
        return 'closed';
    return 'open';
}
function computeStaleMinutes(updatedAt) {
    if (!updatedAt)
        return null;
    const t = new Date(updatedAt).getTime();
    if (Number.isNaN(t))
        return null;
    return Math.max(0, Math.round((Date.now() - t) / 60_000));
}
function buildPricePayload(args) {
    const quote = args.quote;
    const current = quote?.mid ?? null;
    const previousClose = quote && quote.change != null ? quote.mid - quote.change : null;
    const change = quote?.change ?? (current != null && previousClose != null ? current - previousClose : null);
    const changePercent = quote?.changePct ?? (change != null && previousClose ? (change / previousClose) * 100 : null);
    const source = current != null ? (args.source ?? 'mt5-bridge') : 'Unavailable';
    let updatedAt = null;
    if (quote?.timestamp)
        updatedAt = new Date(quote.timestamp).toISOString();
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
async function fetchPriceContext(symbol) {
    const apiSymbol = (0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol);
    let quote = null;
    let source = 'market-data';
    let unavailableReason;
    try {
        const latest = await (0, marketDataService_js_1.getLatestMarketPrice)(apiSymbol);
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
        }
        else {
            unavailableReason = latest.error ?? latest.warning ?? `MT5 bridge quote unavailable for ${apiSymbol}.`;
        }
    }
    catch (err) {
        console.warn(`[pairAnalysis] unified market quote failed for ${apiSymbol}:`, err instanceof Error ? err.message : err);
        unavailableReason = err instanceof Error ? err.message : `MT5 bridge quote unavailable for ${apiSymbol}.`;
    }
    return buildPricePayload({ quote, source, unavailableReason });
}
// ── Map scored news/events into response shapes ──────────────────────────────
function mapScoredArticle(scored) {
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
function mapScoredEvent(scored) {
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
function mapStoredAnalysisToIntelligence(apiSymbol, saved, technicalSummary, fundamentalSummary, hasNearHighImpactEvent) {
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
async function preparePairAnalysisContext(symbol, options) {
    const apiSymbol = (0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol);
    const displaySymbol = (0, symbolNormalizer_js_1.normalizeDisplaySymbol)(apiSymbol);
    const enabled = (0, pairFundamentalDrivers_js_1.isEnabledPair)(apiSymbol);
    await (0, fundamentals_service_js_1.bootstrapFundamentals)();
    if (options?.forceRefresh) {
        await (0, fundamentals_service_js_1.refreshFundamentalsData)();
    }
    const pairData = (0, fundamentals_service_js_1.getFundamentalsForSymbol)(displaySymbol);
    const hasData = pairData.relatedArticles.length > 0 || pairData.relatedEvents.length > 0;
    if (!hasData) {
        await (0, fundamentals_service_js_1.refreshFundamentalsData)();
    }
    const refreshedPairData = (0, fundamentals_service_js_1.getFundamentalsForSymbol)(displaySymbol);
    const allNews = (0, fundamentals_service_js_1.getFundamentalsNews)();
    const allEvents = (0, fundamentals_service_js_1.getFundamentalsEvents)();
    const sourceStatus = (0, fundamentals_service_js_1.getFundamentalSourceStatus)();
    const price = await fetchPriceContext(apiSymbol);
    const latestNews = (0, pairMacroDriverService_js_1.getLatestNewsForSymbol)(displaySymbol, allNews);
    const centralBankDrivers = (0, pairMacroDriverService_js_1.getCentralBankDriversForSymbol)(displaySymbol, allNews);
    const politicalDrivers = (0, pairMacroDriverService_js_1.getPoliticalDriversForSymbol)(displaySymbol, allNews);
    const scoredArticles = (0, newsRelevanceScorer_js_1.scoreNewsRelevanceForPair)(allNews, apiSymbol);
    const topRelevantNews = scoredArticles.slice(0, 8).map(mapScoredArticle);
    const newsImpact = (0, newsRelevanceScorer_js_1.summarizeNewsImpact)(scoredArticles.slice(0, 8));
    const scoredEvents = (0, eventRelevanceFilter_js_1.filterEventsForPair)(allEvents, apiSymbol);
    const relevantEvents = scoredEvents.slice(0, 8).map(mapScoredEvent);
    const nextHighImpactScored = (0, eventRelevanceFilter_js_1.findNextHighImpact)(scoredEvents);
    const nextHighImpactEvent = nextHighImpactScored ? mapScoredEvent(nextHighImpactScored) : null;
    const latestBias = refreshedPairData.latestBias;
    const technical = (0, pairMacroDriverService_js_1.buildTechnicalSummary)({
        symbol: displaySymbol,
        currentPrice: price.current,
        previousClose: price.previousClose,
        dayHigh: price.dayHigh,
        dayLow: price.dayLow,
        fundamentalBias: latestBias?.bias ?? 'unknown',
    });
    const { bullishDrivers, bearishDrivers } = (0, pairMacroDriverService_js_1.inferBullishBearishDrivers)(displaySymbol, latestNews);
    const fundamentals = {
        bias: latestBias?.bias ?? 'unknown',
        confidence: latestBias?.confidence ?? 0,
        impact: latestBias?.impact ?? 'unknown',
        tradeStatus: latestBias?.tradeStatus ?? 'unknown',
        summary: (0, pairMacroDriverService_js_1.buildFundamentalSummary)({
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
        mode: (0, openaiConfig_js_1.isOpenAIConfigured)() ? 'ai-enhanced' : 'rules-based',
    };
    const timeframeBiases = await computeAllTimeframeBiases(symbol);
    const overall = deriveWeightedBias(timeframeBiases);
    const correlatedSymbols = (0, intermarketCorrelation_js_1.getCorrelatedSymbols)(apiSymbol);
    const correlatedBiasEntries = await Promise.all(correlatedSymbols.map(async (sym) => {
        const biases = await computeAllTimeframeBiases(sym);
        const derived = deriveWeightedBias(biases);
        return { symbol: sym, bias: derived.bias, confidence: derived.confidence };
    }));
    const correlationCtx = (0, intermarketCorrelation_js_1.buildCorrelationContext)(apiSymbol, overall.bias, correlatedBiasEntries);
    const macroFocus = (0, pairFundamentalDrivers_js_1.getMacroFocusForSymbol)(apiSymbol);
    const fundamentalDriversList = (0, pairFundamentalDrivers_js_1.getFundamentalDriversForSymbol)(apiSymbol);
    const intelligenceContext = {
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
async function getPairAiDebugSnapshot(symbol, options) {
    (0, openaiConfig_js_1.logOpenAIConfiguration)();
    const prepared = await preparePairAnalysisContext(symbol, options);
    return {
        openaiKeyConfigured: (0, openaiConfig_js_1.isOpenAIConfigured)(),
        model: (0, openaiConfig_js_1.getOpenAIModel)(),
        symbol: prepared.apiSymbol,
        pairContextLoaded: true,
        fundamentalsLoaded: true,
        promptSizeEstimate: prepared.promptSizeEstimate,
        timeoutConfigured: (0, openaiConfig_js_1.getPairAiTimeoutMs)(),
    };
}
async function buildPairAnalysis(symbol, options) {
    const startedAt = Date.now();
    const apiSymbol = (0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol);
    const model = (0, openaiConfig_js_1.getOpenAIModel)();
    (0, openaiConfig_js_1.logOpenAIConfiguration)();
    console.log('[pair-ai] analysis requested', { symbol: apiSymbol });
    options?.onStageChange?.('preparing_pair_snapshot');
    console.log('[pair-ai] loading pair technical context', { symbol: apiSymbol });
    options?.onStageChange?.('loading_fundamentals');
    console.log('[pair-ai] loading fundamentals context', { symbol: apiSymbol });
    const prepared = await preparePairAnalysisContext(symbol, { forceRefresh: options?.forceRefresh });
    let intelligence;
    const savedAnalysis = options?.preferSavedAi === false
        ? null
        : await (0, aiAnalysisStore_service_js_1.getLatestSavedAiAnalysisForSymbol)(prepared.apiSymbol);
    if (savedAnalysis) {
        intelligence = mapStoredAnalysisToIntelligence(prepared.apiSymbol, savedAnalysis, prepared.technical.summary, prepared.fundamentals.summary, prepared.relevantEvents.some((s) => s.isFuture && s.impact === 'high' && s.minutesUntil <= 60));
    }
    else if (options?.allowLiveAI) {
        options?.onStageChange?.('running_ai_analysis');
        console.log('[pair-ai] calling OpenAI', { model });
        intelligence = await (0, pairIntelligenceAI_service_js_1.buildPairIntelligenceAI)(prepared.intelligenceContext);
        console.log('[pair-ai] OpenAI analysis completed', { symbol: prepared.apiSymbol, durationMs: Date.now() - startedAt });
    }
    else {
        intelligence = (0, pairIntelligenceAI_service_js_1.fallbackIntelligence)(prepared.intelligenceContext);
    }
    options?.onStageChange?.('finalizing_verdict');
    const tradeStatus = (0, tradeStatusCalculator_js_1.calculateTradeStatus)({
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
        displayName: (0, symbolNormalizer_js_1.getDisplayName)(prepared.apiSymbol),
        assetClass: (0, symbolNormalizer_js_1.getAssetClass)(prepared.apiSymbol),
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
function buildPairHeaderMeta(symbol) {
    return {
        baseCurrency: (0, symbolNormalizer_js_1.getBaseCurrency)(symbol),
        quoteCurrency: (0, symbolNormalizer_js_1.getQuoteCurrency)(symbol),
    };
}
