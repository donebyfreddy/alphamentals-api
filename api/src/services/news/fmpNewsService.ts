export type NewsSentiment = 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
export type NewsImpact = 'low' | 'medium' | 'high' | 'unknown';

export interface NormalizedNewsArticle {
  id: string;
  title: string;
  summary: string;
  contentSnippet: string | null;
  url: string;
  publishedAt: string;
  fetchedAt: string;
  source: string;
  sourceType: 'api' | 'rss' | 'playwright';
  affectedSymbols: string[];
  affectedCurrencies: string[];
  impact: NewsImpact;
  sentiment: NewsSentiment;
  tickers?: string[];
  rawData?: Record<string, unknown> | null;
}

export async function fetchForexNews(_symbols?: string[]): Promise<NormalizedNewsArticle[]> {
  return [];
}

export async function fetchGeneralMarketNews(): Promise<NormalizedNewsArticle[]> {
  return [];
}
