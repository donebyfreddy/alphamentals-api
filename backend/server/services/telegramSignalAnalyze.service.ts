import { chatCompleteJSON } from '../lib/gemini.js';
import { parseTelegramSignal, type ParsedTelegramSignal } from '../../../src/utils/telegram/parseTelegramSignal.js';
import { getPairDecisionContext, type PairDecisionContext } from './pairDecisionContext.service.js';

export type SignalVerdict = 'GOOD' | 'RISKY' | 'BAD' | 'WAIT';
export type AlignmentLabel = 'aligned' | 'against' | 'mixed' | 'unavailable';
export type RRLabel = 'good' | 'weak' | 'invalid';
export type FinalAction = 'take' | 'wait' | 'avoid' | 'monitor';
export type TrendLabel = 'bullish' | 'bearish' | 'mixed' | 'unknown';
export type SpreadStatus = 'normal' | 'elevated' | 'high' | 'unavailable';
export type VolatilityLabel = 'low' | 'normal' | 'high' | 'extreme' | 'unavailable';
export type DecisionLabel = 'ACCEPTED' | 'REJECTED' | 'WAIT' | 'NEEDS_CONFIRMATION';
export type RejectionCategory =
  | 'NONE'
  | 'INVALID_ORDER_TYPE'
  | 'ALREADY_INVALIDATED'
  | 'STALE_SIGNAL'
  | 'MACRO_CONFLICT'
  | 'TECHNICAL_CONFLICT'
  | 'POOR_RR'
  | 'BAD_EXECUTION_CONDITIONS'
  | 'INSUFFICIENT_DATA';

export interface SignalRrTarget {
  targetIndex: number;
  price: number;
  reward: number;
  ratio: number;
}

export interface SignalRR {
  risk: number;
  targets: SignalRrTarget[];
  tp1Reward: number | null;
  tp1Ratio: number | null;
  tp2Reward: number | null;
  tp2Ratio: number | null;
  tp3Reward: number | null;
  tp3Ratio: number | null;
}

export interface TelegramTradeValidationResult {
  ok: true;
  symbol: string;
  verdict: SignalVerdict;
  decisionLabel: DecisionLabel;
  rejectionCategory: RejectionCategory;
  tradeQualityScore: number;
  executionValidityScore: number;
  aiVerdictConfidence: number;
  rejectionConfidence: number;
  primaryReason: string;
  summary: string;
  reasoning: string;
  fundamentalAlignment: AlignmentLabel;
  technicalAlignment: AlignmentLabel;
  riskRewardAssessment: string;
  entryAssessment: string;
  slAssessment: string;
  tpAssessment: string;
  keyReasons: string[];
  keyRisks: string[];
  confirmationNeeded: string[];
  invalidation: string[];
  finalAction: FinalAction;
  recommendedAction: FinalAction;
  macroBias: string;
  calendarRisk: string;
  parsedSignal: {
    symbol: string;
    direction: string;
    orderType: string | null;
    entry: number | null;
    sl: number | null;
    tps: number[];
  };
  rr: SignalRR | null;
  technicalContext: {
    currentPrice: number | null;
    trend: TrendLabel;
    session: string;
    nextSession: string | null;
    support: number | null;
    resistance: number | null;
    sma20: number | null;
    sma50: number | null;
    marketStructure?: string | null;
    technicalScore?: number | null;
    spread?: number | null;
    spreadStatus?: SpreadStatus;
    atr?: number | null;
    volatility?: VolatilityLabel;
    technicalAlignment: AlignmentLabel;
    source: string;
    sourcePath: string;
    lastUpdated: string | null;
    entryLocationQuality: string;
    liquidityContext: string;
    confirmationNeeded: string[];
    assessment: string;
  };
  fundamentalsContext?: {
    bias: string;
    confidence: number | null;
    calendarRisk: string;
    highImpactEvents: string[];
    keyDrivers: string[];
    risks: string[];
    sourceUpdatedAt: string | null;
  };
  fundamentalContext: {
    fundamentalAlignment: AlignmentLabel;
    source: string;
    sourcePath: string;
    lastUpdated: string | null;
    macroBias: string;
    macroConfidence: number | null;
    keyDrivers: string[];
    assessment: string;
  };
  executionValidity: {
    orderTypeValid: boolean;
    orderTypeAssessment: string;
    currentPriceVsEntry: string;
    currentPriceVsStopLoss: string;
    alreadyInvalidated: boolean;
    entryDistance: string;
    entryDistanceR: string | null;
    freshnessStatus: 'Fresh' | 'Delayed' | 'Stale' | 'Expired' | 'Unknown';
    signalAge: string;
    executionAssessment: string;
  };
  riskReward: {
    riskSize: number | null;
    tpAssessments: Array<{
      tp: string;
      rr: number | null;
      quality: 'good' | 'acceptable' | 'weak' | 'very_weak' | 'unavailable';
      comment: string;
    }>;
    overallQuality: 'good' | 'mixed' | 'poor' | 'unavailable';
    assessment: string;
  };
  newsAndSessionRisk: {
    calendarRisk: 'low' | 'medium' | 'high' | 'unavailable';
    headlineRisk: 'low' | 'medium' | 'high' | 'unavailable';
    session: string;
    liquidityQuality: 'good' | 'reduced' | 'poor' | 'unavailable';
    spreadStatus: 'normal' | 'elevated' | 'dangerous' | 'unavailable';
    volatility: 'low' | 'normal' | 'high' | 'extreme' | 'unavailable';
    assessment: string;
  };
  hardRejectionReasons: string[];
  softConcerns: string[];
  positiveFactors: string[];
  conflicts: string[];
  whatWouldMakeItValid: string[];
  checklist: Array<{
    item: string;
    status: 'pass' | 'fail' | 'warning' | 'unavailable';
    details: string;
  }>;
  legacy: {
    confidence: number;
    reasoning: string;
    riskRewardAssessment: string;
    entryAssessment: string;
    slAssessment: string;
    tpAssessment: string;
    keyReasons: string[];
    keyRisks: string[];
  };
  confluence?: {
    technicalAlignment: number;
    fundamentalAlignment: number;
    riskRewardQuality: number;
    executionConditions: number;
    overall: number;
  };
  pairContext: PairDecisionContext | null;
  usedAnalysisGeneratedAt: string | null;
  aiValidationUnavailable?: boolean;
  aiValidationError?: string | null;
  noAnalysisFound?: boolean;
}

export interface SignalAnalysisResult {
  ok: true;
  symbol: string;
  verdict: SignalVerdict;
  confidence: number;
  summary: string;
  alignment: {
    fundamentals: AlignmentLabel;
    technical: AlignmentLabel;
    riskReward: RRLabel;
  };
  parsedSignal: {
    direction: string;
    orderType: string | null;
    entry: number | null;
    sl: number | null;
    tps: number[];
  };
  rr: SignalRR | null;
  reasoning: string;
  warnings: string[];
  usedAnalysisGeneratedAt: string | null;
  details?: TelegramTradeValidationResult;
}

export interface SignalAnalysisError {
  ok: false;
  error: string;
  noAnalysisFound?: boolean;
}

export interface SignalAnalysisMeta {
  signalTime?: string | null;
  sourceMessage?: string | null;
}

type OrderTypeValidity = {
  status: boolean;
  reason: string;
};

type ObjectiveFacts = {
  analysisTime: string;
  signalTime: string | null;
  signalAgeMs: number | null;
  signalAgeText: string;
  freshnessStatus: 'Fresh' | 'Delayed' | 'Stale' | 'Expired' | 'Unknown';
  orderTypeValid: OrderTypeValidity;
  alreadyInvalidated: { status: boolean; reason: string };
  currentPrice: number | null;
  priceVsEntry: string;
  priceVsStopLoss: string;
  entryDistanceValue: number | null;
  entryDistanceText: string;
  entryDistanceRValue: number | null;
  entryDistanceRText: string | null;
  riskSize: number | null;
  riskSizeText: string;
  minRR: number;
  tpRRText: string;
  srConflictText: string;
  executionConditionText: string;
  missingCriticalData: string[];
  hardRejectionRequired: boolean;
  hardRejectionReasons: string[];
  rejectionCategory: RejectionCategory;
  whatWouldMakeItValid: string[];
  headlineRisk: 'low' | 'medium' | 'high' | 'unavailable';
};

const SIGNAL_MODEL = 'gpt-4o-mini';
const MIN_RR = 1;

function compactSymbol(symbol: string) {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatPrice(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'unavailable';
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 10) return value.toFixed(3).replace(/\.?0+$/, '');
  return value.toFixed(5).replace(/\.?0+$/, '');
}

function formatSignedPrice(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'unavailable';
  const formatted = formatPrice(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatPercent(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'unavailable';
  return `${value.toFixed(0)}%`;
}

function formatDuration(ms: number | null): string {
  if (!isFiniteNumber(ms) || ms < 0) return 'unknown';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function computeRR(parsed: ParsedTelegramSignal): SignalRR | null {
  const { entry, stopLoss, takeProfits, direction } = parsed;
  if (!entry || !stopLoss || takeProfits.length === 0) return null;

  const isBuy = direction === 'BUY' || direction === 'LONG';
  const risk = isBuy ? entry - stopLoss : stopLoss - entry;
  if (!Number.isFinite(risk) || risk <= 0) return null;

  const targets = takeProfits
    .map((price, index) => {
      const reward = isBuy ? price - entry : entry - price;
      if (!Number.isFinite(reward)) return null;
      return {
        targetIndex: index + 1,
        price,
        reward: Number(reward.toFixed(5)),
        ratio: Number((reward / risk).toFixed(2)),
      } satisfies SignalRrTarget;
    })
    .filter((target): target is SignalRrTarget => Boolean(target));

  const tp1 = targets[0] ?? null;
  const tp2 = targets[1] ?? null;
  const tp3 = targets[2] ?? null;

  return {
    risk: Number(risk.toFixed(5)),
    targets,
    tp1Reward: tp1?.reward ?? null,
    tp1Ratio: tp1?.ratio ?? null,
    tp2Reward: tp2?.reward ?? null,
    tp2Ratio: tp2?.ratio ?? null,
    tp3Reward: tp3?.reward ?? null,
    tp3Ratio: tp3?.ratio ?? null,
  };
}

function rrLabel(rr: SignalRR | null): RRLabel {
  if (!rr || rr.targets.length === 0) return 'invalid';
  const bestRatio = Math.max(...rr.targets.map((target) => target.ratio));
  if (bestRatio >= 1.5) return 'good';
  if (bestRatio >= 0.5) return 'weak';
  return 'invalid';
}

function classifySpread(symbol: string, spread: number | null): SpreadStatus {
  if (spread == null) return 'unavailable';
  const compact = compactSymbol(symbol);
  const baseline = compact === 'XAUUSD' ? 0.35 : compact.endsWith('JPY') ? 0.02 : 0.0002;
  if (spread >= baseline * 2.5) return 'high';
  if (spread >= baseline * 1.5) return 'elevated';
  return 'normal';
}

function classifyVolatility(
  symbol: string,
  currentPrice: number | null,
  high: number | null,
  low: number | null,
): VolatilityLabel {
  if (!isFiniteNumber(currentPrice) || !isFiniteNumber(high) || !isFiniteNumber(low) || currentPrice <= 0) return 'unavailable';
  const rangePct = ((high - low) / currentPrice) * 100;
  const isGold = compactSymbol(symbol) === 'XAUUSD';
  if (rangePct >= (isGold ? 1.35 : 0.9)) return 'extreme';
  if (rangePct >= (isGold ? 0.85 : 0.55)) return 'high';
  if (rangePct <= (isGold ? 0.2 : 0.12)) return 'low';
  return 'normal';
}

function mapBiasToTrend(bias: string): TrendLabel {
  if (bias === 'bullish') return 'bullish';
  if (bias === 'bearish') return 'bearish';
  if (bias === 'neutral' || bias === 'mixed') return 'mixed';
  return 'unknown';
}

function scoreAlignment(alignment: AlignmentLabel) {
  if (alignment === 'aligned') return 80;
  if (alignment === 'mixed') return 55;
  if (alignment === 'against') return 25;
  return 40;
}

function scoreRiskReward(rr: SignalRR | null) {
  if (!rr?.targets.length) return 20;
  const tp1 = rr.targets[0]?.ratio ?? null;
  const best = Math.max(...rr.targets.map((target) => target.ratio));
  if (tp1 != null && tp1 < 0.5) return 15;
  if (tp1 != null && tp1 < 1 && best >= 1.5) return 45;
  if (best >= 3) return 85;
  if (best >= 2) return 72;
  if (best >= 1.5) return 60;
  if (best >= 1) return 45;
  return 25;
}

function scoreExecution(args: {
  hardReject: boolean;
  spreadStatus: 'normal' | 'elevated' | 'dangerous' | 'unavailable';
  volatility: 'low' | 'normal' | 'high' | 'extreme' | 'unavailable';
  calendarRisk: string;
  freshnessStatus: ObjectiveFacts['freshnessStatus'];
}) {
  if (args.hardReject) return 0;
  let score = 82;
  if (args.spreadStatus === 'elevated') score -= 15;
  if (args.spreadStatus === 'dangerous') score -= 35;
  if (args.spreadStatus === 'unavailable') score -= 10;
  if (args.volatility === 'high') score -= 15;
  if (args.volatility === 'extreme') score -= 28;
  if (args.volatility === 'unavailable') score -= 8;
  if (args.calendarRisk === 'medium') score -= 12;
  if (args.calendarRisk === 'high') score -= 24;
  if (args.freshnessStatus === 'Delayed') score -= 8;
  if (args.freshnessStatus === 'Stale') score -= 28;
  if (args.freshnessStatus === 'Expired') score -= 45;
  return Math.max(0, Math.min(95, Math.round(score)));
}

function buildConfluence(args: {
  technicalAlignment: AlignmentLabel;
  fundamentalAlignment: AlignmentLabel;
  rr: SignalRR | null;
  spreadStatus: 'normal' | 'elevated' | 'dangerous' | 'unavailable';
  volatility: 'low' | 'normal' | 'high' | 'extreme' | 'unavailable';
  calendarRisk: string;
  hardReject: boolean;
  freshnessStatus: ObjectiveFacts['freshnessStatus'];
}) {
  const technicalAlignment = scoreAlignment(args.technicalAlignment);
  const fundamentalAlignment = scoreAlignment(args.fundamentalAlignment);
  const riskRewardQuality = scoreRiskReward(args.rr);
  const executionConditions = scoreExecution(args);
  const overall = args.hardReject ? 0 : Math.round((technicalAlignment + fundamentalAlignment + riskRewardQuality + executionConditions) / 4);
  return { technicalAlignment, fundamentalAlignment, riskRewardQuality, executionConditions, overall };
}

function buildFundamentalsContext(pairContext: PairDecisionContext | null) {
  if (!pairContext) {
    return {
      bias: 'unavailable',
      confidence: null,
      calendarRisk: 'unavailable',
      highImpactEvents: [] as string[],
      keyDrivers: [] as string[],
      risks: [] as string[],
      sourceUpdatedAt: null,
    };
  }
  return {
    bias: pairContext.macroBias,
    confidence: pairContext.macroConfidence,
    calendarRisk: pairContext.calendarRisk,
    highImpactEvents: pairContext.highImpactEvents.slice(0, 5),
    keyDrivers: pairContext.topDrivers.slice(0, 6),
    risks: pairContext.risks.slice(0, 6),
    sourceUpdatedAt: pairContext.fundamentalsUpdatedAt ?? pairContext.dataGeneratedAt,
  };
}

function buildTechnicalContextFromPair(pairContext: PairDecisionContext, symbol: string): TelegramTradeValidationResult['technicalContext'] {
  return {
    currentPrice: pairContext.price,
    trend: mapBiasToTrend(pairContext.directionBias),
    session: pairContext.session,
    nextSession: pairContext.nextSession,
    support: pairContext.support,
    resistance: pairContext.resistance,
    sma20: null,
    sma50: null,
    marketStructure: pairContext.marketStructure,
    technicalScore: pairContext.technicalScore,
    spread: pairContext.currentSpread,
    spreadStatus: classifySpread(symbol, pairContext.currentSpread),
    atr: null,
    volatility: classifyVolatility(symbol, pairContext.price, pairContext.dayHigh, pairContext.dayLow),
    technicalAlignment: 'unavailable',
    source: 'AlphaMentals Pair Analysis',
    sourcePath: `/pair/${symbol}`,
    lastUpdated: pairContext.priceUpdatedAt,
    entryLocationQuality: 'Unavailable until objective validation is computed.',
    liquidityContext: pairContext.session === 'Closed' ? 'Session is closed.' : `${pairContext.session}${pairContext.nextSession ? ` · Next: ${pairContext.nextSession}` : ''}`,
    confirmationNeeded: [],
    assessment: 'Technical pair intelligence loaded.',
  };
}

function buildEmptyTechnicalContext(symbol: string): TelegramTradeValidationResult['technicalContext'] {
  return {
    currentPrice: null,
    trend: 'unknown',
    session: 'Unknown',
    nextSession: null,
    support: null,
    resistance: null,
    sma20: null,
    sma50: null,
    marketStructure: null,
    technicalScore: null,
    spread: null,
    spreadStatus: 'unavailable',
    atr: null,
    volatility: 'unavailable',
    technicalAlignment: 'unavailable',
    source: 'AlphaMentals Pair Analysis',
    sourcePath: `/pair/${symbol}`,
    lastUpdated: null,
    entryLocationQuality: 'Technical pair intelligence unavailable or stale. Technical alignment confidence reduced.',
    liquidityContext: 'Technical pair intelligence unavailable or stale. Technical alignment confidence reduced.',
    confirmationNeeded: [],
    assessment: 'Technical pair intelligence unavailable or stale. Technical alignment confidence reduced.',
  };
}

function deriveOrderTypeValidity(parsed: ParsedTelegramSignal, currentPrice: number | null): OrderTypeValidity {
  const direction = parsed.direction ?? 'UNKNOWN';
  const orderType = parsed.orderType ?? 'MARKET';
  if (currentPrice == null) {
    return {
      status: false,
      reason: 'Current price is unavailable, so order type validity cannot be confirmed.',
    };
  }
  if (orderType !== 'MARKET' && parsed.entry == null) {
    return {
      status: false,
      reason: `Pending ${direction} ${orderType} signal is missing an entry price.`,
    };
  }
  if (orderType === 'LIMIT') {
    if (direction === 'BUY') {
      const valid = (parsed.entry ?? Infinity) < currentPrice;
      return {
        status: valid,
        reason: valid
          ? `BUY LIMIT entry ${formatPrice(parsed.entry)} is below current price ${formatPrice(currentPrice)}.`
          : `BUY LIMIT entry ${formatPrice(parsed.entry)} must be below current price ${formatPrice(currentPrice)}.`,
      };
    }
    if (direction === 'SELL') {
      const valid = (parsed.entry ?? -Infinity) > currentPrice;
      return {
        status: valid,
        reason: valid
          ? `SELL LIMIT entry ${formatPrice(parsed.entry)} is above current price ${formatPrice(currentPrice)}.`
          : `SELL LIMIT entry ${formatPrice(parsed.entry)} must be above current price ${formatPrice(currentPrice)}.`,
      };
    }
  }
  if (orderType === 'STOP') {
    if (direction === 'BUY') {
      const valid = (parsed.entry ?? -Infinity) > currentPrice;
      return {
        status: valid,
        reason: valid
          ? `BUY STOP entry ${formatPrice(parsed.entry)} is above current price ${formatPrice(currentPrice)}.`
          : `BUY STOP entry ${formatPrice(parsed.entry)} must be above current price ${formatPrice(currentPrice)}.`,
      };
    }
    if (direction === 'SELL') {
      const valid = (parsed.entry ?? Infinity) < currentPrice;
      return {
        status: valid,
        reason: valid
          ? `SELL STOP entry ${formatPrice(parsed.entry)} is below current price ${formatPrice(currentPrice)}.`
          : `SELL STOP entry ${formatPrice(parsed.entry)} must be below current price ${formatPrice(currentPrice)}.`,
      };
    }
  }
  if (direction === 'BUY' || direction === 'SELL') {
    return {
      status: true,
      reason: `${direction} market signal can be evaluated immediately at current price ${formatPrice(currentPrice)}.`,
    };
  }
  return {
    status: false,
    reason: `Unsupported direction/order type combination: ${direction} ${orderType}.`,
  };
}

function deriveInvalidation(parsed: ParsedTelegramSignal, currentPrice: number | null) {
  if (parsed.stopLoss == null || currentPrice == null || !parsed.direction) {
    return { status: false, reason: 'Current price or stop loss unavailable, so invalidation cannot be confirmed.' };
  }
  if (parsed.direction === 'SELL') {
    if (currentPrice > parsed.stopLoss) {
      return {
        status: true,
        reason: `Rejected because current price ${formatPrice(currentPrice)} is already above the SELL stop loss ${formatPrice(parsed.stopLoss)}.`,
      };
    }
    return {
      status: false,
      reason: `Current price ${formatPrice(currentPrice)} remains below the SELL stop loss ${formatPrice(parsed.stopLoss)}.`,
    };
  }
  if (parsed.direction === 'BUY') {
    if (currentPrice < parsed.stopLoss) {
      return {
        status: true,
        reason: `Rejected because current price ${formatPrice(currentPrice)} is already below the BUY stop loss ${formatPrice(parsed.stopLoss)}.`,
      };
    }
    return {
      status: false,
      reason: `Current price ${formatPrice(currentPrice)} remains above the BUY stop loss ${formatPrice(parsed.stopLoss)}.`,
    };
  }
  return { status: false, reason: 'Direction unavailable, so invalidation could not be checked.' };
}

function deriveSignalFreshness(symbol: string, signalTime: string | null, currentPrice: number | null, parsed: ParsedTelegramSignal, rr: SignalRR | null, invalidated: boolean) {
  if (invalidated) {
    return {
      signalAgeMs: signalTime ? Math.max(0, Date.now() - new Date(signalTime).getTime()) : null,
      freshnessStatus: 'Expired' as const,
      signalAgeText: signalTime ? formatDuration(Math.max(0, Date.now() - new Date(signalTime).getTime())) : 'unknown',
    };
  }

  const signalAt = signalTime ? new Date(signalTime).getTime() : Number.NaN;
  const signalAgeMs = Number.isFinite(signalAt) ? Math.max(0, Date.now() - signalAt) : null;
  const ageText = formatDuration(signalAgeMs);

  const entryDistance = currentPrice != null && parsed.entry != null ? Math.abs(currentPrice - parsed.entry) : null;
  const distanceR = entryDistance != null && rr?.risk ? entryDistance / rr.risk : null;
  const isGold = compactSymbol(symbol) === 'XAUUSD';

  let freshnessStatus: ObjectiveFacts['freshnessStatus'] = signalTime ? 'Fresh' : 'Unknown';
  if (signalAgeMs != null) {
    if (signalAgeMs > (isGold ? 6 : 12) * 60 * 60_000) freshnessStatus = 'Expired';
    else if (signalAgeMs > (isGold ? 90 : 180) * 60_000) freshnessStatus = 'Stale';
    else if (signalAgeMs > (isGold ? 30 : 60) * 60_000) freshnessStatus = 'Delayed';
  }
  if (distanceR != null) {
    if (distanceR >= (isGold ? 2 : 2.5)) freshnessStatus = 'Expired';
    else if (distanceR >= (isGold ? 1.25 : 1.75) && freshnessStatus === 'Fresh') freshnessStatus = 'Stale';
    else if (distanceR >= (isGold ? 0.75 : 1.1) && freshnessStatus === 'Fresh') freshnessStatus = 'Delayed';
  }

  return {
    signalAgeMs,
    freshnessStatus,
    signalAgeText: ageText,
  };
}

function deriveSupportResistanceConflict(parsed: ParsedTelegramSignal, pairContext: PairDecisionContext | null, rr: SignalRR | null): string {
  if (!pairContext || pairContext.support == null || pairContext.resistance == null) {
    return 'Support/resistance unavailable from /pair data.';
  }
  if (parsed.entry == null || !parsed.direction) {
    return 'Entry or direction unavailable, so support/resistance conflict could not be assessed.';
  }

  const risk = rr?.risk ?? null;
  if (parsed.direction === 'SELL') {
    const distanceToSupport = parsed.entry - pairContext.support;
    if (distanceToSupport <= 0) return `SELL setup is already sitting at or below support ${formatPrice(pairContext.support)}.`;
    if (risk && distanceToSupport / risk < 0.75) {
      return `SELL setup is trading into nearby support ${formatPrice(pairContext.support)} only ${formatPrice(distanceToSupport)} away (${(distanceToSupport / risk).toFixed(2)}R).`;
    }
    return `Support at ${formatPrice(pairContext.support)} leaves ${formatPrice(distanceToSupport)} of room below the SELL entry.`;
  }

  const distanceToResistance = pairContext.resistance - parsed.entry;
  if (distanceToResistance <= 0) return `BUY setup is already sitting at or above resistance ${formatPrice(pairContext.resistance)}.`;
  if (risk && distanceToResistance / risk < 0.75) {
    return `BUY setup is trading into nearby resistance ${formatPrice(pairContext.resistance)} only ${formatPrice(distanceToResistance)} away (${(distanceToResistance / risk).toFixed(2)}R).`;
  }
  return `Resistance at ${formatPrice(pairContext.resistance)} leaves ${formatPrice(distanceToResistance)} of room above the BUY entry.`;
}

function deriveExecutionConditions(symbol: string, pairContext: PairDecisionContext | null, technicalContext: TelegramTradeValidationResult['technicalContext']) {
  if (!pairContext) {
    return {
      headlineRisk: 'unavailable' as const,
      text: 'Pair technical context unavailable, so session/spread/volatility checks are reduced.',
    };
  }

  const headlineRisk = pairContext.highImpactEvents.length > 0
    ? pairContext.highImpactEvents.some((event) => /in\s([0-5]?\d)m/i.test(event)) ? 'high' as const : 'medium' as const
    : pairContext.risks.some((risk) => /headline|geopolitic|war|conflict|breaking/i.test(risk)) ? 'medium' as const : 'low' as const;

  const spreadText = technicalContext.spreadStatus === 'high'
    ? 'dangerous spread'
    : technicalContext.spreadStatus === 'elevated'
      ? 'elevated spread'
      : technicalContext.spreadStatus === 'normal'
        ? 'normal spread'
        : 'spread unavailable';
  const sessionText = pairContext.session === 'Closed' ? 'session closed' : `active session ${pairContext.session}`;
  const volatilityText = technicalContext.volatility === 'unavailable' ? 'volatility unavailable' : `${technicalContext.volatility} volatility`;

  return {
    headlineRisk,
    text: `${sessionText}; ${spreadText}; ${volatilityText}.`,
  };
}

export function buildObjectiveValidationFacts(args: {
  symbol: string;
  parsed: ParsedTelegramSignal;
  rr: SignalRR | null;
  pairContext: PairDecisionContext | null;
  technicalContext: TelegramTradeValidationResult['technicalContext'];
  signalTime: string | null;
  analysisTime: string;
}): ObjectiveFacts {
  const { symbol, parsed, rr, pairContext, technicalContext, signalTime, analysisTime } = args;
  const currentPrice = pairContext?.price ?? technicalContext.currentPrice ?? null;
  const orderTypeValid = deriveOrderTypeValidity(parsed, currentPrice);
  const alreadyInvalidated = deriveInvalidation(parsed, currentPrice);
  const freshness = deriveSignalFreshness(symbol, signalTime, currentPrice, parsed, rr, alreadyInvalidated.status);
  const entryDistanceValue = currentPrice != null && parsed.entry != null ? Number(Math.abs(currentPrice - parsed.entry).toFixed(5)) : null;
  const entryDistanceRValue = entryDistanceValue != null && rr?.risk ? Number((entryDistanceValue / rr.risk).toFixed(2)) : null;
  const riskSize = rr?.risk ?? (parsed.entry != null && parsed.stopLoss != null ? Number(Math.abs(parsed.entry - parsed.stopLoss).toFixed(5)) : null);
  const priceVsEntry = parsed.entry == null
    ? 'Entry unavailable.'
    : currentPrice == null
      ? 'Current price unavailable.'
      : `Current price ${formatPrice(currentPrice)} vs entry ${formatPrice(parsed.entry)} = ${formatSignedPrice(currentPrice - parsed.entry)}.`;
  const priceVsStopLoss = parsed.stopLoss == null
    ? 'Stop loss unavailable.'
    : currentPrice == null
      ? 'Current price unavailable.'
      : `Current price ${formatPrice(currentPrice)} vs stop loss ${formatPrice(parsed.stopLoss)} = ${formatSignedPrice(currentPrice - parsed.stopLoss)}.`;
  const srConflictText = deriveSupportResistanceConflict(parsed, pairContext, rr);
  const executionCondition = deriveExecutionConditions(symbol, pairContext, technicalContext);
  const missingCriticalData = [
    currentPrice == null ? 'current price' : null,
    parsed.stopLoss == null ? 'stop loss' : null,
    (parsed.orderType === 'LIMIT' || parsed.orderType === 'STOP') && parsed.entry == null ? 'entry' : null,
  ].filter((value): value is string => Boolean(value));

  const hardRejectionReasons: string[] = [];
  if (!orderTypeValid.status) hardRejectionReasons.push(orderTypeValid.reason);
  if (alreadyInvalidated.status) hardRejectionReasons.push(alreadyInvalidated.reason);
  if (parsed.stopLoss == null) hardRejectionReasons.push('Stop loss is missing, so invalidation and risk cannot be validated.');
  if ((parsed.orderType === 'LIMIT' || parsed.orderType === 'STOP') && parsed.entry == null) {
    hardRejectionReasons.push(`Pending ${parsed.direction ?? 'UNKNOWN'} ${parsed.orderType} signal is missing an entry price.`);
  }
  if (currentPrice == null) hardRejectionReasons.push('Current price is missing, so execution validity cannot be confirmed.');
  if (freshness.freshnessStatus === 'Expired') hardRejectionReasons.push(`Signal is ${freshness.freshnessStatus.toLowerCase()} based on age and/or price drift from entry.`);

  let rejectionCategory: RejectionCategory = 'NONE';
  if (alreadyInvalidated.status) rejectionCategory = 'ALREADY_INVALIDATED';
  else if (!orderTypeValid.status) rejectionCategory = 'INVALID_ORDER_TYPE';
  else if (parsed.stopLoss == null || ((parsed.orderType === 'LIMIT' || parsed.orderType === 'STOP') && parsed.entry == null) || currentPrice == null) rejectionCategory = 'INSUFFICIENT_DATA';
  else if (freshness.freshnessStatus === 'Stale' || freshness.freshnessStatus === 'Expired') rejectionCategory = 'STALE_SIGNAL';

  const whatWouldMakeItValid = [
    !orderTypeValid.status ? 'Rebuild the order so the pending entry is on the correct side of the live market price.' : null,
    alreadyInvalidated.status ? 'Wait for a brand-new setup because the current stop-loss has already been breached.' : null,
    freshness.freshnessStatus === 'Stale' || freshness.freshnessStatus === 'Expired' ? 'Wait for a fresh signal closer to current market price.' : null,
    srConflictText.includes('nearby support') || srConflictText.includes('nearby resistance') ? 'Wait for price to clear the nearby support/resistance conflict or improve the RR.' : null,
    executionCondition.text.includes('dangerous spread') ? 'Wait for spread conditions to normalize before considering execution.' : null,
  ].filter((value): value is string => Boolean(value));

  return {
    analysisTime,
    signalTime,
    signalAgeMs: freshness.signalAgeMs,
    signalAgeText: freshness.signalAgeText,
    freshnessStatus: freshness.freshnessStatus,
    orderTypeValid,
    alreadyInvalidated,
    currentPrice,
    priceVsEntry,
    priceVsStopLoss,
    entryDistanceValue,
    entryDistanceText: entryDistanceValue == null ? 'unavailable' : `${formatPrice(entryDistanceValue)}`,
    entryDistanceRValue,
    entryDistanceRText: entryDistanceRValue == null ? null : `${entryDistanceRValue.toFixed(2)}R`,
    riskSize,
    riskSizeText: riskSize == null ? 'unavailable' : formatPrice(riskSize),
    minRR: MIN_RR,
    tpRRText: rr?.targets.length
      ? rr.targets.map((target) => `TP${target.targetIndex}: ${target.ratio}R`).join(' | ')
      : 'unavailable',
    srConflictText,
    executionConditionText: executionCondition.text,
    missingCriticalData,
    hardRejectionRequired: hardRejectionReasons.length > 0,
    hardRejectionReasons,
    rejectionCategory,
    whatWouldMakeItValid,
    headlineRisk: executionCondition.headlineRisk,
  };
}

function buildObjectiveValidationContext(facts: ObjectiveFacts): string {
  return `Current price: ${formatPrice(facts.currentPrice)}
Order type valid: ${facts.orderTypeValid.status ? 'yes' : 'no'} — ${facts.orderTypeValid.reason}
Current price vs entry: ${facts.priceVsEntry}
Current price vs SL: ${facts.priceVsStopLoss}
Already invalidated: ${facts.alreadyInvalidated.status ? 'yes' : 'no'} — ${facts.alreadyInvalidated.reason}
Signal time: ${facts.signalTime ?? 'unknown'}
Analysis time: ${facts.analysisTime}
Signal age: ${facts.signalAgeText}
Freshness status: ${facts.freshnessStatus}
Entry distance: ${facts.entryDistanceText}
Entry distance in R: ${facts.entryDistanceRText ?? 'unavailable'}
Risk size: ${facts.riskSizeText}
Minimum RR required: ${facts.minRR}
TP RR results: ${facts.tpRRText}
Support/resistance conflict: ${facts.srConflictText}
Session/spread/volatility warning: ${facts.executionConditionText}
Missing critical data: ${facts.missingCriticalData.join(', ') || 'none'}
Hard rejection required: ${facts.hardRejectionRequired ? 'yes' : 'no'}
Hard rejection reasons: ${facts.hardRejectionReasons.join('; ') || 'none'}`;
}

function buildRiskRewardSummary(rr: SignalRR | null): TelegramTradeValidationResult['riskReward'] {
  if (!rr) {
    return {
      riskSize: null,
      tpAssessments: [],
      overallQuality: 'unavailable',
      assessment: 'Risk/reward unavailable because entry, stop loss, or take profit values are incomplete.',
    };
  }

  const tpAssessments = rr.targets.map((target) => {
    let quality: TelegramTradeValidationResult['riskReward']['tpAssessments'][number]['quality'] = 'acceptable';
    if (target.ratio >= 1.5) quality = 'good';
    else if (target.ratio < 0.5) quality = 'very_weak';
    else if (target.ratio < 1) quality = 'weak';
    const comment = target.ratio >= 1.5
      ? `TP${target.targetIndex} offers strong RR at ${target.ratio}R.`
      : target.ratio >= 1
        ? `TP${target.targetIndex} offers acceptable RR at ${target.ratio}R.`
        : target.ratio >= 0.5
          ? `TP${target.targetIndex} is weak at only ${target.ratio}R.`
          : `TP${target.targetIndex} is very weak at only ${target.ratio}R.`;
    return {
      tp: `TP${target.targetIndex} @ ${formatPrice(target.price)}`,
      rr: target.ratio,
      quality,
      comment,
    };
  });

  const tp1 = rr.targets[0]?.ratio ?? null;
  const best = rr.targets.length ? Math.max(...rr.targets.map((target) => target.ratio)) : null;
  let overallQuality: TelegramTradeValidationResult['riskReward']['overallQuality'] = 'poor';
  if (best == null) overallQuality = 'unavailable';
  else if (tp1 != null && tp1 >= 1 && best >= 1.5) overallQuality = 'good';
  else if (best >= 1.5 || (tp1 != null && tp1 >= 0.5)) overallQuality = 'mixed';
  const assessment = best == null
    ? 'Risk/reward unavailable.'
    : tp1 != null && tp1 < 0.5
      ? `TP1 is very weak at ${tp1}R, so the reward profile is poor even if later targets are larger.`
      : tp1 != null && tp1 < 1 && best >= 1.5
        ? `TP1 is weak at ${tp1}R while deeper targets improve the profile, so RR is mixed rather than good.`
        : `Best RR available is ${best}R with TP1 at ${tp1 ?? 'unavailable'}R.`;

  return {
    riskSize: rr.risk,
    tpAssessments,
    overallQuality,
    assessment,
  };
}

function deriveTechnicalAlignment(parsed: ParsedTelegramSignal, pairContext: PairDecisionContext | null): AlignmentLabel {
  if (!pairContext || !parsed.direction) return 'unavailable';
  if (pairContext.directionBias === 'unknown' || pairContext.directionBias === 'neutral') return 'mixed';
  if (pairContext.directionBias === 'mixed') return 'mixed';
  if (parsed.direction === 'BUY') return pairContext.directionBias === 'bullish' ? 'aligned' : 'against';
  if (parsed.direction === 'SELL') return pairContext.directionBias === 'bearish' ? 'aligned' : 'against';
  return 'unavailable';
}

function deriveFundamentalAlignment(parsed: ParsedTelegramSignal, pairContext: PairDecisionContext | null): AlignmentLabel {
  if (!pairContext || !parsed.direction) return 'unavailable';
  if (pairContext.macroBias === 'unknown' || pairContext.macroBias === 'neutral') return 'mixed';
  if (pairContext.macroBias === 'mixed') return 'mixed';
  if (parsed.direction === 'BUY') return pairContext.macroBias === 'bullish' ? 'aligned' : 'against';
  if (parsed.direction === 'SELL') return pairContext.macroBias === 'bearish' ? 'aligned' : 'against';
  return 'unavailable';
}

function buildTechnicalPromptContext(pairContext: PairDecisionContext | null, technicalContext: TelegramTradeValidationResult['technicalContext']) {
  if (!pairContext) {
    return 'Technical pair intelligence unavailable or stale. Technical alignment confidence reduced.';
  }
  return [
    `Current price: ${formatPrice(pairContext.price)}`,
    `Trend: ${pairContext.directionBias} (${pairContext.directionConfidence}%)`,
    `Technical bias: ${pairContext.technicalBias} (${pairContext.technicalScore}%)`,
    `Market structure: ${pairContext.marketStructure}`,
    `Support: ${formatPrice(pairContext.support)}`,
    `Resistance: ${formatPrice(pairContext.resistance)}`,
    `Spread: ${formatPrice(pairContext.currentSpread)} (${technicalContext.spreadStatus})`,
    `Volatility: ${technicalContext.volatility}`,
    `Session: ${pairContext.session}${pairContext.nextSession ? ` · Next: ${pairContext.nextSession}` : ''}`,
    `Technical summary: ${pairContext.technicalSummary}`,
    `Source updated at: ${pairContext.priceUpdatedAt ?? 'unknown'}`,
  ].join('\n');
}

function buildFundamentalsPromptContext(pairContext: PairDecisionContext | null) {
  if (!pairContext) {
    return 'Fundamental intelligence unavailable or stale. Macro alignment confidence reduced.';
  }
  return [
    `Macro bias: ${pairContext.macroBias} (${pairContext.macroConfidence}%)`,
    `Fundamental bias: ${pairContext.fundamentalBias} (${pairContext.fundamentalConfidence}%)`,
    `Calendar risk: ${pairContext.calendarRisk}`,
    `High-impact events: ${pairContext.highImpactEvents.join('; ') || 'none'}`,
    `Key drivers: ${pairContext.topDrivers.join('; ') || 'none'}`,
    `Risks: ${pairContext.risks.join('; ') || 'none'}`,
    `Fundamental reason: ${pairContext.fundamentalReason}`,
    `Source updated at: ${pairContext.fundamentalsUpdatedAt ?? 'unknown'}`,
  ].join('\n');
}

function buildSignalPrompt(args: {
  parsed: ParsedTelegramSignal;
  rr: SignalRR | null;
  pairContext: PairDecisionContext | null;
  technicalPairContext: string;
  fundContext: string;
  livePriceContext: string;
  objectiveValidationContext: string;
  signalTime: string | null;
  sourceMessage: string | null;
}): string {
  const { parsed, rr, pairContext, technicalPairContext, fundContext, livePriceContext, objectiveValidationContext, signalTime, sourceMessage } = args;
  const rrLines = rr
    ? rr.targets.map((t) => `TP${t.targetIndex}: reward ${formatPrice(t.reward)}, RR ${t.ratio}`).join('\n')
    : 'Unavailable — entry, SL, or TPs were not parsed.';

  const directionConflict = pairContext
    ? `Signal direction (${parsed.direction}) vs technical bias (${pairContext.directionBias} ${pairContext.directionConfidence}%) and macro bias (${pairContext.macroBias} ${pairContext.macroConfidence}%).`
    : 'Dashboard bias unavailable.';

  return `SIGNAL DETAILS
Symbol: ${parsed.symbol ?? 'unknown'}
Direction: ${parsed.direction ?? 'unknown'}
Order type: ${parsed.orderType ?? 'MARKET'}
Entry: ${parsed.entry ?? 'unknown'}
Stop loss: ${parsed.stopLoss ?? 'unknown'}
Take profits: ${parsed.takeProfits.length ? parsed.takeProfits.join(', ') : 'none'}
Telegram Signal Time: ${signalTime ?? 'unknown'}
Analysis Time: ${new Date().toISOString()}
Original Source Message:
${sourceMessage ?? 'unavailable'}

LIVE PRICE DATA
Source: MT5 Bridge / backend market data
${livePriceContext}

OBJECTIVE VALIDATION FACTS
These are backend-calculated facts. Treat them as truth.
${objectiveValidationContext}

RISK/REWARD
${rrLines}

DIRECTION CONFLICT CHECK
${directionConflict}

TECHNICAL PAIR ANALYSIS CONTEXT
Source: /pair/${parsed.symbol ?? 'unknown'}
This is the same data source powering:
https://alphamentals-dashboard.vercel.app/pair/${parsed.symbol ?? 'unknown'}

Use this technical context only. Do not invent technical values.
${technicalPairContext}

FUNDAMENTALS CONTEXT
Source: /market-intelligence/fundamentals/${parsed.symbol ?? 'unknown'}
This is the same data source powering:
https://alphamentals-dashboard.vercel.app/market-intelligence/fundamentals/${parsed.symbol ?? 'unknown'}

Use this fundamentals context only. Do not invent macro values.
${fundContext}

VALIDATION TASK
Validate whether this signal is GOOD, RISKY, BAD, or WAIT.

Decision definitions:
- GOOD: valid execution, aligned technicals, aligned fundamentals, acceptable RR, no major execution/news risk.
- RISKY: valid but has one or more important concerns.
- WAIT: setup may become valid but needs confirmation, liquidity, freshness, or news risk resolution.
- BAD: invalid order type, already invalidated, stale/expired, strong macro conflict, strong technical conflict, poor RR, missing SL, dangerous execution conditions, or insufficient critical data.

Required checks:
1. Check order type validity first.
2. Check whether current price has already passed SL.
3. Check signal freshness and distance from entry.
4. Check RR per TP.
5. Check support/resistance conflict using /pair/${parsed.symbol ?? 'unknown'} data.
6. Check technical alignment using /pair/${parsed.symbol ?? 'unknown'} data.
7. Check AlphaMentals fundamentals alignment using /market-intelligence/fundamentals/${parsed.symbol ?? 'unknown'} data.
8. Check news/session/spread/volatility.
9. Return strict JSON only.

Reference actual price levels, RR values, support/resistance, bias percentages, source paths, and timestamps when available.`;
}

function buildLivePriceContext(pairContext: PairDecisionContext | null) {
  if (!pairContext) return 'Live MT5-backed price unavailable.';
  return [
    `Current price: ${formatPrice(pairContext.price)}`,
    `Bid: ${formatPrice(pairContext.bid)}`,
    `Ask: ${formatPrice(pairContext.ask)}`,
    `Day high: ${formatPrice(pairContext.dayHigh)}`,
    `Day low: ${formatPrice(pairContext.dayLow)}`,
    `Price updated at: ${pairContext.priceUpdatedAt ?? 'unknown'}`,
  ].join('\n');
}

function safeChecklistStatus(condition: boolean | null | undefined): 'pass' | 'fail' | 'warning' | 'unavailable' {
  if (condition == null) return 'unavailable';
  return condition ? 'pass' : 'fail';
}

function buildLegacyFields(result: Omit<TelegramTradeValidationResult, 'legacy' | 'confidence'>) {
  return {
    confidence: result.aiVerdictConfidence,
    reasoning: result.primaryReason,
    riskRewardAssessment: result.riskReward.assessment,
    entryAssessment: result.executionValidity.currentPriceVsEntry,
    slAssessment: result.executionValidity.currentPriceVsStopLoss,
    tpAssessment: result.riskReward.assessment,
    keyReasons: [...result.hardRejectionReasons, ...result.positiveFactors],
    keyRisks: [...result.softConcerns, ...result.conflicts],
  };
}

function buildFallbackValidation(args: {
  parsed: ParsedTelegramSignal;
  rr: SignalRR | null;
  pairContext: PairDecisionContext | null;
  objectiveFacts: ObjectiveFacts;
  technicalContext: TelegramTradeValidationResult['technicalContext'];
  fundamentalsContext: NonNullable<TelegramTradeValidationResult['fundamentalsContext']>;
  noAnalysisFound?: boolean;
  aiValidationUnavailable?: boolean;
  aiValidationError?: string | null;
  usedAnalysisGeneratedAt?: string | null;
}): TelegramTradeValidationResult {
  const { parsed, rr, pairContext, objectiveFacts, technicalContext, fundamentalsContext } = args;
  const technicalAlignment = deriveTechnicalAlignment(parsed, pairContext);
  const fundamentalAlignment = deriveFundamentalAlignment(parsed, pairContext);
  const riskReward = buildRiskRewardSummary(rr);
  const spreadStatus = technicalContext.spreadStatus === 'high'
    ? 'dangerous'
    : technicalContext.spreadStatus === 'elevated'
      ? 'elevated'
      : technicalContext.spreadStatus === 'normal'
        ? 'normal'
        : 'unavailable';
  const newsAndSessionRisk: TelegramTradeValidationResult['newsAndSessionRisk'] = {
    calendarRisk: fundamentalsContext.calendarRisk === 'high' || fundamentalsContext.calendarRisk === 'medium' || fundamentalsContext.calendarRisk === 'low'
      ? fundamentalsContext.calendarRisk
      : 'unavailable',
    headlineRisk: objectiveFacts.headlineRisk,
    session: technicalContext.session,
    liquidityQuality: technicalContext.session === 'Closed' ? 'poor' : technicalContext.session === 'Unknown' ? 'unavailable' : 'good',
    spreadStatus,
    volatility: technicalContext.volatility ?? 'unavailable',
    assessment: objectiveFacts.executionConditionText,
  };

  const hardReject = objectiveFacts.hardRejectionRequired;
  const decisionLabel: DecisionLabel = hardReject ? 'REJECTED' : objectiveFacts.freshnessStatus === 'Delayed' ? 'NEEDS_CONFIRMATION' : objectiveFacts.freshnessStatus === 'Stale' ? 'WAIT' : 'WAIT';
  const verdict: SignalVerdict = hardReject ? 'BAD' : objectiveFacts.freshnessStatus === 'Stale' ? 'WAIT' : riskReward.overallQuality === 'poor' ? 'RISKY' : 'WAIT';
  const recommendedAction: FinalAction = hardReject ? 'avoid' : verdict === 'WAIT' ? 'wait' : 'monitor';
  const primaryReason = hardReject
    ? objectiveFacts.hardRejectionReasons.join(' ')
    : `AI validation was unavailable, so the trade was scored conservatively using backend-calculated facts and AlphaMentals context.`;
  const positiveFactors = [
    technicalAlignment === 'aligned' ? `Technical alignment supports the ${parsed.direction} direction.` : null,
    fundamentalAlignment === 'aligned' ? `Fundamentals support the ${parsed.direction} direction.` : null,
    riskReward.overallQuality === 'good' ? 'Reward profile is acceptable.' : null,
  ].filter((value): value is string => Boolean(value));
  const conflicts = [
    technicalAlignment === 'against' ? 'Technical pair analysis is against the signal direction.' : null,
    fundamentalAlignment === 'against' ? 'AlphaMentals fundamentals are against the signal direction.' : null,
    objectiveFacts.srConflictText.includes('nearby') ? objectiveFacts.srConflictText : null,
  ].filter((value): value is string => Boolean(value));
  const softConcerns = [
    objectiveFacts.freshnessStatus === 'Delayed' || objectiveFacts.freshnessStatus === 'Stale' ? `Signal freshness is ${objectiveFacts.freshnessStatus}.` : null,
    newsAndSessionRisk.assessment,
    args.aiValidationUnavailable ? (args.aiValidationError ?? 'AI validation unavailable.') : null,
  ].filter((value): value is string => Boolean(value));
  const confluence = buildConfluence({
    technicalAlignment,
    fundamentalAlignment,
    rr,
    spreadStatus: newsAndSessionRisk.spreadStatus,
    volatility: newsAndSessionRisk.volatility,
    calendarRisk: fundamentalsContext.calendarRisk,
    hardReject,
    freshnessStatus: objectiveFacts.freshnessStatus,
  });
  const tradeQualityScore = hardReject ? 0 : confluence.overall;
  const executionValidityScore = scoreExecution({
    hardReject,
    spreadStatus: newsAndSessionRisk.spreadStatus,
    volatility: newsAndSessionRisk.volatility,
    calendarRisk: fundamentalsContext.calendarRisk,
    freshnessStatus: objectiveFacts.freshnessStatus,
  });
  const aiVerdictConfidence = hardReject ? 92 : 55;
  const rejectionConfidence = hardReject ? 96 : 30;

  const base: Omit<TelegramTradeValidationResult, 'legacy' | 'confidence'> = {
    ok: true,
    symbol: parsed.symbol ?? 'UNKNOWN',
    verdict,
    decisionLabel,
    rejectionCategory: hardReject ? objectiveFacts.rejectionCategory : 'NONE',
    tradeQualityScore,
    executionValidityScore,
    aiVerdictConfidence,
    rejectionConfidence,
    primaryReason,
    summary: primaryReason,
    reasoning: primaryReason,
    fundamentalAlignment,
    technicalAlignment,
    riskRewardAssessment: riskReward.assessment,
    entryAssessment: objectiveFacts.priceVsEntry,
    slAssessment: objectiveFacts.priceVsStopLoss,
    tpAssessment: riskReward.assessment,
    keyReasons: [],
    keyRisks: [],
    confirmationNeeded: [
      ...technicalContext.confirmationNeeded,
      ...(hardReject ? [] : objectiveFacts.whatWouldMakeItValid),
    ],
    invalidation: pairContext ? [pairContext.invalidation] : ['Trade becomes invalid if price breaches the stop-loss area.'],
    finalAction: recommendedAction,
    recommendedAction,
    macroBias: pairContext?.macroBias ?? 'unavailable',
    calendarRisk: fundamentalsContext.calendarRisk,
    parsedSignal: {
      symbol: parsed.symbol ?? 'UNKNOWN',
      direction: parsed.direction ?? 'UNKNOWN',
      orderType: parsed.orderType,
      entry: parsed.entry,
      sl: parsed.stopLoss,
      tps: parsed.takeProfits,
    },
    rr,
    technicalContext: {
      ...technicalContext,
      technicalAlignment,
      entryLocationQuality: objectiveFacts.srConflictText,
      confirmationNeeded: hardReject ? [] : objectiveFacts.whatWouldMakeItValid,
      assessment: technicalAlignment === 'against'
        ? 'Technical pair intelligence is against the signal direction.'
        : technicalAlignment === 'aligned'
          ? 'Technical pair intelligence supports the signal direction.'
          : technicalContext.assessment,
    },
    fundamentalsContext,
    fundamentalContext: {
      fundamentalAlignment,
      source: 'AlphaMentals Fundamentals',
      sourcePath: `/market-intelligence/fundamentals/${parsed.symbol ?? 'unknown'}`,
      lastUpdated: fundamentalsContext.sourceUpdatedAt,
      macroBias: fundamentalsContext.bias,
      macroConfidence: fundamentalsContext.confidence,
      keyDrivers: fundamentalsContext.keyDrivers,
      assessment: fundamentalAlignment === 'against'
        ? 'Fundamental intelligence is against the signal direction.'
        : fundamentalAlignment === 'aligned'
          ? 'Fundamental intelligence supports the signal direction.'
          : 'Fundamental intelligence is mixed or unavailable.',
    },
    executionValidity: {
      orderTypeValid: objectiveFacts.orderTypeValid.status,
      orderTypeAssessment: objectiveFacts.orderTypeValid.reason,
      currentPriceVsEntry: objectiveFacts.priceVsEntry,
      currentPriceVsStopLoss: objectiveFacts.priceVsStopLoss,
      alreadyInvalidated: objectiveFacts.alreadyInvalidated.status,
      entryDistance: objectiveFacts.entryDistanceText,
      entryDistanceR: objectiveFacts.entryDistanceRText,
      freshnessStatus: objectiveFacts.freshnessStatus,
      signalAge: objectiveFacts.signalAgeText,
      executionAssessment: objectiveFacts.executionConditionText,
    },
    riskReward,
    newsAndSessionRisk,
    hardRejectionReasons: objectiveFacts.hardRejectionReasons,
    softConcerns,
    positiveFactors,
    conflicts,
    whatWouldMakeItValid: objectiveFacts.whatWouldMakeItValid,
    checklist: [
      {
        item: 'Order type validity',
        status: safeChecklistStatus(objectiveFacts.orderTypeValid.status),
        details: objectiveFacts.orderTypeValid.reason,
      },
      {
        item: 'Stop-loss invalidation',
        status: objectiveFacts.alreadyInvalidated.status ? 'fail' : 'pass',
        details: objectiveFacts.alreadyInvalidated.reason,
      },
      {
        item: 'Signal freshness',
        status: objectiveFacts.freshnessStatus === 'Fresh' ? 'pass' : objectiveFacts.freshnessStatus === 'Unknown' ? 'unavailable' : objectiveFacts.freshnessStatus === 'Delayed' ? 'warning' : 'fail',
        details: `Signal age ${objectiveFacts.signalAgeText}; freshness ${objectiveFacts.freshnessStatus}.`,
      },
      {
        item: 'Risk / reward',
        status: riskReward.overallQuality === 'good' ? 'pass' : riskReward.overallQuality === 'mixed' ? 'warning' : riskReward.overallQuality === 'poor' ? 'fail' : 'unavailable',
        details: riskReward.assessment,
      },
      {
        item: 'Technical alignment',
        status: technicalAlignment === 'aligned' ? 'pass' : technicalAlignment === 'mixed' ? 'warning' : technicalAlignment === 'against' ? 'fail' : 'unavailable',
        details: technicalContext.assessment,
      },
      {
        item: 'Fundamental alignment',
        status: fundamentalAlignment === 'aligned' ? 'pass' : fundamentalAlignment === 'mixed' ? 'warning' : fundamentalAlignment === 'against' ? 'fail' : 'unavailable',
        details: baseFundamentalAssessment(fundamentalsContext, fundamentalAlignment),
      },
      {
        item: 'Critical data completeness',
        status: objectiveFacts.missingCriticalData.length === 0 ? 'pass' : 'fail',
        details: objectiveFacts.missingCriticalData.length ? `Missing: ${objectiveFacts.missingCriticalData.join(', ')}.` : 'No critical data missing.',
      },
    ],
    confluence,
    pairContext,
    usedAnalysisGeneratedAt: args.usedAnalysisGeneratedAt ?? null,
    aiValidationUnavailable: args.aiValidationUnavailable,
    aiValidationError: args.aiValidationError ?? null,
    noAnalysisFound: args.noAnalysisFound ?? false,
  };

  const legacy = buildLegacyFields(base);
  return {
    ...base,
    confidence: legacy.confidence,
    reasoning: legacy.reasoning,
    riskRewardAssessment: legacy.riskRewardAssessment,
    entryAssessment: legacy.entryAssessment,
    slAssessment: legacy.slAssessment,
    tpAssessment: legacy.tpAssessment,
    keyReasons: legacy.keyReasons,
    keyRisks: legacy.keyRisks,
    legacy,
  };
}

function baseFundamentalAssessment(
  fundamentalsContext: NonNullable<TelegramTradeValidationResult['fundamentalsContext']>,
  alignment: AlignmentLabel,
) {
  if (alignment === 'aligned') return 'AlphaMentals fundamentals support the signal direction.';
  if (alignment === 'against') return 'AlphaMentals fundamentals conflict with the signal direction.';
  if (alignment === 'mixed') return 'Fundamental intelligence is mixed.';
  return fundamentalsContext.sourceUpdatedAt
    ? 'Fundamental intelligence unavailable or stale. Macro alignment confidence reduced.'
    : 'Fundamental intelligence unavailable or stale. Macro alignment confidence reduced.';
}

function applyHardRejectionOverride(
  candidate: LlmValidationResponse,
  objectiveFacts: ObjectiveFacts,
): LlmValidationResponse {
  if (!objectiveFacts.hardRejectionRequired) return candidate;
  return {
    ...candidate,
    verdict: 'BAD',
    decisionLabel: 'REJECTED',
    rejectionCategory: objectiveFacts.rejectionCategory === 'NONE' ? 'INSUFFICIENT_DATA' : objectiveFacts.rejectionCategory,
    tradeQualityScore: 0,
    executionValidityScore: 0,
    aiVerdictConfidence: Math.max(candidate.aiVerdictConfidence ?? 0, 90),
    rejectionConfidence: Math.max(candidate.rejectionConfidence ?? 0, 94),
    primaryReason: objectiveFacts.hardRejectionReasons.join(' '),
    recommendedAction: 'avoid',
    finalAction: 'avoid',
    hardRejectionReasons: objectiveFacts.hardRejectionReasons,
  };
}

type LlmValidationResponse = {
  verdict: SignalVerdict;
  decisionLabel: DecisionLabel;
  rejectionCategory: RejectionCategory;
  tradeQualityScore: number;
  executionValidityScore: number;
  aiVerdictConfidence: number;
  rejectionConfidence: number;
  summary: string;
  primaryReason: string;
  executionValidity: {
    orderTypeValid: boolean;
    orderTypeAssessment: string;
    currentPriceVsEntry: string;
    currentPriceVsStopLoss: string;
    alreadyInvalidated: boolean;
    entryDistance: string;
    entryDistanceR: string | null;
    freshnessStatus: 'Fresh' | 'Delayed' | 'Stale' | 'Expired' | 'Unknown';
    signalAge: string;
    executionAssessment: string;
  };
  riskReward: TelegramTradeValidationResult['riskReward'];
  technicalContext: {
    technicalAlignment: AlignmentLabel;
    source: string;
    sourcePath: string;
    lastUpdated: string | null;
    trend: string;
    marketStructure: string;
    technicalScore: number | null;
    support: string;
    resistance: string;
    entryLocationQuality: string;
    liquidityContext: string;
    confirmationNeeded: string[];
    assessment: string;
  };
  fundamentalContext: TelegramTradeValidationResult['fundamentalContext'];
  newsAndSessionRisk: TelegramTradeValidationResult['newsAndSessionRisk'];
  hardRejectionReasons: string[];
  softConcerns: string[];
  positiveFactors: string[];
  conflicts: string[];
  whatWouldMakeItValid: string[];
  checklist: TelegramTradeValidationResult['checklist'];
  recommendedAction: FinalAction;
  finalAction: FinalAction;
  invalidation: string[];
  legacy: TelegramTradeValidationResult['legacy'];
};

function normalizeLlmResponse(args: {
  response: LlmValidationResponse;
  parsed: ParsedTelegramSignal;
  rr: SignalRR | null;
  pairContext: PairDecisionContext | null;
  technicalContext: TelegramTradeValidationResult['technicalContext'];
  fundamentalsContext: NonNullable<TelegramTradeValidationResult['fundamentalsContext']>;
  objectiveFacts: ObjectiveFacts;
}): TelegramTradeValidationResult {
  const { parsed, rr, pairContext, technicalContext, fundamentalsContext, objectiveFacts } = args;
  const response = applyHardRejectionOverride(args.response, objectiveFacts);
  const technicalAlignment = response.technicalContext?.technicalAlignment ?? deriveTechnicalAlignment(parsed, pairContext);
  const fundamentalAlignment = response.fundamentalContext?.fundamentalAlignment ?? deriveFundamentalAlignment(parsed, pairContext);
  const confluence = buildConfluence({
    technicalAlignment,
    fundamentalAlignment,
    rr,
    spreadStatus: response.newsAndSessionRisk.spreadStatus,
    volatility: response.newsAndSessionRisk.volatility,
    calendarRisk: response.newsAndSessionRisk.calendarRisk,
    hardReject: objectiveFacts.hardRejectionRequired,
    freshnessStatus: response.executionValidity.freshnessStatus,
  });

  const base: Omit<TelegramTradeValidationResult, 'legacy' | 'confidence'> = {
    ok: true,
    symbol: parsed.symbol ?? 'UNKNOWN',
    verdict: response.verdict,
    decisionLabel: response.decisionLabel,
    rejectionCategory: response.rejectionCategory,
    tradeQualityScore: response.tradeQualityScore,
    executionValidityScore: response.executionValidityScore,
    aiVerdictConfidence: response.aiVerdictConfidence,
    rejectionConfidence: response.rejectionConfidence,
    primaryReason: response.primaryReason,
    summary: response.summary,
    reasoning: response.primaryReason,
    fundamentalAlignment,
    technicalAlignment,
    riskRewardAssessment: response.riskReward.assessment,
    entryAssessment: response.executionValidity.currentPriceVsEntry,
    slAssessment: response.executionValidity.currentPriceVsStopLoss,
    tpAssessment: response.riskReward.assessment,
    keyReasons: [],
    keyRisks: [],
    confirmationNeeded: response.technicalContext.confirmationNeeded ?? [],
    invalidation: response.invalidation,
    finalAction: response.finalAction,
    recommendedAction: response.recommendedAction,
    macroBias: fundamentalsContext.bias,
    calendarRisk: response.newsAndSessionRisk.calendarRisk,
    parsedSignal: {
      symbol: parsed.symbol ?? 'UNKNOWN',
      direction: parsed.direction ?? 'UNKNOWN',
      orderType: parsed.orderType,
      entry: parsed.entry,
      sl: parsed.stopLoss,
      tps: parsed.takeProfits,
    },
    rr,
    technicalContext: {
      ...technicalContext,
      technicalAlignment,
      marketStructure: response.technicalContext.marketStructure,
      technicalScore: response.technicalContext.technicalScore ?? technicalContext.technicalScore,
      entryLocationQuality: response.technicalContext.entryLocationQuality,
      liquidityContext: response.technicalContext.liquidityContext,
      confirmationNeeded: response.technicalContext.confirmationNeeded,
      assessment: response.technicalContext.assessment,
    },
    fundamentalsContext,
    fundamentalContext: response.fundamentalContext,
    executionValidity: response.executionValidity,
    riskReward: response.riskReward,
    newsAndSessionRisk: response.newsAndSessionRisk,
    hardRejectionReasons: response.hardRejectionReasons,
    softConcerns: response.softConcerns,
    positiveFactors: response.positiveFactors,
    conflicts: response.conflicts,
    whatWouldMakeItValid: response.whatWouldMakeItValid,
    checklist: response.checklist,
    confluence,
    pairContext,
    usedAnalysisGeneratedAt: pairContext?.dataGeneratedAt ?? null,
    noAnalysisFound: !pairContext,
  };

  const legacy = buildLegacyFields(base);
  return {
    ...base,
    confidence: legacy.confidence,
    reasoning: legacy.reasoning,
    riskRewardAssessment: legacy.riskRewardAssessment,
    entryAssessment: legacy.entryAssessment,
    slAssessment: legacy.slAssessment,
    tpAssessment: legacy.tpAssessment,
    keyReasons: legacy.keyReasons,
    keyRisks: legacy.keyRisks,
    legacy,
  };
}

export async function validateTelegramTradeSignal(
  rawText: string,
  overrideParsed?: Partial<ParsedTelegramSignal>,
  meta?: SignalAnalysisMeta,
): Promise<TelegramTradeValidationResult | SignalAnalysisError> {
  const parsed: ParsedTelegramSignal = {
    ...parseTelegramSignal(rawText),
    ...overrideParsed,
  };

  if (!parsed.symbol) return { ok: false, error: 'Could not detect a trading symbol in this signal.' };
  if (!parsed.direction) return { ok: false, error: 'Could not detect trade direction (BUY/SELL) in this signal.' };

  const signalTime = meta?.signalTime ?? null;
  const sourceMessage = meta?.sourceMessage ?? rawText;
  const rr = computeRR(parsed);

  console.log('[telegram-analysis] loading pair technical context', {
    symbol: parsed.symbol,
    source: `/pair/${parsed.symbol}`,
  });

  let pairContext: PairDecisionContext | null = null;
  try {
    pairContext = await getPairDecisionContext(parsed.symbol);
    console.log('[telegram-analysis] pair technical context loaded', {
      symbol: parsed.symbol,
      currentPrice: pairContext.price,
      trend: pairContext.directionBias,
      marketStructure: pairContext.marketStructure,
      support: pairContext.support,
      resistance: pairContext.resistance,
      technicalScore: pairContext.technicalScore,
      spread: pairContext.currentSpread,
      volatility: pairContext.volatility,
      session: pairContext.session,
      updatedAt: pairContext.priceUpdatedAt,
    });
  } catch (error) {
    console.error('[telegram-analysis] pair technical context unavailable', {
      symbol: parsed.symbol,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  console.log('[telegram-analysis] loading fundamentals', {
    symbol: parsed.symbol,
    source: `/market-intelligence/fundamentals/${parsed.symbol}`,
  });

  if (pairContext) {
    console.log('[telegram-analysis] fundamentals loaded', {
      symbol: parsed.symbol,
      bias: pairContext.macroBias,
      confidence: pairContext.macroConfidence,
      updatedAt: pairContext.fundamentalsUpdatedAt,
      driverCount: pairContext.topDrivers.length,
    });
  } else {
    console.error('[telegram-analysis] fundamentals unavailable', {
      symbol: parsed.symbol,
      error: 'Pair decision context unavailable.',
    });
  }

  const analysisTime = new Date().toISOString();
  const technicalContext = pairContext
    ? buildTechnicalContextFromPair(pairContext, parsed.symbol)
    : buildEmptyTechnicalContext(parsed.symbol);
  const fundamentalsContext = buildFundamentalsContext(pairContext);
  const objectiveFacts = buildObjectiveValidationFacts({
    symbol: parsed.symbol,
    parsed,
    rr,
    pairContext,
    technicalContext,
    signalTime,
    analysisTime,
  });

  const livePriceContext = buildLivePriceContext(pairContext);
  const technicalPairContext = buildTechnicalPromptContext(pairContext, technicalContext);
  const fundContext = buildFundamentalsPromptContext(pairContext);
  const objectiveValidationContext = buildObjectiveValidationContext(objectiveFacts);

  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackValidation({
      parsed,
      rr,
      pairContext,
      objectiveFacts,
      technicalContext,
      fundamentalsContext,
      noAnalysisFound: !pairContext,
      aiValidationUnavailable: true,
      aiValidationError: 'OPENAI_API_KEY is not configured.',
      usedAnalysisGeneratedAt: pairContext?.dataGeneratedAt ?? null,
    });
  }

  const systemPrompt = `You are a professional XAU/USD and Forex trade validation analyst.

You validate Telegram trading signals using:
1. live MT5 bridge prices,
2. AlphaMentals pair technical analysis from /pair/{symbol},
3. AlphaMentals fundamentals from /market-intelligence/fundamentals/{symbol},
4. backend-calculated objective validation facts.

Your job is NOT to blindly summarize the Telegram signal.
Your job is to decide whether the signal is actually tradable before the user risks money.

Return only valid JSON. Do not include markdown. Do not include text outside JSON.

Use this exact JSON schema:

{
  "verdict": "GOOD | RISKY | BAD | WAIT",
  "decisionLabel": "ACCEPTED | REJECTED | WAIT | NEEDS_CONFIRMATION",
  "rejectionCategory": "NONE | INVALID_ORDER_TYPE | ALREADY_INVALIDATED | STALE_SIGNAL | MACRO_CONFLICT | TECHNICAL_CONFLICT | POOR_RR | BAD_EXECUTION_CONDITIONS | INSUFFICIENT_DATA",
  "tradeQualityScore": 0,
  "executionValidityScore": 0,
  "aiVerdictConfidence": 0,
  "rejectionConfidence": 0,
  "summary": "...",
  "primaryReason": "...",

  "executionValidity": {
    "orderTypeValid": true,
    "orderTypeAssessment": "...",
    "currentPriceVsEntry": "...",
    "currentPriceVsStopLoss": "...",
    "alreadyInvalidated": false,
    "entryDistance": "...",
    "entryDistanceR": null,
    "freshnessStatus": "Fresh | Delayed | Stale | Expired | Unknown",
    "signalAge": "...",
    "executionAssessment": "..."
  },

  "riskReward": {
    "riskSize": null,
    "tpAssessments": [
      {
        "tp": "...",
        "rr": null,
        "quality": "good | acceptable | weak | very_weak | unavailable",
        "comment": "..."
      }
    ],
    "overallQuality": "good | mixed | poor | unavailable",
    "assessment": "..."
  },

  "technicalContext": {
    "technicalAlignment": "aligned | against | mixed | unavailable",
    "source": "AlphaMentals Pair Analysis",
    "sourcePath": "...",
    "lastUpdated": "...",
    "trend": "...",
    "marketStructure": "...",
    "technicalScore": null,
    "support": "...",
    "resistance": "...",
    "entryLocationQuality": "...",
    "liquidityContext": "...",
    "confirmationNeeded": ["..."],
    "assessment": "..."
  },

  "fundamentalContext": {
    "fundamentalAlignment": "aligned | against | mixed | unavailable",
    "source": "AlphaMentals Fundamentals",
    "sourcePath": "...",
    "lastUpdated": "...",
    "macroBias": "...",
    "macroConfidence": null,
    "keyDrivers": ["..."],
    "assessment": "..."
  },

  "newsAndSessionRisk": {
    "calendarRisk": "low | medium | high | unavailable",
    "headlineRisk": "low | medium | high | unavailable",
    "session": "...",
    "liquidityQuality": "good | reduced | poor | unavailable",
    "spreadStatus": "normal | elevated | dangerous | unavailable",
    "volatility": "low | normal | high | extreme | unavailable",
    "assessment": "..."
  },

  "hardRejectionReasons": ["..."],
  "softConcerns": ["..."],
  "positiveFactors": ["..."],
  "conflicts": ["..."],
  "whatWouldMakeItValid": ["..."],
  "checklist": [
    {
      "item": "...",
      "status": "pass | fail | warning | unavailable",
      "details": "..."
    }
  ],
  "recommendedAction": "take | wait | avoid | monitor",
  "finalAction": "take | wait | avoid | monitor",
  "invalidation": ["..."],

  "legacy": {
    "confidence": 0,
    "reasoning": "...",
    "riskRewardAssessment": "...",
    "entryAssessment": "...",
    "slAssessment": "...",
    "tpAssessment": "...",
    "keyReasons": ["..."],
    "keyRisks": ["..."]
  }
}

Critical rules:

1. Respect backend-calculated objective validation facts.
If the backend says a hard rejection is required, do not override it.

2. Order type validity:
- BUY LIMIT must be below current market price.
- SELL LIMIT must be above current market price.
- BUY STOP must be above current market price.
- SELL STOP must be below current market price.
- If this fails, verdict must be BAD, decisionLabel REJECTED, finalAction avoid.

3. Stop loss invalidation:
- SELL is invalid if current price is already above SL.
- BUY is invalid if current price is already below SL.
- If invalidated, verdict must be BAD, decisionLabel REJECTED, finalAction avoid.

4. Signal freshness:
- If signal is old, delayed, or price has moved far from entry, mark Stale or Expired.
- Treat stale XAU/USD signals conservatively.

5. Entry distance:
- Compare current price to entry.
- Show distance in price units.
- Show distance in R when possible.

6. Risk/reward:
- TP1 below 1R is weak.
- TP1 below 0.5R is very weak.
- If TP2 is good but TP1 is poor, classify RR as mixed, not good.

7. Support/resistance:
- Selling into support is negative.
- Buying into resistance is negative.
- If support/resistance is unavailable, say unavailable.

8. Fundamentals:
- Use only AlphaMentals fundamentals context from /market-intelligence/fundamentals/{symbol}.
- Do not invent macro bias.
- SELL vs bullish XAU/USD fundamentals is a macro conflict.
- BUY vs bearish XAU/USD fundamentals is a macro conflict.

9. Technicals:
- Use only AlphaMentals pair analysis context from /pair/{symbol}.
- Do not invent trend, support, resistance, or market structure.
- If technical data is unavailable, say unavailable.

10. XAU/USD macro reasoning:
When data is available, consider USD strength, yields, Fed expectations, inflation, jobs data, CPI/PPI/FOMC, geopolitical risk, safe-haven demand, risk sentiment, and major headlines.

11. News/session/spread:
High-impact news, headline risk, session closed, elevated spread, or extreme volatility reduces trade quality.

12. Confidence logic:
- tradeQualityScore = quality of taking the trade.
- rejectionConfidence = confidence in rejecting the trade.
- aiVerdictConfidence = confidence in the final verdict.
- If rejecting a clearly invalid trade, tradeQualityScore can be 0 while rejectionConfidence should be high.

13. Source transparency:
Every major conclusion must reference the data used.
Example: "Rejected because current price 4505.90 is above sell SL 4496.10."

14. Conservative behavior:
Missing current price = cannot validate execution.
Missing SL = reject.
Missing entry for pending order = reject.
Missing fundamentals = reduce macro confidence.
Missing technicals = reduce technical confidence.
Never hallucinate missing values.

15. Final verdict must respect hard rejection rules.
If invalid order type, already invalidated, missing SL, missing entry, or expired signal is detected, verdict must be BAD and finalAction must be avoid.`;

  const userPrompt = buildSignalPrompt({
    parsed,
    rr,
    pairContext,
    technicalPairContext,
    fundContext,
    livePriceContext,
    objectiveValidationContext,
    signalTime,
    sourceMessage,
  });

  try {
    const response = await chatCompleteJSON<LlmValidationResponse>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        maxTokens: 1800,
        temperature: 0.1,
        model: SIGNAL_MODEL,
        symbols: [parsed.symbol],
        feature: 'telegram',
        operation: 'auto_signal_validation',
      },
    );

    return normalizeLlmResponse({
      response,
      parsed,
      rr,
      pairContext,
      technicalContext,
      fundamentalsContext,
      objectiveFacts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI validation error';
    return buildFallbackValidation({
      parsed,
      rr,
      pairContext,
      objectiveFacts,
      technicalContext,
      fundamentalsContext,
      noAnalysisFound: !pairContext,
      aiValidationUnavailable: true,
      aiValidationError: message,
      usedAnalysisGeneratedAt: pairContext?.dataGeneratedAt ?? null,
    });
  }
}

export async function analyzeSignalWithAI(
  rawText: string,
  overrideParsed?: Partial<ParsedTelegramSignal>,
  meta?: SignalAnalysisMeta,
): Promise<SignalAnalysisResult | SignalAnalysisError> {
  const result = await validateTelegramTradeSignal(rawText, overrideParsed, meta);
  if (result.ok === false) return result;

  return {
    ok: true,
    symbol: result.symbol,
    verdict: result.verdict,
    confidence: result.confidence,
    summary: result.summary,
    alignment: {
      fundamentals: result.fundamentalAlignment,
      technical: result.technicalAlignment,
      riskReward: rrLabel(result.rr),
    },
    parsedSignal: {
      direction: result.parsedSignal.direction,
      orderType: result.parsedSignal.orderType,
      entry: result.parsedSignal.entry,
      sl: result.parsedSignal.sl,
      tps: result.parsedSignal.tps,
    },
    rr: result.rr,
    reasoning: result.reasoning,
    warnings: result.keyRisks,
    usedAnalysisGeneratedAt: result.usedAnalysisGeneratedAt,
    details: result,
  };
}
