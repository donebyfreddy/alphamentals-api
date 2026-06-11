/**
 * Market structure engine — analyses REAL MT5 candles per timeframe.
 *
 * Computes swing highs/lows (fractals), break-of-structure (BOS),
 * change-of-character (CHoCH), trend direction, ATR-normalised trend
 * strength, and range/consolidation detection.
 *
 * Never fabricates "Neutral Consolidation" — if a timeframe lacks the
 * required candle count it returns status: 'insufficient_data' with a reason.
 */

import type { Mt5Candle, Mt5Timeframe, TimeframeCandleResult } from './mt5Candles.service.js';

export type StructureDirection = 'bullish' | 'bearish' | 'neutral' | 'consolidation';
export type StructureLabel =
  | 'Bullish BOS' | 'Bearish BOS'
  | 'CHoCH bullish' | 'CHoCH bearish'
  | 'Range' | 'Consolidation' | 'Insufficient data';

export interface SwingPoint {
  type: 'high' | 'low';
  price: number;
  time: string;
  index: number;
}

export interface StructureEvent {
  direction: 'bullish' | 'bearish';
  price: number;
  time: string;
}

export interface TimeframeStructure {
  timeframe: Mt5Timeframe;
  availableCandles: number;
  requiredCandles: number;
  status: 'ok' | 'insufficient_data';
  direction: StructureDirection;
  trendStrength: number; // 0-100
  structureLabel: StructureLabel;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  lastBOS: StructureEvent | null;
  lastCHoCH: StructureEvent | null;
  atr: number | null;
  rangePct: number | null; // recent range / price * 100
  explanation: string;
  reason?: string; // only when insufficient_data
}

export interface MarketStructureResult {
  symbol: string;
  alignmentScore: number; // 0-100, higher = stronger multi-TF agreement
  overallDirection: StructureDirection | 'mixed';
  timeframes: TimeframeStructure[];
  explanation: string;
}

// Higher-timeframe fractal needs a wider window than lower TFs.
const FRACTAL_WINDOW: Record<Mt5Timeframe, number> = {
  W1: 2, D1: 2, H4: 3, H1: 3, M15: 3,
};

// Multi-timeframe alignment weights (HTF carries more weight).
const TF_WEIGHT: Record<Mt5Timeframe, number> = {
  W1: 6, D1: 5, H4: 4, H1: 3, M15: 2,
};

function computeATR(candles: Mt5Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (!prev) continue;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  if (!trs.length) return null;
  return trs.reduce((sum, v) => sum + v, 0) / trs.length;
}

/** Fractal swing detection: a swing high/low is an extreme vs `window` bars each side. */
function detectSwings(candles: Mt5Candle[], window: number): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = window; i < candles.length - window; i += 1) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) swings.push({ type: 'high', price: c.high, time: c.time, index: i });
    if (isLow) swings.push({ type: 'low', price: c.low, time: c.time, index: i });
  }
  return swings.sort((a, b) => a.index - b.index);
}

interface TrendClassification {
  direction: StructureDirection;
  highs: SwingPoint[];
  lows: SwingPoint[];
}

/** Classify trend from the last few swing highs/lows (HH/HL vs LH/LL). */
function classifyTrend(swings: SwingPoint[]): TrendClassification {
  const highs = swings.filter((s) => s.type === 'high').slice(-3);
  const lows = swings.filter((s) => s.type === 'low').slice(-3);

  if (highs.length < 2 || lows.length < 2) {
    return { direction: 'neutral', highs, lows };
  }

  const higherHighs = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const higherLows = lows[lows.length - 1].price > lows[lows.length - 2].price;
  const lowerHighs = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const lowerLows = lows[lows.length - 1].price < lows[lows.length - 2].price;

  if (higherHighs && higherLows) return { direction: 'bullish', highs, lows };
  if (lowerHighs && lowerLows) return { direction: 'bearish', highs, lows };
  // Mixed swings → ranging
  return { direction: 'consolidation', highs, lows };
}

/**
 * Detect the most recent BOS and CHoCH by walking swings in order and
 * tracking when closes break prior swing extremes.
 */
function detectBosChoch(candles: Mt5Candle[], swings: SwingPoint[]): { bos: StructureEvent | null; choch: StructureEvent | null } {
  let bos: StructureEvent | null = null;
  let choch: StructureEvent | null = null;

  const highSwings = swings.filter((s) => s.type === 'high');
  const lowSwings = swings.filter((s) => s.type === 'low');
  if (highSwings.length < 2 || lowSwings.length < 2) return { bos, choch };

  // Track prevailing internal trend as we scan breaks chronologically.
  let trend: 'bullish' | 'bearish' | null = null;

  const breaks: Array<{ dir: 'bullish' | 'bearish'; price: number; time: string; index: number }> = [];
  for (let i = 1; i < candles.length; i += 1) {
    const close = candles[i].close;
    // Most recent confirmed swing high/low strictly before i
    const priorHigh = [...highSwings].reverse().find((s) => s.index < i);
    const priorLow = [...lowSwings].reverse().find((s) => s.index < i);
    if (priorHigh && close > priorHigh.price) {
      breaks.push({ dir: 'bullish', price: priorHigh.price, time: candles[i].time, index: i });
    } else if (priorLow && close < priorLow.price) {
      breaks.push({ dir: 'bearish', price: priorLow.price, time: candles[i].time, index: i });
    }
  }

  for (const br of breaks) {
    if (trend === null) {
      trend = br.dir;
      bos = { direction: br.dir, price: br.price, time: br.time };
    } else if (br.dir === trend) {
      bos = { direction: br.dir, price: br.price, time: br.time };
    } else {
      // Break against prevailing trend → change of character
      choch = { direction: br.dir, price: br.price, time: br.time };
      trend = br.dir;
      bos = { direction: br.dir, price: br.price, time: br.time };
    }
  }

  return { bos, choch };
}

function computeTrendStrength(
  candles: Mt5Candle[],
  trend: TrendClassification,
  atr: number | null,
): number {
  if (candles.length < 20 || atr == null || atr === 0) return 0;
  const recent = candles.slice(-20);
  const first = recent[0].close;
  const last = recent[recent.length - 1].close;
  const netMove = Math.abs(last - first);

  // Net directional move expressed in ATR units (how impulsive vs choppy).
  const atrUnits = netMove / atr;

  // Sum of absolute bar moves — the "path length".
  let pathLength = 0;
  for (let i = 1; i < recent.length; i += 1) {
    pathLength += Math.abs(recent[i].close - recent[i - 1].close);
  }
  // Efficiency ratio: directional move / total path (0 = pure chop, 1 = clean trend).
  const efficiency = pathLength > 0 ? netMove / pathLength : 0;

  // Blend: impulse (capped) and efficiency, scaled to 0-100.
  const impulseScore = Math.min(atrUnits / 6, 1); // ~6 ATR over 20 bars = strong
  const raw = (impulseScore * 0.5 + efficiency * 0.5) * 100;

  // Neutral/consolidation trends should not show high strength.
  const directional = trend.direction === 'bullish' || trend.direction === 'bearish';
  return Math.round(directional ? raw : raw * 0.4);
}

function buildLabel(
  trend: StructureDirection,
  bos: StructureEvent | null,
  choch: StructureEvent | null,
  candles: Mt5Candle[],
): StructureLabel {
  // The latest event (BOS or CHoCH) closest to the end wins the label.
  const lastClose = candles[candles.length - 1]?.close ?? null;

  if (choch && bos) {
    // If CHoCH happened after the BOS's reference, it's the freshest signal.
    if (new Date(choch.time).getTime() >= new Date(bos.time).getTime()) {
      return choch.direction === 'bullish' ? 'CHoCH bullish' : 'CHoCH bearish';
    }
  }
  if (trend === 'consolidation') return 'Consolidation';
  if (trend === 'neutral') return 'Range';
  if (bos) return bos.direction === 'bullish' ? 'Bullish BOS' : 'Bearish BOS';
  if (lastClose != null && trend === 'bullish') return 'Bullish BOS';
  if (lastClose != null && trend === 'bearish') return 'Bearish BOS';
  return 'Range';
}

function buildExplanation(
  tf: Mt5Timeframe,
  trend: StructureDirection,
  label: StructureLabel,
  strength: number,
  rangePct: number | null,
): string {
  const tfName = { W1: 'Weekly', D1: 'Daily', H4: '4H', H1: '1H', M15: '15M' }[tf];
  if (trend === 'bullish') {
    return `${tfName}: higher highs and higher lows with a ${label}. Trend strength ${strength}/100${strength >= 55 ? ' — momentum is constructive.' : ' — momentum is modest, watch for a pullback.'}`;
  }
  if (trend === 'bearish') {
    return `${tfName}: lower highs and lower lows with a ${label}. Trend strength ${strength}/100${strength >= 55 ? ' — sellers in control.' : ' — momentum is modest, watch for a bounce.'}`;
  }
  if (trend === 'consolidation') {
    return `${tfName}: mixed swings — price is consolidating${rangePct != null ? ` within roughly ${rangePct.toFixed(2)}% of range` : ''}. No directional structure confirmed.`;
  }
  return `${tfName}: ranging / no clean swing sequence yet. Treat as neutral until a break of structure prints.`;
}

export function analyzeTimeframeStructure(result: TimeframeCandleResult): TimeframeStructure {
  const { timeframe, candles, available, required } = result;

  if (result.status !== 'ok' || candles.length < required) {
    return {
      timeframe,
      availableCandles: available,
      requiredCandles: required,
      status: 'insufficient_data',
      direction: 'neutral',
      trendStrength: 0,
      structureLabel: 'Insufficient data',
      lastSwingHigh: null,
      lastSwingLow: null,
      lastBOS: null,
      lastCHoCH: null,
      atr: null,
      rangePct: null,
      explanation: `Insufficient MT5 candle history for ${timeframe}.`,
      reason: result.message
        ?? `Only ${available} candles available for ${timeframe}; need at least ${required}.`,
    };
  }

  const window = FRACTAL_WINDOW[timeframe];
  const swings = detectSwings(candles, window);
  const trend = classifyTrend(swings);
  const { bos, choch } = detectBosChoch(candles, swings);
  const atr = computeATR(candles);

  const lastHigh = [...swings].reverse().find((s) => s.type === 'high')?.price ?? null;
  const lastLow = [...swings].reverse().find((s) => s.type === 'low')?.price ?? null;

  // Recent range over last 20 bars as % of price.
  const recent = candles.slice(-20);
  const recHigh = Math.max(...recent.map((c) => c.high));
  const recLow = Math.min(...recent.map((c) => c.low));
  const lastClose = candles[candles.length - 1].close;
  const rangePct = lastClose ? ((recHigh - recLow) / lastClose) * 100 : null;

  const trendStrength = computeTrendStrength(candles, trend, atr);
  const label = buildLabel(trend.direction, bos, choch, candles);
  const explanation = buildExplanation(timeframe, trend.direction, label, trendStrength, rangePct);

  return {
    timeframe,
    availableCandles: available,
    requiredCandles: required,
    status: 'ok',
    direction: trend.direction,
    trendStrength,
    structureLabel: label,
    lastSwingHigh: lastHigh,
    lastSwingLow: lastLow,
    lastBOS: bos,
    lastCHoCH: choch,
    atr,
    rangePct,
    explanation,
  };
}

function directionScore(d: StructureDirection): number {
  if (d === 'bullish') return 1;
  if (d === 'bearish') return -1;
  return 0;
}

export function buildMarketStructure(
  symbol: string,
  candleResults: TimeframeCandleResult[],
): MarketStructureResult {
  const timeframes = candleResults.map(analyzeTimeframeStructure);
  const usable = timeframes.filter((tf) => tf.status === 'ok');

  if (usable.length === 0) {
    return {
      symbol,
      alignmentScore: 0,
      overallDirection: 'neutral',
      timeframes,
      explanation: 'No timeframe has sufficient MT5 candle history yet. Open the charts in MT5 on the VPS so the terminal downloads history.',
    };
  }

  // Weighted directional consensus across timeframes.
  let weightedSum = 0;
  let totalWeight = 0;
  let agreementSum = 0;
  for (const tf of usable) {
    const weight = TF_WEIGHT[tf.timeframe];
    const dir = directionScore(tf.direction);
    // Strength-scaled vote: a strong bullish TF counts more than a weak one.
    const strengthFactor = 0.4 + (tf.trendStrength / 100) * 0.6;
    weightedSum += dir * weight * strengthFactor;
    totalWeight += weight;
    agreementSum += Math.abs(dir) * weight;
  }

  const consensus = totalWeight > 0 ? weightedSum / totalWeight : 0; // -1..1
  const alignmentScore = Math.round(Math.min(100, Math.abs(consensus) * 100 + (agreementSum / (totalWeight || 1)) * 20));

  let overallDirection: MarketStructureResult['overallDirection'];
  if (consensus > 0.25) overallDirection = 'bullish';
  else if (consensus < -0.25) overallDirection = 'bearish';
  else if (Math.abs(consensus) <= 0.1 && agreementSum / (totalWeight || 1) < 0.3) overallDirection = 'consolidation';
  else overallDirection = 'mixed';

  const htf = usable.filter((tf) => ['W1', 'D1', 'H4'].includes(tf.timeframe));
  const ltf = usable.filter((tf) => ['H1', 'M15'].includes(tf.timeframe));
  const htfDir = htf.map((t) => t.direction).join('/') || 'n/a';
  const ltfDir = ltf.map((t) => t.direction).join('/') || 'n/a';

  const explanation = overallDirection === 'mixed'
    ? `Timeframes disagree (HTF: ${htfDir}; LTF: ${ltfDir}). Alignment score ${alignmentScore}/100 — wait for HTF and LTF to agree before committing.`
    : `Multi-timeframe structure is ${overallDirection} (HTF: ${htfDir}; LTF: ${ltfDir}). Alignment score ${alignmentScore}/100.`;

  return { symbol, alignmentScore, overallDirection, timeframes, explanation };
}
