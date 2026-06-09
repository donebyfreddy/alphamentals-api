import { fetchCalendar } from '../lib/finnhub.js';
import { chatCompleteJSON } from '../lib/gemini.js';
import { supabase, isDatabaseConfigured } from '../lib/supabase.js';
import { FUNDAMENTAL_SOURCES, type FundamentalSourceConfig } from '../../../src/config/fundamentalSources.js';
import { MANUAL_ECONOMIC_EVENTS } from '../../../src/config/economicEvents.js';
import { fetchForexNews, fetchGeneralMarketNews, type NormalizedNewsArticle } from '../../../src/services/news/fmpNewsService.js';
import { fetchRssArticles } from '../../../src/services/news/rssNewsService.js';
import { scrapeFallbackNews } from '../../../src/services/news/playwrightNewsScraper.js';
import { deduplicateArticles } from '../../../src/services/news/newsDeduplicator.js';
import { fetchPoliticalHeadlines } from '../../../src/services/fundamentals/politicalInfluenceService.js';
import { fetchBoeNews, fetchEcbNews, fetchFedNews } from '../../../src/services/fundamentals/centralBankService.js';
import { detectAffectedSymbols, detectImpactLevel, detectMacroCategories, generateMarketImpactExplanation, type MacroCategory } from '../../../src/services/fundamentals/currencyImpactMapper.js';
import {
  APP_EVENT_TIMEZONE,
  deriveFundamentalEventTiming,
  getWeekWindow,
  type FundamentalEventStatus,
} from '../../../src/lib/fundamentalEvents.js';
// fundamentalAnalysisService exports are no longer used here; batch prompt is built inline.
import { calculateRulesBasedBias } from '../../../src/services/fundamentals/rulesBasedBiasEngine.js';
import { deriveTradeStatus } from '../../../src/services/fundamentals/tradeWarningService.js';

type PairSymbol =
  | 'XAU/USD' | 'XAG/USD'
  | 'EUR/USD' | 'GBP/USD' | 'USD/JPY' | 'AUD/USD' | 'NZD/USD'
  | 'USD/CAD' | 'USD/CHF' | 'GBP/JPY' | 'EUR/JPY' | 'EUR/GBP'
  | 'DXY' | 'USOIL'
  | 'NAS100' | 'SPX500' | 'US30' | 'US100' | 'GER40'
  | 'BTC/USD' | 'ETH/USD';

function getFundamentalsAiModel() {
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}
type Bias = 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
type Impact = 'low' | 'medium' | 'high' | 'unknown';
type TradeStatus = 'safe' | 'wait' | 'avoid' | 'unknown';
type TradeMode = 'favor_buys' | 'favor_sells' | 'wait' | 'avoid';
type HeadlineRisk = 'low' | 'medium' | 'high' | 'unavailable';
type DataFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';

interface TimeHorizonAnalysis {
  intraday?: string;
  swing?: string;
}

interface IntermarketContext {
  dxy?: string;
  yields?: string;
  riskSentiment?: string;
  geopolitics?: string;
}

interface SourceQuality {
  articleCount?: number;
  eventCount?: number;
  dataFreshness?: DataFreshness;
  confidencePenaltyReason?: string;
}

export interface SourceStatusRow {
  id: string;
  name: string;
  type: 'rss' | 'api' | 'playwright' | 'manual';
  enabled: boolean;
  categories: string[];
  status: 'idle' | 'ok' | 'failed' | 'skipped';
  articleCount: number;
  lastFetchedAt: string | null;
  lastError: string | null;
  fallbackUsed: boolean;
}

export interface NewsArticleRow {
  id: string;
  source: string;
  sourceType: 'api' | 'rss' | 'playwright';
  title: string;
  summary: string | null;
  contentSnippet: string | null;
  url: string | null;
  publishedAt: string;
  fetchedAt: string;
  affectedCurrencies: string[];
  affectedSymbols: string[];
  impact: Impact;
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
  topicTags: string[];
  macroCategory: MacroCategory[];
  marketImpactExplanation: string | null;
  relevanceScore: number;
  aiSummary: string | null;
  rawData: Record<string, unknown> | null;
}

export interface EconomicEventRow {
  id: string;
  source: string;
  sourceUrl: string | null;
  eventName: string;
  country: string | null;
  currency: string | null;
  impact: 'low' | 'medium' | 'high';
  category: 'inflation' | 'employment' | 'central bank' | 'PMI' | 'GDP' | 'retail sales' | 'housing' | 'sentiment' | 'other';
  date: string;
  time: string;
  timezone: string;
  providerTimezone: string;
  datetimeUtc: string;
  datetimeLocal: string;
  dateLabel: string;
  dateTimeLabel: string;
  previous: string | null;
  forecast: string | null;
  actual: string | null;
  eventTime: string;
  fetchedAt: string;
  description: string | null;
  whyItMatters: string | null;
  potentialImpact: string | null;
  volatilityImpact: string | null;
  aiInterpretation: string | null;
  status: FundamentalEventStatus | 'released';
  affectedSymbols: string[];
  timeUntil: string;
  blocksTrading: boolean;
  blockWindow: string | null;
  tradeWarning: 'none' | 'wait' | 'avoid';
  rawData: Record<string, unknown> | null;
  debug: {
    rawDateTime: string | null;
    rawDate: string | null;
    rawTime: string | null;
    parsedDateTimeUtc: string;
    appTimezone: string;
    nowUtc: string;
    classification: {
      status: FundamentalEventStatus;
      isToday: boolean;
      isThisWeek: boolean;
      isUpcoming: boolean;
      isPast: boolean;
      isNext4Hours: boolean;
    };
  };
}

export interface PairBiasRow {
  id: string;
  symbol: PairSymbol;
  bias: Bias;
  confidence: number;
  impact: Impact;
  tradeStatus: TradeStatus;
  reason: string;
  keyDrivers: string[];
  relatedArticleIds: string[];
  relatedEventIds: string[];
  updatedAt: string;
  tradeMode?: TradeMode;
  calendarRisk?: Impact;
  headlineRisk?: HeadlineRisk;
  timeHorizon?: TimeHorizonAnalysis;
  decisionSummary?: string;
  fundamentalSummary?: string;
  technicalMacroBridge?: string;
  macroDrivers?: string[];
  watchEvents?: string[];
  keyRisks?: string[];
  invalidationConditions?: string[];
  whatToDo?: string[];
  intermarketContext?: IntermarketContext;
  sourceQuality?: SourceQuality;
}

export interface AIDiagnostics {
  model: string;
  cacheHit: boolean;
  lastAiRefresh: string | null;
  rateLimited: boolean;
  rateLimitRetryAfter: string | null;
  requestsThisMinute: number;
}

export interface ScheduleMetadata {
  generatedAt: string | null;
  generatedTimezone: string;
  nextScheduledRun: string | null;
  triggeredBy: 'startup' | 'cron' | 'manual' | 'scheduled_07' | 'scheduled_13' | 'scheduled_14' | 'scheduled_15' | null;
}

export interface FundamentalsOverviewResponse {
  pairs: PairBiasRow[];
  latestNews: NewsArticleRow[];
  upcomingEvents: EconomicEventRow[];
  highImpactNext4Hours: EconomicEventRow[];
  sourceStatus: SourceStatusRow[];
  lastUpdated: string | null;
  mode: 'rules-based' | 'ai-enhanced';
  warning: string | null;
  errors: string[];
  aiDiagnostics: AIDiagnostics;
  scheduleMetadata: ScheduleMetadata;
}

export interface PairFundamentalsResponse {
  latestBias: PairBiasRow | null;
  biasHistory: PairBiasRow[];
  relatedArticles: NewsArticleRow[];
  relatedEvents: EconomicEventRow[];
}

const SUPPORTED_SYMBOLS: PairSymbol[] = [
  'XAU/USD', 'XAG/USD',
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'NZD/USD',
  'USD/CAD', 'USD/CHF', 'GBP/JPY', 'EUR/JPY', 'EUR/GBP',
  'DXY', 'USOIL',
  'NAS100', 'SPX500', 'US30', 'US100', 'GER40',
  'BTC/USD', 'ETH/USD',
];

const SCHEDULE_TZ = APP_EVENT_TIMEZONE;

const memoryStore: {
  articles: NewsArticleRow[];
  events: EconomicEventRow[];
  pairBiases: PairBiasRow[];
  sourceStatus: SourceStatusRow[];
  lastUpdated: string | null;
  lastWarning: string | null;
  lastErrors: string[];
  scheduleMetadata: ScheduleMetadata;
} = {
  articles: [],
  events: [],
  pairBiases: [],
  sourceStatus: FUNDAMENTAL_SOURCES.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    enabled: source.enabled,
    categories: source.categories,
    status: 'idle',
    articleCount: 0,
    lastFetchedAt: null,
    lastError: null,
    fallbackUsed: false,
  })),
  lastUpdated: null,
  lastWarning: null,
  lastErrors: [],
  scheduleMetadata: {
    generatedAt: null,
    generatedTimezone: SCHEDULE_TZ,
    nextScheduledRun: null,
    triggeredBy: null,
  },
};

let dbUnavailableLogged = false;

function isDbConnectionError(error: unknown): boolean {
  if (!isDatabaseConfigured()) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message ?? '';
  return msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('network');
}

function logDbUnavailable(error: unknown) {
  if (dbUnavailableLogged) return;
  dbUnavailableLogged = true;
  console.warn('[fundamentals] DB unavailable, using in-memory store only:', error instanceof Error ? error.message : error);
}

async function ensureTables(): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    logDbUnavailable('Supabase not configured');
    return false;
  }
  try {
    // Ping the DB — tables are created via supabase-schema.sql
    const { error } = await supabase.from('news_articles').select('id').limit(1);
    if (error) {
      logDbUnavailable(error.message);
      return false;
    }
    dbUnavailableLogged = false;
    return true;
  } catch (error) {
    logDbUnavailable(error);
    return false;
  }
}

function updateSourceStatus(id: string, patch: Partial<SourceStatusRow>) {
  const index = memoryStore.sourceStatus.findIndex((row) => row.id === id);
  if (index === -1) return;
  memoryStore.sourceStatus[index] = { ...memoryStore.sourceStatus[index], ...patch };
}

function logSourceStart(source: FundamentalSourceConfig) {
  console.info(`[fundamentals] source started: ${source.name}`);
  updateSourceStatus(source.id, { status: 'idle', lastError: null, fallbackUsed: false });
}

function logSourceSuccess(source: FundamentalSourceConfig, count: number) {
  console.info(`[fundamentals] source succeeded: ${source.name} (${count} articles/items)`);
  updateSourceStatus(source.id, {
    status: 'ok',
    articleCount: count,
    lastFetchedAt: new Date().toISOString(),
    lastError: null,
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logSourceFailed(source: FundamentalSourceConfig, error: unknown, fallbackUsed = false) {
  const message = toErrorMessage(error);
  console.warn(`[fundamentals] source failed: ${source.name} -> ${message}`);
  updateSourceStatus(source.id, {
    status: fallbackUsed ? 'ok' : 'failed',
    articleCount: 0,
    lastFetchedAt: new Date().toISOString(),
    lastError: message,
    fallbackUsed,
  });
  memoryStore.lastErrors.push(`${source.name}: ${message}`);
}

function makeArticleId(article: Pick<NewsArticleRow, 'url' | 'title' | 'publishedAt'>) {
  const raw = article.url ?? [article.title, article.publishedAt].join('|');
  return `news_${Buffer.from(raw).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`;
}

function inferTopicTags(article: Pick<NewsArticleRow, 'title' | 'summary' | 'contentSnippet' | 'affectedCurrencies'>): string[] {
  const text = [article.title, article.summary, article.contentSnippet].filter(Boolean).join(' ').toLowerCase();
  const tags: string[] = [];
  if (text.includes('powell') || text.includes('federal reserve') || text.includes('fomc')) tags.push('fed');
  if (text.includes('hawkish')) tags.push('hawkish-fed');
  if (text.includes('dovish')) tags.push('dovish-fed');
  if (text.includes('treasury yields') || text.includes('yield')) tags.push('rising-yields');
  if (text.includes('geopolitical') || text.includes('war') || text.includes('sanctions')) tags.push('geopolitical', 'risk-off');
  if (text.includes('tariff') || text.includes('trade war') || text.includes('donald trump') || text.includes('trump')) tags.push('politics');
  if (article.affectedCurrencies.includes('XAU')) tags.push('gold');
  return Array.from(new Set(tags));
}

function computeRelevanceScore(article: Pick<NewsArticleRow, 'impact' | 'publishedAt' | 'macroCategory'>): number {
  let impactWeight: number;
  if (article.impact === 'high') { impactWeight = 100; }
  else if (article.impact === 'medium') { impactWeight = 60; }
  else { impactWeight = 20; }

  const ageMs = Date.now() - new Date(article.publishedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  let recencyFactor: number;
  if (ageHours <= 6) { recencyFactor = 1; }
  else if (ageHours <= 24) { recencyFactor = 0.7; }
  else if (ageHours <= 72) { recencyFactor = 0.3; }
  else { recencyFactor = 0.05; }
  const macroBonus = article.macroCategory.length * 5;
  return Math.round(impactWeight * recencyFactor + macroBonus);
}

function normalizeArticle(article: NormalizedNewsArticle): NewsArticleRow {
  const affectedSymbols = article.affectedSymbols.filter((item): item is PairSymbol => SUPPORTED_SYMBOLS.includes(item as PairSymbol));
  const macroCategory = detectMacroCategories({
    title: article.title,
    summary: article.summary,
    contentSnippet: article.contentSnippet,
  });
  const marketImpactExplanation = generateMarketImpactExplanation(macroCategory, affectedSymbols);
  const normalized: NewsArticleRow = {
    id: makeArticleId({ url: article.url, title: article.title, publishedAt: article.publishedAt }),
    source: article.source,
    sourceType: article.sourceType,
    title: article.title,
    summary: article.summary,
    contentSnippet: article.contentSnippet,
    url: article.url,
    publishedAt: article.publishedAt,
    fetchedAt: article.fetchedAt,
    affectedCurrencies: article.affectedCurrencies,
    affectedSymbols,
    impact: article.impact,
    sentiment: article.sentiment,
    topicTags: [],
    macroCategory,
    marketImpactExplanation,
    relevanceScore: 0,
    aiSummary: article.summary ?? null,
    rawData: article.rawData,
  };
  normalized.topicTags = inferTopicTags(normalized);
  normalized.relevanceScore = computeRelevanceScore(normalized);
  return normalized;
}

const FRESHNESS_CUTOFF_MS = 72 * 60 * 60 * 1000; // 72h default
const HIGH_IMPACT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for high-impact

function dedupeAndSortArticles(articles: NewsArticleRow[]) {
  const deduped = deduplicateArticles(articles).map((article) => normalizeArticle(article as unknown as NormalizedNewsArticle));
  const byId = new Map<string, NewsArticleRow>();
  for (const article of deduped) {
    byId.set(article.id, article);
  }

  const now = Date.now();
  const fresh = Array.from(byId.values()).filter((article) => {
    const ageMs = now - new Date(article.publishedAt).getTime();
    const cutoff = article.impact === 'high' ? HIGH_IMPACT_FRESHNESS_MS : FRESHNESS_CUTOFF_MS;
    return ageMs <= cutoff;
  });

  // Sort by relevance score DESC (combines impact + recency + macro depth)
  return fresh.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function dedupeAndClassifyEvents(events: EconomicEventRow[]) {
  const byId = new Map<string, EconomicEventRow>();
  for (const event of events) {
    if (!event.datetimeUtc) continue;
    byId.set(event.id, event);
  }

  return Array.from(byId.values())
    .sort((a, b) => +new Date(a.datetimeUtc) - +new Date(b.datetimeUtc));
}

function categorizeEconomicEvent(name: string): EconomicEventRow['category'] {
  const text = name.toLowerCase();
  if (/(cpi|ppi|inflation|pce)/.test(text)) return 'inflation';
  if (/(employment|payroll|jobless|unemployment|wage|labor)/.test(text)) return 'employment';
  if (/(fed|ecb|boe|boj|rba|boc|speech|minutes|rate decision|central bank)/.test(text)) return 'central bank';
  if (/pmi/.test(text)) return 'PMI';
  if (/gdp/.test(text)) return 'GDP';
  if (/retail sales/.test(text)) return 'retail sales';
  if (/(housing|home sales|building permits|starts)/.test(text)) return 'housing';
  if (/(sentiment|confidence)/.test(text)) return 'sentiment';
  return 'other';
}

function describeEconomicEvent(eventName: string, category: EconomicEventRow['category']) {
  const name = eventName.trim();
  const defaults: Record<EconomicEventRow['category'], { description: string; why: string; impact: string; volatility: string }> = {
    inflation: {
      description: `${name} tracks inflation pressure and price growth trends.`,
      why: 'Inflation surprises can quickly change rate expectations, yields, and the USD or local currency.',
      impact: 'Higher-than-expected inflation can support the currency if markets expect tighter policy. Softer data can pressure yields and the currency.',
      volatility: 'Typically medium to high volatility, especially for USD pairs and gold.',
    },
    employment: {
      description: `${name} measures labour-market conditions, hiring strength, or wage pressure.`,
      why: 'Employment data is a core central-bank input and can reshape growth and rate expectations.',
      impact: 'Strong labour data can strengthen the local currency and pressure gold if yields rise. Weak data can do the opposite.',
      volatility: 'Often high volatility for major FX pairs around the release.',
    },
    'central bank': {
      description: `${name} reflects central-bank communication or policy direction.`,
      why: 'Central-bank speeches, minutes, and decisions can directly move rate expectations, yields, indices, and FX.',
      impact: 'Watch for comments on inflation, rates, liquidity, banking conditions, and economic outlook.',
      volatility: 'Can trigger sharp intraday volatility in the affected currency, gold, and risk assets.',
    },
    PMI: {
      description: `${name} measures business activity and momentum in manufacturing or services.`,
      why: 'PMI data helps traders gauge growth momentum before harder macro data is released.',
      impact: 'A strong surprise can lift the currency and risk sentiment. A weak print can hurt growth-sensitive assets.',
      volatility: 'Usually medium volatility, but can rise when growth is a dominant market theme.',
    },
    GDP: {
      description: `${name} measures the pace of economic growth.`,
      why: 'GDP releases shape macro growth expectations and can influence monetary policy expectations.',
      impact: 'Stronger GDP can support the currency and yields. Weak GDP can increase easing expectations.',
      volatility: 'Usually medium to high volatility depending on the surprise size.',
    },
    'retail sales': {
      description: `${name} measures consumer spending momentum.`,
      why: 'Consumer demand is a major driver of growth and inflation persistence.',
      impact: 'Strong retail sales can support the currency and risk sentiment; weak sales can weigh on growth expectations.',
      volatility: 'Usually medium volatility.',
    },
    housing: {
      description: `${name} tracks housing-market activity or construction demand.`,
      why: 'Housing is sensitive to rates and can signal how restrictive financial conditions are becoming.',
      impact: 'Stronger housing data can support growth expectations; weak housing data can reinforce slowdown concerns.',
      volatility: 'Usually low to medium volatility.',
    },
    sentiment: {
      description: `${name} measures confidence among consumers or businesses.`,
      why: 'Confidence data helps frame spending and investment appetite before harder data arrives.',
      impact: 'Strong sentiment can support growth-sensitive assets; weak sentiment can hurt risk appetite.',
      volatility: 'Usually low to medium volatility unless sentiment is a key macro focus.',
    },
    other: {
      description: `${name} is a scheduled macro event that can influence the related currency and correlated assets.`,
      why: 'Unexpected macro outcomes can affect rate expectations, relative growth, and short-term risk sentiment.',
      impact: 'Watch how the result changes expectations for the currency, yields, and correlated instruments.',
      volatility: 'Volatility impact depends on the size of the surprise and the current macro theme.',
    },
  };

  return defaults[category];
}

function formatTimeUntil(datetimeUtc: string, now = new Date()) {
  const diffMs = new Date(datetimeUtc).getTime() - now.getTime();
  if (diffMs <= 0) return 'expired';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'today';
  if (minutes < 60) return `in ${minutes}m`;
  if (minutes < 24 * 60) return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes < 48 * 60) return 'tomorrow';
  return `in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

function normalizeManualEvent(event: typeof MANUAL_ECONOMIC_EVENTS[number]): EconomicEventRow {
  const affectedSymbols = detectAffectedSymbols({
    eventName: event.eventName,
    currency: event.currency,
    impact: event.impact,
    title: event.eventName,
  }).filter((symbol): symbol is PairSymbol => SUPPORTED_SYMBOLS.includes(symbol as PairSymbol));

  return {
    id: event.id,
    source: event.source,
    sourceUrl: null,
    eventName: event.eventName,
    country: event.country ?? null,
    currency: event.currency,
    impact: event.impact,
    category: categorizeEconomicEvent(event.eventName),
    date: '',
    time: '',
    timezone: SCHEDULE_TZ,
    providerTimezone: 'UTC',
    datetimeUtc: event.dateTime,
    datetimeLocal: event.dateTime,
    dateLabel: '',
    dateTimeLabel: '',
    previous: event.previous ?? null,
    forecast: event.forecast ?? null,
    actual: event.actual ?? null,
    eventTime: event.dateTime,
    fetchedAt: new Date().toISOString(),
    description: null,
    whyItMatters: null,
    potentialImpact: null,
    volatilityImpact: null,
    aiInterpretation: null,
    status: 'upcoming',
    affectedSymbols,
    timeUntil: 'today',
    blocksTrading: event.impact === 'high',
    blockWindow: event.impact === 'high' ? '30 minutes before/after' : null,
    tradeWarning: deriveTradeStatus({
      bias: 'neutral',
      confidence: 50,
      impact: event.impact,
      events: [{ impact: event.impact, eventTime: event.dateTime }],
    }) === 'avoid' ? 'avoid' : 'wait',
    rawData: { source: 'manual' },
    debug: {
      rawDateTime: event.dateTime,
      rawDate: null,
      rawTime: null,
      parsedDateTimeUtc: event.dateTime,
      appTimezone: SCHEDULE_TZ,
      nowUtc: new Date().toISOString(),
      classification: {
        status: 'upcoming',
        isToday: false,
        isThisWeek: false,
        isUpcoming: true,
        isPast: false,
        isNext4Hours: false,
      },
    },
  };
}

function enrichEconomicEvent(
  base: Omit<EconomicEventRow, 'date' | 'time' | 'timezone' | 'providerTimezone' | 'datetimeUtc' | 'datetimeLocal' | 'dateLabel' | 'dateTimeLabel' | 'eventTime' | 'fetchedAt' | 'description' | 'whyItMatters' | 'potentialImpact' | 'volatilityImpact' | 'aiInterpretation' | 'status' | 'timeUntil' | 'blocksTrading' | 'blockWindow' | 'debug'>,
  timingInput: { rawDateTime?: string | null; rawDate?: string | null; rawTime?: string | null; providerTimezone?: string | null; now?: Date },
): EconomicEventRow | null {
  const now = timingInput.now ?? new Date();
  const timing = deriveFundamentalEventTiming({
    rawDateTime: timingInput.rawDateTime,
    rawDate: timingInput.rawDate,
    rawTime: timingInput.rawTime,
    providerTimezone: timingInput.providerTimezone ?? 'UTC',
    appTimezone: SCHEDULE_TZ,
    now,
  });

  if (!timing) return null;

  const description = describeEconomicEvent(base.eventName, base.category);
  const released = timing.isPast && Boolean(base.actual);
  const event: EconomicEventRow = {
    ...base,
    date: timing.date,
    time: timing.time,
    timezone: timing.timezone,
    providerTimezone: timing.providerTimezone,
    datetimeUtc: timing.datetimeUtc,
    datetimeLocal: timing.datetimeLocal,
    dateLabel: timing.dateLabel,
    dateTimeLabel: timing.dateTimeLabel,
    eventTime: timing.datetimeUtc,
    fetchedAt: now.toISOString(),
    description: description.description,
    whyItMatters: description.why,
    potentialImpact: description.impact,
    volatilityImpact: description.volatility,
    aiInterpretation: description.impact,
    status: released ? 'released' : timing.status,
    timeUntil: formatTimeUntil(timing.datetimeUtc, now),
    blocksTrading: base.impact === 'high',
    blockWindow: base.impact === 'high' ? '30 minutes before/after' : null,
    debug: {
      rawDateTime: timing.rawDateTime,
      rawDate: timing.rawDate,
      rawTime: timing.rawTime,
      parsedDateTimeUtc: timing.datetimeUtc,
      appTimezone: timing.timezone,
      nowUtc: now.toISOString(),
      classification: {
        status: released ? 'released' : timing.status,
        isToday: timing.isToday,
        isThisWeek: timing.isThisWeek,
        isUpcoming: timing.isUpcoming,
        isPast: timing.isPast,
        isNext4Hours: timing.isNext4Hours,
      },
    },
  };

  console.log('[fundamentals/events] classified', {
    id: event.id,
    source: event.source,
    eventName: event.eventName,
    rawDateTime: event.debug.rawDateTime,
    rawDate: event.debug.rawDate,
    rawTime: event.debug.rawTime,
    parsedDateTimeUtc: event.datetimeUtc,
    datetimeLocal: event.datetimeLocal,
    appTimezone: event.timezone,
    currentDateTimeUtc: event.debug.nowUtc,
    status: event.status,
    isToday: event.debug.classification.isToday,
    isThisWeek: event.debug.classification.isThisWeek,
    isUpcoming: event.debug.classification.isUpcoming,
    isPast: event.debug.classification.isPast,
    isNext4Hours: event.debug.classification.isNext4Hours,
  });

  return event;
}

async function loadRssSources() {
  const rssSources = FUNDAMENTAL_SOURCES.filter((source) => source.enabled && source.type === 'rss');
  const results: NewsArticleRow[] = [];

  for (const source of rssSources) {
    logSourceStart(source);
    try {
      const articles = await fetchRssArticles([source]);
      const normalized = articles.map((article) => normalizeArticle(article));
      results.push(...normalized);
      logSourceSuccess(source, normalized.length);
    } catch (error) {
      logSourceFailed(source, error);
    }
  }

  return results;
}

async function loadApiSources() {
  const apiResults: NewsArticleRow[] = [];

  const fmpSource = FUNDAMENTAL_SOURCES.find((source) => source.id === 'fmp-forex-news');
  if (fmpSource) {
    logSourceStart(fmpSource);
    if (process.env.FMP_API_KEY) {
      try {
        const [forex, general] = await Promise.all([fetchForexNews(), fetchGeneralMarketNews()]);
        const normalized = [...forex, ...general].map(normalizeArticle);
        apiResults.push(...normalized);
        logSourceSuccess(fmpSource, normalized.length);
      } catch (error) {
        logSourceFailed(fmpSource, error, true);
      }
    }
  }

  return apiResults;
}

async function loadPoliticalAndCentralBankSources() {
  const results: NewsArticleRow[] = [];

  const political = await fetchPoliticalHeadlines().catch(() => []);
  const fed = await fetchFedNews().catch(() => []);
  const ecb = await fetchEcbNews().catch(() => []);
  const boe = await fetchBoeNews().catch(() => []);

  for (const article of [...political, ...fed, ...ecb, ...boe]) {
    results.push(normalizeArticle(article));
  }

  return results;
}

async function loadPlaywrightFallback(enable: boolean) {
  const source = FUNDAMENTAL_SOURCES.find((item) => item.id === 'playwright-fallback');
  if (!source) return [];
  if (!enable) {
    updateSourceStatus(source.id, { status: 'skipped', lastError: 'Disabled by settings', articleCount: 0 });
    return [];
  }
  logSourceStart(source);
  try {
    const articles = await scrapeFallbackNews({ enabled: true });
    const normalized = articles.map((article) => normalizeArticle(article));
    logSourceSuccess(source, normalized.length);
    return normalized;
  } catch (error) {
    logSourceFailed(source, error);
    return [];
  }
}

async function loadEconomicEvents(): Promise<EconomicEventRow[]> {
  const manualSource = FUNDAMENTAL_SOURCES.find((source) => source.id === 'manual-economic-events');
  const events: EconomicEventRow[] = [];
  const shouldUseManualEvents = process.env.ENABLE_MANUAL_ECONOMIC_EVENTS === 'true' && !process.env.FINNHUB_API_KEY;
  if (manualSource) {
    logSourceStart(manualSource);
    if (shouldUseManualEvents) {
      const manualEvents = MANUAL_ECONOMIC_EVENTS
        .map(normalizeManualEvent)
        .map((event) => enrichEconomicEvent(event, { rawDateTime: event.eventTime, providerTimezone: 'UTC' }))
        .filter((event): event is EconomicEventRow => Boolean(event));
      events.push(...manualEvents);
      logSourceSuccess(manualSource, manualEvents.length);
    } else {
      updateSourceStatus(manualSource.id, {
        status: 'skipped',
        articleCount: 0,
        lastFetchedAt: new Date().toISOString(),
        lastError: shouldUseManualEvents ? null : 'Manual economic events disabled when live provider data is available.',
      });
    }
  }

  try {
    const from = new Date(Date.now() - 6 * 60 * 60_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const finnhubEvents = await fetchCalendar(from, to);

    for (const event of finnhubEvents) {
      const affectedSymbols = detectAffectedSymbols({
        title: event.title,
        eventName: event.title,
        currency: event.currency,
        impact: event.impact,
      }).filter((symbol): symbol is PairSymbol => SUPPORTED_SYMBOLS.includes(symbol as PairSymbol));

      const normalized = enrichEconomicEvent({
        id: `finnhub_${Buffer.from([event.title, event.date, event.time].join('|')).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`,
        source: 'Finnhub',
        sourceUrl: null,
        eventName: event.title,
        country: event.country ?? null,
        currency: event.currency ?? null,
        impact: event.impact,
        category: categorizeEconomicEvent(event.title),
        previous: event.previous ?? null,
        forecast: event.forecast ?? null,
        actual: event.actual ?? null,
        affectedSymbols,
        tradeWarning: deriveTradeStatus({
          bias: 'neutral',
          confidence: 50,
          impact: detectImpactLevel({ title: event.title, currency: event.currency, impact: event.impact }),
          events: [{ impact: event.impact, eventTime: `${event.date}T${event.time}:00Z` }],
        }) === 'avoid' ? 'avoid' : 'wait',
        rawData: event as unknown as Record<string, unknown>,
      }, {
        rawDate: event.date,
        rawTime: event.time,
        providerTimezone: 'UTC',
      });

      if (normalized) events.push(normalized);
    }
  } catch (error) {
    memoryStore.lastErrors.push(`Finnhub calendar: ${error instanceof Error ? error.message : String(error)}`);
  }

  return dedupeAndClassifyEvents(events);
}

function buildEmptyPair(symbol: PairSymbol): PairBiasRow {
  return {
    id: `pair_${symbol.replace('/', '')}`,
    symbol,
    bias: 'unknown',
    confidence: 0,
    impact: 'unknown',
    tradeStatus: 'unknown',
    reason: `No fundamentals data yet for ${symbol}. Click Refresh Fundamentals to fetch latest news.`,
    keyDrivers: [],
    relatedArticleIds: [],
    relatedEventIds: [],
    updatedAt: new Date().toISOString(),
  };
}

function inferTradeModeFromBias(bias: Bias | string): TradeMode {
  if (bias === 'bullish') return 'favor_buys';
  if (bias === 'bearish') return 'favor_sells';
  return 'wait';
}

function inferDataFreshness(articles: NewsArticleRow[], events: EconomicEventRow[]): DataFreshness {
  const timestamps = [
    ...articles.map((article) => article.publishedAt || article.fetchedAt),
    ...events.map((event) => event.datetimeUtc || event.fetchedAt),
  ]
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) return 'unknown';

  const newest = Math.max(...timestamps);
  const ageHours = (Date.now() - newest) / (1000 * 60 * 60);
  if (ageHours <= 6) return 'fresh';
  if (ageHours <= 24) return 'aging';
  return 'stale';
}

// ── AI batch cache & rate-limit state ────────────────────────────────────────

const AI_CACHE_TTL_MS = process.env.NODE_ENV === 'production' ? 12 * 60_000 : 5 * 60_000;

const aiState: {
  cachedBiases: PairBiasRow[] | null;
  cacheExpiresAt: number;
  lastAiRefresh: string | null;
  inFlight: Promise<PairBiasRow[]> | null;
  rateLimitedUntil: number | null;
  rateLimitRetryAfter: string | null;
  requestsThisMinute: number;
  requestWindowStart: number;
} = {
  cachedBiases: null,
  cacheExpiresAt: 0,
  lastAiRefresh: null,
  inFlight: null,
  rateLimitedUntil: null,
  rateLimitRetryAfter: null,
  requestsThisMinute: 0,
  requestWindowStart: Date.now(),
};

function tickRequestCounter() {
  const now = Date.now();
  if (now - aiState.requestWindowStart > 60_000) {
    aiState.requestsThisMinute = 0;
    aiState.requestWindowStart = now;
  }
  aiState.requestsThisMinute += 1;
}

function isRateLimited(): boolean {
  if (aiState.rateLimitedUntil == null) return false;
  if (Date.now() < aiState.rateLimitedUntil) return true;
  aiState.rateLimitedUntil = null;
  aiState.rateLimitRetryAfter = null;
  return false;
}

function extractRetryAfterMs(error: unknown): number {
  const msg = toErrorMessage(error);
  const match = /retry.*?after[^\d]*(\d+)/i.exec(msg) ?? /(\d+)\s*second/i.exec(msg);
  if (match) return Number.parseInt(match[1], 10) * 1000;
  return 60_000; // default 1 minute backoff
}

/** Build one batched prompt for all symbols at once. */
function buildBatchPrompt(rulesResults: Array<{ symbol: string; reason: string; articleIds: string[]; eventIds: string[] }>, articles: NewsArticleRow[], events: EconomicEventRow[]): string {
  const INSTRUMENT_CONTEXT: Record<string, string> = {
    'EUR/USD': 'Professional focus: ECB vs Fed divergence, Eurozone inflation/PMI/growth, US CPI/NFP, DXY direction, yield spreads, and risk sentiment. Separate intraday catalyst risk from swing bias.',
    'GBP/USD': 'Professional focus: BoE vs Fed divergence, UK inflation/jobs/GDP, US macro surprise risk, DXY direction, gilt vs Treasury yield spread, and political headlines.',
    'XAU/USD': 'Professional focus: US real yields, nominal yields, DXY direction, Fed expectations, inflation, labor data, safe-haven demand, and geopolitical headline risk. Treat stale macro narratives conservatively.',
    'DXY': 'Professional focus: Fed path, US CPI/NFP/GDP, Treasury yields, positioning, and global risk sentiment. Explain inverse or confirming pressure on EUR, GBP, Gold, and Oil.',
    'USOIL': 'Professional focus: OPEC+ supply discipline, EIA/API inventory flow, China/global demand, USD strength, inflation transmission, and geopolitical supply risk.',
  };

  const symbolBlocks = rulesResults.map((r) => {
    const compactKey = r.symbol.replace('/', '');
    const matchedArticles = articles.filter((a) => r.articleIds.includes(a.id));
    const matchedEvents = events.filter((e) => r.eventIds.includes(e.id));
    const relArticles = matchedArticles
      .slice(0, 6)
      .map((a) => ({
        title: a.title,
        sentiment: a.sentiment,
        impact: a.impact,
        publishedAt: a.publishedAt,
        source: a.source,
      }));
    const relEvents = matchedEvents
      .slice(0, 5)
      .map((e) => ({
        eventName: e.eventName,
        impact: e.impact,
        currency: e.currency,
        date: e.date,
        time: e.time,
        actual: e.actual,
        forecast: e.forecast,
        previous: e.previous,
      }));
    const sourceQuality = {
      articleCount: matchedArticles.length,
      eventCount: matchedEvents.length,
      dataFreshness: inferDataFreshness(matchedArticles, matchedEvents),
    };

    return `### ${compactKey} (${r.symbol})
Instrument context: ${INSTRUMENT_CONTEXT[r.symbol] ?? 'Macro instrument.'}
Rules-based context: ${r.reason}
Source quality baseline: ${JSON.stringify(sourceQuality)}
Related articles: ${JSON.stringify(relArticles)}
Related events: ${JSON.stringify(relEvents)}`;
  }).join('\n\n');

  const keyShape = rulesResults.map((r) => `"${r.symbol.replace('/', '')}": {
    "bias":"bullish|bearish|neutral|mixed",
    "confidence":0-100,
    "impact":"low|medium|high",
    "tradeStatus":"safe|wait|avoid",
    "reason":"<2 sentences, include macro/intermarket context>",
    "keyDrivers":["..."],
    "tradeMode":"favor_buys|favor_sells|wait|avoid",
    "calendarRisk":"low|medium|high",
    "headlineRisk":"low|medium|high|unavailable",
    "timeHorizon":{"intraday":"...","swing":"..."},
    "decisionSummary":"...",
    "fundamentalSummary":"...",
    "technicalMacroBridge":"...",
    "macroDrivers":["..."],
    "watchEvents":["..."],
    "keyRisks":["..."],
    "invalidationConditions":["..."],
    "whatToDo":["..."],
    "intermarketContext":{"dxy":"...","yields":"...","riskSentiment":"...","geopolitics":"..."},
    "sourceQuality":{"articleCount":0,"eventCount":0,"dataFreshness":"fresh|aging|stale|unknown","confidencePenaltyReason":"..."}
  }`).join(',\n  ');

  return `You are the AlphaMentals professional macro/fundamental analyst.

Analyze the fundamental bias for ALL instruments below in one response.
Use only:
- the rules-based context,
- the related articles,
- the related events,
- the instrument context.

Do not invent headlines, events, price action, technical levels, or macro drivers that are not grounded in the provided context.
If the source set is thin, mixed, or stale, lower confidence and explain the penalty.
Separate intraday bias from swing bias.
Be practical for traders: explain what matters now, what can invalidate the view, and what the trader should do next.
Use intermarket reasoning when supported by the data, especially DXY, yields, risk sentiment, oil, and geopolitics.
Never promise outcomes. Never overstate certainty.

${symbolBlocks}

Return JSON only with this exact shape:
{
  ${keyShape}
}`;
}

interface BatchAIBias {
  bias: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  confidence: number;
  impact: 'low' | 'medium' | 'high';
  tradeStatus: 'safe' | 'wait' | 'avoid';
  reason: string;
  keyDrivers: string[];
  tradeMode?: TradeMode;
  calendarRisk?: 'low' | 'medium' | 'high';
  headlineRisk?: HeadlineRisk;
  timeHorizon?: TimeHorizonAnalysis;
  decisionSummary?: string;
  fundamentalSummary?: string;
  technicalMacroBridge?: string;
  macroDrivers?: string[];
  watchEvents?: string[];
  keyRisks?: string[];
  invalidationConditions?: string[];
  whatToDo?: string[];
  intermarketContext?: IntermarketContext;
  sourceQuality?: SourceQuality;
}

async function callBatchAI(rulesResults: PairBiasRow[], articles: NewsArticleRow[], events: EconomicEventRow[]): Promise<PairBiasRow[]> {
  tickRequestCounter();
  const startMs = Date.now();

  console.info('[Fundamentals AI] batch request start', {
    provider: 'openai',
    model: getFundamentalsAiModel(),
    symbols: rulesResults.map((r) => r.symbol).join(', '),
    requestsThisMinute: aiState.requestsThisMinute,
  });

  const prompt = buildBatchPrompt(
    rulesResults.map((r) => ({ symbol: r.symbol, reason: r.reason, articleIds: r.relatedArticleIds, eventIds: r.relatedEventIds })),
    articles,
    events,
  );

  const raw = await chatCompleteJSON<Record<string, unknown>>([
    {
      role: 'system',
      content: 'You are the AlphaMentals professional macro/fundamental analyst. Return JSON only. Use only the provided rules-based context, related articles, related events, and instrument context. Do not invent macro drivers, events, headlines, or technical structure. Lower confidence when source quality is weak, mixed, or stale. Separate intraday and swing thinking, include intermarket context when supported, and keep trader guidance practical but not promotional.',
    },
    { role: 'user', content: prompt },
  ], { temperature: 0.1, maxTokens: 1500, model: getFundamentalsAiModel(), feature: 'fundamentals', operation: 'generate_pair_fundamentals' });

  const durationMs = Date.now() - startMs;
  console.info('[Fundamentals AI] batch request success', { provider: 'openai', model: getFundamentalsAiModel(), durationMs, status: 'success' });

  // Merge AI results back over rules-based rows
  const now = new Date().toISOString();
  return rulesResults.map((row) => {
    const compactKey = row.symbol.replace('/', '');
    const aiEntry = raw[compactKey] as BatchAIBias | undefined;
    if (!aiEntry || typeof aiEntry.bias !== 'string') return row;

    return {
      ...row,
      bias: ['bullish', 'bearish', 'neutral', 'mixed'].includes(aiEntry.bias) ? aiEntry.bias : row.bias,
      confidence: typeof aiEntry.confidence === 'number' ? Math.max(0, Math.min(100, aiEntry.confidence)) : row.confidence,
      impact: ['low', 'medium', 'high'].includes(aiEntry.impact) ? aiEntry.impact : row.impact,
      tradeStatus: ['safe', 'wait', 'avoid'].includes(aiEntry.tradeStatus) ? aiEntry.tradeStatus : row.tradeStatus,
      reason: typeof aiEntry.reason === 'string' ? aiEntry.reason : row.reason,
      keyDrivers: Array.isArray(aiEntry.keyDrivers) ? aiEntry.keyDrivers : row.keyDrivers,
      tradeMode: aiEntry.tradeMode && ['favor_buys', 'favor_sells', 'wait', 'avoid'].includes(aiEntry.tradeMode)
        ? aiEntry.tradeMode
        : row.tradeMode ?? inferTradeModeFromBias(aiEntry.bias),
      calendarRisk: aiEntry.calendarRisk && ['low', 'medium', 'high'].includes(aiEntry.calendarRisk)
        ? aiEntry.calendarRisk
        : row.calendarRisk ?? (row.impact === 'unknown' ? 'medium' : row.impact),
      headlineRisk: aiEntry.headlineRisk && ['low', 'medium', 'high', 'unavailable'].includes(aiEntry.headlineRisk)
        ? aiEntry.headlineRisk
        : row.headlineRisk,
      timeHorizon: aiEntry.timeHorizon ?? row.timeHorizon,
      decisionSummary: typeof aiEntry.decisionSummary === 'string' ? aiEntry.decisionSummary : row.decisionSummary ?? aiEntry.reason,
      fundamentalSummary: typeof aiEntry.fundamentalSummary === 'string' ? aiEntry.fundamentalSummary : row.fundamentalSummary ?? aiEntry.reason,
      technicalMacroBridge: typeof aiEntry.technicalMacroBridge === 'string' ? aiEntry.technicalMacroBridge : row.technicalMacroBridge,
      macroDrivers: Array.isArray(aiEntry.macroDrivers) ? aiEntry.macroDrivers : row.macroDrivers ?? row.keyDrivers,
      watchEvents: Array.isArray(aiEntry.watchEvents) ? aiEntry.watchEvents : row.watchEvents,
      keyRisks: Array.isArray(aiEntry.keyRisks) ? aiEntry.keyRisks : row.keyRisks,
      invalidationConditions: Array.isArray(aiEntry.invalidationConditions) ? aiEntry.invalidationConditions : row.invalidationConditions,
      whatToDo: Array.isArray(aiEntry.whatToDo) ? aiEntry.whatToDo : row.whatToDo,
      intermarketContext: aiEntry.intermarketContext ?? row.intermarketContext,
      sourceQuality: aiEntry.sourceQuality ?? row.sourceQuality,
      updatedAt: now,
    };
  });
}

async function runPairAnalysis(articles: NewsArticleRow[], events: EconomicEventRow[]): Promise<PairBiasRow[]> {
  // Build rules-based baseline for all symbols
  const rulesResults: PairBiasRow[] = SUPPORTED_SYMBOLS.map((symbol) => {
    const r = calculateRulesBasedBias({ symbol, articles, events, sourceStale: !memoryStore.lastUpdated });
    const matchedArticles = articles.filter((article) => r.articleIds.includes(article.id));
    const matchedEvents = events.filter((event) => r.eventIds.includes(event.id));
    return {
      id: `pair_${symbol.replace('/', '')}`,
      symbol,
      bias: r.bias,
      confidence: r.confidence,
      impact: r.impact,
      tradeStatus: r.tradeStatus,
      reason: r.reason,
      keyDrivers: r.keyDrivers,
      relatedArticleIds: r.articleIds,
      relatedEventIds: r.eventIds,
      updatedAt: new Date().toISOString(),
      tradeMode: inferTradeModeFromBias(r.bias),
      calendarRisk: r.impact === 'unknown' ? 'medium' : r.impact,
      headlineRisk: 'unavailable',
      decisionSummary: r.reason,
      fundamentalSummary: r.reason,
      macroDrivers: r.keyDrivers,
      watchEvents: [],
      keyRisks: [],
      invalidationConditions: [],
      whatToDo: [],
      sourceQuality: {
        articleCount: matchedArticles.length,
        eventCount: matchedEvents.length,
        dataFreshness: inferDataFreshness(matchedArticles, matchedEvents),
      },
    };
  });

  const aiEnabled = Boolean(process.env.OPENAI_API_KEY);
  const hasContent = rulesResults.some((r) => r.relatedArticleIds.length || r.relatedEventIds.length);

  if (!aiEnabled || !hasContent) {
    return rulesResults;
  }

  // Return cached AI result if still valid
  if (aiState.cachedBiases && Date.now() < aiState.cacheExpiresAt) {
    console.info('[Fundamentals AI] cache hit — skipping provider call', { model: getFundamentalsAiModel(), expiresIn: Math.round((aiState.cacheExpiresAt - Date.now()) / 1000) + 's' });
    aiState.cachedBiases = aiState.cachedBiases.map((cached, i) => ({
      ...cached,
      relatedArticleIds: rulesResults[i]?.relatedArticleIds ?? cached.relatedArticleIds,
      relatedEventIds: rulesResults[i]?.relatedEventIds ?? cached.relatedEventIds,
    }));
    return aiState.cachedBiases;
  }

  // Rate-limited — return rules-based, warn
  if (isRateLimited()) {
    const retryIn = aiState.rateLimitedUntil ? Math.round((aiState.rateLimitedUntil - Date.now()) / 1000) : '?';
    console.warn('[Fundamentals AI] rate-limited — returning rules-based result', { retryInSeconds: retryIn });
    memoryStore.lastErrors.push(`Fundamentals AI temporarily rate-limited. Retry in ~${retryIn}s.`);
    return aiState.cachedBiases ?? rulesResults;
  }

  // Deduplicate: if a batch call is already in flight, reuse it
  if (aiState.inFlight != null) {
    console.info('[Fundamentals AI] dedup — reusing in-flight batch request');
    return aiState.inFlight;
  }

  const batchPromise = callBatchAI(rulesResults, articles, events)
    .then((enriched) => {
      aiState.cachedBiases = enriched;
      aiState.cacheExpiresAt = Date.now() + AI_CACHE_TTL_MS;
      aiState.lastAiRefresh = new Date().toISOString();
      aiState.inFlight = null;
      enriched.forEach((row) =>
        console.info(`[fundamentals] pair analysis completed: ${row.symbol} -> ${row.bias} (${row.confidence})`),
      );
      return enriched;
    })
    .catch((error) => {
      aiState.inFlight = null;
      const message = error instanceof Error ? error.message : String(error);
      const is429 = /429|quota|resource.?exhausted|rate.?limit/i.test(message);

      if (is429) {
        const backoffMs = extractRetryAfterMs(error);
        aiState.rateLimitedUntil = Date.now() + backoffMs;
        aiState.rateLimitRetryAfter = new Date(aiState.rateLimitedUntil).toISOString();
        console.warn('[Fundamentals AI] 429 rate limit hit', {
          model: getFundamentalsAiModel(),
          backoffMs,
          retryAfter: aiState.rateLimitRetryAfter,
        });
        memoryStore.lastErrors.push(`Fundamentals AI rate-limited (429). Next retry allowed after ${aiState.rateLimitRetryAfter}.`);
      } else {
        console.warn('[Fundamentals AI] batch request failed', { model: getFundamentalsAiModel(), error: message });
        memoryStore.lastErrors.push(`Fundamentals AI batch failed: ${message}`);
      }

      // Return cached biases if available, else fall back to rules-based
      return aiState.cachedBiases ?? rulesResults;
    });

  aiState.inFlight = batchPromise;
  return batchPromise;
}

async function persistBestEffort() {
  const canUseDb = await ensureTables();
  if (!canUseDb) return;

  try {
    const rows = memoryStore.sourceStatus.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.type,
      url: FUNDAMENTAL_SOURCES.find((c) => c.id === source.id)?.url ?? '',
      enabled: source.enabled,
      categories: source.categories,
      last_fetched_at: source.lastFetchedAt,
      last_status: source.status,
      last_error: source.lastError,
    }));
    await supabase.from('fundamental_sources').upsert(rows, { onConflict: 'id' });
  } catch (error) {
    logDbUnavailable(error);
  }

  // Persist per-symbol biases so they survive Render restarts.
  if (memoryStore.pairBiases.length) {
    try {
      const biasRows = memoryStore.pairBiases.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        bias: row.bias,
        confidence: row.confidence,
        impact: row.impact,
        trade_status: row.tradeStatus,
        reason: row.reason,
        key_drivers: row.keyDrivers,
        related_article_ids: row.relatedArticleIds,
        related_event_ids: row.relatedEventIds,
        updated_at: row.updatedAt,
      }));
      await supabase.from('pair_fundamental_biases').upsert(biasRows, { onConflict: 'id' });
    } catch (error) {
      logDbUnavailable(error);
    }
  }

  if (memoryStore.events.length) {
    try {
      const eventRows = memoryStore.events.map((event) => ({
        id: event.id,
        source: event.source,
        sourceUrl: event.sourceUrl,
        eventName: event.eventName,
        country: event.country,
        currency: event.currency,
        impact: event.impact.toUpperCase(),
        category: event.category,
        eventDate: event.date,
        eventLocalTime: event.time,
        eventDateTimeUtc: event.datetimeUtc,
        eventDateTimeLocal: event.datetimeLocal,
        timezone: event.timezone,
        previous: event.previous,
        forecast: event.forecast,
        actual: event.actual,
        eventTime: event.datetimeUtc,
        fetchedAt: event.fetchedAt,
        description: event.description,
        whyItMatters: event.whyItMatters,
        affectedSymbols: event.affectedSymbols,
        aiInterpretation: event.aiInterpretation,
        status: event.status,
        tradeWarning: event.tradeWarning.toUpperCase(),
        updatedAt: new Date().toISOString(),
      }));
      await supabase.from('economic_events').upsert(eventRows, { onConflict: 'id' });
    } catch (error) {
      logDbUnavailable(error);
    }
  }
}

function getMode(): 'rules-based' | 'ai-enhanced' {
  return process.env.OPENAI_API_KEY ? 'ai-enhanced' : 'rules-based';
}

function buildWarning(): string | null {
  const missingApiSources = memoryStore.sourceStatus.filter((source) => source.status === 'failed' && source.lastError?.includes('API key missing'));
  const fallbackSourceUsed = memoryStore.sourceStatus.some((source) => source.fallbackUsed);

  if (missingApiSources.length && memoryStore.articles.length) {
    return `${missingApiSources.map((source) => source.name).join(', ')} failed because API key is missing. RSS fallback loaded ${memoryStore.articles.length} articles.`;
  }
  if (!memoryStore.articles.length && !memoryStore.events.length) {
    return 'No sources returned data. Check internet connection, source config, or enable Playwright fallback.';
  }
  if (fallbackSourceUsed) {
    return 'Some sources failed, but fallback sources were used.';
  }
  return null;
}

function formatMadridTs(date: Date): string {
  return date.toLocaleString('en-GB', {
    timeZone: SCHEDULE_TZ,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }) + ` ${SCHEDULE_TZ}`;
}

export function setScheduleNextRun(nextRunAt: Date): void {
  memoryStore.scheduleMetadata.nextScheduledRun = formatMadridTs(nextRunAt);
}

export function getScheduleMetadata(): ScheduleMetadata {
  return { ...memoryStore.scheduleMetadata };
}

export async function refreshFundamentalsData(options?: {
  enablePlaywrightFallback?: boolean;
  triggeredBy?: ScheduleMetadata['triggeredBy'];
}) {
  memoryStore.lastErrors = [];
  memoryStore.lastWarning = null;

  const [rssArticles, apiArticles, politicalArticles, events] = await Promise.all([
    loadRssSources(),
    loadApiSources(),
    loadPoliticalAndCentralBankSources(),
    loadEconomicEvents(),
  ]);

  let articles = dedupeAndSortArticles([...rssArticles, ...apiArticles, ...politicalArticles]);
  if (articles.length > 0) {
    await loadPlaywrightFallback(false);
  } else {
    const fallbackArticles = await loadPlaywrightFallback(Boolean(options?.enablePlaywrightFallback));
    articles = dedupeAndSortArticles(fallbackArticles);
  }

  memoryStore.articles = articles.slice(0, 200);
  memoryStore.events = events.slice(0, 100);
  memoryStore.pairBiases = articles.length || events.length
    ? await runPairAnalysis(memoryStore.articles, memoryStore.events)
    : SUPPORTED_SYMBOLS.map(buildEmptyPair);
  const now = new Date();
  memoryStore.lastUpdated = now.toISOString();
  memoryStore.lastWarning = buildWarning();
  memoryStore.scheduleMetadata = {
    generatedAt: formatMadridTs(now),
    generatedTimezone: SCHEDULE_TZ,
    nextScheduledRun: memoryStore.scheduleMetadata.nextScheduledRun,
    triggeredBy: options?.triggeredBy ?? memoryStore.scheduleMetadata.triggeredBy ?? 'manual',
  };

  await persistBestEffort();

  return getFundamentalsOverview();
}

export async function fetchAndStoreNews(options?: { enablePlaywrightFallback?: boolean }) {
  const overview = await refreshFundamentalsData(options);
  return { stored: overview.latestNews.length };
}

export async function fetchAndStoreEconomicEvents() {
  memoryStore.events = await loadEconomicEvents();
  return { stored: memoryStore.events.length };
}

export async function runFundamentalAnalysis(symbols: string[] = SUPPORTED_SYMBOLS) {
  const filteredSymbols = new Set(symbols.map(normalizeFundamentalSymbol));
  const fresh = memoryStore.articles.length || memoryStore.events.length
    ? await runPairAnalysis(memoryStore.articles, memoryStore.events)
    : SUPPORTED_SYMBOLS.map(buildEmptyPair);

  // MERGE: update only the requested symbols, preserve others already in memory.
  // Replacing the whole array was wiping every other symbol whenever a single-symbol
  // on-demand analysis ran (e.g. cold page load for XAUUSD erased EURUSD, etc.).
  const updated = fresh.filter((row) => filteredSymbols.has(row.symbol));
  const kept = memoryStore.pairBiases.filter((row) => !filteredSymbols.has(row.symbol));
  memoryStore.pairBiases = [...kept, ...updated];

  return updated;
}

export function getFundamentalsOverview(): FundamentalsOverviewResponse {
  const now = Date.now();
  // Sync per-minute request counter so diagnostics reflect current window
  if (now - aiState.requestWindowStart > 60_000) {
    aiState.requestsThisMinute = 0;
    aiState.requestWindowStart = now;
  }

  const upcomingEvents = memoryStore.events
    .filter((event) => new Date(event.datetimeUtc).getTime() >= now)
    .sort((a, b) => +new Date(a.datetimeUtc) - +new Date(b.datetimeUtc))
    .slice(0, 30);
  const highImpactNext4Hours = upcomingEvents
    .filter((event) => event.impact === 'high' && new Date(event.datetimeUtc).getTime() <= now + (4 * 60 * 60 * 1000));

  return {
    pairs: memoryStore.pairBiases.length ? memoryStore.pairBiases : SUPPORTED_SYMBOLS.map(buildEmptyPair),
    latestNews: memoryStore.articles.slice(0, 50),
    upcomingEvents,
    highImpactNext4Hours,
    sourceStatus: memoryStore.sourceStatus,
    lastUpdated: memoryStore.lastUpdated,
    mode: getMode(),
    warning: memoryStore.lastWarning,
    errors: memoryStore.lastErrors,
    aiDiagnostics: {
      model: getFundamentalsAiModel(),
      cacheHit: aiState.cachedBiases != null && now < aiState.cacheExpiresAt,
      lastAiRefresh: aiState.lastAiRefresh,
      rateLimited: aiState.rateLimitedUntil != null && now < aiState.rateLimitedUntil,
      rateLimitRetryAfter: aiState.rateLimitRetryAfter,
      requestsThisMinute: aiState.requestsThisMinute,
    },
    scheduleMetadata: { ...memoryStore.scheduleMetadata },
  };
}

const NON_PAIR_SYMBOLS = new Set(['DXY', 'USOIL', 'NAS100', 'SPX500', 'US30', 'US100', 'GER40']);

function normalizeFundamentalSymbol(symbol: string): PairSymbol {
  const compact = symbol.replace('/', '').toUpperCase();
  if (NON_PAIR_SYMBOLS.has(compact)) return compact as PairSymbol;
  return `${compact.slice(0, 3)}/${compact.slice(3, 6)}` as PairSymbol;
}

export function getFundamentalsForSymbol(symbol: string): PairFundamentalsResponse {
  const normalized = normalizeFundamentalSymbol(symbol);
  const latestBias = memoryStore.pairBiases.find((row) => row.symbol === normalized) ?? buildEmptyPair(normalized);
  return {
    latestBias,
    biasHistory: memoryStore.pairBiases.filter((row) => row.symbol === normalized),
    relatedArticles: memoryStore.articles.filter((article) => article.affectedSymbols.includes(normalized)).slice(0, 20),
    relatedEvents: memoryStore.events.filter((event) => event.affectedSymbols.includes(normalized)).slice(0, 20),
  };
}

export function getFundamentalsNews() {
  return memoryStore.articles;
}

export function getFundamentalsEvents() {
  return memoryStore.events;
}

export function getFundamentalSourceStatus() {
  return memoryStore.sourceStatus;
}

export async function bootstrapFundamentals() {
  await ensureTables();
  if (!memoryStore.lastUpdated) {
    // Attempt to hydrate from DB so a Render restart doesn't serve empty data
    // until the next scheduled job run.
    try {
      const nowIso = new Date().toISOString();
      const { data: storedEvents } = await supabase
        .from('economic_events')
        .select('*')
        .gte('eventTime', new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString())
        .order('eventTime', { ascending: true });
      if (storedEvents && storedEvents.length > 0) {
        memoryStore.events = storedEvents
          .map((row) => enrichEconomicEvent({
            id: row.id,
            source: row.source,
            sourceUrl: row.sourceUrl ?? null,
            eventName: row.eventName,
            country: row.country ?? null,
            currency: row.currency ?? null,
            impact: String(row.impact).toLowerCase() as EconomicEventRow['impact'],
            category: (row.category as EconomicEventRow['category']) ?? categorizeEconomicEvent(row.eventName),
            previous: row.previous ?? null,
            forecast: row.forecast ?? null,
            actual: row.actual ?? null,
            affectedSymbols: Array.isArray(row.affectedSymbols) ? row.affectedSymbols as PairSymbol[] : [],
            tradeWarning: String(row.tradeWarning ?? 'wait').toLowerCase() as EconomicEventRow['tradeWarning'],
            rawData: null,
          }, {
            rawDateTime: row.eventTime,
            providerTimezone: 'UTC',
            now: new Date(nowIso),
          }))
          .filter((event): event is EconomicEventRow => Boolean(event));
      }

      const { data } = await supabase
        .from('pair_fundamental_biases')
        .select('*')
        .order('updated_at', { ascending: false });
      if (data && data.length > 0) {
        // Keep only the freshest row per symbol (the query orders by updated_at DESC).
        const seen = new Set<string>();
        const rows: PairBiasRow[] = [];
        for (const row of data) {
          if (!seen.has(row.symbol)) {
            seen.add(row.symbol);
            rows.push({
              id: row.id,
              symbol: row.symbol as PairSymbol,
              bias: row.bias as Bias,
              confidence: row.confidence,
              impact: row.impact as Impact,
              tradeStatus: row.trade_status as TradeStatus,
              reason: row.reason,
              keyDrivers: (row.key_drivers as string[]) ?? [],
              relatedArticleIds: (row.related_article_ids as string[]) ?? [],
              relatedEventIds: (row.related_event_ids as string[]) ?? [],
              updatedAt: row.updated_at,
            });
          }
        }
        if (rows.length > 0) {
          memoryStore.pairBiases = rows;
          memoryStore.lastUpdated = rows[0]?.updatedAt ?? null;
          console.info('[Fundamentals] Hydrated from DB', { symbols: rows.map((r) => r.symbol) });
          return;
        }
      }
    } catch (error) {
      console.warn('[Fundamentals] DB hydration failed (non-fatal):', error instanceof Error ? error.message : error);
    }
    memoryStore.pairBiases = SUPPORTED_SYMBOLS.map(buildEmptyPair);
  }
}
