export type TradeWarningStatus = 'safe' | 'caution' | 'avoid' | 'wait';

export interface TradeWarningInput {
  bias?: string;
  confidence?: number;
  impact?: string;
  events?: { impact?: string; eventTime?: string }[];
}

export function deriveTradeStatus(_input: TradeWarningInput): TradeWarningStatus {
  return 'safe';
}
