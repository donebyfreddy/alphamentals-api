import { buildPairAnalysis } from './pairAnalysis.service.js';
import { getActiveSession, getNextSession } from '../../../src/utils/sessions/sessionTimes.js';
import { getTradingCalendarContext } from './myfxbookCalendar.service.js';

export interface PairDecisionContext {
  symbol: string;
  displaySymbol: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  priceUpdatedAt: string | null;
  dayHigh: number | null;
  dayLow: number | null;
  directionBias: 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
  directionConfidence: number;
  technicalBias: string;
  technicalScore: number;
  technicalSummary: string;
  marketStructure: string;
  macroBias: 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
  macroConfidence: number;
  fundamentalBias: string;
  fundamentalConfidence: number;
  fundamentalSummary: string;
  fundamentalReason: string;
  calendarRisk: 'low' | 'medium' | 'high';
  highImpactEvents: string[];
  economicCalendarWarning: string | null;
  topDrivers: string[];
  bullishDrivers: string[];
  bearishDrivers: string[];
  spreadStatus: 'normal' | 'wide' | 'unavailable';
  currentSpread: number | null;
  volatility: number | null;
  support: number | null;
  resistance: number | null;
  session: string;
  nextSession: string | null;
  tradeStatus: string;
  tradeStatusLabel: string;
  verdict: string;
  verdictScore: number;
  reasoning: string;
  risks: string[];
  invalidation: string;
  dataGeneratedAt: string | null;
  fundamentalsUpdatedAt: string | null;
  mode: 'ai-enhanced' | 'rules-based';
}

type PairAnalysis = Awaited<ReturnType<typeof buildPairAnalysis>>;

function deriveCalendarRisk(analysis: PairAnalysis): 'low' | 'medium' | 'high' {
  if (analysis.intelligence.tradeStatus === 'high_risk') return 'high';
  const next = analysis.nextHighImpactEvent;
  if (next && next.isFuture) {
    if (next.minutesUntil <= 60) return 'high';
    if (next.minutesUntil <= 180) return 'medium';
  }
  return 'low';
}

function deriveSpreadInfo(
  bid: number | null,
  ask: number | null,
  price: number | null,
): { spreadStatus: 'normal' | 'wide' | 'unavailable'; currentSpread: number | null } {
  if (bid == null || ask == null || price == null || price === 0) {
    return { spreadStatus: 'unavailable', currentSpread: null };
  }
  const spread = ask - bid;
  const spreadPct = (spread / price) * 100;
  return {
    spreadStatus: spreadPct > 0.05 ? 'wide' : 'normal',
    currentSpread: Number(spread.toFixed(5)),
  };
}

export async function getPairDecisionContext(symbol: string): Promise<PairDecisionContext> {
  const [analysis, liveCalendarContext] = await Promise.all([
    buildPairAnalysis(symbol, { preferSavedAi: true }),
    getTradingCalendarContext(symbol).catch(() => null),
  ]);

  const derivedCalendarRisk = deriveCalendarRisk(analysis);
  const calendarRisk = liveCalendarContext && (liveCalendarContext.riskLevel === 'high' || derivedCalendarRisk !== 'high')
    ? liveCalendarContext.riskLevel
    : derivedCalendarRisk;
  const { spreadStatus, currentSpread } = deriveSpreadInfo(
    analysis.price.bid,
    analysis.price.ask,
    analysis.price.current,
  );

  const highImpactEvents = analysis.relevantEvents
    .filter((e) => e.impact === 'high' && e.isFuture)
    .slice(0, 5)
    .map((e) => {
      const currency = e.currency ? ` (${e.currency})` : '';
      return `${e.eventName}${currency} in ${e.minutesUntil}m`;
    });
  const mergedHighImpactEvents = liveCalendarContext?.upcomingHighImpactEvents?.length
    ? liveCalendarContext.upcomingHighImpactEvents
    : highImpactEvents;

  let volatility: number | null = null;
  if (analysis.price.dayHigh != null && analysis.price.dayLow != null) {
    volatility = Number((analysis.price.dayHigh - analysis.price.dayLow).toFixed(5));
  }

  const activeSession = getActiveSession();
  const nextSess = getNextSession();
  const nextSessionLabel = nextSess ? `${nextSess.session.name} in ${nextSess.opensInMinutes}m` : null;

  return {
    symbol: analysis.symbol,
    displaySymbol: analysis.displaySymbol,
    price: analysis.price.current,
    bid: analysis.price.bid,
    ask: analysis.price.ask,
    priceUpdatedAt: analysis.price.updatedAt,
    dayHigh: analysis.price.dayHigh,
    dayLow: analysis.price.dayLow,
    directionBias: analysis.overallBias,
    directionConfidence: analysis.overallConfidence,
    technicalBias: analysis.intelligence.technicalBias.direction,
    technicalScore: analysis.intelligence.technicalBias.percentage,
    technicalSummary: analysis.intelligence.technicalBias.summary,
    marketStructure: analysis.intelligence.tradePlan.preferredDirection,
    macroBias: analysis.fundamentals.bias,
    macroConfidence: analysis.fundamentals.confidence,
    fundamentalBias: analysis.intelligence.fundamentalBias.direction,
    fundamentalConfidence: analysis.intelligence.fundamentalBias.percentage,
    fundamentalSummary: analysis.intelligence.fundamentalBias.summary,
    fundamentalReason: analysis.fundamentals.reason,
    calendarRisk,
    highImpactEvents: mergedHighImpactEvents,
    economicCalendarWarning: liveCalendarContext?.warning ?? null,
    topDrivers: analysis.fundamentals.keyDrivers,
    bullishDrivers: analysis.fundamentals.bullishDrivers,
    bearishDrivers: analysis.fundamentals.bearishDrivers,
    spreadStatus,
    currentSpread,
    volatility,
    support: analysis.price.dayLow,
    resistance: analysis.price.dayHigh,
    session: activeSession?.name ?? 'Closed',
    nextSession: nextSessionLabel,
    tradeStatus: analysis.intelligence.tradeStatus,
    tradeStatusLabel: analysis.tradeStatus.label,
    verdict: analysis.intelligence.overallBias,
    verdictScore: analysis.intelligence.biasPercentage,
    reasoning: analysis.intelligence.summary,
    risks: [
      ...(liveCalendarContext?.warning ? [liveCalendarContext.warning] : []),
      ...analysis.intelligence.risks,
    ],
    invalidation: analysis.intelligence.invalidation,
    dataGeneratedAt: analysis.fundamentals.lastUpdated,
    fundamentalsUpdatedAt: analysis.fundamentals.lastUpdated,
    mode: analysis.fundamentals.mode,
  };
}
