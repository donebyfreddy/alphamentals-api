export interface CorrelationSignal {
  relatedSymbol: string;
  relationship: string;
  status: 'confirmed' | 'neutral' | 'diverging' | 'high_conflict';
  confidenceDelta: number;
  explanation: string;
}

export interface MacroCorrelationContext {
  symbol: string;
  signals: CorrelationSignal[];
  totalConfidenceDelta: number;
  macroSummary: string;
  correlations: Array<{ symbol: string; correlation: number; description: string }>;
}

export function getCorrelatedSymbols(_symbol: string): string[] {
  return [];
}

export function buildCorrelationContext(
  symbol: string,
  _bias?: string,
  _entries?: unknown[],
): MacroCorrelationContext {
  return { symbol, signals: [], totalConfidenceDelta: 0, macroSummary: '', correlations: [] };
}
