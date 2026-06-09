import { z } from 'zod';
import { createHash } from 'node:crypto';
import { chatCompleteJSON } from '../lib/gemini.js';
import * as memCache from '../lib/cache.js';
import * as diag from '../lib/aiDiagnostics.js';
import { getOpenAIModel, isOpenAIConfigured, logOpenAIConfiguration } from '../lib/openaiConfig.js';

const BiasDirection = z.enum(['bullish', 'bearish', 'neutral', 'mixed']);
const TradeStatusEnum = z.enum(['safe', 'wait', 'high_risk', 'no_trade']);

export const PairIntelligenceSchema = z.object({
  symbol: z.string(),
  overallBias: BiasDirection,
  biasPercentage: z.number().int().min(0).max(100),
  technicalBias: z.object({
    direction: BiasDirection,
    percentage: z.number().int().min(0).max(100),
    summary: z.string(),
  }),
  fundamentalBias: z.object({
    direction: BiasDirection,
    percentage: z.number().int().min(0).max(100),
    summary: z.string(),
  }),
  newsImpact: z.object({
    direction: BiasDirection,
    percentage: z.number().int().min(0).max(100),
    summary: z.string(),
  }),
  tradeStatus: TradeStatusEnum,
  summary: z.string(),
  bullishDrivers: z.array(z.string()),
  bearishDrivers: z.array(z.string()),
  risks: z.array(z.string()),
  invalidation: z.string(),
  tradePlan: z.object({
    preferredDirection: z.string(),
    entryConditions: z.array(z.string()),
    avoidConditions: z.array(z.string()),
    riskNotes: z.string(),
  }),
});

export type PairIntelligenceAI = z.infer<typeof PairIntelligenceSchema>;

export interface CorrelationSignalSummary {
  relatedSymbol: string;
  relationship: string;
  status: 'confirmed' | 'neutral' | 'diverging' | 'high_conflict';
  confidenceDelta: number;
  explanation: string;
}

export interface PairIntelligenceContext {
  symbol: string;
  displaySymbol: string;
  currentPrice: number | null;
  marketStatus: 'open' | 'closed' | 'unknown';
  priceStaleMinutes: number | null;
  overallBias: 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
  overallConfidence: number;
  timeframeBiases: Array<{
    timeframe: string;
    bias: string;
    confidence: number;
    reason: string;
  }>;
  technicalSummary: string;
  fundamentalSummary: string;
  topRelevantNews: Array<{
    title: string;
    summary: string;
    relevanceScore: number;
    biasImpact: string;
    whyItMatters: string;
  }>;
  upcomingHighImpactEvents: Array<{
    eventName: string;
    currency: string | null;
    impact: string;
    eventTime: string;
    minutesUntil: number;
  }>;
  macroDrivers: string[];
  fundamentalDrivers: string[];
  correlationSignals?: CorrelationSignalSummary[];
  correlationConfidenceDelta?: number;
  correlationMacroSummary?: string;
}

function hashContext(ctx: PairIntelligenceContext): string {
  const lean = {
    symbol: ctx.symbol,
    price: ctx.currentPrice,
    overall: ctx.overallBias,
    confidence: ctx.overallConfidence,
    biases: ctx.timeframeBiases.map((b) => `${b.timeframe}:${b.bias}:${b.confidence}`),
    newsTitles: ctx.topRelevantNews.slice(0, 5).map((n) => n.title),
    events: ctx.upcomingHighImpactEvents.map((e) => `${e.eventName}:${e.eventTime}`),
  };
  return createHash('sha1').update(JSON.stringify(lean)).digest('hex').slice(0, 16);
}

const FAST_MODEL = getOpenAIModel();
const DEEP_MODEL = getOpenAIModel();

const CACHE_TTL_MS = Number(process.env.AI_FAST_CACHE_TTL_SECONDS ?? '1200') * 1000; // 20 min default
const STALE_GRACE_MS = Number(process.env.AI_STALE_GRACE_SECONDS ?? '300') * 1000;   // 5 min grace

const SYSTEM_PROMPT = `You are a JSON-only intermarket analyst. You produce STRUCTURED, ACTIONABLE pair intelligence for retail traders across forex, commodities (Gold, Oil), and macro indices (DXY).

Rules you MUST follow:
- Output VALID JSON only. No prose, no markdown, no commentary.
- Do not base analysis on unrelated regional currency headlines (e.g. INR, ZAR, THB) unless they directly affect USD or global risk sentiment.
- Do not overstate confidence. If data is stale, market is closed, timeframes conflict, or news is thin, lower the confidence and use "mixed" or "neutral".
- Separate TECHNICAL and FUNDAMENTAL bias — they may disagree.
- If a high-impact event is within 60 minutes, tradeStatus MUST be "high_risk" or "wait".
- Keep all text fields tight and trader-focused. No motivational language. No financial advice.
- biasPercentage is the strength of the overall bias 0-100 (50 = balanced).
- INTERMARKET CORRELATION RULES (apply when correlation signals are provided):
  * DXY bullish → headwind for EURUSD, GBPUSD, XAUUSD, USOIL. Reduce bullish confidence on those instruments unless divergence is justified.
  * DXY bearish → tailwind for EURUSD, GBPUSD, XAUUSD, USOIL. Increase confidence for bullish setups on those instruments.
  * If DXY is bullish AND EURUSD is bullish → flag divergence; reduce biasPercentage and add risk noting the conflict.
  * If DXY is bearish AND Gold is bullish → strong confirmation; increase confidence.
  * USOIL bullish spike → inflation implications for FX; may weaken rate-cut expectations; note in risks.
  * USOIL and XAUUSD both bullish → risk-off or inflation macro regime; note this alignment.
  * A "high_conflict" correlation signal MUST appear in the risks array and reduce biasPercentage.
  * A "confirmed" correlation signal may increase biasPercentage modestly.
  * Adjusted biasPercentage = base biasPercentage + correlationConfidenceDelta (clamped 0-100).`;

function buildSingleSymbolBlock(ctx: PairIntelligenceContext): string {
  const trim = (value: string, max = 220) => value.replace(/\s+/g, ' ').trim().slice(0, max);
  const biasLines = ctx.timeframeBiases
    .slice(0, 6)
    .map((b) => `  ${b.timeframe}: ${b.bias} ${b.confidence}% — ${trim(b.reason, 90)}`)
    .join('\n');
  const newsLines = ctx.topRelevantNews.length
    ? ctx.topRelevantNews
      .slice(0, 4)
      .map((n, i) => `  ${i + 1}. [${n.relevanceScore}% rel · ${n.biasImpact}] ${trim(n.title, 110)} — ${trim(n.summary || n.whyItMatters, 140)}`)
      .join('\n')
    : '  (no high-relevance news in this batch)';
  const eventLines = ctx.upcomingHighImpactEvents.length
    ? ctx.upcomingHighImpactEvents.slice(0, 4).map((e) => `  ${trim(e.eventName, 90)} (${e.currency ?? '?'}, ${e.impact}) — in ${e.minutesUntil}m`).join('\n')
    : '  (no high-impact events in window)';
  const staleNote = ctx.priceStaleMinutes != null && ctx.priceStaleMinutes > 60
    ? `\nDATA FRESHNESS WARNING: price is ${ctx.priceStaleMinutes} minutes old.`
    : '';

  let correlationSection = '';
  if (ctx.correlationSignals && ctx.correlationSignals.length > 0) {
    const sigLines = ctx.correlationSignals
      .slice(0, 4)
      .map((s) => `  [${s.status.toUpperCase()}] ${s.relatedSymbol} (${s.relationship}): ${trim(s.explanation, 120)}`)
      .join('\n');
    correlationSection = `
Cross-market correlation signals:
${sigLines}
Net correlation confidence delta: ${(ctx.correlationConfidenceDelta ?? 0) >= 0 ? '+' : ''}${ctx.correlationConfidenceDelta ?? 0}%
Macro correlation summary: ${ctx.correlationMacroSummary ?? 'No cross-market data.'}
`;
  }

  return `--- ${ctx.displaySymbol} ---
Price: ${ctx.currentPrice ?? 'unavailable'} | Market: ${ctx.marketStatus} | Bias: ${ctx.overallBias} (${ctx.overallConfidence}%)${staleNote}

Multi-timeframe bias:
${biasLines}

Technical: ${trim(ctx.technicalSummary, 220)}
Fundamental: ${trim(ctx.fundamentalSummary, 220)}
${correlationSection}
News (pre-filtered):
${newsLines}

Events:
${eventLines}

Macro focus: ${ctx.macroDrivers.slice(0, 6).join(', ')}
Drivers: ${ctx.fundamentalDrivers.slice(0, 6).join(', ')}`;
}

const BATCH_JSON_SHAPE = `{
  "SYMBOL": {
    "symbol": "SYMBOL",
    "overallBias": "bullish|bearish|neutral|mixed",
    "biasPercentage": 0-100,
    "technicalBias": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1-2 sentences>" },
    "fundamentalBias": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1-2 sentences>" },
    "newsImpact": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1 sentence>" },
    "tradeStatus": "safe|wait|high_risk|no_trade",
    "summary": "<3-4 sentences, trader-language>",
    "bullishDrivers": ["..."],
    "bearishDrivers": ["..."],
    "risks": ["..."],
    "invalidation": "<one clear invalidation level or condition>",
    "tradePlan": {
      "preferredDirection": "long|short|stand aside",
      "entryConditions": ["..."],
      "avoidConditions": ["..."],
      "riskNotes": "<1-2 sentences>"
    }
  }
}`;

function buildBatchUserPrompt(contexts: PairIntelligenceContext[]): string {
  const blocks = contexts.map(buildSingleSymbolBlock).join('\n\n');
  const symbolKeys = contexts.map((c) => c.symbol).join(', ');
  return `Analyze all instruments below and return a single JSON object keyed by symbol (${symbolKeys}).

${blocks}

Return JSON only with this exact shape (one key per symbol):
${BATCH_JSON_SHAPE.replaceAll('SYMBOL', symbolKeys)}`;
}

function buildSingleUserPrompt(ctx: PairIntelligenceContext): string {
  return `${buildSingleSymbolBlock(ctx)}

Return JSON only with this exact shape:
{
  "symbol": "${ctx.symbol}",
  "overallBias": "bullish|bearish|neutral|mixed",
  "biasPercentage": 0-100,
  "technicalBias": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1-2 sentences>" },
  "fundamentalBias": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1-2 sentences>" },
  "newsImpact": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1 sentence>" },
  "tradeStatus": "safe|wait|high_risk|no_trade",
  "summary": "<3-4 sentences, trader-language>",
  "bullishDrivers": ["..."],
  "bearishDrivers": ["..."],
  "risks": ["..."],
  "invalidation": "<one clear invalidation level or condition>",
  "tradePlan": {
    "preferredDirection": "long|short|stand aside",
    "entryConditions": ["..."],
    "avoidConditions": ["..."],
    "riskNotes": "<1-2 sentences>"
  }
}`;
}

function fallbackPreferredDirection(direction: 'bullish' | 'bearish' | 'neutral' | 'mixed'): string {
  if (direction === 'bullish') return 'long';
  if (direction === 'bearish') return 'short';
  return 'stand aside';
}

export function fallbackIntelligence(ctx: PairIntelligenceContext): PairIntelligenceAI {
  const direction: 'bullish' | 'bearish' | 'neutral' | 'mixed' = ctx.overallBias === 'unknown' ? 'neutral' : ctx.overallBias;
  return {
    symbol: ctx.symbol,
    overallBias: direction,
    biasPercentage: Math.max(40, Math.min(80, ctx.overallConfidence)),
    technicalBias: {
      direction,
      percentage: ctx.overallConfidence,
      summary: ctx.technicalSummary,
    },
    fundamentalBias: {
      direction: 'neutral',
      percentage: 50,
      summary: ctx.fundamentalSummary,
    },
    newsImpact: {
      direction: 'neutral',
      percentage: 50,
      summary: ctx.topRelevantNews.length ? 'Some relevant news present but AI not available to weigh impact.' : 'No relevant news in this batch.',
    },
    tradeStatus: ctx.upcomingHighImpactEvents.some((e) => e.minutesUntil <= 60) ? 'high_risk' : 'wait',
    summary: `${ctx.displaySymbol} overall bias is ${direction} based on weighted multi-timeframe scoring. AI analysis unavailable — showing rules-based view.`,
    bullishDrivers: ctx.topRelevantNews.filter((n) => n.biasImpact === 'bullish').slice(0, 3).map((n) => n.title),
    bearishDrivers: ctx.topRelevantNews.filter((n) => n.biasImpact === 'bearish').slice(0, 3).map((n) => n.title),
    risks: ['Headline volatility can reverse short-term bias quickly.', 'AI analysis unavailable — confidence is rules-based only.'],
    invalidation: 'No clear invalidation level without AI context.',
    tradePlan: {
      preferredDirection: fallbackPreferredDirection(direction),
      entryConditions: ['Wait for AI analysis or confirm with own setup before entry.'],
      avoidConditions: ['Avoid trading into high-impact news within 60 minutes.'],
      riskNotes: 'Use normal risk per trade; this is informational only, not financial advice.',
    },
  };
}

function cacheKey(ctx: PairIntelligenceContext): string {
  return `pair-intel-ai:${ctx.symbol}:${hashContext(ctx)}`;
}

/**
 * Single-symbol intelligence with stale-while-revalidate.
 * Returns cached result instantly (even slightly stale), then refreshes in background.
 */
export async function buildPairIntelligenceAI(ctx: PairIntelligenceContext, options?: { deep?: boolean }): Promise<PairIntelligenceAI> {
  const key = cacheKey(ctx);
  const aiEnabled = isOpenAIConfigured();
  logOpenAIConfiguration();

  // Try fresh cache first
  const fresh = memCache.get<PairIntelligenceAI>(key);
  if (fresh) {
    diag.recordCacheHit();
    return fresh;
  }

  // Try stale cache (grace period) — return immediately, refresh in background
  const staleResult = memCache.getStale<PairIntelligenceAI>(key, STALE_GRACE_MS);
  if (staleResult?.isStale && aiEnabled && diag.canMakeRequest()) {
    diag.recordCacheHit();
    // Background refresh — don't await
    void callSingleSymbolAI(ctx, key, options?.deep ?? false).catch(() => undefined);
    return staleResult.data;
  }

  if (!aiEnabled) {
    const fb = fallbackIntelligence(ctx);
    memCache.set(key, fb, CACHE_TTL_MS);
    return fb;
  }

  return callSingleSymbolAI(ctx, key, options?.deep ?? false);
}

async function callSingleSymbolAI(ctx: PairIntelligenceContext, key: string, deep: boolean): Promise<PairIntelligenceAI> {
  const model = deep ? DEEP_MODEL : FAST_MODEL;
  diag.recordCacheMiss();

  try {
    const raw = await chatCompleteJSON<unknown>(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildSingleUserPrompt(ctx) },
      ],
      { maxTokens: 900, temperature: 0.15, model, symbols: [ctx.symbol], feature: 'pair_intelligence', operation: 'generate_intelligence' },
    );
    const parsed = PairIntelligenceSchema.parse(raw);
    memCache.set(key, parsed, CACHE_TTL_MS);
    return parsed;
  } catch (error) {
    console.warn('[pairIntelligenceAI] AI call failed, using fallback:', error instanceof Error ? error.message : error);
    const fb = fallbackIntelligence(ctx);
    memCache.set(key, fb, 60_000);
    return fb;
  }
}

function resolveCachedContext(
  ctx: PairIntelligenceContext,
  forceRefresh: boolean,
  results: Record<string, PairIntelligenceAI>,
): boolean {
  if (forceRefresh) return false;

  const fresh = memCache.get<PairIntelligenceAI>(cacheKey(ctx));
  if (fresh) {
    diag.recordCacheHit();
    results[ctx.symbol] = fresh;
    return true;
  }

  // Stale-while-revalidate: serve stale immediately, but keep in missing list for refresh
  const stale = memCache.getStale<PairIntelligenceAI>(cacheKey(ctx), STALE_GRACE_MS);
  if (stale) {
    diag.recordCacheHit();
    results[ctx.symbol] = stale.data;
    return !stale.isStale; // fully resolved only if not actually stale
  }

  return false;
}

function applyBatchAIResult(
  ctx: PairIntelligenceContext,
  raw: Record<string, unknown>,
  results: Record<string, PairIntelligenceAI>,
): void {
  const entry = raw[ctx.symbol] ?? raw[ctx.displaySymbol];
  if (!entry) {
    results[ctx.symbol] = fallbackIntelligence(ctx);
    return;
  }
  try {
    const parsed = PairIntelligenceSchema.parse(entry);
    memCache.set(cacheKey(ctx), parsed, CACHE_TTL_MS);
    results[ctx.symbol] = parsed;
  } catch {
    results[ctx.symbol] = fallbackIntelligence(ctx);
  }
}

/**
 * Batch intelligence: analyze multiple symbols in ONE AI call.
 * Cache hits are served immediately; only cache-miss symbols go to the AI.
 * Returns a map of symbol → PairIntelligenceAI.
 */
export async function buildBatchPairIntelligenceAI(
  contexts: PairIntelligenceContext[],
  options?: { deep?: boolean; forceRefresh?: boolean },
): Promise<Record<string, PairIntelligenceAI>> {
  const aiEnabled = isOpenAIConfigured();
  logOpenAIConfiguration();
  const results: Record<string, PairIntelligenceAI> = {};
  const missing = contexts.filter((ctx) => !resolveCachedContext(ctx, options?.forceRefresh ?? false, results));

  if (!missing.length) return results;

  if (!aiEnabled || !diag.canMakeRequest()) {
    for (const ctx of missing) results[ctx.symbol] = fallbackIntelligence(ctx);
    return results;
  }

  const model = options?.deep ? DEEP_MODEL : FAST_MODEL;
  const symbols = missing.map((c) => c.symbol);
  diag.recordCacheMiss();

  try {
    const raw = await chatCompleteJSON<Record<string, unknown>>(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildBatchUserPrompt(missing) },
      ],
      { maxTokens: missing.length * 950, temperature: 0.15, model, symbols, feature: 'pair_intelligence', operation: 'batch_intelligence' },
    );
    for (const ctx of missing) applyBatchAIResult(ctx, raw, results);
  } catch (error) {
    console.warn('[pairIntelligenceAI] batch AI call failed, using fallback:', error instanceof Error ? error.message : error);
    for (const ctx of missing) {
      if (!results[ctx.symbol]) results[ctx.symbol] = fallbackIntelligence(ctx);
    }
  }

  return results;
}
