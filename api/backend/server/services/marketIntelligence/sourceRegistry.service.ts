import type { SourceStatus } from '../../types/marketIntelligence.js';

const DEFAULT_SOURCES: SourceStatus[] = [
  { id: 'myfxbook', name: 'Myfxbook Economic Calendar', category: 'calendar', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'calendar-playwright', name: 'Public Economic Calendar Scraper', category: 'calendar', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'calendar-manual', name: 'Manual Economic Calendar Fallback', category: 'calendar', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'fxstreet', name: 'FXStreet RSS', category: 'news', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'kitco', name: 'Kitco Gold RSS', category: 'news', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'marketwatch', name: 'MarketWatch RSS', category: 'news', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'dailyfx', name: 'DailyFX RSS', category: 'news', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'reuters', name: 'Reuters RSS', category: 'news', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'investing', name: 'Investing.com Scraper', category: 'news', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'openai-news', name: 'OpenAI News Classifier', category: 'fundamentals', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'openai-fundamentals', name: 'OpenAI Fundamental Analysis', category: 'fundamentals', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
  { id: 'rules-fundamentals', name: 'Rules-Based Fundamental Fallback', category: 'fundamentals', active: false, lastFetch: null, items: 0, error: 'Not fetched yet' },
];

const sources = new Map(DEFAULT_SOURCES.map((source) => [source.id, { ...source }]));

export function listSourceStatuses(): SourceStatus[] {
  return DEFAULT_SOURCES.map((source) => ({ ...sources.get(source.id)! }));
}

export function setSourceStatus(id: string, patch: Partial<SourceStatus>): void {
  const current = sources.get(id);
  if (!current) return;
  sources.set(id, { ...current, ...patch });
}

export function resetSourceStatuses(): void {
  for (const source of DEFAULT_SOURCES) {
    sources.set(source.id, { ...source });
  }
}
