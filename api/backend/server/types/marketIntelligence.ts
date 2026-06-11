export type Impact = 'low' | 'medium' | 'high';
export type Bias = 'bullish' | 'bearish' | 'neutral' | 'mixed';
export type SourceCategory = 'calendar' | 'news' | 'fundamentals';

export interface SourceStatus {
  id: string;
  name: string;
  category: SourceCategory;
  active: boolean;
  lastFetch: string | null;
  items: number;
  error: string | null;
}

export interface EconomicEvent {
  id: string;
  source: string;
  title: string;
  country?: string;
  currency: string;
  impact: Impact;
  date: string;
  time?: string;
  datetime?: string;
  actual?: string | null;
  forecast?: string | null;
  previous?: string | null;
  unit?: string | null;
  url?: string | null;
  aiSummary?: string;
  tradingContext?: {
    affectedSymbols: string[];
    riskWindowMinutes: number;
    bias: Bias;
    reason: string;
  };
}

export interface NewsArticle {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string | null;
  symbols: string[];
  currencies: string[];
  impact: Impact;
  sentiment: string;
  category: string;
  aiRelevanceScore: number;
}

export interface FundamentalAnalysisItem {
  asset: string;
  bias: Bias;
  confidence: number;
  summary: string;
  drivers: string[];
  risks: string[];
  timeframe: 'intraday' | 'swing';
  updatedAt: string;
}

export interface FundamentalAnalysisResponse {
  analysis: FundamentalAnalysisItem[];
  globalMacro: {
    usdBias: Bias;
    riskSentiment: 'risk-on' | 'risk-off' | 'mixed';
    goldBias: Bias;
  };
  sources: SourceStatus[];
  generatedAt: string;
}
