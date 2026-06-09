export type BiasDirection = 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
export type BiasImpact = 'low' | 'medium' | 'high' | 'unknown';
export type BiasTradeStatus = 'safe' | 'wait' | 'avoid' | 'unknown';

export interface BiasResult {
  symbol: string;
  bias: BiasDirection;
  confidence: number;
  impact: BiasImpact;
  tradeStatus: BiasTradeStatus;
  reason: string;
  reasons: string[];
  keyDrivers: string[];
  articleIds: string[];
  eventIds: string[];
}

export interface BiasInput {
  symbol: string;
  articles?: unknown[];
  events?: unknown[];
  sourceStale?: boolean;
}

export function calculateRulesBasedBias(input: BiasInput): BiasResult {
  return {
    symbol: input.symbol,
    bias: 'neutral',
    confidence: 0,
    impact: 'unknown',
    tradeStatus: 'wait',
    reason: '',
    reasons: [],
    keyDrivers: [],
    articleIds: [],
    eventIds: [],
  };
}
