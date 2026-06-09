export interface TradeExecutionSettings {
  liveExecutionEnabled: boolean;
  maxRiskPercent: number;
  maxPositions: number;
  blockNewsMinutes: number;
  duplicateWindowMinutes: number;
  minRR: number;
}

export interface TradeExecutionPlan {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize?: number;
  riskPercent?: number;
  accountBalance?: number;
  settings: TradeExecutionSettings;
}

export interface TradeExecutionValidation {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
  rr: number | null;
  riskPercent: number | null;
}

export const DEFAULT_EXECUTION_SETTINGS: TradeExecutionSettings = {
  liveExecutionEnabled: false,
  maxRiskPercent: Number(process.env.TRADING_RISK_PERCENT ?? 1),
  maxPositions: 5,
  blockNewsMinutes: Number(process.env.TRADING_BLOCK_NEWS_MINUTES ?? 30),
  duplicateWindowMinutes: Number(process.env.TRADING_DUPLICATE_WINDOW_MINUTES ?? 180),
  minRR: Number(process.env.TRADING_MIN_RR ?? 2),
};

export function validateTradeExecutionPlan(
  _plan: TradeExecutionPlan,
  _settings?: Partial<TradeExecutionSettings>,
): TradeExecutionValidation {
  return { allowed: false, blockers: ['Live execution disabled'], warnings: [], rr: null, riskPercent: null };
}
