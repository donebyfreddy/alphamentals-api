import Parser from 'rss-parser';
import type { Impact, NewsArticle } from '../../types/marketIntelligence.js';
import { getCachedValue, setCachedValue } from './cacheStore.service.js';
import { listSourceStatuses, setSourceStatus } from './sourceRegistry.service.js';
import { OpenAIExtractionService } from './openaiExtraction.service.js';
import { PlaywrightScraperService } from './playwrightScraper.service.js';

const parser = new Parser();
const openAI = new OpenAIExtractionService();
const scraper = new PlaywrightScraperService();

type FeedSource = {
  id: string;
  name: string;
  url: string;
};

const FEED_SOURCES: FeedSource[] = [
  { id: 'fxstreet', name: 'FXStreet', url: 'https://www.fxstreet.com/rss/news' },
  { id: 'kitco', name: 'Kitco', url: 'https://www.kitco.com/rss/news.rss' },
  { id: 'marketwatch', name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/' },
  { id: 'dailyfx', name: 'DailyFX', url: 'https://www.dailyfx.com/feeds/all' },
  { id: 'reuters', name: 'Reuters', url: 'https://feeds.reuters.com/reuters/businessNews' },
];

function envTrue(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function makeId(raw: string): string {
  return `news_${Buffer.from(raw).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`;
}

function inferFallbackClassification(text: string): Pick<NewsArticle, 'symbols' | 'currencies' | 'impact' | 'sentiment' | 'category' | 'aiRelevanceScore'> {
  const lower = text.toLowerCase();
  const symbols = new Set<string>();
  const currencies = new Set<string>();

  if (/(gold|xau|bullion)/.test(lower)) {
    symbols.add('XAUUSD');
    currencies.add('XAU');
  }
  if (/(dollar|fed|cpi|nfp|yields|treasury|usd)/.test(lower)) {
    currencies.add('USD');
    symbols.add('EURUSD');
    symbols.add('GBPUSD');
    symbols.add('USDJPY');
    symbols.add('XAUUSD');
  }
  if (/(ecb|euro|eur)/.test(lower)) {
    currencies.add('EUR');
    symbols.add('EURUSD');
  }
  if (/(boe|pound|sterling|gbp)/.test(lower)) {
    currencies.add('GBP');
    symbols.add('GBPUSD');
  }
  if (/(boj|yen|jpy)/.test(lower)) {
    currencies.add('JPY');
    symbols.add('USDJPY');
  }
  if (/(bitcoin|btc|crypto)/.test(lower)) {
    currencies.add('BTC');
    symbols.add('BTCUSD');
  }
  if (/(nasdaq|nas100|tech stocks)/.test(lower)) symbols.add('NAS100');
  if (/(dow|us30)/.test(lower)) symbols.add('US30');

  let impact: Impact = 'low';
  if (/(breaking|fed|cpi|nfp|rate decision|powell|ecb|boj|boe|inflation)/.test(lower)) impact = 'high';
  else if (/(gold|yields|treasury|risk|geopolitical|jobs)/.test(lower)) impact = 'medium';

  let sentiment = 'neutral';
  if (/(rally|surge|rise|strong|beat|optimism|support)/.test(lower)) sentiment = 'bullish';
  else if (/(drop|fall|weak|miss|pressure|concern|risk-off)/.test(lower)) sentiment = 'bearish';

  let category = 'macro';
  if (/(gold|bullion)/.test(lower)) category = 'commodities';
  else if (/(fed|ecb|boj|boe|rate)/.test(lower)) category = 'central-bank';
  else if (/(bitcoin|btc|crypto)/.test(lower)) category = 'crypto';
  else if (/(stocks|nasdaq|dow|equit)/.test(lower)) category = 'equities';

  return {
    symbols: Array.from(symbols),
    currencies: Array.from(currencies),
    impact,
    sentiment,
    category,
    aiRelevanceScore: impact === 'high' ? 0.85 : impact === 'medium' ? 0.65 : 0.35,
  };
}

async function classifyArticle(article: NewsArticle): Promise<NewsArticle> {
  const cacheKey = `news-classification:${article.id}`;
  const cached = await getCachedValue<NewsArticle>(cacheKey);
  if (cached) return cached;

  try {
    const classified = await openAI.classifyNewsArticle(article);
    setSourceStatus('openai-news', {
      active: true,
      lastFetch: new Date().toISOString(),
      items: Math.max(1, listSourceStatuses().find((item) => item.id === 'openai-news')?.items ?? 0),
      error: null,
    });
    const normalized = {
      ...article,
      symbols: classified.symbols,
      currencies: classified.currencies,
      impact: classified.impact,
      sentiment: classified.sentiment,
      category: classified.category,
      aiRelevanceScore: classified.relevanceScore,
      summary: classified.summary || article.summary,
    };
    await setCachedValue(cacheKey, normalized, 24 * 60 * 60 * 1000);
    return normalized;
  } catch (error) {
    const fallback = inferFallbackClassification(`${article.title} ${article.summary}`);
    setSourceStatus('openai-news', {
      active: false,
      lastFetch: new Date().toISOString(),
      items: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...article, ...fallback };
  }
}

function dedupeArticles(articles: NewsArticle[]): NewsArticle[] {
  const map = new Map<string, NewsArticle>();
  for (const article of articles) {
    const key = article.url || article.title.toLowerCase();
    if (!map.has(key)) map.set(key, article);
  }
  return Array.from(map.values()).sort((a, b) => {
    const left = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const right = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return right - left;
  });
}

async function fetchFeed(source: FeedSource): Promise<NewsArticle[]> {
  const feed = await parser.parseURL(source.url);
  const now = Date.now();
  const recentItems = (feed.items ?? []).filter((item) => {
    const published = new Date(item.isoDate ?? item.pubDate ?? now).getTime();
    return now - published <= 7 * 24 * 60 * 60 * 1000;
  });

  const articles = recentItems.map((item) => ({
    id: makeId(item.link ?? `${source.id}:${item.title}`),
    source: source.id,
    title: item.title?.trim() || 'Untitled article',
    summary: (item.contentSnippet ?? item.content ?? item.summary ?? item.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
    url: item.link?.trim() || source.url,
    publishedAt: item.isoDate ?? item.pubDate ?? null,
    symbols: [],
    currencies: [],
    impact: 'low' as const,
    sentiment: 'neutral',
    category: 'macro',
    aiRelevanceScore: 0.35,
  }));

  setSourceStatus(source.id, {
    active: articles.length > 0,
    lastFetch: new Date().toISOString(),
    items: articles.length,
    error: articles.length ? null : 'No valid items returned',
  });
  return articles;
}

async function fetchInvestingFallback(): Promise<NewsArticle[]> {
  console.info('[news] source fetch started: Investing.com');
  try {
    const scraped = await scraper.scrapePage('https://www.investing.com/news/forex-news');
    const nowIso = new Date().toISOString();
    const articles = scraped.links
      .filter((link) => /investing\.com\/news\//i.test(link.href) && link.text.length > 20)
      .slice(0, 12)
      .map((link) => ({
        id: makeId(link.href),
        source: 'investing',
        title: link.text,
        summary: `${link.text}. Extracted from Investing.com via Playwright fallback.`,
        url: link.href,
        publishedAt: scraped.timestamps[0] ?? nowIso,
        symbols: [],
        currencies: [],
        impact: 'medium' as const,
        sentiment: 'neutral',
        category: 'macro',
        aiRelevanceScore: 0.5,
      }));

    setSourceStatus('investing', {
      active: articles.length > 0,
      lastFetch: nowIso,
      items: articles.length,
      error: articles.length ? null : 'No valid items returned',
    });
    console.info(`[news] source fetch completed: Investing.com -> ${articles.length} items`);
    return articles;
  } catch (error) {
    setSourceStatus('investing', {
      active: false,
      lastFetch: new Date().toISOString(),
      items: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    console.warn('[news] source error: Investing.com ->', error instanceof Error ? error.message : String(error));
    return [];
  }
}

export async function fetchNormalizedNews(): Promise<NewsArticle[]> {
  const ttlMinutes = Number(process.env.NEWS_CACHE_TTL_MINUTES ?? process.env.CACHE_TTL_MINUTES ?? '10');
  const cached = await getCachedValue<NewsArticle[]>('market-news');
  if (cached) return cached;

  const enabled = envTrue(process.env.NEWS_ENABLED, true);
  if (!enabled) {
    return [];
  }

  const rawResults = await Promise.all(FEED_SOURCES.map(async (source) => {
    console.info(`[news] source fetch started: ${source.name}`);
    try {
      const items = await fetchFeed(source);
      console.info(`[news] source fetch completed: ${source.name} -> ${items.length} items`);
      return items;
    } catch (error) {
      setSourceStatus(source.id, {
        active: false,
        lastFetch: new Date().toISOString(),
        items: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn(`[news] source error: ${source.name} ->`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }));

  const investingArticles = await fetchInvestingFallback();
  const combined = dedupeArticles([...rawResults.flat(), ...investingArticles]).slice(0, 40);
  const aiLimit = Math.min(combined.length, 12);
  const classified = await Promise.all(combined.map((article, index) => (index < aiLimit ? classifyArticle(article) : Promise.resolve({
    ...article,
    ...inferFallbackClassification(`${article.title} ${article.summary}`),
  }))));

  await setCachedValue('market-news', classified, ttlMinutes * 60 * 1000);
  return classified;
}
