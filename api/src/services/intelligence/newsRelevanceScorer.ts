export type ScoredArticleBiasImpact = 'bullish' | 'bearish' | 'neutral';
export type NewsImpactSummary = {
  direction: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  percentage: number;
  summary: string;
};

export interface ScoredArticle<T = unknown> {
  article: T;
  relevanceScore: number;
  biasImpact: ScoredArticleBiasImpact | null;
  whyItMatters: string;
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
}

export function scoreNewsRelevanceForPair<T>(_articles: T[], _symbol: string): ScoredArticle<T>[] {
  return [];
}

export function summarizeNewsImpact(_articles: ScoredArticle[]): NewsImpactSummary {
  return { direction: 'neutral', percentage: 0, summary: '' };
}
