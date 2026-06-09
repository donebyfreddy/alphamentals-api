export const ALLOWED_TRADINGVIEW_SYMBOLS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USOIL', 'WTI', 'DXY', 'BTCUSD', 'US30'] as const;

export type TradingviewSymbol = (typeof ALLOWED_TRADINGVIEW_SYMBOLS)[number];
export type TradingSignalType = 'setup_detected' | 'important_zone' | 'price_zone_reached';
export type TradingDecision = 'BUY' | 'SELL' | 'NO_TRADE';

export type RawTradingviewPayload = {
  secret?: string;
  symbol?: string;
  timeframe?: string;
  signal?: string;
  strategy?: string;
  message?: string;
  exchange?: string;
  price?: string | number;
  time?: string | number;
  signal_type?: string;
  direction_hint?: string;
  trend?: string;
  ema50?: string | number;
  ema200?: string | number;
  rsi?: string | number;
  atr?: string | number;
  support?: string | number;
  resistance?: string | number;
  liquidity_event?: string;
  structure?: string;
  candle_pattern?: string;
  session?: string;
  market_structure?: string;
  fair_value_gap?: string;
  note?: string;
};

export type ParsedTradingviewAlert = {
  receivedAt: string;
  secret: string;
  symbol: TradingviewSymbol;
  originalSymbol: string;
  timeframe: string;
  signal: string | null;
  strategy: string | null;
  message: string | null;
  exchange: string;
  price: number;
  eventTimeIso: string;
  signalType: TradingSignalType;
  directionHint: 'buy' | 'sell' | 'neutral';
  trend: 'bullish' | 'bearish' | 'ranging';
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  atr: number | null;
  support: number | null;
  resistance: number | null;
  liquidityEvent: 'sweep_high' | 'sweep_low' | 'none';
  structure: 'BOS_up' | 'BOS_down' | 'CHoCH_up' | 'CHoCH_down' | 'none';
  candlePattern: 'bullish_engulfing' | 'bearish_engulfing' | 'pin_bar' | 'bullish_pin_bar' | 'bearish_pin_bar' | 'none';
  session: string | null;
  marketStructure: string | null;
  fairValueGap: string | null;
  note: string | null;
  fingerprint: string;
};

export type CorrelatedSnapshot = {
  key: 'dxy' | 'gold' | 'wti' | 'us10y' | 'us02y';
  label: string;
  symbol: string;
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  trend: 'up' | 'down' | 'flat' | 'unknown';
  available: boolean;
  asOf: string | null;
  note?: string;
};

export type UpcomingUsdEvent = {
  title: string;
  impact: 'low' | 'medium' | 'high';
  currency: string;
  startsAt: string;
  minutesUntil: number;
};

export type TradingContext = {
  sessionLabel: string;
  correlatedMarkets: {
    dxy: CorrelatedSnapshot;
    gold: CorrelatedSnapshot;
    wti: CorrelatedSnapshot;
    us10y: CorrelatedSnapshot;
    us02y: CorrelatedSnapshot;
  };
  macroNotes: string[];
  upcomingUsdNews: UpcomingUsdEvent[];
  dataWarnings: string[];
};

export type TradePlan = {
  decision: TradingDecision;
  symbol: TradingviewSymbol;
  timeframe: string;
  confidence: number;
  entry_zone: {
    low: number;
    high: number;
  };
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  risk_reward: string;
  position_size_note: string;
  reasoning: string[];
  invalid_if: string[];
  warnings: string[];
  bias?: 'bullish' | 'bearish' | 'neutral';
  risk_amount?: number;
  position_size_formula?: string;
};

export type TradingviewAlertRecord = {
  id: string;
  fingerprint: string;
  status: 'received' | 'processed' | 'duplicate' | 'failed';
  symbol: TradingviewSymbol;
  timeframe: string;
  receivedAt: string;
  alert: ParsedTradingviewAlert;
  context: TradingContext | null;
  analysis: TradePlan | null;
  notifications: Array<{ channel: string; delivered: boolean; detail: string }>;
  response: Record<string, unknown> | null;
  error: string | null;
};
