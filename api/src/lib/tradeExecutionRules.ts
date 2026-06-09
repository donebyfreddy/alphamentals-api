export interface TradeExecutionSettings {
  liveExecutionEnabled: boolean;
  paperMode: boolean;
  maxRiskPercent: number;
  maxPositions: number;
  blockNewsMinutes: number;
  duplicateWindowMinutes: number;
  minRR: number;
}

export interface TradeExecutionPlan {
  symbol: string;
  direction: 'BUY' | 'SELL' | 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  orderType?: 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop' | 'market';
  lotSize?: number;
  riskPercent?: number;
  accountBalance?: number;
  userId: string;
  idempotencyKey: string;
  setupGrade?: string | null;
  setupName?: string | null;
  session?: string;
  notes?: string | null;
  playbookChecks?: Record<string, boolean>;
  override?: { requested?: boolean; reason?: string | null };
  account?: { id?: string | null; metaApiAccountId?: string; balance?: number; equity?: number; currency?: string; status?: string } | null;
  marketGate?: {
    isMetaApiConnected: boolean;
    isBrokerHealthy: boolean;
    isMarketOpen?: boolean;
    [key: string]: unknown;
  };
  settings: TradeExecutionSettings;
}

export interface TradeExecutionValidation {
  allowed: boolean;
  blockers: string[];
  blockingReasons: string[];
  warnings: string[];
  overrideableWarnings: string[];
  tradeHealthScore: number;
  rr: number | null;
  riskPercent: number | null;
  risk: { finalLotSize: number; [key: string]: unknown };
}

export const DEFAULT_EXECUTION_SETTINGS: TradeExecutionSettings = {
  liveExecutionEnabled: false,
  paperMode: true,
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
  return {
    allowed: false,
    blockers: ['Live execution disabled'],
    blockingReasons: ['Live execution disabled'],
    warnings: [],
    overrideableWarnings: [],
    tradeHealthScore: 0,
    rr: null,
    riskPercent: null,
    risk: { finalLotSize: 0.01 },
  };
}
