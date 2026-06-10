export interface FundamentalSourceConfig {
  id: string;
  name: string;
  type: 'rss' | 'api' | 'playwright' | 'manual';
  enabled: boolean;
  url?: string;
  categories: string[];
}

export const FUNDAMENTAL_SOURCES: FundamentalSourceConfig[] = [
  // ── Forex / macro news RSS ──────────────────────────────────────────────────
  {
    id: 'forexlive-rss',
    name: 'ForexLive',
    type: 'rss',
    enabled: true,
    url: 'https://www.forexlive.com/feed/',
    categories: ['forex', 'macro', 'central bank'],
  },
  {
    id: 'fxstreet-rss',
    name: 'FXStreet',
    type: 'rss',
    enabled: true,
    url: 'https://www.fxstreet.com/rss/news',
    categories: ['forex', 'analysis'],
  },
  {
    id: 'dailyfx-rss',
    name: 'DailyFX',
    type: 'rss',
    enabled: true,
    url: 'https://www.dailyfx.com/feeds/all',
    categories: ['forex', 'analysis'],
  },
  {
    id: 'marketwatch-rss',
    name: 'MarketWatch',
    type: 'rss',
    enabled: true,
    url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/',
    categories: ['macro', 'markets'],
  },
  // ── Gold / commodities RSS ──────────────────────────────────────────────────
  {
    id: 'kitco-gold-rss',
    name: 'Kitco Gold News',
    type: 'rss',
    enabled: true,
    url: 'https://www.kitco.com/rss/news.rss',
    categories: ['gold', 'commodities'],
  },
  {
    id: 'investing-gold-rss',
    name: 'Investing.com Gold',
    type: 'rss',
    enabled: true,
    url: 'https://www.investing.com/rss/news_301.rss',
    categories: ['gold', 'commodities'],
  },
  // ── Central bank / policy RSS ───────────────────────────────────────────────
  {
    id: 'fed-press-rss',
    name: 'Federal Reserve Press',
    type: 'rss',
    enabled: true,
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    categories: ['central bank', 'monetary policy'],
  },
  {
    id: 'ecb-press-rss',
    name: 'ECB Press',
    type: 'rss',
    enabled: true,
    url: 'https://www.ecb.europa.eu/rss/press.html',
    categories: ['central bank', 'monetary policy'],
  },
  // ── Macro / general market RSS ──────────────────────────────────────────────
  {
    id: 'reuters-business-rss',
    name: 'Reuters Business',
    type: 'rss',
    enabled: true,
    url: 'https://feeds.reuters.com/reuters/businessNews',
    categories: ['macro', 'politics', 'markets'],
  },
  // ── API sources (activated when key is present) ─────────────────────────────
  {
    id: 'fmp-forex-news',
    name: 'FMP Forex News',
    type: 'api',
    enabled: true,
    categories: ['forex', 'macro'],
  },
  // ── Manual economic events ──────────────────────────────────────────────────
  {
    id: 'manual-economic-events',
    name: 'Manual Economic Events',
    type: 'manual',
    enabled: true,
    categories: ['calendar'],
  },
  // ── Playwright fallback (disabled by default) ───────────────────────────────
  {
    id: 'playwright-fallback',
    name: 'Playwright Fallback',
    type: 'playwright',
    enabled: false,
    categories: ['fallback'],
  },
];
