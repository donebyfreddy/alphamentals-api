export type MacroCategory = 'monetary_policy' | 'inflation' | 'employment' | 'growth' | 'trade' | 'geopolitics' | 'other';
export type ImpactLevel = 'low' | 'medium' | 'high';

export function detectAffectedSymbols(_input: {
  title?: string;
  eventName?: string;
  currency?: string;
  impact?: string;
}): string[] {
  return [];
}

export function detectImpactLevel(_input: {
  title?: string;
  currency?: string;
  impact?: string;
}): ImpactLevel {
  return 'low';
}

export function detectMacroCategories(_input: {
  title?: string;
  summary?: string | null;
  contentSnippet?: string | null;
}): MacroCategory[] {
  return ['other'];
}

export function generateMarketImpactExplanation(
  _categories: MacroCategory[],
  _symbols: string[],
): string {
  return '';
}
