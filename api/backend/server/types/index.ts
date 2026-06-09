// Shared server-side types

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface DateRangeQuery {
  from?: string;
  to?: string;
}

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface PerformanceStats {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  breakEvenCount: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  avgRR: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  bestTrade: number;
  worstTrade: number;
  avgHoldTime: number; // minutes
}

export interface EquityCurvePoint {
  date: string;
  equity: number;
  drawdown: number;
  tradeCount: number;
}

export interface HeatmapCell {
  label: string;
  value: number;
  count: number;
  winRate: number;
}

export interface MistakeBreakdown {
  tag: string;
  count: number;
  pnlImpact: number;
  avgScore: number;
}

export interface SetupPerformance {
  setup: string;
  trades: number;
  winRate: number;
  avgRR: number;
  expectancy: number;
  profitFactor: number;
}

export interface PsychologyCorrelation {
  emotion: string;
  avgScore: number;
  winRate: number;
  count: number;
  avgPnl: number;
  phase?: 'pre' | 'during' | 'post';
}

export interface SetupQualityPerformance {
  grade: string;
  trades: number;
  winRate: number;
  pnl: number;
  avgRR: number;
  avgDiscipline: number;
  avgPsychology: number;
}

export interface MistakeCost {
  tag: string;
  count: number;
  totalCost: number;
  winRate: number;
  avgPnl: number;
}

export interface DisciplineStats {
  followedPlan: { trades: number; winRate: number; pnl: number };
  brokePlan: { trades: number; winRate: number; pnl: number };
  highBlueprint: { trades: number; winRate: number; pnl: number };
  lowBlueprint: { trades: number; winRate: number; pnl: number };
  mostBrokenRule: string | null;
}

export interface RiskFlagStats {
  missingStopLoss: { count: number; pnl: number };
  poorRR: { count: number; pnl: number };
  movedStop: { count: number; pnl: number };
  overLeveraged: { count: number; pnl: number };
  riskAbovePlan: { count: number; pnl: number };
  totalLostToRiskIssues: number;
}

export interface TimeOfDayCell {
  hour: number;
  label: string;
  value: number;
  count: number;
  winRate: number;
}
