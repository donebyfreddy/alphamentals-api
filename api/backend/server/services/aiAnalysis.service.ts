import { z } from 'zod';
import { createHash } from 'crypto';
import { chatCompleteJSON } from '../lib/gemini.js';
import { supabase } from '../lib/supabase.js';
import * as memCache from '../lib/cache.js';
import type { Candle, Quote } from '../lib/yahoo.js';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const ClaudeSignalSchema = z.object({
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().int().min(0).max(100),
  structure: z.enum(['BOS', 'CHoCH', 'ranging']),
  liquidity: z.enum(['buy-side', 'sell-side', 'balanced']),
  fundamentals: z.enum(['risk-on', 'risk-off', 'hawkish', 'dovish']),
  newsImpact: z.number().int().min(0).max(100),
  sentimentScore: z.number().int().min(-100).max(100),
  volatility: z.enum(['low', 'medium', 'high']),
  tradeReady: z.boolean(),
  reasoning: z.string(),
});
export type ClaudeSignal = z.infer<typeof ClaudeSignalSchema>;

export const DaySummarySchema = z.object({
  overallVolatility: z.enum(['low', 'medium', 'high', 'extreme']),
  traderVerdict: z.enum(['safe-to-trade', 'trade-with-caution', 'stay-away']),
  verdictReason: z.string(),
  keyEvents: z.array(z.string()),
  avoidWindows: z.array(z.string()),
  bestTradingWindows: z.array(z.string()),
  affectedPairs: z.array(z.string()),
  reasoning: z.string(),
});
export type DaySummary = z.infer<typeof DaySummarySchema>;

export const CalendarAIRecSchema = z.object({
  bias: z.string(),
  volatilityExpected: z.enum(['low', 'medium', 'high']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  suggestedAction: z.string(),
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string(),
});
export type CalendarAIRec = z.infer<typeof CalendarAIRecSchema>;

// ─── TTL config per timeframe (ms) ────────────────────────────────────────────

const TTL_BY_TIMEFRAME: Record<string, number> = {
  m1: 30 * 60_000,
  m5: 30 * 60_000,
  m15: 60 * 60_000,
  h1: 3 * 60 * 60_000,
  h4: 6 * 60 * 60_000,
  d1: 18 * 60 * 60_000,
  macro: 6 * 60 * 60_000,
  default: 60 * 60_000,
};

function ttlFor(timeframe: string): number {
  return TTL_BY_TIMEFRAME[timeframe] ?? TTL_BY_TIMEFRAME.default;
}

// ─── Request deduplication ────────────────────────────────────────────────────

const inFlight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

function hash(data: unknown): string {
  return createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

// ─── DB cache helpers ─────────────────────────────────────────────────────────

async function getDbCache<T>(symbol: string, timeframe: string, analysisType: string, inputHash: string): Promise<T | null> {
  try {
    const { data: row } = await supabase
      .from('market_analysis_cache')
      .select('*')
      .eq('symbol', symbol).eq('timeframe', timeframe).eq('analysisType', analysisType).eq('inputHash', inputHash)
      .maybeSingle();
    if (!row) return null;
    if (new Date(row.expiresAt) < new Date()) {
      await supabase.from('market_analysis_cache')
        .delete()
        .eq('symbol', symbol).eq('timeframe', timeframe).eq('analysisType', analysisType).eq('inputHash', inputHash);
      return null;
    }
    return row.aiResponse as T;
  } catch {
    return null;
  }
}

async function setDbCache(
  symbol: string, timeframe: string, analysisType: string, inputHash: string,
  data: unknown, ttlMs: number, extras?: { confidence?: number; sentiment?: string; structure?: string; liquidity?: string; reasoning?: string }
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await supabase.from('market_analysis_cache').upsert(
      { symbol, timeframe, analysisType, inputHash, aiResponse: data, expiresAt, ...extras },
      { onConflict: 'symbol,timeframe,analysisType,inputHash' },
    );
  } catch {
    // DB unavailable — silent fail, mem cache still works
  }
}

// ─── Local SMC fallback (no AI call) ─────────────────────────────────────────

function localSmcSignal(candles: Candle[], quote?: Quote): ClaudeSignal {
  const recent = candles.filter((c) => c.close > 0).slice(-40);
  const current = quote?.mid ?? recent.at(-1)?.close ?? 0;
  const previous = recent.at(-8)?.close ?? recent.at(0)?.close ?? current;
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const recentHigh = Math.max(...highs.slice(-12));
  const recentLow = Math.min(...lows.slice(-12));
  const priorHigh = Math.max(...highs.slice(0, -12));
  const priorLow = Math.min(...lows.slice(0, -12));
  const range = Math.max(recentHigh - recentLow, Number.EPSILON);
  const move = current - previous;
  const movePct = Math.abs(move / Math.max(previous, Number.EPSILON));

  const bullishBreak = current > priorHigh;
  const bearishBreak = current < priorLow;
  const bias: ClaudeSignal['bias'] = bullishBreak || move > range * 0.2 ? 'bullish' : bearishBreak || move < -range * 0.2 ? 'bearish' : 'neutral';
  const structure: ClaudeSignal['structure'] = bullishBreak || bearishBreak ? 'BOS' : Math.abs(move) > range * 0.35 ? 'CHoCH' : 'ranging';
  const liquidity: ClaudeSignal['liquidity'] = current > recentHigh - range * 0.2 ? 'buy-side' : current < recentLow + range * 0.2 ? 'sell-side' : 'balanced';
  const volatility: ClaudeSignal['volatility'] = movePct > 0.004 ? 'high' : movePct > 0.0015 ? 'medium' : 'low';
  const confidence = bias === 'neutral' ? 52 : Math.min(82, Math.max(58, Math.round(58 + Math.min(movePct * 4000, 24))));

  return {
    bias, confidence, structure, liquidity,
    fundamentals: bias === 'bullish' ? 'risk-on' : bias === 'bearish' ? 'risk-off' : 'hawkish',
    newsImpact: 0,
    sentimentScore: bias === 'bullish' ? confidence - 50 : bias === 'bearish' ? 50 - confidence : 0,
    volatility,
    tradeReady: structure !== 'ranging' && bias !== 'neutral',
    reasoning: 'Local SMC fallback: Azure AI unavailable.',
  };
}

// ─── generateSignal ───────────────────────────────────────────────────────────

export async function generateSignal(symbol: string, candles: Candle[], quote?: Quote): Promise<ClaudeSignal & { cachedAt?: number }> {
  const timeframe = 'h1';
  const inputData = { symbol, closes: candles.slice(-20).map((c) => c.close), price: quote?.mid };
  const inputHash = hash(inputData);
  const memKey = `signal:${symbol}:${inputHash}`;

  const fromMem = memCache.get<ClaudeSignal & { cachedAt?: number }>(memKey);
  if (fromMem) return fromMem;

  return dedupe(memKey, async () => {
    const fromDb = await getDbCache<ClaudeSignal>(symbol, timeframe, 'signal', inputHash);
    if (fromDb) {
      const result = { ...fromDb, cachedAt: Date.now() };
      memCache.set(memKey, result, ttlFor(timeframe));
      return result;
    }

    const recent = candles.slice(-20);
    const closes = recent.map((c) => c.close);
    const price = quote?.mid ?? closes.at(-1) ?? 0;
    const high = recent.reduce((m, c) => Math.max(m, c.high), 0);
    const low = recent.reduce((m, c) => Math.min(m, c.low), Infinity);

    const prompt = `SMC/ICT analysis for ${symbol}. Price:${price.toFixed(5)} Change:${(quote?.changePct ?? 0).toFixed(3)}% H:${high.toFixed(5)} L:${low.toFixed(5)} Closes:[${closes.slice(-10).map((c) => c.toFixed(5)).join(',')}]

Return JSON only:
{"bias":"bullish"|"bearish"|"neutral","confidence":0-100,"structure":"BOS"|"CHoCH"|"ranging","liquidity":"buy-side"|"sell-side"|"balanced","fundamentals":"risk-on"|"risk-off"|"hawkish"|"dovish","newsImpact":0-100,"sentimentScore":-100-100,"volatility":"low"|"medium"|"high","tradeReady":true|false,"reasoning":"<2 sentences>"}`;

    let parsed: ClaudeSignal;
    try {
      const raw = await chatCompleteJSON<unknown>([
        { role: 'system', content: 'You are a JSON-only SMC trading analysis engine. Output valid JSON.' },
        { role: 'user', content: prompt },
      ], { maxTokens: 300, temperature: 0.1, feature: 'ai_analysis', operation: 'generate_signal' });
      parsed = ClaudeSignalSchema.parse(raw);
    } catch {
      parsed = localSmcSignal(candles, quote);
    }

    const ttl = ttlFor(timeframe);
    memCache.set(memKey, { ...parsed, cachedAt: Date.now() }, ttl);
    await setDbCache(symbol, timeframe, 'signal', inputHash, parsed, ttl, {
      confidence: parsed.confidence,
      sentiment: parsed.bias,
      structure: parsed.structure,
      liquidity: parsed.liquidity,
      reasoning: parsed.reasoning,
    });

    return { ...parsed, cachedAt: Date.now() };
  });
}

// ─── generateDaySummary ───────────────────────────────────────────────────────

type CalendarEvent = { title: string; currency: string; impact: string; time: string; forecast?: string | null; previous?: string | null; actual?: string | null };

export async function generateDaySummary(date: string, events: CalendarEvent[]): Promise<DaySummary> {
  const inputHash = hash({ date, events: events.map((e) => e.title) });
  const memKey = `day-summary:${date}:${inputHash}`;

  const fromMem = memCache.get<DaySummary>(memKey);
  if (fromMem) return fromMem;

  return dedupe(memKey, async () => {
    const fromDb = await getDbCache<DaySummary>('macro', 'macro', 'day-summary', inputHash);
    if (fromDb) { memCache.set(memKey, fromDb, ttlFor('macro')); return fromDb; }

    const eventList = events
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((e) => `${e.time}[${e.impact.toUpperCase()}]${e.title}(${e.currency})${e.actual ? ` actual:${e.actual}` : e.forecast ? ` fcst:${e.forecast}` : ''}`)
      .join('; ');

    const prompt = `Forex trading risk brief for ${date}. Events: ${eventList}

Return JSON only:
{"overallVolatility":"low"|"medium"|"high"|"extreme","traderVerdict":"safe-to-trade"|"trade-with-caution"|"stay-away","verdictReason":"<1 sentence>","keyEvents":["..."],"avoidWindows":["..."],"bestTradingWindows":["..."],"affectedPairs":["..."],"reasoning":"<3 sentences>"}`;

    const raw = await chatCompleteJSON<unknown>([
      { role: 'system', content: 'You are a JSON-only forex risk analyst.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 400, temperature: 0.1, feature: 'ai_analysis', operation: 'day_summary' });

    const parsed = DaySummarySchema.parse(raw);
    const ttl = ttlFor('macro');
    memCache.set(memKey, parsed, ttl);
    await setDbCache('macro', 'macro', 'day-summary', inputHash, parsed, ttl);
    return parsed;
  });
}

// ─── generateCalendarRec ──────────────────────────────────────────────────────

type EventInput = { title: string; currency: string; impact: 'low' | 'medium' | 'high'; forecast?: string; previous?: string; actual?: string };

export async function generateCalendarRec(event: EventInput): Promise<CalendarAIRec> {
  const inputHash = hash(event);
  const memKey = `cal-rec:${event.title}:${event.currency}:${inputHash}`;

  const fromMem = memCache.get<CalendarAIRec>(memKey);
  if (fromMem) return fromMem;

  return dedupe(memKey, async () => {
    const fromDb = await getDbCache<CalendarAIRec>(event.currency, 'macro', 'cal-rec', inputHash);
    if (fromDb) { memCache.set(memKey, fromDb, 600_000); return fromDb; }

    const context = event.actual
      ? `actual:${event.actual} forecast:${event.forecast ?? 'N/A'} prev:${event.previous ?? 'N/A'}`
      : `forecast:${event.forecast ?? 'N/A'} prev:${event.previous ?? 'N/A'} (pending)`;

    const prompt = `Event: ${event.title} | Currency: ${event.currency} | Impact: ${event.impact} | ${context}

Return JSON only:
{"bias":"<e.g. Bullish USD>","volatilityExpected":"low"|"medium"|"high","riskLevel":"low"|"medium"|"high","suggestedAction":"<1 sentence>","confidence":0-100,"reasoning":"<2 sentences>"}`;

    const raw = await chatCompleteJSON<unknown>([
      { role: 'system', content: 'You are a JSON-only forex economic event analyst.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 200, temperature: 0.1, feature: 'ai_analysis', operation: 'calendar_recommendation' });

    const parsed = CalendarAIRecSchema.parse(raw);
    memCache.set(memKey, parsed, 600_000);
    await setDbCache(event.currency, 'macro', 'cal-rec', inputHash, parsed, 600_000);
    return parsed;
  });
}
