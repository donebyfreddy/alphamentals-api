export type MacroCategory = 'monetary_policy' | 'inflation' | 'employment' | 'growth' | 'trade' | 'geopolitics' | 'other';
export type ImpactLevel = 'low' | 'medium' | 'high';

const SYMBOL_KEYWORDS: Record<string, string[]> = {
  'XAU/USD': ['gold', 'xau', 'bullion', 'precious metal', 'yellow metal', 'safe haven', 'aurum'],
  'EUR/USD': ['euro', 'eur', 'eurusd', 'ecb', 'european central bank', 'eurozone', 'euro area', 'lagarde', 'eu economy', 'euro/dollar'],
  'GBP/USD': ['pound', 'gbp', 'cable', 'sterling', 'boe', 'bank of england', 'uk economy', 'britain', 'british', 'bailey', 'gilts', 'uk inflation', 'uk gdp'],
  'USD/JPY': ['yen', 'jpy', 'usdjpy', 'boj', 'bank of japan', 'japan economy', 'ueda', 'nikkei'],
  'AUD/USD': ['aussie', 'aud', 'audusd', 'rba', 'reserve bank australia', 'australia'],
  'USD/CAD': ['loonie', 'cad', 'usdcad', 'boc', 'bank of canada', 'canada', 'canadian'],
  'USD/CHF': ['franc', 'chf', 'usdchf', 'snb', 'swiss national bank', 'switzerland'],
  'NZD/USD': ['kiwi', 'nzd', 'nzdusd', 'rbnz', 'new zealand'],
  'DXY': ['dxy', 'dollar index', 'us dollar', 'dollar strength', 'greenback', 'fed', 'federal reserve', 'fomc', 'powell', 'us monetary', 'treasury'],
  'USOIL': ['oil', 'crude', 'opec', 'wti', 'brent', 'petroleum', 'energy price', 'barrel', 'inventories', 'eia', 'api inventory'],
  'XAG/USD': ['silver', 'xag', 'precious metal'],
  'NAS100': ['nasdaq', 'nas100', 'tech stocks', 'technology shares'],
  'SPX500': ['s&p', 'sp500', 'spx', 'us stocks', 'equity'],
};

const CURRENCY_SYMBOL_MAP: Record<string, string[]> = {
  'USD': ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'DXY', 'USOIL', 'AUD/USD', 'NZD/USD', 'USD/CAD', 'USD/CHF'],
  'EUR': ['EUR/USD'],
  'GBP': ['GBP/USD'],
  'JPY': ['USD/JPY'],
  'AUD': ['AUD/USD'],
  'CAD': ['USD/CAD', 'USOIL'],
  'CHF': ['USD/CHF'],
  'NZD': ['NZD/USD'],
  'XAU': ['XAU/USD'],
  'XAG': ['XAG/USD'],
};

const HIGH_IMPACT_TERMS = [
  'fomc', 'federal reserve', 'fed decision', 'rate decision', 'rate hike', 'rate cut',
  'cpi', 'consumer price', 'inflation data', 'inflation report',
  'nfp', 'non-farm payroll', 'payrolls', 'jobs report',
  'ecb decision', 'boe decision', 'boj decision',
  'powell', 'lagarde', 'bailey',
  'gdp', 'gross domestic product',
];

const MEDIUM_IMPACT_TERMS = [
  'pmi', 'ism', 'retail sales', 'employment', 'jobless claims',
  'trade balance', 'current account', 'housing', 'durable goods',
  'treasury yield', 'bond yield', 'dollar', 'gold price', 'oil price',
  'opec', 'debt ceiling', 'fiscal', 'budget',
];

export function detectAffectedSymbols(input: {
  title?: string;
  eventName?: string;
  currency?: string;
  impact?: string;
}): string[] {
  const text = [input.title, input.eventName].filter(Boolean).join(' ').toLowerCase();
  const symbols = new Set<string>();

  // Currency-based detection (direct mapping)
  const cur = input.currency?.toUpperCase();
  if (cur && CURRENCY_SYMBOL_MAP[cur]) {
    for (const sym of CURRENCY_SYMBOL_MAP[cur]) symbols.add(sym);
  }

  // Keyword-based detection
  for (const [symbol, keywords] of Object.entries(SYMBOL_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) symbols.add(symbol);
  }

  // USD macro events affect DXY + major pairs
  if (/(fed|federal reserve|fomc|powell|cpi|nfp|payroll|jobless|inflation|gdp|treasury|yield|rate decision|rate hike|rate cut)/.test(text)) {
    symbols.add('DXY');
    symbols.add('XAU/USD');
    symbols.add('EUR/USD');
    symbols.add('GBP/USD');
  }

  // Geopolitical/safe haven events affect gold
  if (/(war|conflict|sanction|geopolit|tension|crisis|risk.?off|safe.?haven)/.test(text)) {
    symbols.add('XAU/USD');
  }

  // Oil events
  if (/(opec|crude|oil|petroleum|barrel|eia|wti|brent)/.test(text)) {
    symbols.add('USOIL');
  }

  return Array.from(symbols);
}

export function detectImpactLevel(input: {
  title?: string;
  currency?: string;
  impact?: string;
}): ImpactLevel {
  if (input.impact) {
    const i = input.impact.toLowerCase();
    if (i === 'high') return 'high';
    if (i === 'medium' || i === 'moderate') return 'medium';
    if (i === 'low') return 'low';
  }
  const text = (input.title ?? '').toLowerCase();
  if (HIGH_IMPACT_TERMS.some((t) => text.includes(t))) return 'high';
  if (MEDIUM_IMPACT_TERMS.some((t) => text.includes(t))) return 'medium';
  return 'low';
}

export function detectMacroCategories(input: {
  title?: string;
  summary?: string | null;
  contentSnippet?: string | null;
}): MacroCategory[] {
  const text = [input.title, input.summary, input.contentSnippet].filter(Boolean).join(' ').toLowerCase();
  const categories = new Set<MacroCategory>();

  if (/(fed|fomc|ecb|boe|boj|rate decision|interest rate|monetary policy|central bank|powell|lagarde|bailey|hawkish|dovish|taper|quantitative)/.test(text)) categories.add('monetary_policy');
  if (/(cpi|inflation|pce|price index|deflation|ppi|cost of living|price pressure)/.test(text)) categories.add('inflation');
  if (/(employment|payroll|nfp|jobless|unemployment|wage|labor|labour|hiring|jobs)/.test(text)) categories.add('employment');
  if (/(gdp|growth|pmi|ism|retail|consumer spending|output|production|recession|expansion)/.test(text)) categories.add('growth');
  if (/(trade|tariff|export|import|deficit|surplus|trade war|wto|sanction|embargo)/.test(text)) categories.add('trade');
  if (/(war|conflict|geopolit|sanction|tension|crisis|military|israel|russia|ukraine|china|taiwan|middle east)/.test(text)) categories.add('geopolitics');

  if (categories.size === 0) categories.add('other');
  return Array.from(categories);
}

export function generateMarketImpactExplanation(categories: MacroCategory[], symbols: string[]): string {
  if (!categories.length || !symbols.length) return '';
  const catLabels = categories.map((c) => c.replace('_', ' ')).join(', ');
  const symLabels = symbols.slice(0, 3).join(', ');
  return `${catLabels} data relevant to ${symLabels}`;
}
