export type TradeStatus = 'safe' | 'caution' | 'avoid' | 'news_risk' | 'high_risk' | 'wait';

export interface TradeStatusResult {
  status: TradeStatus;
  label: string;
  reason: string;
}

export interface TradeStatusInput {
  overallBias?: string;
  technicalBias?: string;
  fundamentalBias?: string;
  marketStatus?: string;
  priceStaleMinutes?: number | null;
  highImpactWithinMinutes?: number | null;
  overallConfidence?: number | null;
}

export function calculateTradeStatus(_input: TradeStatusInput): TradeStatusResult {
  return { status: 'safe', label: 'Safe to trade', reason: '' };
}
