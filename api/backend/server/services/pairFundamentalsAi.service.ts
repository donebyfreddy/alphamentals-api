/**
 * Per-symbol fundamental AI engine.
 *
 * Gathers MT5-adjacent context (news, calendar, macro, telegram) for one
 * instrument plus its indirect drivers, then asks OpenAI (server-side only)
 * to produce a structured PairFundamentalAnalysis. The model is instructed to
 * weigh INDIRECT macro/geopolitical relationships and conflicting forces, not
 * just direct headlines.
 *
 * If OpenAI is not configured, returns a grounded rules-based fallback that is
 * clearly flagged (never a fake "AI analysis unavailable" with empty content).
 */

import { chatCompleteJSON } from '../lib/gemini.js';
import { getConfiguredOpenAIApiKey, getOpenAIModel } from '../lib/openaiConfig.js';
import {
  getFundamentalsNews,
  getFundamentalsEvents,
  getFundamentalsOverview,
  bootstrapFundamentals,
} from './fundamentals.service.js';
import { getTelegramRuntimeState } from './telegramBridge.service.js';

export type PairBias = 'bullish' | 'bearish' | 'neutral' | 'mixed';
export type ImpactDir = 'bullish' | 'bearish' | 'neutral' | 'mixed';
export type SupportedPair = 'XAUUSD' | 'EURUSD' | 'GBPUSD' | 'DXY' | 'USOIL';

export interface PairFundamentalAnalysis {
  symbol: string;
  generatedAt: string;
  model: string;
  mode: 'ai' | 'rules-fallback';
  dataFreshness: {
    newsLatestAt: string | null;
    calendarLatestAt: string | null;
    macroLatestAt: string | null;
    telegramLatestAt: string | null;
    isStale: boolean;
    warnings: string[];
  };
  bias: PairBias;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  score: number;
  summary: string;
  bullishDrivers: string[];
  bearishDrivers: string[];
  neutralOrMixedDrivers: string[];
  keyCatalysts: Array<{ title: string; time?: string; source: string; expectedImpact: ImpactDir; reason: string }>;
  newsEvidence: Array<{ title: string; source: string; publishedAt: string; relevance: string; impact: ImpactDir }>;
  macroEvidence: Array<{ name: string; value?: string; previous?: string; interpretation: string; impact: ImpactDir }>;
  conflictAnalysis: { hasConflictingForces: boolean; explanation: string; bullishWeight: number; bearishWeight: number };
  tradingImplication: string;
  invalidation: string;
  riskWarnings: string[];
}

// Indirect-driver context: which other instruments/themes matter for each pair.
const INSTRUMENT_FOCUS: Record<SupportedPair, string> = {
  XAUUSD: 'USD/DXY direction, real yields / rate expectations, Fed policy expectations, inflation expectations, geopolitical risk, oil price shock effects (oil up → inflation up → possibly hawkish Fed → USD up → gold pressured), safe-haven demand, risk sentiment, central-bank gold demand, upcoming US data (CPI/NFP/FOMC).',
  EURUSD: 'USD side vs EUR side, Fed vs ECB policy divergence, US vs Eurozone data surprises, energy shock impact on Europe (higher oil hurts EUR growth), risk sentiment.',
  GBPUSD: 'USD side vs GBP side, Fed vs BoE divergence, US vs UK data surprises, UK inflation/wages/growth, UK fiscal concerns, risk sentiment.',
  DXY: 'US data surprises, Fed expectations, US yields, risk-off USD demand, EUR and GBP weakness (DXY is heavily EUR-weighted), rate-cut repricing.',
  USOIL: 'Supply disruption risk, Strait of Hormuz / shipping risk, OPEC+ supply decisions, EIA/API inventories, global demand expectations, USD direction (stronger USD pressures oil).',
};

const RELATED_SYMBOLS: Record<SupportedPair, string[]> = {
  XAUUSD: ['XAU/USD', 'DXY', 'USOIL', 'EUR/USD'],
  EURUSD: ['EUR/USD', 'DXY'],
  GBPUSD: ['GBP/USD', 'DXY'],
  DXY: ['DXY', 'EUR/USD', 'GBP/USD'],
  USOIL: ['USOIL', 'DXY'],
};

function normalizePair(symbol: string): SupportedPair {
  const compact = symbol.replace(/[/\s]/g, '').toUpperCase();
  if (compact === 'XAUUSD' || compact === 'GOLD') return 'XAUUSD';
  if (compact === 'EURUSD') return 'EURUSD';
  if (compact === 'GBPUSD') return 'GBPUSD';
  if (compact === 'DXY' || compact === 'USDX') return 'DXY';
  if (compact === 'USOIL' || compact === 'WTI') return 'USOIL';
  return 'XAUUSD';
}

function displaySymbol(pair: SupportedPair): string {
  return { XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', DXY: 'DXY', USOIL: 'USOIL' }[pair];
}

function confidenceLabel(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence >= 67) return 'high';
  if (confidence >= 40) return 'medium';
  return 'low';
}

interface GatheredContext {
  news: ReturnType<typeof getFundamentalsNews>;
  events: ReturnType<typeof getFundamentalsEvents>;
  newsLatestAt: string | null;
  calendarLatestAt: string | null;
  telegramLatestAt: string | null;
  telegramAvailable: boolean;
  warnings: string[];
}

function gatherContext(pair: SupportedPair): GatheredContext {
  const related = RELATED_SYMBOLS[pair];
  const allNews = getFundamentalsNews();
  const allEvents = getFundamentalsEvents();
  const warnings: string[] = [];

  // News relevant to this pair or its indirect drivers.
  const news = allNews
    .filter((a) => a.affectedSymbols.some((s) => related.includes(s)) || a.macroCategory.length > 0)
    .slice(0, 18);

  // Upcoming + recent events relevant to the pair's currencies/drivers.
  const now = Date.now();
  const events = allEvents
    .filter((e) => e.affectedSymbols.some((s) => related.includes(s)) || e.impact === 'high')
    .filter((e) => {
      const t = new Date(e.datetimeUtc).getTime();
      return t >= now - 24 * 3600_000 && t <= now + 7 * 24 * 3600_000;
    })
    .slice(0, 15);

  if (!news.length) warnings.push('No recent news matched this instrument or its indirect drivers.');
  if (!events.length) warnings.push('No upcoming high-impact calendar events found in the next 7 days.');

  const newsLatestAt = news.length
    ? news.reduce((latest, a) => (new Date(a.publishedAt) > new Date(latest) ? a.publishedAt : latest), news[0].publishedAt)
    : null;
  const calendarLatestAt = events.length ? events[0].datetimeUtc : null;

  const telegram = getTelegramRuntimeState();

  return {
    news,
    events,
    newsLatestAt,
    calendarLatestAt,
    telegramLatestAt: telegram.lastSyncAt,
    telegramAvailable: telegram.connected,
    warnings,
  };
}

const SYSTEM_PROMPT = `You are an institutional macro and FX/commodities analyst.

Your task is to analyze the selected trading instrument using ONLY the provided data (news, calendar, macro, MT5 price context, Telegram).

Determine whether the instrument is fundamentally bullish, bearish, neutral, or mixed.

You MUST consider INDIRECT macro relationships, not only direct headlines. Reason through cause and effect chains.

Example chain for gold:
- A Strait of Hormuz threat raises oil supply risk.
- Higher oil raises inflation expectations.
- Higher inflation can make the Fed more hawkish, lifting yields and the USD.
- A stronger USD / higher yields pressure gold.
- BUT the same geopolitical fear raises safe-haven demand for gold.
- Weigh both forces and choose a bias with a confidence number.

You MUST explicitly populate conflictAnalysis when forces oppose each other.

Rules:
- Never invent facts, headlines, events, or prices not present in the provided data.
- If the data is stale, thin, or weak, LOWER the confidence and say so in warnings.
- newsEvidence and keyCatalysts must reference ACTUAL provided titles/events.
- Return ONLY valid JSON matching the requested schema. No prose outside JSON.`;

function buildUserPrompt(pair: SupportedPair, ctx: GatheredContext): string {
  const focus = INSTRUMENT_FOCUS[pair];
  const newsBlock = ctx.news.map((a) => ({
    title: a.title,
    source: a.source,
    publishedAt: a.publishedAt,
    sentiment: a.sentiment,
    impact: a.impact,
    symbols: a.affectedSymbols,
    categories: a.macroCategory,
  }));
  const eventBlock = ctx.events.map((e) => ({
    eventName: e.eventName,
    currency: e.currency,
    impact: e.impact,
    time: e.datetimeUtc,
    actual: e.actual,
    forecast: e.forecast,
    previous: e.previous,
    symbols: e.affectedSymbols,
  }));

  return `INSTRUMENT: ${displaySymbol(pair)} (${pair})

WHAT TO WEIGH FOR THIS INSTRUMENT:
${focus}

NEWS (${newsBlock.length} items):
${JSON.stringify(newsBlock)}

ECONOMIC CALENDAR (${eventBlock.length} items, -24h to +7d):
${JSON.stringify(eventBlock)}

TELEGRAM: ${ctx.telegramAvailable ? 'connected (signals may be available)' : 'unavailable — ignore Telegram, do not fabricate signals'}

DATA WARNINGS: ${ctx.warnings.length ? ctx.warnings.join('; ') : 'none'}

Return JSON with EXACTLY this shape (no extra keys):
{
  "bias": "bullish|bearish|neutral|mixed",
  "confidence": 0-100,
  "score": -100..100,
  "summary": "2-4 sentence executive summary of the current fundamental picture, including indirect drivers",
  "bullishDrivers": ["..."],
  "bearishDrivers": ["..."],
  "neutralOrMixedDrivers": ["..."],
  "keyCatalysts": [{"title":"...","time":"ISO or label","source":"...","expectedImpact":"bullish|bearish|neutral|mixed","reason":"why it matters for ${pair}"}],
  "newsEvidence": [{"title":"<actual provided title>","source":"...","publishedAt":"ISO","relevance":"how it affects ${pair} directly or indirectly","impact":"bullish|bearish|neutral|mixed"}],
  "macroEvidence": [{"name":"e.g. DXY direction / Fed expectations","value":"optional","previous":"optional","interpretation":"...","impact":"bullish|bearish|neutral|mixed"}],
  "conflictAnalysis": {"hasConflictingForces": true|false, "explanation":"how opposing forces net out", "bullishWeight": 0-100, "bearishWeight": 0-100},
  "tradingImplication": "what a trader should practically do/watch",
  "invalidation": "what would flip this fundamental view",
  "riskWarnings": ["..."]
}`;
}

interface RawAi {
  bias?: string;
  confidence?: number;
  score?: number;
  summary?: string;
  bullishDrivers?: string[];
  bearishDrivers?: string[];
  neutralOrMixedDrivers?: string[];
  keyCatalysts?: PairFundamentalAnalysis['keyCatalysts'];
  newsEvidence?: PairFundamentalAnalysis['newsEvidence'];
  macroEvidence?: PairFundamentalAnalysis['macroEvidence'];
  conflictAnalysis?: PairFundamentalAnalysis['conflictAnalysis'];
  tradingImplication?: string;
  invalidation?: string;
  riskWarnings?: string[];
}

function isStale(latestIso: string | null): boolean {
  if (!latestIso) return true;
  const ageH = (Date.now() - new Date(latestIso).getTime()) / 3600_000;
  return ageH > 24;
}

function buildRulesFallback(pair: SupportedPair, ctx: GatheredContext, reason: string): PairFundamentalAnalysis {
  // Grounded sentiment tally from the gathered news (not random).
  let bull = 0;
  let bear = 0;
  for (const a of ctx.news) {
    if (a.sentiment === 'bullish') bull += a.impact === 'high' ? 2 : 1;
    if (a.sentiment === 'bearish') bear += a.impact === 'high' ? 2 : 1;
  }
  let bias: PairBias = 'neutral';
  if (bull > bear * 1.4) bias = 'bullish';
  else if (bear > bull * 1.4) bias = 'bearish';
  else if (bull > 0 && bear > 0) bias = 'mixed';
  const total = bull + bear;
  const confidence = total ? Math.min(55, Math.round((Math.abs(bull - bear) / total) * 55)) : 10;

  const newsEvidence = ctx.news.slice(0, 6).map((a) => ({
    title: a.title,
    source: a.source,
    publishedAt: a.publishedAt,
    relevance: `Tagged ${a.affectedSymbols.join(', ') || 'macro'}`,
    impact: (a.sentiment === 'bullish' || a.sentiment === 'bearish' ? a.sentiment : 'neutral') as ImpactDir,
  }));

  const now = new Date().toISOString();
  return {
    symbol: pair,
    generatedAt: now,
    model: 'rules-fallback',
    mode: 'rules-fallback',
    dataFreshness: {
      newsLatestAt: ctx.newsLatestAt,
      calendarLatestAt: ctx.calendarLatestAt,
      macroLatestAt: ctx.newsLatestAt,
      telegramLatestAt: ctx.telegramLatestAt,
      isStale: isStale(ctx.newsLatestAt),
      warnings: [reason, ...ctx.warnings],
    },
    bias,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    score: bull - bear,
    summary: `Rules-based reading for ${displaySymbol(pair)} from ${ctx.news.length} recent articles (${bull} bullish vs ${bear} bearish weight). ${reason} AI reasoning is disabled, so indirect macro relationships are not fully modelled.`,
    bullishDrivers: bull ? [`${bull} weighted bullish news signal(s)`] : [],
    bearishDrivers: bear ? [`${bear} weighted bearish news signal(s)`] : [],
    neutralOrMixedDrivers: bias === 'mixed' ? ['Conflicting headlines — direction unclear'] : [],
    keyCatalysts: ctx.events.slice(0, 5).map((e) => ({
      title: e.eventName,
      time: e.datetimeUtc,
      source: e.source,
      expectedImpact: 'neutral' as ImpactDir,
      reason: `${e.impact} impact ${e.currency ?? ''} event`,
    })),
    newsEvidence,
    macroEvidence: [],
    conflictAnalysis: {
      hasConflictingForces: bias === 'mixed',
      explanation: bias === 'mixed' ? 'News flow is mixed; no clear dominant force.' : 'Insufficient AI reasoning to model indirect conflicts.',
      bullishWeight: total ? Math.round((bull / total) * 100) : 0,
      bearishWeight: total ? Math.round((bear / total) * 100) : 0,
    },
    tradingImplication: 'Treat as low-conviction until AI analysis is available or more source data arrives.',
    invalidation: 'A fresh high-impact catalyst or a decisive shift in news sentiment.',
    riskWarnings: ['AI fundamental reasoning unavailable — this is a simplified rules-based estimate.'],
  };
}

export async function buildPairFundamentalAnalysis(
  symbol: string,
  options?: { forceRefresh?: boolean },
): Promise<PairFundamentalAnalysis> {
  const pair = normalizePair(symbol);
  await bootstrapFundamentals();
  if (options?.forceRefresh) {
    // Caller is expected to have refreshed sources already; we just read memory store.
  }
  const ctx = gatherContext(pair);

  if (!getConfiguredOpenAIApiKey()) {
    console.warn(`[pair-fundamentals] ${pair}: OPENAI_API_KEY not configured — using rules fallback`);
    return buildRulesFallback(pair, ctx, 'OPENAI_API_KEY is not configured on the server.');
  }

  const model = getOpenAIModel();
  try {
    console.info(`[pair-fundamentals] ${pair}: AI analysis started model=${model} news=${ctx.news.length} events=${ctx.events.length}`);
    const raw = await chatCompleteJSON<RawAi>([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(pair, ctx) },
    ], { temperature: 0.15, maxTokens: 1800, model, feature: 'pair_fundamentals', operation: 'analyze_pair', symbols: [pair] });

    const bias: PairBias = ['bullish', 'bearish', 'neutral', 'mixed'].includes(raw.bias ?? '')
      ? (raw.bias as PairBias) : 'neutral';
    const confidence = typeof raw.confidence === 'number' ? Math.max(0, Math.min(100, raw.confidence)) : 30;
    const now = new Date().toISOString();

    console.info(`[pair-fundamentals] ${pair}: AI analysis completed bias=${bias} confidence=${confidence}`);

    return {
      symbol: pair,
      generatedAt: now,
      model,
      mode: 'ai',
      dataFreshness: {
        newsLatestAt: ctx.newsLatestAt,
        calendarLatestAt: ctx.calendarLatestAt,
        macroLatestAt: ctx.newsLatestAt,
        telegramLatestAt: ctx.telegramLatestAt,
        isStale: isStale(ctx.newsLatestAt),
        warnings: ctx.warnings,
      },
      bias,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      score: typeof raw.score === 'number' ? Math.max(-100, Math.min(100, raw.score)) : 0,
      summary: raw.summary ?? `Fundamental analysis for ${displaySymbol(pair)}.`,
      bullishDrivers: Array.isArray(raw.bullishDrivers) ? raw.bullishDrivers.slice(0, 8) : [],
      bearishDrivers: Array.isArray(raw.bearishDrivers) ? raw.bearishDrivers.slice(0, 8) : [],
      neutralOrMixedDrivers: Array.isArray(raw.neutralOrMixedDrivers) ? raw.neutralOrMixedDrivers.slice(0, 6) : [],
      keyCatalysts: Array.isArray(raw.keyCatalysts) ? raw.keyCatalysts.slice(0, 8) : [],
      newsEvidence: Array.isArray(raw.newsEvidence) ? raw.newsEvidence.slice(0, 10) : [],
      macroEvidence: Array.isArray(raw.macroEvidence) ? raw.macroEvidence.slice(0, 10) : [],
      conflictAnalysis: raw.conflictAnalysis ?? { hasConflictingForces: false, explanation: '', bullishWeight: 50, bearishWeight: 50 },
      tradingImplication: raw.tradingImplication ?? '',
      invalidation: raw.invalidation ?? '',
      riskWarnings: Array.isArray(raw.riskWarnings) ? raw.riskWarnings.slice(0, 6) : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pair-fundamentals] ${pair}: AI analysis failed — ${message}`);
    return buildRulesFallback(pair, ctx, `AI analysis failed: ${message}`);
  }
}

export { normalizePair, displaySymbol };
