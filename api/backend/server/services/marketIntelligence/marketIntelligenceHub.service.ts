import type {
  EconomicEvent,
  FundamentalAnalysisResponse,
  NewsArticle,
  SourceStatus,
} from '../../types/marketIntelligence.js';
import { clearCachedValue } from './cacheStore.service.js';
import { fetchNormalizedCalendar } from './economicCalendar.service.js';
import { generateFundamentalAnalysis } from './fundamentalAnalysis.service.js';
import { fetchNormalizedNews } from './rssNews.service.js';
import { listSourceStatuses } from './sourceRegistry.service.js';

let bootstrapPromise: Promise<void> | null = null;

export async function getCalendarPayload(): Promise<{
  events: EconomicEvent[];
  sources: SourceStatus[];
  generatedAt: string;
}> {
  const events = await fetchNormalizedCalendar().catch((error) => {
    console.warn('[market-intelligence] calendar fetch failed:', error instanceof Error ? error.message : String(error));
    return [];
  });
  return {
    events,
    sources: listSourceStatuses(),
    generatedAt: new Date().toISOString(),
  };
}

export async function getNewsPayload(): Promise<{
  articles: NewsArticle[];
  sources: SourceStatus[];
  generatedAt: string;
}> {
  const articles = await fetchNormalizedNews().catch((error) => {
    console.warn('[market-intelligence] news fetch failed:', error instanceof Error ? error.message : String(error));
    return [];
  });
  return {
    articles,
    sources: listSourceStatuses(),
    generatedAt: new Date().toISOString(),
  };
}

export async function getFundamentalsPayload(): Promise<FundamentalAnalysisResponse> {
  const [calendar, news] = await Promise.all([
    fetchNormalizedCalendar().catch(() => []),
    fetchNormalizedNews().catch(() => []),
  ]);
  const fundamentals = await generateFundamentalAnalysis(news, calendar);
  return {
    ...fundamentals,
    sources: listSourceStatuses(),
    generatedAt: new Date().toISOString(),
  };
}

export async function getHealthPayload(): Promise<{
  ok: true;
  time: string;
  sourcesActive: number;
  sourcesTotal: number;
}> {
  await bootstrapMarketIntelligence();
  const sources = listSourceStatuses();
  return {
    ok: true,
    time: new Date().toISOString(),
    sourcesActive: sources.filter((source) => source.active).length,
    sourcesTotal: sources.length,
  };
}

export function getSourcesStatusPayload(): { sources: SourceStatus[] } {
  return { sources: listSourceStatuses() };
}

export async function refreshMarketIntelligence(): Promise<{
  ok: true;
  refreshed: {
    calendar: number;
    news: number;
    fundamentals: number;
  };
  generatedAt: string;
  sources: SourceStatus[];
}> {
  await Promise.all([
    clearCachedValue('economic-calendar'),
    clearCachedValue('market-news'),
    clearCachedValue('fundamental-analysis'),
  ]);

  const [calendar, news, fundamentals] = await Promise.all([
    fetchNormalizedCalendar().catch(() => []),
    fetchNormalizedNews().catch(() => []),
    (async () => {
      const calendarNow = await fetchNormalizedCalendar().catch(() => []);
      const newsNow = await fetchNormalizedNews().catch(() => []);
      return generateFundamentalAnalysis(newsNow, calendarNow);
    })(),
  ]);

  return {
    ok: true,
    refreshed: {
      calendar: calendar.length,
      news: news.length,
      fundamentals: fundamentals.analysis.length,
    },
    generatedAt: new Date().toISOString(),
    sources: listSourceStatuses(),
  };
}

export async function bootstrapMarketIntelligence(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    console.info('[market-intelligence] env loaded');
    console.info('[market-intelligence] Myfxbook credentials detected:', Boolean(process.env.MYFXBOOK_EMAIL && process.env.MYFXBOOK_PASSWORD));
    await Promise.all([
      fetchNormalizedCalendar().catch(() => []),
      fetchNormalizedNews().catch(() => []),
    ]);
  })().finally(() => {
    bootstrapPromise = null;
  });
  return bootstrapPromise;
}
