export type NewsItemSentiment = 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
export type NewsItemImpact = 'low' | 'medium' | 'high' | 'unknown';

export interface LatestNewsItem {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  contentSnippet: string | null;
  impact: NewsItemImpact;
  sentiment: NewsItemSentiment;
  affectedCurrencies: string[];
  affectedSymbols: string[];
  aiSummary: string | null;
  publishedAt: string;
}

export interface TechnicalSummaryResult {
  trend: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  timeframe: '1D';
  summary: string;
}

export function buildTechnicalSummary(_input: {
  symbol?: string;
  currentPrice?: number | null;
  previousClose?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  fundamentalBias?: string;
}): TechnicalSummaryResult {
  return { trend: 'unknown', timeframe: '1D', summary: '' };
}

export function buildFundamentalSummary(_input: {
  symbol?: string;
  bias?: string;
  reason?: string;
  currentPrice?: number | null;
  dailyChangePercent?: number | null;
  technicalTrend?: string;
}): string {
  return '';
}

export function getCentralBankDriversForSymbol(_symbol: string, _data?: unknown): string[] {
  return [];
}

export function getLatestNewsForSymbol(_symbol: string, _allNews?: unknown): LatestNewsItem[] {
  return [];
}

export function getPoliticalDriversForSymbol(_symbol: string, _data?: unknown): string[] {
  return [];
}

export function inferBullishBearishDrivers(
  _symbol: string,
  _data?: unknown,
): { bullishDrivers: string[]; bearishDrivers: string[] } {
  return { bullishDrivers: [], bearishDrivers: [] };
}
