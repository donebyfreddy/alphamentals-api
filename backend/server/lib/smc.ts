import type { Candle, Quote } from './yahoo.js';

export const VALID_SMC_SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD'] as const;
export type ValidSmcSymbol = (typeof VALID_SMC_SYMBOLS)[number];
export type SmcTimeframe = '15m' | '30m' | '1h' | '4h' | '1d';
export type SmcBias = 'bullish' | 'bearish' | 'neutral';
export type SmcAction = 'watch' | 'prepare entry' | 'ignore';

export interface Zone {
  low: number;
  high: number;
  sourceTime: number;
}

export interface OrderBlock extends Zone {
  direction: 'buy' | 'sell';
}

export interface Fvg extends Zone {
  direction: 'bullish' | 'bearish';
}

export interface StructureEvent {
  type: 'BOS' | 'CHoCH';
  direction: SmcBias;
  level: number;
  time: number;
}

export interface LiquidityPool {
  side: 'buy-side' | 'sell-side';
  level: number;
  time: number;
}

export interface TimeframeAnalysis {
  timeframe: SmcTimeframe;
  bias: SmcBias;
  structure: string;
  bosEvents: StructureEvent[];
  chochEvents: StructureEvent[];
  buySideLiquidity: LiquidityPool[];
  sellSideLiquidity: LiquidityPool[];
  supplyZones: Zone[];
  demandZones: Zone[];
  orderBlocks: OrderBlock[];
  bullishFvgs: Fvg[];
  bearishFvgs: Fvg[];
  liquiditySweep?: {
    side: 'buy-side' | 'sell-side';
    level: number;
    time: number;
  };
}

export interface TradeIdea {
  entryType: 'buy' | 'sell';
  entryZone: Zone;
  stopLossLogic: string;
  targetLogic: string;
  confidence: number;
}

export interface SmcAlert {
  instrument: ValidSmcSymbol;
  eventType: 'CHoCH' | 'BOS' | 'FVG touch' | 'zone entry' | 'liquidity sweep' | 'bias alignment';
  timeframe: SmcTimeframe | 'M15-D1';
  directionalBias: SmcBias;
  suggestedAction: SmcAction;
}

export interface SmcReport {
  instrument: ValidSmcSymbol;
  biasSummary: Record<SmcTimeframe, SmcBias> & { overallAlignment: string };
  keyLevels: {
    supplyZones: Zone[];
    demandZones: Zone[];
    orderBlocks: OrderBlock[];
    liquidityPools: LiquidityPool[];
  };
  structureAnalysis: {
    bosEvents: StructureEvent[];
    chochEvents: StructureEvent[];
  };
  fvgMap: {
    bullishFvgs: Fvg[];
    bearishFvgs: Fvg[];
  };
  tradeIdeas: TradeIdea[];
  alerts: SmcAlert[];
  timeframeAnalysis: Record<SmcTimeframe, TimeframeAnalysis>;
}

const TIMEFRAMES: SmcTimeframe[] = ['15m', '30m', '1h', '4h', '1d'];

export function normalizeSmcSymbol(symbol: string): ValidSmcSymbol | null {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  const corrected = normalized === 'GDPUSD' ? 'GBPUSD' : normalized;
  return VALID_SMC_SYMBOLS.includes(corrected as ValidSmcSymbol)
    ? (corrected as ValidSmcSymbol)
    : null;
}

export function aggregateCandles(candles: Candle[], groupSize: number): Candle[] {
  if (groupSize <= 1) return candles;
  const aggregated: Candle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (group.length < groupSize) continue;
    aggregated.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + (c.volume || 0), 0),
    });
  }
  return aggregated;
}

function round(price: number) {
  return Number(price.toFixed(price > 100 ? 2 : 5));
}

function candleBody(c: Candle) {
  return Math.abs(c.close - c.open);
}

function averageBody(candles: Candle[]) {
  const sample = candles.slice(-30);
  return sample.reduce((sum, c) => sum + candleBody(c), 0) / Math.max(sample.length, 1);
}

function findSwings(candles: Candle[], lookback = 2) {
  const highs: LiquidityPool[] = [];
  const lows: LiquidityPool[] = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const c = candles[i];
    const left = candles.slice(i - lookback, i);
    const right = candles.slice(i + 1, i + 1 + lookback);
    if ([...left, ...right].every((x) => c.high > x.high)) {
      highs.push({ side: 'buy-side', level: round(c.high), time: c.time });
    }
    if ([...left, ...right].every((x) => c.low < x.low)) {
      lows.push({ side: 'sell-side', level: round(c.low), time: c.time });
    }
  }
  return { highs, lows };
}

function determineBias(highs: LiquidityPool[], lows: LiquidityPool[], candles: Candle[]): SmcBias {
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  if (lastHighs.length < 2 || lastLows.length < 2) return 'neutral';

  const higherHigh = lastHighs[1].level > lastHighs[0].level;
  const higherLow = lastLows[1].level > lastLows[0].level;
  const lowerHigh = lastHighs[1].level < lastHighs[0].level;
  const lowerLow = lastLows[1].level < lastLows[0].level;
  const close = candles[candles.length - 1]?.close ?? 0;

  if (higherHigh && higherLow && close >= lastLows[1].level) return 'bullish';
  if (lowerHigh && lowerLow && close <= lastHighs[1].level) return 'bearish';
  return 'neutral';
}

function structureEvents(candles: Candle[], bias: SmcBias, highs: LiquidityPool[], lows: LiquidityPool[]) {
  const close = candles[candles.length - 1]?.close;
  const time = candles[candles.length - 1]?.time;
  const previousHigh = highs[highs.length - 1];
  const previousLow = lows[lows.length - 1];
  const bosEvents: StructureEvent[] = [];
  const chochEvents: StructureEvent[] = [];

  if (!close || !time) return { bosEvents, chochEvents };

  if (previousHigh && close > previousHigh.level) {
    const event: StructureEvent = { type: bias === 'bearish' ? 'CHoCH' : 'BOS', direction: 'bullish', level: previousHigh.level, time };
    (event.type === 'CHoCH' ? chochEvents : bosEvents).push(event);
  }

  if (previousLow && close < previousLow.level) {
    const event: StructureEvent = { type: bias === 'bullish' ? 'CHoCH' : 'BOS', direction: 'bearish', level: previousLow.level, time };
    (event.type === 'CHoCH' ? chochEvents : bosEvents).push(event);
  }

  return { bosEvents, chochEvents };
}

function findFvgs(candles: Candle[]): { bullishFvgs: Fvg[]; bearishFvgs: Fvg[] } {
  const bullishFvgs: Fvg[] = [];
  const bearishFvgs: Fvg[] = [];
  for (let i = 2; i < candles.length; i += 1) {
    const first = candles[i - 2];
    const third = candles[i];
    if (first.high < third.low) {
      bullishFvgs.push({ direction: 'bullish', low: round(first.high), high: round(third.low), sourceTime: third.time });
    }
    if (first.low > third.high) {
      bearishFvgs.push({ direction: 'bearish', low: round(third.high), high: round(first.low), sourceTime: third.time });
    }
  }
  return { bullishFvgs: bullishFvgs.slice(-5), bearishFvgs: bearishFvgs.slice(-5) };
}

function findZonesAndOrderBlocks(candles: Candle[]) {
  const supplyZones: Zone[] = [];
  const demandZones: Zone[] = [];
  const orderBlocks: OrderBlock[] = [];
  const avgBody = averageBody(candles);

  for (let i = 1; i < candles.length; i += 1) {
    const previous = candles[i - 1];
    const current = candles[i];
    const body = candleBody(current);
    const displacement = body > avgBody * 1.5;

    if (displacement && current.close > current.open) {
      demandZones.push({ low: round(current.low), high: round(Math.min(current.open, current.close)), sourceTime: current.time });
      if (previous.close < previous.open) {
        orderBlocks.push({ direction: 'buy', low: round(previous.low), high: round(previous.high), sourceTime: previous.time });
      }
    }

    if (displacement && current.close < current.open) {
      supplyZones.push({ low: round(Math.max(current.open, current.close)), high: round(current.high), sourceTime: current.time });
      if (previous.close > previous.open) {
        orderBlocks.push({ direction: 'sell', low: round(previous.low), high: round(previous.high), sourceTime: previous.time });
      }
    }
  }

  return {
    supplyZones: supplyZones.slice(-5),
    demandZones: demandZones.slice(-5),
    orderBlocks: orderBlocks.slice(-6),
  };
}

function detectLiquiditySweep(candles: Candle[], highs: LiquidityPool[], lows: LiquidityPool[]): TimeframeAnalysis['liquiditySweep'] {
  const last = candles[candles.length - 1];
  const previousHigh = highs[highs.length - 1];
  const previousLow = lows[lows.length - 1];
  if (!last) return undefined;
  if (previousHigh && last.high > previousHigh.level && last.close < previousHigh.level) {
    return { side: 'buy-side', level: previousHigh.level, time: last.time };
  }
  if (previousLow && last.low < previousLow.level && last.close > previousLow.level) {
    return { side: 'sell-side', level: previousLow.level, time: last.time };
  }
  return undefined;
}

function containsPrice(zone: Zone, price: number) {
  return price >= zone.low && price <= zone.high;
}

function analyzeTimeframe(timeframe: SmcTimeframe, candles: Candle[]): TimeframeAnalysis {
  const clean = candles.filter((c) => c.close > 0).slice(-180);
  const { highs, lows } = findSwings(clean);
  const bias = determineBias(highs, lows, clean);
  const { bosEvents, chochEvents } = structureEvents(clean, bias, highs, lows);
  const { bullishFvgs, bearishFvgs } = findFvgs(clean);
  const { supplyZones, demandZones, orderBlocks } = findZonesAndOrderBlocks(clean);
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  const structure = lastHighs.length >= 2 && lastLows.length >= 2
    ? `${lastHighs[1].level > lastHighs[0].level ? 'Higher Highs' : 'Lower Highs'} / ${lastLows[1].level > lastLows[0].level ? 'Higher Lows' : 'Lower Lows'}`
    : 'Insufficient confirmed swings';

  return {
    timeframe,
    bias,
    structure,
    bosEvents,
    chochEvents,
    buySideLiquidity: highs.slice(-5),
    sellSideLiquidity: lows.slice(-5),
    supplyZones,
    demandZones,
    orderBlocks,
    bullishFvgs,
    bearishFvgs,
    liquiditySweep: detectLiquiditySweep(clean, highs, lows),
  };
}

function makeTradeIdea(report: Record<SmcTimeframe, TimeframeAnalysis>, price: number): TradeIdea[] {
  const higher = [report['1d'].bias, report['4h'].bias, report['1h'].bias];
  const bullishVotes = higher.filter((b) => b === 'bullish').length;
  const bearishVotes = higher.filter((b) => b === 'bearish').length;
  const execution = report['1h'];

  if (bullishVotes >= 2) {
    const zone = [...execution.demandZones, ...execution.bullishFvgs, ...execution.orderBlocks.filter((ob) => ob.direction === 'buy')]
      .sort((a, b) => Math.abs(price - ((a.low + a.high) / 2)) - Math.abs(price - ((b.low + b.high) / 2)))[0];
    if (zone) {
      return [{
        entryType: 'buy',
        entryZone: zone,
        stopLossLogic: `Below sell-side liquidity under ${round(zone.low)}`,
        targetLogic: `First target buy-side liquidity near ${execution.buySideLiquidity.at(-1)?.level ?? 'next swing high'}`,
        confidence: Math.min(100, 55 + bullishVotes * 10 + (execution.chochEvents.length ? 10 : 0)),
      }];
    }
  }

  if (bearishVotes >= 2) {
    const zone = [...execution.supplyZones, ...execution.bearishFvgs, ...execution.orderBlocks.filter((ob) => ob.direction === 'sell')]
      .sort((a, b) => Math.abs(price - ((a.low + a.high) / 2)) - Math.abs(price - ((b.low + b.high) / 2)))[0];
    if (zone) {
      return [{
        entryType: 'sell',
        entryZone: zone,
        stopLossLogic: `Above buy-side liquidity over ${round(zone.high)}`,
        targetLogic: `First target sell-side liquidity near ${execution.sellSideLiquidity.at(-1)?.level ?? 'next swing low'}`,
        confidence: Math.min(100, 55 + bearishVotes * 10 + (execution.chochEvents.length ? 10 : 0)),
      }];
    }
  }

  return [];
}

function makeAlerts(symbol: ValidSmcSymbol, report: Record<SmcTimeframe, TimeframeAnalysis>, price: number): SmcAlert[] {
  const alerts: SmcAlert[] = [];
  for (const tf of TIMEFRAMES) {
    const analysis = report[tf];
    if (['1h', '4h', '1d'].includes(tf) && analysis.chochEvents.length) {
      alerts.push({ instrument: symbol, eventType: 'CHoCH', timeframe: tf, directionalBias: analysis.chochEvents.at(-1)?.direction ?? analysis.bias, suggestedAction: 'prepare entry' });
    }
    if (analysis.bosEvents.length) {
      alerts.push({ instrument: symbol, eventType: 'BOS', timeframe: tf, directionalBias: analysis.bosEvents.at(-1)?.direction ?? analysis.bias, suggestedAction: 'watch' });
    }
    if ([...analysis.bullishFvgs, ...analysis.bearishFvgs].some((fvg) => containsPrice(fvg, price))) {
      alerts.push({ instrument: symbol, eventType: 'FVG touch', timeframe: tf, directionalBias: analysis.bias, suggestedAction: 'prepare entry' });
    }
    if ([...analysis.supplyZones, ...analysis.demandZones].some((zone) => containsPrice(zone, price))) {
      alerts.push({ instrument: symbol, eventType: 'zone entry', timeframe: tf, directionalBias: analysis.bias, suggestedAction: 'prepare entry' });
    }
    if (analysis.liquiditySweep) {
      alerts.push({ instrument: symbol, eventType: 'liquidity sweep', timeframe: tf, directionalBias: analysis.bias, suggestedAction: 'watch' });
    }
  }

  const biases = TIMEFRAMES.map((tf) => report[tf].bias);
  if (biases.every((bias) => bias === 'bullish') || biases.every((bias) => bias === 'bearish')) {
    alerts.push({ instrument: symbol, eventType: 'bias alignment', timeframe: 'M15-D1', directionalBias: biases[0], suggestedAction: 'watch' });
  }

  return alerts;
}

export function buildSmcReport(
  symbol: ValidSmcSymbol,
  candlesByTimeframe: Record<SmcTimeframe, Candle[]>,
  quote?: Quote,
): SmcReport {
  const timeframeAnalysis = TIMEFRAMES.reduce((acc, tf) => {
    acc[tf] = analyzeTimeframe(tf, candlesByTimeframe[tf] ?? []);
    return acc;
  }, {} as Record<SmcTimeframe, TimeframeAnalysis>);
  const price = quote?.mid ?? candlesByTimeframe['1h'].at(-1)?.close ?? 0;
  const tradeIdeas = makeTradeIdea(timeframeAnalysis, price);
  const d1 = timeframeAnalysis['1d'].bias;
  const h4 = timeframeAnalysis['4h'].bias;
  const h1 = timeframeAnalysis['1h'].bias;
  const alignment = [d1, h4, h1].filter((bias) => bias !== 'neutral');
  const overallAlignment = alignment.length >= 2 && alignment[0] === alignment[1]
    ? `${alignment[0]} higher-timeframe alignment`
    : 'mixed or neutral higher-timeframe alignment';

  return {
    instrument: symbol,
    biasSummary: {
      '1d': d1,
      '4h': h4,
      '1h': h1,
      '30m': timeframeAnalysis['30m'].bias,
      '15m': timeframeAnalysis['15m'].bias,
      overallAlignment,
    },
    keyLevels: {
      supplyZones: [...timeframeAnalysis['4h'].supplyZones, ...timeframeAnalysis['1h'].supplyZones].slice(-6),
      demandZones: [...timeframeAnalysis['4h'].demandZones, ...timeframeAnalysis['1h'].demandZones].slice(-6),
      orderBlocks: [...timeframeAnalysis['4h'].orderBlocks, ...timeframeAnalysis['1h'].orderBlocks].slice(-6),
      liquidityPools: [
        ...timeframeAnalysis['4h'].buySideLiquidity,
        ...timeframeAnalysis['4h'].sellSideLiquidity,
        ...timeframeAnalysis['1h'].buySideLiquidity,
        ...timeframeAnalysis['1h'].sellSideLiquidity,
      ].slice(-10),
    },
    structureAnalysis: {
      bosEvents: TIMEFRAMES.flatMap((tf) => timeframeAnalysis[tf].bosEvents),
      chochEvents: TIMEFRAMES.flatMap((tf) => timeframeAnalysis[tf].chochEvents),
    },
    fvgMap: {
      bullishFvgs: [...timeframeAnalysis['4h'].bullishFvgs, ...timeframeAnalysis['1h'].bullishFvgs, ...timeframeAnalysis['30m'].bullishFvgs].slice(-8),
      bearishFvgs: [...timeframeAnalysis['4h'].bearishFvgs, ...timeframeAnalysis['1h'].bearishFvgs, ...timeframeAnalysis['30m'].bearishFvgs].slice(-8),
    },
    tradeIdeas,
    alerts: makeAlerts(symbol, timeframeAnalysis, price),
    timeframeAnalysis,
  };
}
